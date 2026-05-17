"""
Curated prebuilt automation template library — 9 templates.

Design rules:
- required_capabilities  — ALL must be present for can_run = True
- optional_capabilities  — improves the automation when present
- relevant_capabilities  — ANY single match causes this template to surface in Suggested
- Conditions are added only when they prevent real false positives, not just because we can.
- build_prefill uses the best available device for each slot; empty strings mean the
  wizard will ask the user to fill that slot before saving.
"""
from __future__ import annotations

from services.capability_matcher import first_entity


# ---------------------------------------------------------------------------
# Global friendly names for capability keys
# ---------------------------------------------------------------------------

CAP_FRIENDLY: dict[str, str] = {
    "climate_control":   "Smart AC / thermostat (Wi-Fi)",
    "ir_ac_control":     "IR AC blaster",
    "light_on_off":      "Smart lights",
    "light_dimmable":    "Dimmable lights",
    "motion_sensor":     "Motion sensor",
    "presence_sensor":   "Presence sensor",
    "phone_presence":    "GPS / phone location tracker",
    "door_sensor":       "Door sensor",
    "window_sensor":     "Window sensor",
    "leak_sensor":       "Water leak sensor",
    "smart_plug":        "Smart plug",
    "energy_monitoring": "Energy monitor",
    "media_player":      "Media player",
    "room_temperature":  "Temperature sensor",
    "humidity":          "Humidity sensor",
}


# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------

