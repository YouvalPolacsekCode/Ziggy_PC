"""Agent tool registry — the v2 agent's "hands".

The agent DECIDES which tool to call; these executors DO the work by calling the
existing, tested services/handlers. The LLM never free-hands hardware: device
control goes through home_automation service functions with an exact entity_id
the agent picked from the HA-truth directory.

Two families of tools:
  1. Device / home tools (control_device, query_devices, room_occupancy) — new,
     directory-aware, per-entity.
  2. Passthrough tools (tasks, notes, automations, web, presence, anomalies…) —
     thin wrappers over core.action_parser.handle_intent so v1 behavior is
     reused verbatim.
"""
from __future__ import annotations

from typing import Any, Callable

from core.logger_module import log_error, log_info
from core.agent import directory as _dir


# ── Color map for set_color (mirrors light_handler) ──────────────────────────
_COLOR_MAP = {
    "red": (255, 0, 0), "green": (0, 255, 0), "blue": (0, 0, 255),
    "yellow": (255, 223, 160), "white": (255, 255, 255),
    "orange": (255, 165, 0), "purple": (128, 0, 128), "pink": (255, 105, 180),
    "warm white": (255, 223, 160), "warm": (255, 223, 160),
}

# Generic on/off/open/close service mapping per domain.
_ONOFF_SERVICE = {
    "switch":        {"on": ("switch", "turn_on"), "off": ("switch", "turn_off")},
    "input_boolean": {"on": ("input_boolean", "turn_on"), "off": ("input_boolean", "turn_off")},
    "fan":           {"on": ("fan", "turn_on"), "off": ("fan", "turn_off")},
    "media_player":  {"on": ("media_player", "turn_on"), "off": ("media_player", "turn_off")},
    "humidifier":    {"on": ("humidifier", "turn_on"), "off": ("humidifier", "turn_off")},
    "water_heater":  {"on": ("water_heater", "turn_on"), "off": ("water_heater", "turn_off")},
    "vacuum":        {"on": ("vacuum", "start"), "off": ("vacuum", "return_to_base")},
    "cover":         {"on": ("cover", "open_cover"), "off": ("cover", "close_cover"),
                      "open": ("cover", "open_cover"), "close": ("cover", "close_cover")},
    "lock":          {"on": ("lock", "lock"), "off": ("lock", "unlock"),
                      "lock": ("lock", "lock"), "unlock": ("lock", "unlock")},
}

_ACTION_ALIASES = {
    "turn_on": "on", "turn on": "on", "on": "on", "start": "on", "activate": "on",
    "turn_off": "off", "turn off": "off", "off": "off", "stop": "off",
    "open": "open", "close": "close", "lock": "lock", "unlock": "unlock",
    "set_temperature": "set_temperature", "temperature": "set_temperature",
    "set_brightness": "set_brightness", "brightness": "set_brightness", "dim": "set_brightness",
    "set_color": "set_color", "color": "set_color",
}


