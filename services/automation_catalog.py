"""
Automation capability catalog for Ziggy Pro Mode (Session D1).

Single source of truth for "what can Ziggy build in an automation?" Consumed
by the Ziggy Pro designer (D3) when reasoning about a user's outcome request.
Also feeds `/api/debug/capabilities`.

Distinct from `services.capability_catalog` (which catalogs virtual-device
templates for the Ziggy device builder — different domain).

Two halves:

1. HAND-CURATED CATALOG (`_HA_CAPABILITIES` below) — the full HA automation
   capability surface (triggers/conditions/actions/modes) annotated with
   `ziggy_supported: true | "partial" | false`. List of capabilities is
   stable across HA versions; only the support flags change as Ziggy grows.

2. RUNTIME INTROSPECTION (`detect_drift`) — reads the live system
   (tools_schema, the converter shape) to detect mismatches between the
   curated catalog and reality.

User-facing rule (non-negotiable, per project memory): when a capability is
unsupported, Ziggy says "I can't currently do that" in Ziggy-native voice.
NEVER mention "Home Assistant" / "HA" / integration names to end users. Each
gap entry carries `decline_message_en` and `decline_message_he` for D3 to
compose user-facing rejections without leaking jargon.
"""
from __future__ import annotations
from typing import Any, Literal
import copy

Support = Literal[True, False, "partial"]


# ── HA capability catalog ────────────────────────────────────────────────────
#
# Schema per entry:
#   id            — HA's name for the primitive
#   description   — internal/LLM-facing; technical wording is fine
#   shape         — params the LLM passes when composing (dict skeleton)
#   ziggy_supported — true | false | "partial"
#   ziggy_via     — which Ziggy primitive currently maps to it (optional)
#   ziggy_note    — internal caveat for partial / false support
#   decline_*     — Ziggy-native user-facing message when ziggy_supported=false
#                   (NEVER mentions HA / integrations / brand names)
#   example       — one-line example for the LLM
#
# When adding a new HA primitive here, also extend the relevant Ziggy
# converter (ha_automations._trigger_to_ha / _action_to_ha / save_automation)
# and flip ziggy_supported. Don't ship an entry as `true` without the
# converter wired up — `detect_drift()` will surface the mismatch.