TEMPLATES: list[dict] = [

    # ── Presence ──────────────────────────────────────────────────────────

    {
        "id":                    "leave_home",
        "name":                  "Leave Home",
        "description":           "Turn off lights and AC when everyone leaves. Uses GPS (most reliable), or falls back to no-motion-for-30-min if you have motion sensors, or door-close as a last resort.",
        "category":              "presence",
        "icon":                  "🚪",
        "required_capabilities": ["door_sensor"],          # weakest req so it always shows
        "optional_capabilities": ["phone_presence", "motion_sensor", "light_on_off", "climate_control", "ir_ac_control"],
        "relevant_capabilities": ["phone_presence", "motion_sensor", "door_sensor", "light_on_off", "climate_control", "ir_ac_control"],
        "capability_labels": {
            "phone_presence":  "GPS tracker (best trigger — fires when you leave home zone)",
            "motion_sensor":   "Motion sensor (backup — fires after 30 min of no movement)",
            "door_sensor":     "Door sensor (last resort — fires when door closes)",
            "light_on_off":    "Smart lights — will be turned off",
            "climate_control": "Smart AC — will be turned off",
            "ir_ac_control":   "IR AC — will be turned off via IR",
        },
        "safety_level":          "safe",
        "tags":                  ["presence", "energy", "lights"],
    },

    {
        "id":                    "welcome_home",
        "name":                  "Welcome Home",
        "description":           "Turn on lights the moment you open the front door. If you also have GPS presence, a condition confirms it's actually you (not a visitor) before turning anything on.",
        "category":              "presence",
        "icon":                  "🏠",
        "required_capabilities": ["door_sensor", "light_on_off"],
        "optional_capabilities": ["phone_presence", "climate_control", "ir_ac_control"],
        "relevant_capabilities": ["door_sensor", "light_on_off", "phone_presence", "climate_control", "ir_ac_control"],
        "capability_labels": {
            "door_sensor":     "Door sensor — exact moment of arrival (trigger)",
            "light_on_off":    "Smart lights — will be turned on",
            "phone_presence":  "GPS tracker — confirms it's you, not a visitor (condition)",
            "climate_control": "Smart AC — optional comfort on arrival",
            "ir_ac_control":   "IR AC — optional comfort via IR on arrival",
        },
        "safety_level":          "safe",
        "tags":                  ["presence", "lights", "comfort"],
    },

    {
        "id":                    "precool_on_arrival",
        "name":                  "Pre-cool on Arrival",
        "description":           "Turn on AC when you enter the home zone (or a wider 'Near Home' zone for a head-start). Condition: only fires when the room is actually hot (> 24 °C). Create a 2–3 km zone in HA for a true pre-arrival trigger.",
        "category":              "climate",
        "icon":                  "🏡",
        "required_capabilities": ["phone_presence"],
        "optional_capabilities": ["room_temperature", "climate_control", "ir_ac_control"],
        "relevant_capabilities": ["phone_presence", "room_temperature", "climate_control", "ir_ac_control"],
        "capability_labels": {
            "phone_presence":   "GPS tracker (person.X or device_tracker.X) — location trigger",
            "room_temperature": "Temperature sensor — condition: only run when room > 24 °C",
            "climate_control":  "Smart AC — will be set to cool at 22 °C",
            "ir_ac_control":    "IR AC blaster — will be activated via IR",
        },
        "safety_level":          "safe",
        "tags":                  ["presence", "climate", "comfort", "gps", "zone"],
    },

    # ── Routine ───────────────────────────────────────────────────────────

    {
        "id":                    "sleep_mode",
        "name":                  "Sleep Mode",
        "description":           "Turn off all lights and lower AC at bedtime. If you have motion sensors, a condition confirms no one is still moving around before shutting things down.",
        "category":              "routine",
        "icon":                  "🌙",
        "required_capabilities": ["light_on_off"],
        "optional_capabilities": ["motion_sensor", "climate_control", "ir_ac_control"],
        "relevant_capabilities": ["light_on_off", "motion_sensor", "climate_control", "ir_ac_control"],
        "capability_labels": {
            "light_on_off":    "Smart lights — will be turned off",
            "motion_sensor":   "Motion sensor — condition: only triggers if no movement detected",
            "climate_control": "Smart AC — will be set to sleep temperature (20 °C)",
            "ir_ac_control":   "IR AC — will be adjusted via IR",
        },
        "safety_level":          "safe",
        "tags":                  ["routine", "night", "comfort"],
    },

    {
        "id":                    "morning_routine",
        "name":                  "Morning Routine",
        "description":           "Turn on lights and set a comfortable temperature at wake-up. If you have GPS tracking, a condition ensures this only fires when you're actually home (skips it when you're travelling).",
        "category":              "routine",
        "icon":                  "☀️",
        "required_capabilities": ["light_on_off"],
        "optional_capabilities": ["phone_presence", "climate_control", "ir_ac_control"],
        "relevant_capabilities": ["light_on_off", "phone_presence", "climate_control", "ir_ac_control"],
        "capability_labels": {
            "light_on_off":    "Smart lights — will be turned on",
            "phone_presence":  "GPS tracker — condition: skip if you're away",
            "climate_control": "Smart AC — will be set to morning temperature (22 °C)",
            "ir_ac_control":   "IR AC — will be adjusted via IR",
        },
        "safety_level":          "safe",
        "tags":                  ["routine", "morning", "comfort"],
    },

    # ── Climate ───────────────────────────────────────────────────────────

    {
        "id":                    "smart_climate",
        "name":                  "Smart Climate Control",
        "description":           "Automatically activate AC when room temperature exceeds a threshold. Condition: only when someone is home — no point cooling an empty house. Works with Wi-Fi thermostat or IR blaster.",
        "category":              "climate",
        "icon":                  "🌡️",
        "required_capabilities": ["room_temperature"],
        "optional_capabilities": ["phone_presence", "climate_control", "ir_ac_control"],
        "relevant_capabilities": ["room_temperature", "phone_presence", "climate_control", "ir_ac_control"],
        "capability_labels": {
            "room_temperature": "Temperature sensor — monitors room heat (trigger)",
            "phone_presence":   "GPS tracker — condition: only cools when you're home",
            "climate_control":  "Smart AC — set to cool mode at 22 °C",
            "ir_ac_control":    "IR AC blaster — turned on via IR command",
        },
        "safety_level":          "safe",
        "tags":                  ["climate", "temperature", "comfort"],
    },

    # ── Safety ────────────────────────────────────────────────────────────

    {
        "id":                    "child_room_monitor",
        "name":                  "Child Room Comfort Monitor",
        "description":           "Alert when a room's temperature rises above a safe threshold (28 °C). Add a separate automation for humidity if needed — the wizard only supports one trigger at a time.",
        "category":              "safety",
        "icon":                  "👶",
        "required_capabilities": ["room_temperature"],
        "optional_capabilities": ["climate_control", "ir_ac_control"],
        "relevant_capabilities": ["room_temperature", "climate_control", "ir_ac_control"],
        "capability_labels": {
            "room_temperature": "Temperature sensor — monitors room heat (trigger at > 28 °C)",
            "climate_control":  "Smart AC — optional: auto-cool the room",
            "ir_ac_control":    "IR AC — optional: auto-cool via IR",
        },
        "safety_level":          "safe",
        "tags":                  ["safety", "temperature", "children"],
    },

    # ── Comfort ───────────────────────────────────────────────────────────

    {
        "id":                    "motion_night_light",
        "name":                  "Motion Night Light",
        "description":           "Turn on a light when motion is detected at night, then turn it off after 2 minutes. Condition: only active between 21:00 and 07:00 so it doesn't trigger during the day.",
        "category":              "comfort",
        "icon":                  "👣",
        "required_capabilities": ["motion_sensor", "light_on_off"],
        "optional_capabilities": [],
        "relevant_capabilities": ["motion_sensor", "light_on_off"],
        "capability_labels": {
            "motion_sensor": "Motion sensor — triggers the light",
            "light_on_off":  "Smart light — turns on, waits 2 min, turns off",
        },
        "safety_level":          "safe",
        "tags":                  ["motion", "lights", "night"],
    },

    # ── Energy ────────────────────────────────────────────────────────────

    {
        "id":                    "anti_waste_watchdog",
        "name":                  "Anti-Waste Watchdog",
        "description":           "At 23:00, if any lights are still on, turn them all off and send a notification. Saves energy without requiring you to remember. Condition: only fires when a light is actually on.",
        "category":              "energy",
        "icon":                  "♻️",
        "required_capabilities": ["light_on_off"],
        "optional_capabilities": ["smart_plug"],
        "relevant_capabilities": ["light_on_off", "smart_plug"],
        "capability_labels": {
            "light_on_off": "Smart lights — checked and turned off if still on at 23:00",
            "smart_plug":   "Smart plugs — optional: add a separate automation to check plug devices",
        },
        "safety_level":          "safe",
        "tags":                  ["energy", "lights", "automatic"],
    },
]