# ── Tool schemas exposed to the model ────────────────────────────────────────
TOOL_SCHEMAS: list[dict] = [
    {"type": "function", "function": {
        "name": "control_device",
        "description": (
            "Control ONE specific device. You MUST pass the exact entity_id from the "
            "device directory in the system prompt — resolve the user's reference "
            "(e.g. 'the lamp in the living room', 'המנורה בסלון') to the matching "
            "device's id yourself. If two or more devices could match, DO NOT guess — "
            "ask the user which one (one short question). Issue one call per device."
        ),
        "parameters": {"type": "object", "properties": {
            "entity_id": {"type": "string", "description": "Exact device id from the directory."},
            "action": {"type": "string", "description": "on, off, open, close, lock, unlock, set_temperature, set_brightness, set_color"},
            "value": {"type": "string", "description": "For set_temperature: °C. set_brightness: 0-100. set_color: colour name."},
            "confirmed": {"type": "boolean", "description": "true ONLY after the user explicitly said yes to an action the home's policy asked to confirm (locks etc.)."},
        }, "required": ["entity_id", "action"]},
    }},
    {"type": "function", "function": {
        "name": "query_devices",
        "description": (
            "Look up the current state of devices to answer a question like 'is the "
            "AC on?', 'what's on right now?', 'is the living room light on?'. "
            "Optionally filter by room and/or only devices that are on."
        ),
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string", "description": "Room slug to filter by (optional)."},
            "only_on": {"type": "boolean", "description": "Only devices currently on (optional)."},
        }},
    }},
    {"type": "function", "function": {
        "name": "room_occupancy",
        "description": (
            "Answer 'is anyone in <room>?' / 'יש מישהו ב<חדר>?' using the room's "
            "motion/presence/occupancy sensors. Pass the room the user named."
        ),
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string", "description": "Room the user asked about."},
        }, "required": ["room"]},
    }},
    {"type": "function", "function": {
        "name": "get_temperature",
        "description": "Get the current temperature reading in a room.",
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string"},
        }, "required": ["room"]},
    }},
    {"type": "function", "function": {
        "name": "is_someone_home",
        "description": "Check whether people are home/away (whole-home presence, by person). NOT for a specific room — use room_occupancy for a room.",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string", "description": "Person name (optional)."},
        }},
    }},
    {"type": "function", "function": {
        "name": "add_task",
        "description": "Create a task/reminder. Call even if details are missing — the handler asks for the rest.",
        "parameters": {"type": "object", "properties": {
            "task": {"type": "string"}, "due": {"type": "string"},
        }},
    }},
    {"type": "function", "function": {
        "name": "list_tasks",
        "description": "Show the user's tasks.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "design_smart_room",
        "description": (
            "Use when the user wants to make a whole ROOM smart — 'make the bedroom "
            "smart', 'תבנה לי חדר שינה חכם', 'set up a smart living room'. Builds the "
            "full reliable Smart Room recipe (lights on when entering an empty room — "
            "bright by day, warm/dim at night — off when empty; a partner entering a "
            "room where someone's already present stays dark). Returns a preview "
            "bundle. Pass the room the user named."
        ),
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string", "description": "The room the user named (e.g. bedroom, living room)."},
        }, "required": ["room"]},
    }},
    {"type": "function", "function": {
        "name": "design_automation",
        "description": (
            "ZIGGY PRO MODE for FREE-FORM outcomes that are NOT a whole-room smart "
            "setup — 'make my office cozy', 'design a morning routine', 'automate the "
            "blinds by sunset'. For 'make <room> smart' use design_smart_room instead. "
            "Returns a preview bundle. Pass the user's outcome text verbatim."
        ),
        "parameters": {"type": "object", "properties": {
            "outcome": {"type": "string", "description": "The user's outcome request, verbatim."},
        }, "required": ["outcome"]},
    }},
    {"type": "function", "function": {
        "name": "create_automation",
        "description": "Create a specific scheduled/triggered automation when the user gives an explicit single trigger+action (e.g. 'turn off the bedroom light at 23:00').",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"},
            "trigger_type": {"type": "string", "enum": ["time", "state", "numeric_state", "sunrise", "sunset"]},
            "trigger_time": {"type": "string"},
            "action_entity_id": {"type": "string", "description": "Exact device id from the directory."},
            "action_service": {"type": "string", "description": "turn_on or turn_off"},
        }, "required": ["trigger_type"]},
    }},
    {"type": "function", "function": {
        "name": "list_automations",
        "description": "List existing automations/routines.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_active_anomalies",
        "description": "Any alerts/anomalies at home right now ('anything I should know?', 'מה קורה בבית?').",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ir_send_command",
        "description": (
            "Control an IR device (marked [IR] in the directory) that has NO HA "
            "entity — TV power/volume/mute/HDMI/nav, AC power/mode/fan, fan speed. "
            "Give device_type + action + room. For AC TEMPERATURE use "
            "ir_set_ac_temperature instead."
        ),
        "parameters": {"type": "object", "properties": {
            "device_type": {"type": "string", "enum": ["tv", "ac", "fan", "soundbar", "projector"]},
            "action": {"type": "string", "description": "e.g. power, on, off, volume_up, mute, hdmi_1, mode_cool, fan_high"},
            "room": {"type": "string"},
        }, "required": ["device_type", "action"]},
    }},
    {"type": "function", "function": {
        "name": "ir_set_ac_temperature",
        "description": "Set an IR-controlled AC's temperature (no HA entity). Optionally set mode (cool/heat/fan/auto/dry).",
        "parameters": {"type": "object", "properties": {
            "temperature": {"type": "integer", "description": "°C, 16-30"},
            "mode": {"type": "string", "enum": ["cool", "heat", "fan", "auto", "dry"]},
            "room": {"type": "string"},
        }, "required": ["temperature"]},
    }},
    {"type": "function", "function": {
        "name": "ir_send_channel",
        "description": "Switch an IR TV to a channel number.",
        "parameters": {"type": "object", "properties": {
            "channel": {"type": "integer"}, "room": {"type": "string"},
        }, "required": ["channel"]},
    }},
    {"type": "function", "function": {
        "name": "web_search",
        "description": (
            "Look up live external info — weather, news, prices, scores, current "
            "events. ONLY for a clear question needing current data. Never for "
            "gibberish or home-control."
        ),
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"},
        }, "required": ["query"]},
    }},
    # ── Fixer tools: diagnose & repair a misbehaving home ────────────────────
    {"type": "function", "function": {
        "name": "check_home_health",
        "description": (
            "Check whether the whole home is healthy. Use when the user says things "
            "like 'nothing works', 'the house is stuck', 'my devices aren't "
            "responding', or asks if everything's OK. Read-only."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "diagnose_device",
        "description": (
            "Investigate why ONE device is misbehaving — 'why won't the living-room "
            "light turn on?', 'the AC isn't responding'. Pass the exact entity_id "
            "from the directory. Read-only; gathers what's wrong so you can explain it."
        ),
        "parameters": {"type": "object", "properties": {
            "entity_id": {"type": "string", "description": "Exact device id from the directory."},
        }, "required": ["entity_id"]},
    }},
    {"type": "function", "function": {
        "name": "refresh_device",
        "description": (
            "Try to wake up / fix ONE stuck device that isn't responding or is showing "
            "the wrong state. This actually nudges the device back into line — a safe "
            "action you may take on your own, then tell the user what happened. Pass entity_id."
        ),
        "parameters": {"type": "object", "properties": {
            "entity_id": {"type": "string", "description": "Exact device id from the directory."},
        }, "required": ["entity_id"]},
    }},
    {"type": "function", "function": {
        "name": "recover_connectivity",
        "description": (
            "When lots of devices went offline at once or the home lost contact with "
            "its wireless devices, reconnect them. A safe action you may take on your "
            "own. If it can't fix it remotely it returns a simple physical step to tell "
            "the user. No arguments."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "acknowledge_alerts",
        "description": (
            "The user says the devices currently shown as offline are fine that way "
            "(e.g. unplugged on purpose) — stop flagging them. No arguments."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_down_devices",
        "description": (
            "Proactively scan the WHOLE home for devices that have gone quiet / "
            "stopped responding for a while (not just one the user named). Use for "
            "'is anything broken?', 'are all my devices working?', or a general "
            "health check. Read-only."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "diagnose_pairing",
        "description": (
            "Find out why a NEW device won't connect / won't be found / won't "
            "pair — 'I'm trying to add a new sensor and it won't connect', 'the "
            "new bulb isn't found', 'למה המכשיר החדש לא מתחבר?'. Checks whether "
            "the home is open to new devices, whether it can reach its wireless "
            "devices at all, and whether a device started connecting but never "
            "finished. Read-only; no arguments. Use this instead of "
            "check_home_health when the problem is a device that was never "
            "added yet."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "explain_device_change",
        "description": (
            "Explain WHY a device changed on its own — 'why did the living-room light "
            "turn off last night?', 'what turned on the AC?'. Traces which automation/"
            "routine, person, or device caused it. Pass the exact entity_id; optionally "
            "action ('on'/'off') and how many hours back to look. Read-only."
        ),
        "parameters": {"type": "object", "properties": {
            "entity_id": {"type": "string", "description": "Exact device id from the directory."},
            "action": {"type": "string", "description": "on or off (optional — which change to explain)."},
            "hours": {"type": "integer", "description": "How many hours back to look (default 48)."},
        }, "required": ["entity_id"]},
    }},
    # ── v3: self-knowledge, memory of the home, routines, why-not ───────────
    {"type": "function", "function": {
        "name": "what_can_ziggy_do",
        "description": (
            "Ziggy's own catalog of what he can do. Use for 'what can you do', 'can "
            "you X', 'do you support Y', 'מה אתה יודע לעשות', 'אתה יכול…'. Returns "
            "matching capabilities with a plain description and whether each is live. "
            "Answer from it honestly in your own words; never invent a capability."
        ),
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "What the user asked about, in their words. Empty for a general overview."},
        }},
    }},
    {"type": "function", "function": {
        "name": "recent_activity",
        "description": (
            "What changed in the home recently — devices that turned on/off, in "
            "which room, when. Use for 'what happened', 'what changed', 'מה קרה "
            "בבית', 'did anything turn on'. Optional room and hours (default 3)."
        ),
        "parameters": {"type": "object", "properties": {
            "hours": {"type": "number"}, "room": {"type": "string"},
        }},
    }},
    {"type": "function", "function": {
        "name": "explain_missing_action",
        "description": (
            "Explain why something that SHOULD have happened to a device did NOT — "
            "'why didn't the light turn on when I came in?', 'למה האור לא נדלק "
            "כשנכנסתי?', 'the AC should have started'. Checks whether the device is "
            "reachable, which routines act on it and what their last runs did, what "
            "the room's sensors saw, and what Ziggy already tried. Pass the exact "
            "device id from the directory; hours back to look (default 3)."
        ),
        "parameters": {"type": "object", "properties": {
            "entity_id": {"type": "string", "description": "Exact device id from the directory."},
            "hours": {"type": "number"},
        }, "required": ["entity_id"]},
    }},
    {"type": "function", "function": {
        "name": "repair_history",
        "description": (
            "What Ziggy already tried to fix for a device on his own (wake, "
            "reconnect, re-add) and how it went. Use before suggesting a fix, or when "
            "the user asks 'did you try anything?'. Pass the exact device id."
        ),
        "parameters": {"type": "object", "properties": {
            "entity_id": {"type": "string"},
        }, "required": ["entity_id"]},
    }},
    {"type": "function", "function": {
        "name": "run_routine",
        "description": (
            "Run one of the home's on-demand routines by name — 'good night', "
            "'run the movie routine', 'לילה טוב', 'תפעיל את שגרת הבוקר'. Fuzzy name "
            "match; if nothing matches you get the list of routine names back."
        ),
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"},
        }, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "toggle_automation",
        "description": (
            "Enable or disable an existing automation/routine by name — 'turn off the "
            "night routine', 'תכבה את האוטומציה של הסלון'. Fuzzy name match."
        ),
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "enabled": {"type": "boolean"},
        }, "required": ["name", "enabled"]},
    }},
    {"type": "function", "function": {
        "name": "show_device",
        "description": (
            "Show ONE device as a card the user can act on — 'show me the lamp', "
            "'תראה לי את המנורה בסלון'. Pass the exact device id from the directory. "
            "The card has the device's control and a button that opens its page."
        ),
        "parameters": {"type": "object", "properties": {
            "entity_id": {"type": "string", "description": "Exact device id from the directory."},
        }, "required": ["entity_id"]},
    }},
    {"type": "function", "function": {
        "name": "open_screen",
        "description": (
            "Open a screen in the app — 'take me to the lamp's page', 'קח אותי "
            "לעמוד של המנורה', 'open the automations', 'go to the bedroom', 'show "
            "settings'. screen: device | room | devices | rooms | automations | "
            "routines | alerts | settings | assistants. For device pass the exact "
            "device id in `id`; for room pass the room slug from the directory."
        ),
        "parameters": {"type": "object", "properties": {
            "screen": {"type": "string", "enum": ["device", "room", "devices", "rooms", "automations",
                                                  "routines", "alerts", "settings", "assistants"]},
            "id": {"type": "string", "description": "Device id or room slug when screen is device/room."},
        }, "required": ["screen"]},
    }},
    {"type": "function", "function": {
        "name": "delete_automation",
        "description": (
            "Delete an existing automation/routine by name. Deletion is final, so "
            "the first call answers needs_approval naming what would be deleted; ask "
            "the user, and only after an explicit yes call again with confirmed=true."
        ),
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"}, "confirmed": {"type": "boolean"},
        }, "required": ["name"]},
    }},
]