_HA_CAPABILITIES: dict[str, list[dict[str, Any]]] = {
    "triggers": [
        {
            "id":              "state",
            "description":     "Fire when an entity's state changes (optionally only after it has held that state for a duration).",
            "shape":           {"entity_id": "<entity>", "state": "<value>", "for_minutes": "<optional int>"},
            "ziggy_supported": True,
            "example":         "When binary_sensor.bedroom_motion is 'off' for 5 minutes",
        },
        {
            "id":              "numeric_state",
            "description":     "Fire when a numeric sensor crosses an above/below threshold.",
            "shape":           {"entity_id": "<sensor>", "above": "<float>", "below": "<float>"},
            "ziggy_supported": True,
            "example":         "When sensor.living_room_temperature rises above 28",
        },
        {
            "id":              "time",
            "description":     "Fire at a specific wall-clock time.",
            "shape":           {"time": "HH:MM"},
            "ziggy_supported": True,
            "example":         "Every day at 07:00",
        },
        {
            "id":              "time_pattern",
            "description":     "Fire periodically (every N seconds / minutes / hours).",
            "shape":           {"minutes": "/15", "hours": "/2", "seconds": "/30"},
            "ziggy_supported": "partial",
            "ziggy_via":       "ziggy_scheduler",
            "ziggy_note":      "Currently routed to Ziggy's local scheduler (needs_ha doesn't list time_pattern). Functionally works; add to needs_ha if HA-native scheduling is preferred.",
            "example":         "Every 15 minutes",
        },
        {
            "id":              "sunrise",
            "description":     "Fire at sunrise (with optional offset).",
            "shape":           {"offset": "+00:30:00"},
            "ziggy_supported": True,
            "example":         "30 minutes after sunrise",
        },
        {
            "id":              "sunset",
            "description":     "Fire at sunset (with optional offset).",
            "shape":           {"offset": "-00:15:00"},
            "ziggy_supported": True,
            "example":         "15 minutes before sunset",
        },
        {
            "id":                 "zone",
            "description":        "Fire when a person enters or leaves a geographic zone.",
            "shape":              {"entity_id": "person.X", "zone": "zone.home", "event": "enter|leave"},
            "ziggy_supported":    False,
            "ziggy_note":         "Converter exists but not exposed via create_automation; also requires HA-Companion GPS feed we don't ingest. presence_engine is the Ziggy-native path.",
            "decline_message_en": "I can't currently set up automations tied to people arriving or leaving home.",
            "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי הגעה או יציאה מהבית.",
        },
        {
            "id":                 "webhook",
            "description":        "Fire on an inbound HTTP POST to a custom URL.",
            "shape":              {"webhook_id": "<unique>"},
            "ziggy_supported":    False,
            "ziggy_note":         "Converter exists; handler doesn't expose. Security review needed before opening.",
            "decline_message_en": "I can't currently trigger automations from external web requests.",
            "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות כשמשהו קורא לזיגי מבחוץ.",
        },
        {
            "id":                 "template",
            "description":        "Fire when an arbitrary Jinja template evaluates to true.",
            "shape":              {"value_template": "{{ ... }}"},
            "ziggy_supported":    False,
            "decline_message_en": "I can't currently set up triggers based on custom expressions yet.",
            "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי ביטויים שהגדרת בעצמך.",
        },
        {
            "id":                 "calendar",
            "description":        "Fire N minutes before a calendar event starts/ends.",
            "shape":              {"entity_id": "calendar.X", "event": "start|end", "offset": "-00:30:00"},
            "ziggy_supported":    False,
            "decline_message_en": "I can't currently trigger automations from calendar events.",
            "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי אירועים מהיומן.",
        },
        {
            "id":                 "tag",
            "description":        "Fire when an NFC tag is scanned by a registered reader.",
            "shape":              {"tag_id": "<uuid>"},
            "ziggy_supported":    False,
            "decline_message_en": "I can't currently trigger automations from NFC tag scans.",
            "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי סריקת תג NFC.",
        },
        {
            "id":                 "device",
            "description":        "Fire on a manufacturer-defined device event (button single/double/long-press, etc.).",
            "shape":              {"device_id": "<id>", "type": "<event>", "subtype": "<button>"},
            "ziggy_supported":    False,
            "decline_message_en": "I can't currently set up automations on button presses or other device-specific events yet.",
            "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי לחיצת כפתור או אירועים מיוחדים אחרים.",
        },
        {
            "id":                 "event",
            "description":        "Fire on a generic system event.",
            "shape":              {"event_type": "<name>"},
            "ziggy_supported":    False,
            "decline_message_en": "I can't currently set up automations on low-level system events.",
            "decline_message_he": "אני עדיין לא יודע להפעיל אוטומציות לפי אירועים פנימיים של המערכת.",
        },
    ],
    "conditions": [
        {
            "id":              "state",
            "description":     "Require an entity to match a specific state.",
            "shape":           {"entity_id": "<entity>", "operator": "is|is_not", "value": "<state>"},
            "ziggy_supported": True,
        },
        {
            "id":              "numeric_state",
            "description":     "Require a numeric sensor to be above/below a threshold.",
            "shape":           {"entity_id": "<sensor>", "operator": "above|below", "value": "<float>"},
            "ziggy_supported": True,
        },
        {
            "id":              "time_window",
            "description":     "Require current wall-clock time to be within after/before (supports overnight).",
            "shape":           {"after": "HH:MM", "before": "HH:MM"},
            "ziggy_supported": "partial",
            "ziggy_via":       "local_automation_actions",
            "ziggy_note":      "Local evaluator supports it (local_automation_actions._eval_single_condition); not yet plumbed through the LLM-creation handler (still builds flat AND list).",
        },
        {
            "id":              "or_group",
            "description":     "Boolean OR of nested conditions.",
            "shape":           {"conditions": "[<condition>, ...]"},
            "ziggy_supported": "partial",
            "ziggy_note":      "Local evaluator supports recursive AND/OR groups; creation handler doesn't expose.",
        },
        {
            "id":              "and_group",
            "description":     "Boolean AND of nested conditions (equivalent to a flat list).",
            "ziggy_supported": "partial",
            "ziggy_note":      "Flat AND already supported; nested groups via local evaluator only.",
        },
        {
            "id":                 "sun",
            "description":        "Require sun to be above/below the horizon.",
            "shape":              {"after": "sunrise|sunset", "before": "sunrise|sunset", "elevation": "<deg>"},
            "ziggy_supported":    False,
            "decline_message_en": "I can't currently use sun-position conditions yet.",
            "decline_message_he": "אני עדיין לא יודע להתחשב במיקום השמש.",
        },
    ],
    "actions": [
        {
            "id":              "call_service",
            "description":     "Invoke a service on an entity (turn_on, turn_off, set_temperature, open_cover, etc.).",
            "shape":           {"entity_id": "<entity>", "service": "turn_on|turn_off|...", "data": "<optional kwargs>"},
            "ziggy_supported": True,
        },
        {
            "id":              "delay",
            "description":     "Pause execution for N seconds.",
            "shape":           {"seconds": "<int>"},
            "ziggy_supported": True,
        },
        {
            "id":              "notify",
            "description":     "Send a push/persistent notification.",
            "shape":           {"message": "<text>"},
            "ziggy_supported": True,
        },
        {
            "id":              "wait_for_state",
            "description":     "Pause until an entity reaches a target state, with optional timeout.",
            "shape":           {"entity_id": "<entity>", "state": "<value>", "timeout": "<sec>"},
            "ziggy_supported": True,
        },
        {
            "id":              "wait_for_trigger",
            "description":     "Pause until a trigger fires (e.g. 'until motion stops for 5 minutes').",
            "ziggy_supported": "partial",
            "ziggy_via":       "ha_native_body escape hatch",
            "ziggy_note":      "Available when emitted by blueprint instantiation (save_automation uses ha_native_body for blueprints); not exposed via direct create_automation actions list.",
        },
        {
            "id":              "scene_activate",
            "description":     "Activate a saved scene (atomic group state restore).",
            "shape":           {"entity_id": "scene.<id>"},
            "ziggy_supported": True,
            "ziggy_via":       "call_service with service=scene.turn_on",
        },
        {
            "id":              "choose",
            "description":     "Conditional branching (if/elif/else within actions).",
            "ziggy_supported": "partial",
            "ziggy_via":       "ha_native_body escape hatch",
            "ziggy_note":      "Available in blueprint instantiation; not in direct create_automation.",
        },
        {
            "id":              "repeat",
            "description":     "Loop a block of actions N times or while a condition holds.",
            "ziggy_supported": "partial",
            "ziggy_via":       "ha_native_body escape hatch",
        },
    ],
    "modes": [
        {"id": "single",   "description": "Drop new triggers while running.",                          "ziggy_supported": True, "tip": "Default. Right for time-based or one-shot routines."},
        {"id": "restart",  "description": "Cancel running instance, start fresh on each new trigger.", "ziggy_supported": True, "tip": "Use for motion-driven automations so the off-timer resets on each new motion event."},
        {"id": "queued",   "description": "Queue new triggers and run them sequentially.",             "ziggy_supported": True},
        {"id": "parallel", "description": "Run concurrent instances on each new trigger.",             "ziggy_supported": True},
    ],
}


