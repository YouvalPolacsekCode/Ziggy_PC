"""
Automation capability catalog for the chat designer (Ziggy "Pro Mode").

Single source of truth for "what can Ziggy build in an automation?" Consumed
by the designer (services.orchestra_designer) when reasoning about a user's
outcome request, and by `/api/debug/capabilities`.

Distinct from `services.capability_catalog` (which catalogs virtual-device
templates for the Ziggy device builder — different domain).

THE RULE (2026-09-18): `ziggy_supported` is COMPUTED from the converters,
never typed by hand. The hand-written part of an entry is its description,
shape, example and the Ziggy-native decline text. Support is true iff:

  triggers    — services.ha_automations._trigger_to_ha handles the kind
  conditions  — BOTH evaluators handle it: local_automation_actions
                ._eval_single_condition and ha_automations._condition_to_ha
                (`state` / `numeric_state` are the entity branch in both)
  actions     — Ziggy's executor runs the step (local_automation_actions
                ._LOCAL_TYPES) — HA either runs it natively or defers it back

Why: the previous hand-curated flags drifted in the one direction the old
drift check could not see — converter-supports / catalog-declines — so chat
told the operator "I can't set up arrivals" while the app's wizard had a zone
trigger and the converter had compiled it for months. `detect_drift()` now
fails in both directions and a test pins it empty.

A deliberate exception is `policy_declined: True` — the converter can, but the
product says no for now (webhook: inbound HTTP needs a security review). That
is an explicit decision, not drift, and the decline text still applies.

User-facing rule (non-negotiable, per project memory): when a capability is
unsupported, Ziggy says "I can't currently do that" in Ziggy-native voice.
NEVER mention "Home Assistant" / "HA" / integration names to end users.
"""
from __future__ import annotations

import copy
import inspect
import re
from typing import Any, Literal

Support = Literal[True, False, "partial"]


# ── HA capability entries (descriptions, shapes, decline text) ───────────────
#
# Schema per entry:
#   id              — HA's name for the primitive (or Ziggy's for a native one)
#   description     — internal/LLM-facing; technical wording is fine
#   shape           — params the LLM passes when composing (dict skeleton)
#   example         — one-line example for the LLM
#   ziggy_via       — which Ziggy primitive currently maps to it (optional)
#   ziggy_note      — internal caveat (optional)
#   policy_declined — True to refuse a converter-supported primitive on purpose
#   decline_*       — Ziggy-native user-facing message when unsupported
#
# `ziggy_supported` is filled in by _annotate(); do not write it here.