# ---------------------------------------------------------------------------
# Suggestion matching
# ---------------------------------------------------------------------------

def matches_suggestion(template: dict, cap_map: dict) -> bool:
    """
    Surface the template if the user has ANY relevant device.
    Empty relevant_capabilities → always show.
    """
    relevant = template.get("relevant_capabilities", [])
    if not relevant:
        return True
    return any(bool(cap_map.get(c)) for c in relevant)


def can_run(template: dict, cap_map: dict) -> bool:
    return all(bool(cap_map.get(c)) for c in template.get("required_capabilities", []))


def get_matched_caps(template: dict, cap_map: dict) -> list[str]:
    return [c for c in template.get("relevant_capabilities", []) if cap_map.get(c)]


def get_missing_required(template: dict, cap_map: dict) -> list[str]:
    return [c for c in template.get("required_capabilities", []) if not cap_map.get(c)]


def get_missing_optional(template: dict, cap_map: dict) -> list[str]:
    return [c for c in template.get("optional_capabilities", []) if not cap_map.get(c)]


def friendly_cap(template: dict, cap: str) -> str:
    local = template.get("capability_labels", {}).get(cap)
    return local if local else CAP_FRIENDLY.get(cap, cap.replace("_", " "))


# ---------------------------------------------------------------------------
# Prefill builders
# ---------------------------------------------------------------------------

def build_prefill(template: dict, cap_map: dict) -> dict:
    builders = {
        "leave_home":          _leave_home,
        "welcome_home":        _welcome_home,
        "precool_on_arrival":  _precool_on_arrival,
        "sleep_mode":          _sleep_mode,
        "morning_routine":     _morning_routine,
        "smart_climate":       _smart_climate,
        "child_room_monitor":  _child_room_monitor,
        "motion_night_light":  _motion_night_light,
        "anti_waste_watchdog": _anti_waste_watchdog,
    }
    fn = builders.get(template["id"])
    return fn(cap_map) if fn else _generic(template, cap_map)


# ── Builders ──────────────────────────────────────────────────────────────────

def _leave_home(cap_map: dict) -> dict:
    phone   = first_entity(cap_map, "phone_presence")
    motion  = first_entity(cap_map, "motion_sensor")
    door    = first_entity(cap_map, "door_sensor")
    climate = first_entity(cap_map, "climate_control")

    # Best trigger: GPS (person → not_home)
    # Second: motion sensor off for 30 min
    # Last resort: door closes
    if phone:
        trigger = {"type": "state", "entity_id": phone, "state": "not_home"}
    elif motion:
        trigger = {"type": "state", "entity_id": motion, "state": "off", "for_minutes": 30}
    else:
        trigger = {"type": "state", "entity_id": door or "", "state": "off"}

    # Condition: no motion currently (guards multi-person households)
    conditions = []
    if motion:
        conditions.append({"entity_id": motion, "operator": "is", "value": "off"})

    actions: list[dict] = [{"type": "send_intent", "text": "Turn off all lights"}]
    if climate:
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "homeassistant.turn_off", "service_value": "turn_off",
        })
    actions.append({
        "type": "notify",
        "message": "Everyone left — lights and AC turned off.",
        "title": "Leave Home",
    })

    return {
        "name":        "Leave Home",
        "description": "Turns off lights and AC when everyone leaves home",
        "trigger":     trigger,
        "conditions":  conditions,
        "actions":     actions,
        "rooms":       [],
    }