# ── Ziggy-native primitives (no HA equivalent) ──────────────────────────────
#
# Things Ziggy can do that aren't HA automation shapes. These are full tools
# the LLM can compose into a bundle alongside automations.

_ZIGGY_NATIVE: list[dict[str, Any]] = [
    {
        "id":          "occupancy_sensor",
        "kind":        "sensor_create",
        "tool":        "create_occupancy_sensor",
        "description": "Create a binary sensor that ORs multiple presence signals (motion + presence + door) into one 'occupied' entity.",
        "params":      {"room": "<slug>", "sensor_entities": ["<entity>", "..."], "friendly_name": "<display>"},
        "use_when":    "User wants 'is this room occupied' as a single signal automations can reference, especially when fusing motion + mmWave + door sensors.",
    },
    {
        "id":          "kv_state",
        "kind":        "state_store",
        "tool":        "set_local_state",
        "description": "Persistent boolean/string flag stored in Ziggy (sleep_mode, guest_mode, vacation_mode, etc.). Survives restarts.",
        "params":      {"namespace": "modes", "key": "<flag>", "value": "<json>"},
        "use_when":    "Bundle needs a shared toggle that multiple automations reference as a condition.",
    },
    {
        "id":          "ir_command",
        "kind":        "action",
        "tool":        "send_ir_command",
        "description": "Send an IR command via Broadlink (AC, TV, fan, etc.). Use when the target device isn't on a smart protocol.",
        "use_when":    "Action target is IR-controlled (older AC, TV, etc.) rather than smart-protocol controlled.",
    },
    {
        "id":          "blueprint_instantiation",
        "kind":        "automation_create",
        "tool":        "instantiate_blueprint",
        "description": "Create an automation from a pre-validated bundled template. Hebrew-translated, Israeli-defaulted, includes HA-only constructs (wait_for_trigger, choose, etc.) that direct create_automation can't currently emit.",
        "use_when":    "Outcome matches a bundled template's purpose. PREFER blueprints over composing from scratch when one fits — pre-tested, Hebrew-ready, bypasses some Ziggy-side limitations via the ha_native_body escape hatch.",
    },
]