_TRIGGERS: list[dict[str, Any]] = [
    {
        "id":          "state",
        "description": "Fire when an entity's state changes (optionally only after it has held that state for a duration).",
        "shape":       {"entity_id": "<entity>", "state": "<value>", "for_minutes": "<optional int>"},
        "example":     "When binary_sensor.bedroom_motion is 'off' for 5 minutes",
    },
    {
        "id":          "numeric_state",
        "description": "Fire when a numeric sensor crosses an above/below threshold.",
        "shape":       {"entity_id": "<sensor>", "above": "<float>", "below": "<float>"},
        "example":     "When sensor.living_room_temperature rises above 28",
    },
    {
        "id":          "time",
        "description": "Fire at a specific wall-clock time.",
        "shape":       {"time": "HH:MM"},
        "example":     "Every day at 07:00",
    },
    {
        "id":          "time_pattern",
        "description": "Fire periodically (every N seconds / minutes / hours).",
        "shape":       {"minutes": "/15", "hours": "/2", "seconds": "/30"},
        "example":     "Every 15 minutes",
    },
    {
        "id":          "sunrise",
        "description": "Fire at sunrise (with optional offset).",
        "shape":       {"offset": "+00:30:00"},
        "example":     "30 minutes after sunrise",
    },
    {
        "id":          "sunset",
        "description": "Fire at sunset (with optional offset).",
        "shape":       {"offset": "-00:15:00"},
        "example":     "15 minutes before sunset",
    },
    {
        "id":          "zone",
        "description": "Fire when a tracked person enters or leaves a geographic zone (HA person entity). "
                       "PREFER the Ziggy-native arrival/departure recipes (welcome_home / leave_home) — "
                       "they run on Ziggy's own presence engine with the whole-house-quiet guard.",
        "shape":       {"entity_id": "person.X", "zone": "zone.home", "event": "enter|leave"},
        "example":     "When person.youval enters zone.home",
        "decline_message_en": "I can't currently set up automations tied to people arriving or leaving home.",
        "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי הגעה או יציאה מהבית.",
    },
    {
        "id":          "controller",
        "description": "Fire when a button on a wireless remote / scene switch is pressed. "
                       "Use the controller ids and action names from home_context.controllers.",
        "shape":       {"controller_id": "<ieee from home_context.controllers>", "action": "<one of that controller's actions, e.g. single_left / double / hold>"},
        "example":     "When the Aqara switch's left button is pressed once",
        "decline_message_en": "I can't currently set up automations on button presses yet.",
        "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי לחיצת כפתור.",
    },
    {
        "id":          "webhook",
        "description": "Fire on an inbound HTTP POST to a custom URL.",
        "shape":       {"webhook_id": "<unique>"},
        "policy_declined": True,
        "ziggy_note":  "Converter exists; declined by POLICY pending a security review of inbound webhooks.",
        "decline_message_en": "I can't currently trigger automations from external web requests.",
        "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות כשמשהו קורא לזיגי מבחוץ.",
    },
    {
        "id":          "template",
        "description": "Fire when an arbitrary Jinja template evaluates to true.",
        "shape":       {"value_template": "{{ ... }}"},
        "decline_message_en": "I can't currently set up triggers based on custom expressions yet.",
        "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי ביטויים שהגדרת בעצמך.",
    },
    {
        "id":          "calendar",
        "description": "Fire N minutes before a calendar event starts/ends.",
        "shape":       {"entity_id": "calendar.X", "event": "start|end", "offset": "-00:30:00"},
        "decline_message_en": "I can't currently trigger automations from calendar events.",
        "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי אירועים מהיומן.",
    },
    {
        "id":          "tag",
        "description": "Fire when an NFC tag is scanned by a registered reader.",
        "shape":       {"tag_id": "<uuid>"},
        "decline_message_en": "I can't currently trigger automations from NFC tag scans.",
        "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי סריקת תג NFC.",
    },
    {
        "id":          "device",
        "description": "Fire on a manufacturer-defined device event. (Button presses are the `controller` trigger.)",
        "shape":       {"device_id": "<id>", "type": "<event>", "subtype": "<button>"},
        "decline_message_en": "I can't currently set up automations on device-specific events yet.",
        "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי אירועים מיוחדים של מכשיר.",
    },
    {
        "id":          "event",
        "description": "Fire on a generic system event.",
        "shape":       {"event_type": "<name>"},
        "decline_message_en": "I can't currently set up automations on low-level system events.",
        "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי אירועים פנימיים של המערכת.",
    },
]

_CONDITIONS: list[dict[str, Any]] = [
    {
        "id":          "state",
        "description": "Require an entity to match a specific state (optionally held for N minutes).",
        "shape":       {"entity_id": "<entity>", "operator": "is|is_not", "value": "<state>", "for_minutes": "<optional int>"},
    },
    {
        "id":          "numeric_state",
        "description": "Require a numeric sensor to be above/below a threshold.",
        "shape":       {"entity_id": "<sensor>", "operator": "above|below", "value": "<float>"},
    },
    {
        "id":          "time_window",
        "description": "Require the wall-clock time to be within after/before (overnight windows allowed).",
        "shape":       {"type": "time", "after": "HH:MM", "before": "HH:MM"},
    },
    {
        "id":          "sun",
        "description": "Require it to be dark (after sunset) or light (before sunset / after sunrise).",
        "shape":       {"type": "sun", "after": "sunset|sunrise", "before": "sunset|sunrise"},
        "decline_message_en": "I can't currently use sun-position conditions yet.",
        "decline_message_he": "אני עדיין לא יודע להתחשב במיקום השמש.",
    },
    {
        "id":          "mode",
        "description": "Require one of the FIXED home modes to be on/off: sleep, movie, cleaning, guest, vacation. "
                       "Never invent another mode.",
        "shape":       {"type": "mode", "mode": "sleep|movie|cleaning|guest|vacation", "is": "true|false"},
        "decline_message_en": "I can't currently use home modes in automations.",
        "decline_message_he": "אני עדיין לא יודע להשתמש במצבי בית באוטומציות.",
    },
    {
        "id":          "presence",
        "description": "Require Ziggy's household presence: everyone away, or someone home.",
        "shape":       {"type": "presence", "value": "all_away|anyone_home", "for_minutes": "<optional int>"},
    },
    {
        "id":          "or_group",
        "description": "Boolean OR of nested conditions.",
        "shape":       {"type": "or", "conditions": "[<condition>, ...]"},
    },
    {
        "id":          "and_group",
        "description": "Boolean AND of nested conditions (a flat list is already AND).",
        "shape":       {"type": "and", "conditions": "[<condition>, ...]"},
    },
]