# Tool names that produce a natural action-confirmation and, when they succeed
# alone with no model narration, can be confirmed deterministically (1 round-trip).
TERMINAL_ACTION_TOOLS = frozenset({"control_device", "create_automation", "add_task"})

# Device verbs the home's policy may want a human yes for. control_device asks
# the PDP for these; everything else acts (a light is a light).
_POLICY_VERBS = {"lock": "device.lock", "unlock": "device.unlock",
                 "open": "device.open", "close": "device.close"}
_POLICY_DOMAINS = {"lock", "cover", "alarm_control_panel"}

# Passthrough tools → (intent name for handle_intent).
_PASSTHROUGH = {
    "get_temperature": "get_temperature",
    "is_someone_home": "is_someone_home",
    "add_task": "add_task",
    "list_tasks": "list_tasks",
    "create_automation": "create_automation",
    "list_automations": "list_automations",
    "get_active_anomalies": "get_active_anomalies",
    "ir_send_command": "ir_send_command",
    "ir_set_ac_temperature": "ir_set_ac_temperature",
    "ir_send_channel": "ir_send_channel",
    # Pro Mode: reuse the v1 handler so the chat gets the SAME preview-card
    # envelope (data.kind=automation_bundle_preview) + guardrails (no empty /
    # voice-only cards). The runner detects that envelope and renders the card.
    "design_automation": "design_automation_set",
}


# Tools that change home configuration outside the HA-service / IR hop.
# Value = the success message the agent narrates from during rehearsal.
_REHEARSAL_BLOCKED = {
    "create_automation":    "created (rehearsal — nothing was changed in the home)",
    "refresh_device":       "done (rehearsal — nothing was changed in the home)",
    "recover_connectivity": "done (rehearsal — nothing was changed in the home)",
    "toggle_automation":    "done (rehearsal — nothing was changed in the home)",
    "delete_automation":    "deleted (rehearsal — nothing was changed in the home)",
    "run_routine":          "ran (rehearsal — nothing was changed in the home)",
}


def _norm_action(action: str) -> str:
    return _ACTION_ALIASES.get((action or "").strip().lower(), (action or "").strip().lower())


def _policy_says_ask(eid: str, action: str, actor: str | None, confirmed: bool) -> bool:
    """True when the home's policy wants a human yes for this verb and none was given."""
    dom = eid.split(".", 1)[0]
    if dom not in _POLICY_DOMAINS or action not in _POLICY_VERBS:
        return False
    try:
        from core.agent import authz
        may_act, _mode = authz.check(_POLICY_VERBS[action], on_behalf_of=actor,
                                     explicit_confirm=bool(confirmed))
        return not may_act
    except Exception:
        return False