# ── Public API ───────────────────────────────────────────────────────────────


def get_catalog() -> dict:
    """Full catalog snapshot — HA capabilities annotated for Ziggy support,
    plus Ziggy-native primitives, plus live blueprint enumeration.

    Designed for LLM context (D3 designer). Returned dict is JSON-serializable.
    """
    out: dict[str, Any] = {
        "ha_capabilities": copy.deepcopy(_HA_CAPABILITIES),
        "ziggy_native":    copy.deepcopy(_ZIGGY_NATIVE),
        "blueprints":      _blueprints_summary(),
        "summary": {
            "trigger_supported":   _count_supported("triggers"),
            "condition_supported": _count_supported("conditions"),
            "action_supported":    _count_supported("actions"),
            "ziggy_native_count":  len(_ZIGGY_NATIVE),
        },
    }
    return out


def get_supported_only() -> dict:
    """Catalog filtered to what Ziggy CAN do today (true + partial).

    Default LLM context — gaps (false entries) surface only when the user
    asks for something we can't do, so the designer doesn't waste tokens
    reasoning about them on every call.
    """
    full = get_catalog()
    for kind in ("triggers", "conditions", "actions"):
        full["ha_capabilities"][kind] = [
            c for c in full["ha_capabilities"][kind]
            if c.get("ziggy_supported") in (True, "partial")
        ]
    return full


def get_gaps() -> list[dict]:
    """Just the unsupported HA primitives, each with Ziggy-native decline
    messages. The designer uses this to compose 'I can't currently do that'
    replies without leaking HA / integration names.
    """
    gaps: list[dict] = []
    for kind, entries in _HA_CAPABILITIES.items():
        if kind == "modes":
            continue
        for c in entries:
            if c.get("ziggy_supported") is False:
                gaps.append({
                    "kind":               kind[:-1],  # "triggers" → "trigger"
                    "id":                 c["id"],
                    "decline_message_en": c.get("decline_message_en", "I can't currently do that."),
                    "decline_message_he": c.get("decline_message_he", "אני עדיין לא יודע לעשות את זה."),
                })
    return gaps