_ACTIONS: list[dict[str, Any]] = [
    {
        "id":          "call_service",
        "description": "Invoke a service on an entity (turn_on, turn_off, set_temperature, open_cover, ...). "
                       "Light turn_ons should carry respect_hold=true so a light a person switched off stays off.",
        "shape":       {"type": "call_service", "entity_id": "<entity>", "service": "turn_on|turn_off|...",
                        "service_data": "<optional kwargs, e.g. {\"brightness_pct\": 40}>", "respect_hold": "true for light turn_on"},
    },
    {
        "id":          "delay",
        "description": "Pause execution for N seconds.",
        "shape":       {"type": "delay", "seconds": "<int>"},
    },
    {
        "id":          "notify",
        "description": "Send a push notification to the household's phones. Never the ONLY action of a rule.",
        "shape":       {"type": "notify", "message": "<text>"},
    },
    {
        "id":          "wait_for_state",
        "description": "Pause until an entity reaches a target state, with a timeout.",
        "shape":       {"type": "wait_for_state", "entity_id": "<entity>", "state": "<value>", "timeout_seconds": "<int>", "on_timeout": "continue|abort"},
    },
    {
        "id":          "set_mode",
        "description": "Turn one of the fixed home modes on or off, optionally for N hours.",
        "shape":       {"type": "set_mode", "mode": "sleep|movie|cleaning|guest|vacation", "on": "true|false", "hours": "<optional float>"},
    },
    {
        "id":          "turn_off_all_lights",
        "description": "Every light in the home off, in one reliable batch.",
        "shape":       {"type": "turn_off_all_lights"},
    },
    {
        "id":          "ir_command",
        "description": "Send an infrared command (AC, TV, fan) through the home's IR blaster.",
        "shape":       {"type": "ir_command", "ir_device_id": "<id>", "ir_command": "power_on|power_off|..."},
    },
    {
        "id":          "scene_activate",
        "description": "Activate a saved scene.",
        "shape":       {"type": "call_service", "entity_id": "scene.<id>", "service": "turn_on"},
        "ziggy_via":   "call_service with service=scene.turn_on",
    },
    {
        "id":          "wait_for_trigger",
        "description": "Pause until a trigger fires. Only inside blueprint bodies.",
        "ziggy_via":   "ha_native_body escape hatch (blueprints)",
        "decline_message_en": "I can't currently wait for a second event inside one automation.",
        "decline_message_he": "אני עדיין לא יודע לחכות לאירוע נוסף בתוך אותה אוטומציה.",
    },
    {
        "id":          "choose",
        "description": "Conditional branching inside actions. Only inside blueprint bodies.",
        "ziggy_via":   "ha_native_body escape hatch (blueprints)",
        "decline_message_en": "I can't currently branch inside one automation — I'll build one rule per case instead.",
        "decline_message_he": "אני עדיין לא יודע להסתעף בתוך אותה אוטומציה — אבנה כלל נפרד לכל מקרה.",
    },
    {
        "id":          "repeat",
        "description": "Loop a block of actions. Only inside blueprint bodies.",
        "ziggy_via":   "ha_native_body escape hatch (blueprints)",
        "decline_message_en": "I can't currently repeat a block of actions in one automation.",
        "decline_message_he": "אני עדיין לא יודע לחזור על פעולות בתוך אותה אוטומציה.",
    },
]