async def _exec_control_device(args: dict, directory: dict, actor: str | None = None,
                               lang: str = "en") -> dict:
    from services.home_automation import (
        toggle_light, set_light_brightness, set_light_color,
        set_ac_temperature, call_service,
    )
    eid = (args.get("entity_id") or "").strip()
    action = _norm_action(args.get("action"))
    value = args.get("value")
    dev = _dir.get_device(directory, eid)
    if not dev:
        return {"ok": False, "message": f"unknown device {eid}", "no_such_device": True}
    dom = eid.split(".", 1)[0]
    if _policy_says_ask(eid, action, actor, bool(args.get("confirmed"))):
        label = _device_label(dev, lang)
        return {"ok": True, "needs_approval": True, "device": dev, "action": action,
                "message": (f"{label}: זה דורש אישור — לשאול את המשתמש ולקרוא שוב עם confirmed=true אחרי כן."
                            if lang == "he" else
                            f"{label}: this needs the user's explicit yes — ask, then call again with confirmed=true."),
                "data": {"kind": "needs_approval", "fix": f"control_device:{action}", "acted": False}}

    # Already there? Say so instead of "I turned it off" twice (Canary 01:03).
    if action in ("on", "off") and dom != "climate":
        if bool(dev.get("on")) == (action == "on") and (dev.get("state") or "") not in ("unavailable", "unknown", ""):
            log_info(f"[agent.tools] control_device {eid} {action} route=noop (already {action})")
            return {"ok": True, "message": f"already {action} {dev['name']}",
                    "device": dev, "action": action, "value": value, "already": True}

    routed = None
    try:
        # Hybrid-aware power: an entity with a linked IR codeset routes on/off
        # through the command router (Wi-Fi↔IR ranked fallback, same as the UI
        # tile path). hybrid_route_or_none returns None for the 99% of devices
        # with no IR link — those keep the exact direct paths below.
        from services.command_router import hybrid_route_or_none, wifi_reachable

        def _routed_failed(routed: dict) -> bool:
            return not routed.get("ok")

        if dom == "light":
            if action == "set_brightness":
                set_light_brightness(eid, int(float(value)))
                done = "set_brightness"
            elif action == "set_color":
                rgb = _COLOR_MAP.get((str(value) or "white").lower(), (255, 255, 255))
                set_light_color(eid, rgb_color=rgb)
                done = "set_color"
            else:
                on = action == "on"
                routed = hybrid_route_or_none(eid, "turn_on" if on else "turn_off")
                if routed is None:
                    toggle_light(eid, on)
                elif _routed_failed(routed):
                    return {"ok": False, "message": routed.get("message", "command failed"),
                            "device": dev}
                done = "on" if on else "off"
        elif dom == "climate":
            if action == "set_temperature":
                set_ac_temperature(eid, int(float(value)))
                done = "set_temperature"
            elif action == "off":
                routed = hybrid_route_or_none(eid, "turn_off")
                if routed is None:
                    call_service("climate", "turn_off", {"entity_id": eid})
                elif _routed_failed(routed):
                    return {"ok": False, "message": routed.get("message", "command failed"),
                            "device": dev}
                done = "off"
            else:  # on — cool-first Israeli default; IR is the rescue, not the
                   # default: a live smart AC carries true state (project rule),
                   # so hybrid routing only kicks in when its Wi-Fi is dead.
                routed = None
                if not wifi_reachable(eid):
                    routed = hybrid_route_or_none(eid, "turn_on")
                if routed is None:
                    call_service("climate", "set_hvac_mode", {"entity_id": eid, "hvac_mode": "cool"})
                elif _routed_failed(routed):
                    return {"ok": False, "message": routed.get("message", "command failed"),
                            "device": dev}
                done = "on"
        else:
            routed = hybrid_route_or_none(eid, "turn_on" if action == "on" else "turn_off")
            if routed is not None:
                if _routed_failed(routed):
                    return {"ok": False, "message": routed.get("message", "command failed"),
                            "device": dev}
                done = action
            else:
                table = _ONOFF_SERVICE.get(dom)
                if not table or action not in table:
                    # default to switch semantics
                    svc = ("homeassistant", "turn_on" if action == "on" else "turn_off")
                    call_service(svc[0], svc[1], {"entity_id": eid})
                    done = action
                else:
                    d, s = table[action]
                    call_service(d, s, {"entity_id": eid})
                    done = action
    except Exception as e:
        log_error(f"[agent.tools] control_device failed {eid}: {e}")
        return {"ok": False, "message": str(e), "device": dev}

    # The route is the evidence a "it worked the third time" report needs:
    # hybrid = the command router (Wi-Fi↔IR codeset), direct = HA service.
    route = "hybrid:" + str((routed or {}).get("via") or (routed or {}).get("path") or "ir") \
        if routed is not None else f"direct:{dom}"
    log_info(f"[agent.tools] control_device {eid} {done} route={route}")
    return {
        "ok": True, "message": f"{done} {dev['name']}",
        "device": dev, "action": done, "value": value, "route": route,
    }


def _exec_query_devices(args: dict, directory: dict) -> dict:
    from services.room_alias_bank import resolve_room
    room = args.get("room")
    only_on = bool(args.get("only_on"))
    devices = directory.get("devices") or []
    if room:
        target = resolve_room((room or "").lower().strip())
        devices = [d for d in devices if (d.get("room") or "") == target]
    if only_on:
        devices = [d for d in devices if d["on"]]
    summary = [
        {"name": d["name"], "room": d["room"], "domain": d["domain"],
         "state": d["state"], "on": d["on"], "he_noun": d["he_noun"], "room_he": d["room_he"],
         "place_he": d.get("place_he")}
        for d in devices
    ]
    # `devices` (no ids) is what the model reads; `data` (with ids) is what
    # the chat card renders with live toggles. The sanitizer keeps ids out
    # of the reply text either way.
    card = [{**s, "entity_id": d["entity_id"]} for s, d in zip(summary, devices)
            if not d.get("ir")]
    return {"ok": True, "message": f"{len(summary)} devices", "devices": summary,
            "data": {"kind": "device_list", "devices": card,
                     "room": room or None, "only_on": only_on}}


def _exec_room_occupancy(args: dict, directory: dict) -> dict:
    res = _dir.room_occupancy(directory, args.get("room") or "")
    return {"ok": True, **res}


async def _exec_web_search(args: dict) -> dict:
    query = (args.get("query") or "").strip()
    if not query:
        return {"ok": False, "message": "empty query"}
    try:
        from services import web_manager
        r = web_manager.search_for_gpt(query)
        if not r.get("ok") or not r.get("snippets"):
            return {"ok": True, "message": "no results", "snippets": []}
        return {"ok": True, "query": query, "snippets": r["snippets"][:5]}
    except Exception as e:
        log_error(f"[agent.tools] web_search failed: {e}")
        return {"ok": False, "message": str(e)}


