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
        "name": "design_automation",
        "description": (
            "ZIGGY PRO MODE. Use when the user describes an OUTCOME for their home "
            "(not a single action): 'make the bedroom smart', 'תעשה אוטומציה לסלון', "
            "'set up a morning routine', 'automate the office'. Returns a preview "
            "bundle the user reviews before anything is created. Pass the user's "
            "outcome text verbatim."
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
]

# Tool names that produce a natural action-confirmation and, when they succeed
# alone with no model narration, can be confirmed deterministically (1 round-trip).
TERMINAL_ACTION_TOOLS = frozenset({"control_device", "create_automation", "add_task"})

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
}


def _norm_action(action: str) -> str:
    return _ACTION_ALIASES.get((action or "").strip().lower(), (action or "").strip().lower())


async def _exec_control_device(args: dict, directory: dict) -> dict:
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

    try:
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
                toggle_light(eid, on)
                done = "on" if on else "off"
        elif dom == "climate":
            if action == "set_temperature":
                set_ac_temperature(eid, int(float(value)))
                done = "set_temperature"
            elif action == "off":
                call_service("climate", "turn_off", {"entity_id": eid})
                done = "off"
            else:  # on — cool-first Israeli default
                call_service("climate", "set_hvac_mode", {"entity_id": eid, "hvac_mode": "cool"})
                done = "on"
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

    return {
        "ok": True, "message": f"{done} {dev['name']}",
        "device": dev, "action": done, "value": value,
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
         "state": d["state"], "on": d["on"], "he_noun": d["he_noun"], "room_he": d["room_he"]}
        for d in devices
    ]
    return {"ok": True, "message": f"{len(summary)} devices", "devices": summary}


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


async def _exec_design_automation(args: dict) -> dict:
    outcome = (args.get("outcome") or "").strip()
    try:
        from services.orchestra_designer import design_bundle
        res = design_bundle(outcome)
        if not res.get("ok"):
            return {"ok": False, "message": res.get("error") or "design failed"}
        bundle = res["bundle"]
        # Surface the bundle so the frontend can render the preview card.
        return {"ok": True, "message": "bundle designed", "bundle": bundle,
                "preview": True, "decline": bundle.get("decline")}
    except Exception as e:
        log_error(f"[agent.tools] design_automation failed: {e}")
        return {"ok": False, "message": str(e)}


async def _exec_passthrough(name: str, args: dict) -> dict:
    """Reuse the v1 handler for a tool by dispatching through handle_intent."""
    from core.action_parser import handle_intent
    intent = _PASSTHROUGH[name]
    res = await handle_intent({"intent": intent, "params": dict(args), "source": "agent"})
    return {
        "ok": bool(res.get("ok")),
        "message": res.get("message", ""),
        "data": res.get("data"),
    }


async def execute_tool(name: str, args: dict, directory: dict) -> dict:
    """Dispatch one tool call. Returns a JSON-serializable result dict."""
    log_info(f"[agent.tools] execute {name} args={args}")
    if name == "control_device":
        return await _exec_control_device(args, directory)
    if name == "query_devices":
        return _exec_query_devices(args, directory)
    if name == "room_occupancy":
        return _exec_room_occupancy(args, directory)
    if name == "web_search":
        return await _exec_web_search(args)
    if name == "design_automation":
        return await _exec_design_automation(args)
    if name in _PASSTHROUGH:
        return await _exec_passthrough(name, args)
    return {"ok": False, "message": f"unknown tool {name}"}