def detect_drift() -> dict:
    """Surface mismatches between the hand-curated catalog and the live system.

    Returns:
      {
        "missing_in_converter": [...]   catalog says supported but converter has no branch
        "missing_in_catalog":    [...]  converter handles a trigger the catalog doesn't list
        "tool_schema_unknown":   [...]  create_automation tool exposes a trigger_type the catalog doesn't list
      }
    """
    drift: dict[str, list] = {
        "missing_in_converter": [],
        "missing_in_catalog":   [],
        "tool_schema_unknown":  [],
    }
    converter_triggers = _introspect_converter_triggers()
    catalog_trigger_ids = {c["id"] for c in _HA_CAPABILITIES["triggers"]}
    for cap in _HA_CAPABILITIES["triggers"]:
        if cap.get("ziggy_supported") in (True, "partial") and cap["id"] not in converter_triggers:
            drift["missing_in_converter"].append(cap["id"])
    for tid in converter_triggers:
        if tid not in catalog_trigger_ids:
            drift["missing_in_catalog"].append(tid)
    schema_triggers = _introspect_tool_schema_triggers()
    for tid in schema_triggers:
        if tid not in catalog_trigger_ids:
            drift["tool_schema_unknown"].append(tid)
    return drift


# ── Introspectors ────────────────────────────────────────────────────────────


def _introspect_converter_triggers() -> set[str]:
    """Scrape _trigger_to_ha for the trigger kinds it actually handles.

    Reads the source rather than executing — keeps the scan side-effect-free
    and resilient to runtime config issues. Catches both:
      `if kind == "state":`            single equality
      `if kind in ("sunrise", "sunset"):`  tuple membership
    """
    import inspect
    import re
    try:
        from services.ha_automations import _trigger_to_ha
        src = inspect.getsource(_trigger_to_ha)
    except Exception:
        return set()
    found: set[str] = set()
    found.update(re.findall(r"kind\s*==\s*['\"](\w+)['\"]", src))
    # Tuple-membership form: kind in ("a", "b", ...)
    for tup_body in re.findall(r"kind\s+in\s*\(([^)]+)\)", src):
        found.update(re.findall(r"['\"](\w+)['\"]", tup_body))
    return found


def _introspect_tool_schema_triggers() -> set[str]:
    """Scrape the create_automation tool schema for the trigger_type enum.

    If the LLM-facing schema lists a trigger type that's not in our catalog,
    something is out of sync.
    """
    try:
        from core.tools_schema import TOOLS
    except Exception:
        return set()
    for entry in TOOLS:
        fn = entry.get("function", {}) if isinstance(entry, dict) else {}
        if fn.get("name") != "create_automation":
            continue
        props = (fn.get("parameters", {}) or {}).get("properties", {}) or {}
        enum = (props.get("trigger_type", {}) or {}).get("enum") or []
        return set(enum)
    return set()


def _blueprints_summary() -> list[dict]:
    """Enumerate bundled blueprints as catalog entries.

    Each blueprint becomes a concrete 'tool option' the LLM can recommend.
    Trimmed to id / name / category / inputs so D3's context budget stays sane.
    """
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


def _count_supported(kind: str) -> dict:
    items = _HA_CAPABILITIES.get(kind, [])
    return {
        "true":    sum(1 for c in items if c.get("ziggy_supported") is True),
        "partial": sum(1 for c in items if c.get("ziggy_supported") == "partial"),
        "false":   sum(1 for c in items if c.get("ziggy_supported") is False),
        "total":   len(items),
    }