async def _exec_design_smart_room(args: dict, lang: str) -> dict:
    """Deterministic Smart Room recipe → the same preview-card envelope."""
    from services.room_alias_bank import resolve_room
    from services.smart_room_recipe import build_smart_room_bundle
    room = (args.get("room") or "").strip()
    slug = resolve_room(room.lower())
    try:
        res = build_smart_room_bundle(slug, language=lang)
    except Exception as e:
        log_error(f"[agent.tools] smart_room recipe failed: {e}")
        return {"ok": False, "message": str(e)}
    if res.get("needs_occupancy"):
        # Can't create the fused presence sensor inline in chat — direct to the tab.
        msg = (f"כדי להפוך את {room or slug} לחדר חכם צריך קודם חיישן נוכחות משולב. "
               f"אפשר להגדיר אותו במסך האוטומציות, בתבנית ״חדר חכם״, ואז לבקש שוב."
               if lang == "he" else
               f"To make {room or slug} smart it first needs a fused presence sensor. "
               f"Set it up in the Automations page under the Smart Room template, then ask again.")
        return {"ok": True, "message": msg}
    if not res.get("ok"):
        b = res.get("bundle") or {}
        return {"ok": True, "message": b.get("decline") or res.get("error") or "could not build"}
    bundle = res["bundle"]
    if bundle.get("decline"):
        return {"ok": True, "message": bundle["decline"]}
    return {"ok": True, "message": "smart room designed",
            "data": {"kind": "automation_bundle_preview", "bundle": bundle}}


# Health level → a neutral severity the model can reason on WITHOUT seeing the
# raw engine issue codes (no "coordinator"/"zigbee" ever reaches the model).
_HEALTH_SEVERITY = {"ok": "ok", "degraded": "attention", "down": "problem"}


async def _exec_check_home_health(lang: str) -> dict:
    """Read-only 'is the home healthy?' — pre-translated so no jargon reaches the model."""
    from services import ha_health
    from core.agent import health_speech
    snap = await ha_health.health_snapshot()
    severity = _HEALTH_SEVERITY.get(snap.get("level"), "attention")
    offline = int((snap.get("devices") or {}).get("offline", 0) or 0)
    return {
        "ok": True,
        "message": health_speech.summarize_health(snap, lang=lang),
        "data": {"kind": "home_health", "severity": severity, "offline_count": offline},
    }


def _device_label(dev: dict, lang: str) -> str:
    """A jargon-free name for a device — the Hebrew noun + where, never an entity_id.

    'Where' comes from the device's own name when it carries a place ("Kitchen
    Light" → במטבח) and only then from the area it is filed under."""
    if lang == "he":
        noun = dev.get("he_noun") or dev.get("name") or "המכשיר"
        where = dev.get("place_he") or (f"ב{dev['room_he']}" if dev.get("room_he") else "")
        return f"{noun} {where}".strip()
    return dev.get("name") or dev.get("he_noun") or "device"


def _no_such_device(lang: str) -> dict:
    return {"ok": False, "no_such_device": True,
            "message": ("לא מצאתי מכשיר כזה." if lang == "he"
                        else "I couldn't find that device.")}


def _needs_approval(fix: str, lang: str, device_label: str = "") -> dict:
    """The home's policy says this fix needs a human yes — ask for it, plainly.

    There is no approval card in chat yet, so the agent degrades to asking in
    words; the user's "yes" comes back as the next turn.
    """
    from core.agent import health_speech
    return {
        "ok": True,
        "message": health_speech.describe_needs_approval(fix, lang, device_label),
        "data": {"kind": "needs_approval", "fix": fix, "acted": False},
    }


async def _exec_refresh_device(args: dict, directory: dict, lang: str,
                               actor: str | None = None) -> dict:
    """Auto-safe fix: force-poll + one heal cycle on a stuck device, then report."""
    from services import self_heal
    from core.agent import authz, health_speech
    eid = (args.get("entity_id") or "").strip()
    dev = _dir.get_device(directory, eid)
    if not dev:
        return _no_such_device(lang)
    may_act, _mode = authz.check("system.refresh_device", on_behalf_of=actor)
    if not may_act:
        return _needs_approval("refresh_device", lang, _device_label(dev, lang))
    res = await self_heal.manual_refresh_heal(eid)
    outcome = res.get("outcome", "healing")
    return {
        "ok": True,
        "message": health_speech.describe_self_heal_outcome(outcome, _device_label(dev, lang), lang),
        "data": {"kind": "device_refresh", "outcome": outcome,
                 "fixed": outcome in ("recovered", "synced")},
    }


async def _exec_recover_connectivity(lang: str, actor: str | None = None) -> dict:
    """Auto-safe fix: reconnect the home's wireless devices; translate the outcome."""
    from services import ha_health
    from core.agent import authz, health_speech
    may_act, _mode = authz.check("system.reload_coordinator", on_behalf_of=actor)
    if not may_act:
        return _needs_approval("recover_connectivity", lang)
    raw = await ha_health.trigger_recover_now()
    if raw.get("in_progress"):
        outcome, fixed = "in_progress", False
    elif raw.get("no_coordinator"):
        outcome, fixed = "nothing_to_do", False
    elif raw.get("already_healthy"):
        outcome, fixed = "healthy", True
    elif raw.get("ok"):
        outcome, fixed = "reconnected", True
    else:
        outcome, fixed = "needs_replug", False
    return {
        "ok": True,
        "message": health_speech.describe_recovery(outcome, lang),
        "data": {"kind": "connectivity_recovery", "outcome": outcome, "fixed": fixed},
    }


async def _exec_diagnose_device(args: dict, directory: dict, lang: str) -> dict:
    """Read-only: gather why a device might be misbehaving, for the agent to reason on."""
    from services import command_ledger
    from core.agent import health_speech
    eid = (args.get("entity_id") or "").strip()
    dev = _dir.get_device(directory, eid)
    if not dev:
        return _no_such_device(lang)
    is_on = bool(dev.get("on"))
    last = command_ledger.get_last(eid) or {}
    last_intended = last.get("state")
    reachable = (dev.get("state") or "").lower() not in ("unavailable", "unknown")
    return {
        "ok": True,
        "message": health_speech.describe_diagnosis(_device_label(dev, lang),
                                                    is_on, last_intended, lang),
        "data": {"kind": "device_diagnosis", "is_on": is_on,
                 "last_intended": last_intended, "reachable": reachable},
    }