_MODES: list[dict[str, Any]] = [
    {"id": "single",   "description": "Drop new triggers while running.",                          "tip": "Default. Right for time-based or one-shot routines."},
    {"id": "restart",  "description": "Cancel running instance, start fresh on each new trigger.", "tip": "Use for motion-driven automations so the off-timer resets on each new motion event."},
    {"id": "queued",   "description": "Queue new triggers and run them sequentially."},
    {"id": "parallel", "description": "Run concurrent instances on each new trigger."},
]


# ── Ziggy-native primitives (no HA equivalent) ──────────────────────────────

_ZIGGY_NATIVE: list[dict[str, Any]] = [
    {
        "id": "person_arrives", "kind": "trigger",
        "description": "Fires when a household member arrives home (Ziggy's own presence engine).",
        "shape": {"type": "person_arrives", "person": "*|<name>"},
        "use_when": "'when I get home', 'כשאני מגיע הביתה'. Prefer the welcome_home recipe.",
    },
    {
        "id": "person_leaves", "kind": "trigger",
        "description": "Fires when a household member leaves home.",
        "shape": {"type": "person_leaves", "person": "*|<name>"},
    },
    {
        "id": "all_persons_left", "kind": "trigger",
        "description": "Fires when the LAST person leaves. Honours guest mode automatically.",
        "shape": {"type": "all_persons_left"},
        "use_when": "'when everyone's out'. Prefer the leave_home recipe (adds the whole-house-quiet guard).",
    },
    {
        "id": "zone_entered", "kind": "trigger",
        "description": "Fires when a person enters a named Ziggy place (e.g. 'Near Home').",
        "shape": {"type": "zone_entered", "zone": "<place name>", "person": "*"},
    },
    {
        "id": "zone_left", "kind": "trigger",
        "description": "Fires when a person leaves a named Ziggy place.",
        "shape": {"type": "zone_left", "zone": "<place name>", "person": "*"},
    },
    {
        "id": "manual", "kind": "trigger",
        "description": "Runs only when a person taps Run in the app (an on-demand routine).",
        "shape": {"type": "manual"},
    },
    {
        "id": "recipe", "kind": "automation_create",
        "description": "A tested, deterministic bundle. smart_room(room) | motion_light(room, lights?, linger_minutes?) | "
                       "welcome_home(lights, only_after_dark?) | leave_home(quiet_minutes?, ac?, notify?). "
                       "ALWAYS prefer a recipe when one fits the outcome.",
        "shape": {"recipe": "smart_room|motion_light|welcome_home|leave_home", "...": "params"},
    },
    {
        "id": "ir_command", "kind": "action", "tool": "send_ir_command",
        "description": "Send an IR command via the home's blaster (AC, TV, fan) when the device isn't on a smart protocol.",
    },
    {
        "id": "blueprint_instantiation", "kind": "automation_create", "tool": "instantiate_blueprint",
        "description": "Create an automation from a pre-validated bundled template. Every input that names a device MUST be a real entity id from the home context.",
    },
]


# ── Introspection ────────────────────────────────────────────────────────────

_ALIAS = {"time_window": "time", "or_group": "or", "and_group": "and", "scene_activate": "call_service"}
_ENTITY_CONDITION_TYPES = {"state", "numeric_state"}   # the entity branch in both evaluators


def _source_of(fn) -> str:
    try:
        return inspect.getsource(fn)
    except Exception:
        return ""


def _introspect_converter_triggers() -> set[str]:
    """Trigger kinds `_trigger_to_ha` actually handles (`kind == "x"` and
    `kind in ("a", "b")`)."""
    try:
        from services.ha_automations import _trigger_to_ha
    except Exception:
        return set()
    src = _source_of(_trigger_to_ha)
    found = set(re.findall(r"kind\s*==\s*['\"](\w+)['\"]", src))
    for tup in re.findall(r"kind\s+in\s*\(([^)]+)\)", src):
        found.update(re.findall(r"['\"](\w+)['\"]", tup))
    return found


