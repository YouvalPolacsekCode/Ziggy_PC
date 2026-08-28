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
    # Pro Mode: reuse the v1 handler so the chat gets the SAME preview-card
    # envelope (data.kind=automation_bundle_preview) + guardrails (no empty /
    # voice-only cards). The runner detects that envelope and renders the card.
    "design_automation": "design_automation_set",
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
    """A jargon-free name for a device — the Hebrew noun + room, never an entity_id."""
    if lang == "he":
        noun = dev.get("he_noun") or dev.get("name") or "המכשיר"
        room = dev.get("room_he")
        return f"{noun} ב{room}" if room else noun
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


async def execute_tool(name: str, args: dict, directory: dict, lang: str = "en",
                       actor: str | None = None) -> dict:
    """Dispatch one tool call. Returns a JSON-serializable result dict.

    ``actor`` is the chat user's principal ref ("person:<username>") when the
    turn came from an authenticated human — the state-changing fixes pass it to
    the PDP so the agent can never exceed the person it acts for.
    """
    log_info(f"[agent.tools] execute {name} args={args}")
    if name == "control_device":
        return await _exec_control_device(args, directory)
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
    if name == "acknowledge_alerts":
        return await _exec_acknowledge_alerts(lang)
    if name == "list_down_devices":
        return await _exec_list_down_devices(lang)
    if name == "explain_device_change":
        return await _exec_explain_device_change(args, directory, lang)
    if name in _PASSTHROUGH:
        return await _exec_passthrough(name, args)
    return {"ok": False, "message": f"unknown tool {name}"}