async def _exec_explain_device_change(args: dict, directory: dict, lang: str) -> dict:
    """Read-only causal trace: what turned this device on/off? Names only, no ids."""
    from services import cause_tracer
    from core.agent import health_speech
    eid = (args.get("entity_id") or "").strip()
    dev = _dir.get_device(directory, eid)
    if not dev:
        return _no_such_device(lang)
    action = (args.get("action") or "").strip().lower() or None
    try:
        hours = int(args.get("hours") or 48)
    except (TypeError, ValueError):
        hours = 48
    entries = cause_tracer.fetch_logbook(eid, hours=hours)
    res = cause_tracer.explain_change(entries, eid, action=action)
    return {
        "ok": True,
        "message": health_speech.describe_cause(res, _device_label(dev, lang), lang),
        "data": {"kind": "cause_trace",
                 "cause_kind": (res or {}).get("cause_kind", "unknown"),
                 "cause_name": (res or {}).get("cause_name")},
    }


async def _exec_list_down_devices(lang: str) -> dict:
    """Proactive scan: which devices have gone quiet? Names only — never ids."""
    from services import down_device_detector as dd
    from core.agent import health_speech
    items = dd.find_down_devices()
    return {
        "ok": True,
        "message": health_speech.describe_down_devices(items, lang),
        "data": {"kind": "down_devices", "count": len(items),
                 "names": [i.get("name") for i in items]},
    }


async def _exec_diagnose_pairing(lang: str) -> dict:
    """Read-only: why isn't the new device connecting? Verdict + the next step."""
    from services import pairing_doctor
    from core.agent import health_speech
    assessment = await pairing_doctor.diagnose_pairing()
    return {
        "ok": True,
        "message": health_speech.describe_pairing(assessment, lang),
        "data": {"kind": "pairing_diagnosis",
                 "verdict": assessment.get("verdict"),
                 "radio_ok": assessment.get("radio_ok"),
                 "open_to_new_devices": assessment.get("pairing_open"),
                 "unfinished": assessment.get("stalled_names") or [],
                 "waiting_to_add": assessment.get("pending_names") or []},
    }


async def _exec_acknowledge_alerts(lang: str) -> dict:
    """User says the currently-offline devices are fine — stop flagging them."""
    from services import ha_health
    from services.ha_subscriber import state_cache
    from services.entity_filter import _should_hide
    from core.agent import health_speech
    ids = {eid for eid, e in state_cache.items()
           if not _should_hide(eid) and (e.get("state") in ("unavailable", "unknown"))}
    res = ha_health.acknowledge_offline(ids)
    count = int(res.get("acknowledged_count", 0) or 0)
    return {"ok": True, "message": health_speech.describe_ack(count, lang),
            "data": {"kind": "alerts_acknowledged", "count": count}}


# ── v3 executors ─────────────────────────────────────────────────────────────
_SCREEN_PATHS = {
    "devices": "/devices", "rooms": "/rooms", "automations": "/actions",
    "routines": "/routines", "alerts": "/alerts", "settings": "/settings",
    "assistants": "/settings/assistants",
}


def _exec_open_screen(args: dict, directory: dict, lang: str) -> dict:
    """Agent-first: the agent can drive the app. Returns a navigate card the
    app follows (with the chat kept at hand on wide screens)."""
    screen = (args.get("screen") or "").strip().lower()
    ident = (args.get("id") or "").strip()
    if screen == "device":
        dev = _dir.get_device(directory, ident)
        if not dev:
            return _no_such_device(lang)
        if dev.get("ir"):
            path, label = f"/remote/{dev.get('ir_id')}", _device_label(dev, lang)
        else:
            path, label = f"/devices/{ident}", _device_label(dev, lang)
    elif screen == "room":
        from services.room_alias_bank import resolve_room
        slug = resolve_room(ident.lower()) if ident else ""
        path, label = (f"/rooms/{slug}" if slug else "/rooms"), (_dir.room_he(slug) if lang == "he" else slug.replace("_", " ")) or ""
    elif screen in _SCREEN_PATHS:
        path, label = _SCREEN_PATHS[screen], screen
    else:
        return {"ok": False, "message": f"unknown screen {screen}"}
    msg = (f"פותח את {label}." if lang == "he" else f"Opening {label}.") if label else ("פותח." if lang == "he" else "Opening.")
    return {"ok": True, "message": msg,
            "data": {"kind": "navigate", "path": path, "screen": screen, "label": label}}


def _exec_show_device(args: dict, directory: dict, lang: str) -> dict:
    eid = (args.get("entity_id") or "").strip()
    dev = _dir.get_device(directory, eid)
    if not dev:
        return _no_such_device(lang)
    label = _device_label(dev, lang)
    state_he = "דולק" if dev.get("on") else "כבוי"
    msg = (f"הנה {label} — {state_he} כרגע." if lang == "he"
           else f"Here's the {label} — it's {'on' if dev.get('on') else 'off'} right now.")
    return {"ok": True, "message": msg,
            "data": {"kind": "device", "device": {k: dev.get(k) for k in
                     ("entity_id", "name", "room", "room_he", "domain", "state", "on", "he_noun", "place_he", "ir", "ir_id")},
                     "path": (f"/remote/{dev.get('ir_id')}" if dev.get("ir") else f"/devices/{eid}")}}


def _exec_get_temperature(args: dict, directory: dict, lang: str) -> Optional[dict]:
    """Answer from the home's real readings; None → caller falls back to v1."""
    from services.room_alias_bank import resolve_room
    room = (args.get("room") or "").strip()
    target = resolve_room(room.lower()) if room else ""
    sens = [s for s in (directory.get("sensors") or []) if s.get("kind") == "temperature"]
    if not sens:
        return None
    low = room.lower()
    hits = [s for s in sens if target and (s.get("room") or "") == target]
    if not hits and low:
        hits = [s for s in sens if low in (s.get("name") or "").lower()
                or (s.get("place_he") and low in s["place_he"])]
    if not hits and not room:
        hits = sens
    if not hits:
        return None
    parts = []
    for s in hits[:4]:
        where = (s.get("place_he") or (f"ב{s['room_he']}" if s.get("room_he") else "")) if lang == "he" \
            else (s.get("room") or s.get("name") or "").replace("_", " ")
        unit = s.get("unit") or "°"
        parts.append(f"{s['value']}{unit} {where}".strip())
    msg = ("הטמפרטורה: " if lang == "he" else "Temperature: ") + "; ".join(parts) + "."
    return {"ok": True, "message": msg,
            "data": {"kind": "reading", "readings": [{"name": s["name"], "room": s.get("room"),
                                                       "value": s["value"], "unit": s.get("unit")} for s in hits[:4]]}}