def _introspect_local_condition_types() -> set[str]:
    try:
        from services.local_automation_actions import _eval_single_condition
    except Exception:
        return set()
    src = _source_of(_eval_single_condition)
    found = set(re.findall(r"ctype\s*==\s*['\"](\w+)['\"]", src))
    return found | _ENTITY_CONDITION_TYPES


def _introspect_ha_condition_types() -> set[str]:
    try:
        from services.ha_automations import _condition_to_ha
    except Exception:
        return set()
    src = _source_of(_condition_to_ha)
    found = set(re.findall(r"c\.get\(\"type\"\)\s*==\s*['\"](\w+)['\"]", src))
    return found | _ENTITY_CONDITION_TYPES


def _introspect_condition_types() -> set[str]:
    """Supported iff BOTH evaluators handle it. Boolean groups are local-only
    (HA gets them via native bodies) but never split a decision, so they pass."""
    both = _introspect_local_condition_types() & _introspect_ha_condition_types()
    return both | ({"and", "or", "not"} & _introspect_local_condition_types())


def _introspect_action_types() -> set[str]:
    try:
        from services.local_automation_actions import _LOCAL_TYPES
        return set(_LOCAL_TYPES)
    except Exception:
        return set()


def _introspect_tool_schema_triggers() -> set[str]:
    try:
        from core.tools_schema import TOOLS
    except Exception:
        return set()
    for entry in TOOLS:
        fn = entry.get("function", {}) if isinstance(entry, dict) else {}
        if fn.get("name") != "create_automation":
            continue
        props = (fn.get("parameters", {}) or {}).get("properties", {}) or {}
        return set((props.get("trigger_type", {}) or {}).get("enum") or [])
    return set()


# ── Annotation ───────────────────────────────────────────────────────────────

def _supported_ids(kind: str) -> set[str]:
    if kind == "triggers":
        return _introspect_converter_triggers()
    if kind == "conditions":
        return _introspect_condition_types()
    if kind == "actions":
        return _introspect_action_types()
    return set()


def _annotate(kind: str, entries: list[dict]) -> list[dict]:
    supported = _supported_ids(kind)
    out: list[dict] = []
    for e in entries:
        c = copy.deepcopy(e)
        target = _ALIAS.get(c["id"], c["id"])
        can = target in supported
        if c.get("policy_declined"):
            c["ziggy_supported"] = False
        else:
            c["ziggy_supported"] = bool(can)
        c.setdefault("decline_message_en", "I can't currently do that.")
        c.setdefault("decline_message_he", "אני עדיין לא יודע לעשות את זה.")
        out.append(c)
    return out


# ── Public API ───────────────────────────────────────────────────────────────

def get_catalog() -> dict:
    """Full catalog snapshot — HA capabilities annotated for Ziggy support
    (computed), Ziggy-native primitives, live blueprint enumeration."""
    caps = {
        "triggers":   _annotate("triggers", _TRIGGERS),
        "conditions": _annotate("conditions", _CONDITIONS),
        "actions":    _annotate("actions", _ACTIONS),
        "modes":      [dict(m, ziggy_supported=True) for m in _MODES],
    }
    return {
        "ha_capabilities": caps,
        "ziggy_native":    copy.deepcopy(_ZIGGY_NATIVE),
        "home_modes":      ["sleep", "movie", "cleaning", "guest", "vacation"],
        "blueprints":      _blueprints_summary(),
        "summary": {
            "trigger_supported":   _count_supported(caps["triggers"]),
            "condition_supported": _count_supported(caps["conditions"]),
            "action_supported":    _count_supported(caps["actions"]),
            "ziggy_native_count":  len(_ZIGGY_NATIVE),
        },
    }