def _welcome_home(cap_map: dict) -> dict:
    door    = first_entity(cap_map, "door_sensor")
    light   = first_entity(cap_map, "light_on_off")
    phone   = first_entity(cap_map, "phone_presence")
    climate = first_entity(cap_map, "climate_control")

    # Trigger: door opens (exact moment of entry)
    trigger = {"type": "state", "entity_id": door or "", "state": "on"}

    # Condition: GPS confirms it's a household member, not a visitor
    conditions = []
    if phone:
        conditions.append({"entity_id": phone, "operator": "is", "value": "home"})

    actions: list[dict] = []
    if light:
        actions.append({
            "type": "call_service", "entity_id": light,
            "service": "homeassistant.turn_on", "service_value": "turn_on",
        })
    if climate:
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "climate.set_temperature",
            "service_value": "set_temperature",
            "service_data": {"temperature": 22},
        })
    actions.append({
        "type": "notify",
        "message": "Welcome home!",
        "title": "Welcome Home",
    })

    return {
        "name":        "Welcome Home",
        "description": "Turns on lights when you open the front door",
        "trigger":     trigger,
        "conditions":  conditions,
        "actions":     actions,
        "rooms":       [],
    }


def _precool_on_arrival(cap_map: dict) -> dict:
    tracker = first_entity(cap_map, "phone_presence")
    temp    = first_entity(cap_map, "room_temperature")
    climate = first_entity(cap_map, "climate_control")

    actions: list[dict] = []
    if climate:
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "homeassistant.turn_on", "service_value": "turn_on",
        })
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "climate.set_temperature",
            "service_value": "set_temperature",
            "service_data": {"temperature": 22},
        })
    else:
        # IR AC or nothing — let Ziggy's intent pipeline handle it
        actions.append({"type": "send_intent", "text": "Turn on AC"})
    actions.append({
        "type": "notify",
        "message": "You're heading home — AC is cooling down for your arrival.",
        "title": "Pre-cool on Arrival",
    })

    # Condition: only run if it's actually hot (temp sensor available)
    conditions = []
    if temp:
        conditions.append({"entity_id": temp, "operator": "above", "value": "24"})

    return {
        "name":        "Pre-cool on Arrival",
        "description": "Turns on AC when you enter home zone (or a wider Near Home zone)",
        "trigger":     {
            "type":      "zone",
            "entity_id": tracker or "",
            "zone":      "zone.home",
            "event":     "enter",
        },
        "conditions":  conditions,
        "actions":     actions,
        "rooms":       [],
    }


def _sleep_mode(cap_map: dict) -> dict:
    motion  = first_entity(cap_map, "motion_sensor")
    climate = first_entity(cap_map, "climate_control")

    # Condition: no one moving around (so we don't cut lights on an awake person)
    conditions = []
    if motion:
        conditions.append({"entity_id": motion, "operator": "is", "value": "off"})

    actions: list[dict] = [{"type": "send_intent", "text": "Turn off all lights"}]
    if climate:
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "climate.set_temperature",
            "service_value": "set_temperature",
            "service_data": {"temperature": 20},
        })
    actions.append({
        "type": "notify",
        "message": "Sleep mode on — lights off, AC at 20 °C.",
        "title": "Sleep Mode",
    })

    return {
        "name":        "Sleep Mode",
        "description": "Turns off lights and sets AC to sleep temperature at bedtime",
        "trigger":     {"type": "time", "time": "22:30"},
        "conditions":  conditions,
        "actions":     actions,
        "rooms":       [],
    }


def _morning_routine(cap_map: dict) -> dict:
    light   = first_entity(cap_map, "light_on_off")
    phone   = first_entity(cap_map, "phone_presence")
    climate = first_entity(cap_map, "climate_control")

    # Condition: you're home (skip if you're away on a trip)
    conditions = []
    if phone:
        conditions.append({"entity_id": phone, "operator": "is", "value": "home"})

    actions: list[dict] = []
    if light:
        actions.append({
            "type": "call_service", "entity_id": light,
            "service": "homeassistant.turn_on", "service_value": "turn_on",
        })
    if climate:
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "climate.set_temperature",
            "service_value": "set_temperature",
            "service_data": {"temperature": 22},
        })
    actions.append({
        "type": "notify",
        "message": "Good morning!",
        "title": "Morning Routine",
    })

    return {
        "name":        "Morning Routine",
        "description": "Turns on lights and sets a comfortable temperature at wake-up",
        "trigger":     {"type": "time", "time": "07:00"},
        "conditions":  conditions,
        "actions":     actions,
        "rooms":       [],
    }


