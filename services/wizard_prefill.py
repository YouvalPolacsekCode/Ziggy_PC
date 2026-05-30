"""
Adapter that maps a habit-based suggestion (from suggestion_engine /
suggestion_manager) into the AutomationWizard prefill shape.

The device-based template path already emits prefill via
services.automation_templates.build_prefill(). This module is the
habit-side equivalent, so the Configure button on a habit card opens
the same wizard pre-populated with sensible defaults derived from the
detected pattern.

Wizard prefill shape — consumed by frontend/src/pages/Automations.jsx
AutomationWizard `initial` prop:

    {
        "name":        str,
        "description": str,
        "trigger":     dict,        # time | state | manual
        "conditions":  list[dict],  # entity-state or time-window rows
        "actions":     list[dict],  # call_service | send_intent | notify | ...
        "rooms":       list[str],
    }

Wizard trigger conventions (from AutomationWizard / TriggerEditor):
    {"type": "time",  "time": "HH:MM"}                       — time of day
    {"type": "state", "entity_id": "...", "state": "..."}    — entity state change
    {"type": "manual"}                                       — placeholder, user picks

Habit suggestion `trigger` field on disk uses {"type": "time", "value": "HH:MM"}
for time-based and {"type": "sequence", "value": "<intent> in <room>"} for
sequence patterns, so a small translation is required before handing to the
wizard.
"""
from __future__ import annotations

from typing import Any


def habit_to_wizard_prefill(suggestion: dict[str, Any]) -> dict[str, Any]:
    """
    Convert a persisted habit suggestion (the dict shape produced by
    services.suggestion_manager.add_suggestion()) into the AutomationWizard
    prefill shape.

    The output is JSON-serializable and matches what frontend/src/pages/
    Automations.jsx AutomationWizard expects as its `initial` prop. Callers
    are free to override any field before showing the wizard.

    Never raises on malformed input — missing fields default to safe values
    so the wizard always opens with something the user can edit.
    """
    pattern_type = suggestion.get("pattern_type") or ""

    if pattern_type == "sequence":
        trigger, conditions = _sequence_trigger(suggestion)
    else:
        trigger = _time_or_passthrough_trigger(suggestion)
        conditions = []

    actions = _convert_actions(suggestion.get("actions") or [])

    name = _derive_name(suggestion)
    description = _derive_description(suggestion)
    rooms = _derive_rooms(suggestion)

    return {
        "name":        name,
        "description": description,
        "trigger":     trigger,
        "conditions":  conditions,
        "actions":     actions,
        "rooms":       rooms,
    }


# ---------------------------------------------------------------------------
# Trigger conversion
# ---------------------------------------------------------------------------

def _time_or_passthrough_trigger(suggestion: dict[str, Any]) -> dict[str, Any]:
    """
    Convert a habit suggestion trigger to the wizard's trigger shape.

    Habit time triggers are {"type":"time","value":"HH:MM"} but the wizard
    keeps time-of-day in `time`, not `value`. Translate, but tolerate either
    field on the way in. Anything else is passed through unchanged so the
    user can correct it inside the wizard.
    """
    src = suggestion.get("trigger") or {}
    src_type = src.get("type")

    if src_type == "time":
        hhmm = str(src.get("time") or src.get("value") or "").strip()
        return {"type": "time", "time": hhmm}

    if src_type == "state":
        # Already wizard-compatible.
        return {
            "type":       "state",
            "entity_id":  src.get("entity_id", ""),
            "state":      src.get("state", ""),
            **({"for_minutes": src["for_minutes"]} if src.get("for_minutes") else {}),
        }

    # Anything we don't recognise (incl. legacy "manual" / "sequence" /
    # truly empty triggers) → manual placeholder so the wizard opens cleanly
    # and the user can pick a real trigger.
    return {"type": "manual"}