def _exec_what_can_ziggy_do(args: dict) -> dict:
    from services import capability_lookup as cl
    q = (args.get("query") or "").strip()
    items = cl.search(q, limit=6) if q else []
    general = not q or not items
    if general:
        # A generic "what can you do" (or a query the catalog doesn't match)
        # gets the overview rather than an empty list the model would turn
        # into "I can't say" — Ziggy always knows what he can do.
        items = cl.overview()
    return {"ok": True, "message": f"{len(items)} capabilities",
            "capabilities": items,
            "overview": general,
            "data": {"kind": "capabilities", "capabilities": items, "overview": general},
            "note": ("These are Ziggy's live capabilities; answer in your own words, "
                     "grouped naturally, without listing them all. "
                     "status 'live' means it works in this home today; anything else "
                     "is not available to the user yet.")}


def _exec_recent_activity(args: dict, directory: dict) -> dict:
    from core.agent import context as _ctx
    from services.room_alias_bank import resolve_room
    try:
        hours = float(args.get("hours") or 3)
    except (TypeError, ValueError):
        hours = 3.0
    room = (args.get("room") or "").strip().lower()
    target = resolve_room(room) if room else None
    d = directory
    if target:
        d = {**directory, "devices": [x for x in (directory.get("devices") or []) if (x.get("room") or "") == target]}
    text = _ctx.recent_text(d, minutes=int(hours * 60))
    if not text:
        return {"ok": True, "message": "nothing changed in that window", "changes": [],
                "data": {"kind": "recent_activity", "changes": [], "hours": hours}}
    changes = [ln.strip() for ln in text.splitlines()]
    return {"ok": True, "message": "changes (newest first)", "changes": changes,
            "data": {"kind": "recent_activity", "changes": changes, "hours": hours}}


def _room_label(dev: dict, lang: str) -> str | None:
    return dev.get("room_he") if lang == "he" else (dev.get("room") or "").replace("_", " ") or None


async def _exec_explain_missing_action(args: dict, directory: dict, lang: str) -> dict:
    import asyncio
    from services import why_not
    from core.agent import health_speech
    eid = (args.get("entity_id") or "").strip()
    dev = _dir.get_device(directory, eid)
    if not dev:
        return _no_such_device(lang)
    try:
        hours = float(args.get("hours") or 3)
    except (TypeError, ValueError):
        hours = 3.0
    facts = await asyncio.to_thread(why_not.gather_facts, eid, hours, directory=directory)
    verdicts = why_not.judge(facts)
    msg = health_speech.describe_why_not(verdicts, facts, _device_label(dev, lang),
                                         _room_label(dev, lang), lang)
    # Model-facing facts: names only, no ids, no engine codes.
    autos = [{"name": a.get("name"), "enabled": a.get("enabled"),
              "last_run": ((a.get("runs") or [{}])[0].get("status") if a.get("runs") else "none in window")}
             for a in facts.get("automations") or []]
    sensors = [{"room": _room_label(dev, lang), "state": s.get("state"),
                "held_minutes": int((s.get("held_s") or 0) / 60),
                "problem": ("stuck" if "ANOM-12" in (s.get("anomalies") or []) else
                            "quiet" if any(a in (s.get("anomalies") or []) for a in ("ANOM-10", "ANOM-13")) else None)}
               for s in facts.get("sensors") or []]
    return {"ok": True, "message": msg,
            "data": {"kind": "why_not", "verdicts": verdicts,
                     "device_reachable": (facts.get("device") or {}).get("reachable"),
                     "routines": autos, "room_sensors": sensors,
                     "occupancy": facts.get("occupancy"),
                     "tried": [{"step": r.get("rung"), "outcome": r.get("outcome")} for r in facts.get("repairs") or []]}}


def _exec_repair_history(args: dict, directory: dict, lang: str) -> dict:
    eid = (args.get("entity_id") or "").strip()
    dev = _dir.get_device(directory, eid)
    if not dev:
        return _no_such_device(lang)
    try:
        from services import repair_ladder
        rows = repair_ladder.history(eid, limit=10) or []
    except Exception:
        rows = []
    if not rows:
        return {"ok": True, "message": ("עוד לא ניסיתי לתקן את זה לבד." if lang == "he"
                                        else "I haven't tried fixing this on my own yet."),
                "data": {"kind": "repair_history", "attempts": []}}
    steps = {"nudge": ("להעיר אותו", "wake it"), "reinterview": ("לחבר מחדש", "reconnect it"),
             "repair": ("להוסיף מחדש", "re-add it"), "physical": ("צעד פיזי", "a physical step")}
    parts = [f"{steps.get(r.get('rung'), (r.get('rung'), r.get('rung')))[0 if lang == 'he' else 1]} → {r.get('outcome')}"
             for r in rows[:5]]
    return {"ok": True,
            "message": ("ניסיתי: " if lang == "he" else "I tried: ") + "; ".join(parts),
            "data": {"kind": "repair_history",
                     "attempts": [{"step": r.get("rung"), "outcome": r.get("outcome"), "ts": r.get("ts")} for r in rows]}}


def _best_name_match(name: str, items: list[dict]) -> dict | None:
    import re as _re
    q = _re.sub(r"[^\w֐-׿]+", " ", (name or "").lower()).strip()
    if not q:
        return None
    qs = set(q.split())
    best, best_score = None, 0.0
    for it in items:
        n = _re.sub(r"[^\w֐-׿]+", " ", str(it.get("name") or "").lower()).strip()
        if not n:
            continue
        if n == q:
            return it
        ns = set(n.split())
        overlap = len(qs & ns)
        score = overlap / max(1, len(ns)) + (0.5 if q in n or n in q else 0)
        if score > best_score:
            best, best_score = it, score
    return best if best_score >= 0.5 else None


async def _exec_run_routine(args: dict, lang: str) -> dict:
    import asyncio
    from services.ha_scripts import list_scripts
    from services.local_automation_actions import execute_ziggy_actions
    routines = await asyncio.to_thread(list_scripts)
    hit = _best_name_match(args.get("name") or "", routines or [])
    if not hit:
        names = [r.get("name") for r in (routines or [])][:10]
        return {"ok": False, "message": "no such routine", "routines": names}
    try:
        await execute_ziggy_actions(hit["id"], hit.get("name") or "Routine")
    except Exception as e:
        log_error(f"[agent.tools] run_routine failed: {e}")
        return {"ok": False, "message": (f"לא הצלחתי להפעיל את ״{hit.get('name')}״." if lang == "he"
                                         else f"Couldn't run \"{hit.get('name')}\".")}
    return {"ok": True, "message": (f"הפעלתי את ״{hit.get('name')}״." if lang == "he"
                                    else f"Ran \"{hit.get('name')}\"."),
            "routine": hit.get("name")}