def _smart_climate(cap_map: dict) -> dict:
    temp    = first_entity(cap_map, "room_temperature")
    climate = first_entity(cap_map, "climate_control")
    phone   = first_entity(cap_map, "phone_presence")

    # Condition: someone is home — no point cooling an empty house
    conditions = []
    if phone:
        conditions.append({"entity_id": phone, "operator": "is", "value": "home"})

    actions: list[dict] = []
    if climate:
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "climate.set_hvac_mode",
            "service_value": "set_hvac_mode",
            "service_data": {"hvac_mode": "cool"},
        })
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "climate.set_temperature",
            "service_value": "set_temperature",
            "service_data": {"temperature": 22},
        })
    else:
        # IR blaster or no AC entity — route through Ziggy intent
        actions.append({"type": "send_intent", "text": "Turn on AC"})
    actions.append({
        "type": "notify",
        "message": "Room is getting hot — AC activated.",
        "title": "Smart Climate",
    })

    return {
        "name":        "Smart Climate Control",
        "description": "Activates AC when room temperature exceeds 26 °C",
        "trigger":     {"type": "numeric_state", "entity_id": temp or "", "above": 26},
        "conditions":  conditions,
        "actions":     actions,
        "rooms":       [],
    }


def _child_room_monitor(cap_map: dict) -> dict:
    temp    = first_entity(cap_map, "room_temperature")
    climate = first_entity(cap_map, "climate_control")

    actions: list[dict] = [
        {"type": "notify", "message": "Child room temperature is above 28 °C — check the AC.", "title": "Child Room Alert"},
    ]
    if climate:
        actions.append({
            "type": "call_service", "entity_id": climate,
            "service": "climate.set_temperature",
            "service_value": "set_temperature",
            "service_data": {"temperature": 22},
        })

    return {
        "name":        "Child Room Comfort Monitor",
        "description": "Alerts (and optionally auto-cools) when room temperature exceeds 28 °C",
        "trigger":     {"type": "numeric_state", "entity_id": temp or "", "above": 28},
        "conditions":  [],
        "actions":     actions,
        "rooms":       [],
    }


def _motion_night_light(cap_map: dict) -> dict:
    motion = first_entity(cap_map, "motion_sensor")
    light  = first_entity(cap_map, "light_on_off")

    # Condition: nighttime only (21:00 – 07:00)
    conditions = [{"type": "time", "after": "21:00", "before": "07:00"}]

    return {
        "name":        "Motion Night Light",
        "description": "Turns on a light when motion is detected at night, off after 2 min",
        "trigger":     {"type": "state", "entity_id": motion or "", "state": "on"},
        "conditions":  conditions,
        "actions":     [
            {"type": "call_service", "entity_id": light or "", "service": "homeassistant.turn_on",  "service_value": "turn_on"},
            {"type": "delay",        "seconds": 120},
            {"type": "call_service", "entity_id": light or "", "service": "homeassistant.turn_off", "service_value": "turn_off"},
        ],
        "rooms":       [],
    }


def _anti_waste_watchdog(cap_map: dict) -> dict:
    light = first_entity(cap_map, "light_on_off")

    # Condition: at least one light is actually on — skip the notification if everything is already off
    conditions = []
    if light:
        conditions.append({"entity_id": light, "operator": "is", "value": "on"})

    return {
        "name":        "Anti-Waste Watchdog",
        "description": "At 23:00, if lights are still on, turns them off and notifies you",
        "trigger":     {"type": "time", "time": "23:00"},
        "conditions":  conditions,
        "actions":     [
            {"type": "send_intent", "text": "Turn off all lights"},
            {"type": "notify",      "message": "Lights were left on — turned off automatically.", "title": "Waste Watchdog"},
        ],
        "rooms":       [],
    }


def _generic(template: dict, cap_map: dict) -> dict:
    return {
        "name":        template["name"],
        "description": template["description"],
        "trigger":     {"type": "time", "time": "08:00"},
        "conditions":  [],
        "actions":     [],
        "rooms":       [],
    }