def _sequence_trigger(suggestion: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Sequence patterns describe "B fires shortly after A". Per Prompt 1:
    map trigger = first action's entity changing, and add a 'within 5 min'
    window as a condition so the user sees the temporal coupling.

    The habit suggestion stores action B in `actions[0]` and references
    action A's intent + room through the canonical_key + trigger.value
    string ("toggle_device in kitchen"). We can rarely recover a concrete
    entity_id for A from the persisted shape, so the trigger is left as a
    manual placeholder when no entity is available — the user will pick
    the exact device in the wizard. The condition still encodes the
    "within 5 min" hint regardless.
    """
    src = suggestion.get("trigger") or {}
    label = str(src.get("value") or "").strip()

    # A entity is not persisted in the suggestion dict — emit a manual
    # trigger and put the human-readable hint into the description so the
    # user knows what to pick.
    trigger: dict[str, Any] = {"type": "manual"}
    if label:
        trigger["hint"] = label

    # Synthetic time-window condition. ConditionRow tolerates `type='time'`
    # rows with after/before bounds; we encode the 5-minute coupling as a
    # comment-style time-window the user can adjust or remove.
    conditions: list[dict[str, Any]] = [
        {
            "type":  "time",
            "after": "",
            "before": "",
            "note":  "within 5 min of the triggering event",
        }
    ]
    return trigger, conditions


# ---------------------------------------------------------------------------
# Action conversion
# ---------------------------------------------------------------------------

def _convert_actions(habit_actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Habit actions are {"intent": "...", "params": {...}} pairs. The wizard
    expects discriminated action dicts (call_service / send_intent / notify
    / ...). We always have an intent name, so the safest, lossless conversion
    is `send_intent` — which the local automation engine already supports
    via local_automation_actions.execute_action() and which preserves the
    full intent + params payload for the user to refine later.
    """
    out: list[dict[str, Any]] = []
    for a in habit_actions:
        if not isinstance(a, dict):
            continue
        intent = a.get("intent")
        if not intent:
            continue
        params = a.get("params") or {}
        text = _intent_to_natural_text(intent, params)
        out.append({
            "type":   "send_intent",
            "text":   text,
            "intent": intent,
            "params": params,
        })
    return out


def _intent_to_natural_text(intent: str, params: dict[str, Any]) -> str:
    """
    Build a short, human-readable phrase from an intent + params pair so
    the wizard's send_intent step shows a sensible default. Hebrew RTL is
    fine inside the wizard input (dir="auto" everywhere), but the wizard's
    actual *execution* path treats `text` as a natural-language utterance,
    so English here keeps the intent resolver's job predictable. The user
    can rewrite to Hebrew (or anything) inside the wizard.
    """
    room = (params.get("room") or "").strip() if isinstance(params, dict) else ""

    if intent == "toggle_device":
        on = bool(params.get("turn_on", True)) if isinstance(params, dict) else True
        verb = "Turn on" if on else "Turn off"
        if room:
            return f"{verb} the {room} device"
        return f"{verb} the device"

    if intent == "turn_on_light":
        return f"Turn on the {room} light" if room else "Turn on the light"
    if intent == "turn_off_light":
        return f"Turn off the {room} light" if room else "Turn off the light"
    if intent == "set_brightness":
        return f"Set the {room} brightness" if room else "Set the brightness"
    if intent == "control_ac":
        return f"Control the {room} AC" if room else "Control the AC"

    # Generic fallback — readable enough for the user to recognise and edit.
    pretty = intent.replace("_", " ")
    return f"{pretty} in {room}" if room else pretty


# ---------------------------------------------------------------------------
# Misc derivations
# ---------------------------------------------------------------------------

def _derive_name(suggestion: dict[str, Any]) -> str:
    """Short, editable name. Prefer pattern_summary, fall back to canonical key."""
    summary = (suggestion.get("pattern_summary") or "").strip()
    if summary:
        # First sentence is usually compact enough for a name field.
        first = summary.split(".")[0].strip()
        return first[:80]
    key = (suggestion.get("canonical_key") or "").strip()
    return key[:80] if key else "Suggested automation"


def _derive_description(suggestion: dict[str, Any]) -> str:
    """Longer-form explanation — pattern_summary + reasoning if both exist."""
    summary = (suggestion.get("pattern_summary") or "").strip()
    reasoning = (suggestion.get("reasoning") or "").strip()
    if summary and reasoning and summary != reasoning:
        return f"{summary}\n\n{reasoning}"
    return summary or reasoning or ""


def _derive_rooms(suggestion: dict[str, Any]) -> list[str]:
    """Collect any `room` values referenced by the suggestion's actions."""
    rooms: list[str] = []
    for a in suggestion.get("actions") or []:
        if not isinstance(a, dict):
            continue
        params = a.get("params")
        if isinstance(params, dict):
            r = params.get("room")
            if r and r not in rooms:
                rooms.append(r)
    return rooms