async def _exec_toggle_automation(args: dict, lang: str) -> dict:
    import asyncio
    from services.ha_automations import list_automations, toggle_automation
    autos = await asyncio.to_thread(list_automations)
    hit = _best_name_match(args.get("name") or "", autos or [])
    if not hit:
        return {"ok": False, "message": "no such automation",
                "automations": [a.get("name") for a in (autos or [])][:15]}
    enabled = bool(args.get("enabled"))
    ok_ = await asyncio.to_thread(toggle_automation, hit["id"], enabled)
    if not ok_:
        return {"ok": False, "message": "could not change it"}
    if lang == "he":
        msg = f"{'הפעלתי' if enabled else 'כיביתי'} את ״{hit.get('name')}״."
    else:
        msg = f"{'Enabled' if enabled else 'Disabled'} \"{hit.get('name')}\"."
    return {"ok": True, "message": msg, "automation": hit.get("name"), "enabled": enabled}


async def _exec_delete_automation(args: dict, lang: str, actor: str | None) -> dict:
    import asyncio
    from services.ha_automations import list_automations, delete_automation
    autos = await asyncio.to_thread(list_automations)
    hit = _best_name_match(args.get("name") or "", autos or [])
    if not hit:
        return {"ok": False, "message": "no such automation",
                "automations": [a.get("name") for a in (autos or [])][:15]}
    if not args.get("confirmed"):
        return {"ok": True, "needs_approval": True, "automation": hit.get("name"),
                "message": (f"למחוק את ״{hit.get('name')}״? זה סופי. לשאול את המשתמש ולקרוא שוב עם confirmed=true."
                            if lang == "he" else
                            f"Delete \"{hit.get('name')}\"? This is final. Ask the user, then call again with confirmed=true."),
                "data": {"kind": "needs_approval", "fix": "delete_automation", "acted": False}}
    ok_ = await asyncio.to_thread(delete_automation, hit["id"])
    if not ok_:
        return {"ok": False, "message": "could not delete it"}
    return {"ok": True, "message": (f"מחקתי את ״{hit.get('name')}״." if lang == "he"
                                    else f"Deleted \"{hit.get('name')}\"."),
            "automation": hit.get("name")}


async def _exec_passthrough(name: str, args: dict) -> dict:
    """Reuse the v1 handler for a tool by dispatching through handle_intent."""
    from core.action_parser import handle_intent
    intent = _PASSTHROUGH[name]
    res = await handle_intent({"intent": intent, "params": dict(args), "source": "agent"})
    data = res.get("data")
    if name == "list_automations" and isinstance(data, dict) and isinstance(data.get("automations"), list):
        # Card-shaped copy for the chat (ids stay internal to the app's switches).
        data = {"kind": "automations", "automations": [
            {"id": a.get("id"), "name": a.get("name"), "enabled": bool(a.get("enabled", True)),
             "last_triggered": a.get("last_triggered")}
            for a in data["automations"] if isinstance(a, dict)]}
    return {
        "ok": bool(res.get("ok")),
        "message": res.get("message", ""),
        "data": data,
    }


async def execute_tool(name: str, args: dict, directory: dict, lang: str = "en",
                       actor: str | None = None) -> dict:
    """Dispatch one tool call. Returns a JSON-serializable result dict.

    ``actor`` is the chat user's principal ref ("person:<username>") when the
    turn came from an authenticated human — the state-changing fixes pass it to
    the PDP so the agent can never exceed the person it acts for.
    """
    log_info(f"[agent.tools] execute {name} args={args}")
    # Rehearsal mode: configuration-changing tools are acknowledged, not run.
    # Device control is NOT intercepted here — it flows into home_automation /
    # ir_manager, whose writes are the guarded hop, so the reply reads naturally.
    if name in _REHEARSAL_BLOCKED:
        from services import rehearsal as _rehearsal
        if _rehearsal.active():
            _rehearsal.note("tool", tool=name, args=args)
            return {"ok": True, "rehearsal": True, "message": _REHEARSAL_BLOCKED[name]}
    if name == "control_device":
        return await _exec_control_device(args, directory, actor, lang)
    if name == "what_can_ziggy_do":
        return _exec_what_can_ziggy_do(args)
    if name == "open_screen":
        return _exec_open_screen(args, directory, lang)
    if name == "show_device":
        return _exec_show_device(args, directory, lang)
    if name == "get_temperature":
        res = _exec_get_temperature(args, directory, lang)
        if res is not None:
            return res
        # no reading in the directory → the legacy device-map handler
    if name == "recent_activity":
        return _exec_recent_activity(args, directory)
    if name == "explain_missing_action":
        return await _exec_explain_missing_action(args, directory, lang)
    if name == "repair_history":
        return _exec_repair_history(args, directory, lang)
    if name == "run_routine":
        return await _exec_run_routine(args, lang)
    if name == "toggle_automation":
        return await _exec_toggle_automation(args, lang)
    if name == "delete_automation":
        return await _exec_delete_automation(args, lang, actor)
    if name == "query_devices":
        return _exec_query_devices(args, directory)
    if name == "room_occupancy":
        return _exec_room_occupancy(args, directory)
    if name == "design_smart_room":
        return await _exec_design_smart_room(args, lang)
    if name == "web_search":
        return await _exec_web_search(args)
    if name == "check_home_health":
        return await _exec_check_home_health(lang)
    if name == "refresh_device":
        return await _exec_refresh_device(args, directory, lang, actor)
    if name == "recover_connectivity":
        return await _exec_recover_connectivity(lang, actor)
    if name == "diagnose_device":
        return await _exec_diagnose_device(args, directory, lang)
    if name == "diagnose_pairing":
        return await _exec_diagnose_pairing(lang)
    if name == "acknowledge_alerts":
        return await _exec_acknowledge_alerts(lang)
    if name == "list_down_devices":
        return await _exec_list_down_devices(lang)
    if name == "explain_device_change":
        return await _exec_explain_device_change(args, directory, lang)
    if name in _PASSTHROUGH:
        return await _exec_passthrough(name, args)
    return {"ok": False, "message": f"unknown tool {name}"}