def get_supported_only() -> dict:
    """Catalog filtered to what Ziggy CAN do today. Default designer context."""
    full = get_catalog()
    for kind in ("triggers", "conditions", "actions"):
        full["ha_capabilities"][kind] = [
            c for c in full["ha_capabilities"][kind] if c.get("ziggy_supported") in (True, "partial")
        ]
    return full


def get_gaps() -> list[dict]:
    """Unsupported primitives with Ziggy-native decline messages."""
    gaps: list[dict] = []
    caps = get_catalog()["ha_capabilities"]
    for kind in ("triggers", "conditions", "actions"):
        for c in caps[kind]:
            if c.get("ziggy_supported") is False:
                gaps.append({
                    "kind":               kind[:-1],
                    "id":                 c["id"],
                    "decline_message_en": c["decline_message_en"],
                    "decline_message_he": c["decline_message_he"],
                })
    return gaps


def detect_drift() -> dict:
    """Mismatches between the catalog entries and the live converters, BOTH ways.

      missing_in_converter                    catalog says supported, converter has no branch
      missing_in_catalog                      converter handles a trigger the catalog doesn't list
      tool_schema_unknown                     create_automation exposes a trigger the catalog doesn't list
      converter_supports_but_catalog_declines an entry reads unsupported although the converter can
                                              (policy_declined entries are exempt — explicit decision)
      catalog_entry_missing_for_converter     a condition/action type the evaluators handle with no entry
    """
    drift: dict[str, list] = {
        "missing_in_converter": [], "missing_in_catalog": [], "tool_schema_unknown": [],
        "converter_supports_but_catalog_declines": [], "catalog_entry_missing_for_converter": [],
    }
    caps = get_catalog()["ha_capabilities"]
    for kind in ("triggers", "conditions", "actions"):
        supported = _supported_ids(kind)
        listed = {_ALIAS.get(c["id"], c["id"]) for c in caps[kind]}
        for c in caps[kind]:
            target = _ALIAS.get(c["id"], c["id"])
            if c.get("ziggy_supported") is True and target not in supported:
                drift["missing_in_converter"].append(f"{kind[:-1]}:{c['id']}")
            if c.get("ziggy_supported") is False and target in supported and not c.get("policy_declined"):
                drift["converter_supports_but_catalog_declines"].append(f"{kind[:-1]}:{c['id']}")
        if kind == "triggers":
            for tid in supported - listed:
                drift["missing_in_catalog"].append(tid)
            for tid in _introspect_tool_schema_triggers() - listed:
                drift["tool_schema_unknown"].append(tid)
        else:
            internal = {"device", "message", "send_intent", "ziggy_intent", "automation", "speak",
                        "notify_actionable", "wait_cancellable", "cancel_pending", "device_command",
                        "save_entity_states", "restore_entity_states", "fake_occupancy_start",
                        "media_play", "turn_off_everything", "ir_device_state", "not"}
            for tid in sorted((supported - listed) - internal):
                drift["catalog_entry_missing_for_converter"].append(f"{kind[:-1]}:{tid}")
    return drift


# ── Helpers ──────────────────────────────────────────────────────────────────

def _blueprints_summary() -> list[dict]:
    try:
        from services.blueprint_importer import list_blueprints
        bps = list_blueprints()
    except Exception:
        return []
    out: list[dict] = []
    for b in bps:
        out.append({
            "id":             getattr(b, "id", ""),
            "name":           getattr(b, "name", ""),
            "name_he":        getattr(b, "name_he", "") or "",
            "description":    (getattr(b, "description", "") or "")[:200],
            "description_he": getattr(b, "description_he", "") or "",
            "category":       getattr(b, "category", "blueprint"),
            "inputs": [
                {"key": getattr(i, "key", ""), "name": getattr(i, "name", ""), "required": getattr(i, "required", False)}
                for i in getattr(b, "inputs", [])
            ],
        })
    return out


def _count_supported(items: list[dict]) -> dict:
    return {
        "true":    sum(1 for c in items if c.get("ziggy_supported") is True),
        "partial": sum(1 for c in items if c.get("ziggy_supported") == "partial"),
        "false":   sum(1 for c in items if c.get("ziggy_supported") is False),
        "total":   len(items),
    }
