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


def _dimmable_lights_by_room(cap_map: dict) -> list[dict]:
    """Return [{"id": room_id, "entity_id": "light.<x>"}] — one dimmable light
    per room, picking the first dimmable light registered in each.

    Cross-references the device registry to bind each dimmable-light entity to
    its room. Rooms with no registry entry (entity not yet placed) are skipped.
    Used by Fake Occupancy to ensure simulated activity spans multiple rooms
    rather than flickering one bulb on and off all evening.
    """
    try:
        import services.device_registry as _dr
        if not _dr._initialized:
            _dr.init()
        dimmable_ids = set(cap_map.get("has_dimmable_light") or cap_map.get("light_dimmable") or [])
        seen_rooms: set[str] = set()
        result: list[dict] = []
        for entry in _dr.get_all():
            eid = entry.get("entity_id")
            room = entry.get("room")
            if not eid or not room or eid not in dimmable_ids:
                continue
            if room in seen_rooms:
                continue
            seen_rooms.add(room)
            result.append({"id": room, "entity_id": eid})
        return result
    except Exception:
        return []


def _first_tv_ir_device() -> dict | None:
    """Return the first IR-registered TV (any room), or None."""
    try:
        from services.ir_manager import list_ir_devices
        tvs = list_ir_devices(device_type="tv")
        return tvs[0] if tvs else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Global friendly names for capability keys
# ---------------------------------------------------------------------------

CAP_FRIENDLY: dict[str, str] = {
    "climate_control":            "Smart AC / thermostat (Wi-Fi)",
    "ir_ac_control":              "IR AC blaster",
    "light_on_off":                "Smart lights",
    "light_dimmable":              "Dimmable lights",
    "motion_sensor":               "Motion sensor",
    "presence_sensor":             "Presence sensor",
    "phone_presence":              "GPS / phone location tracker",
    "door_sensor":                 "Door sensor",
    "window_sensor":               "Window sensor",
    "leak_sensor":                 "Water leak sensor",
    "smart_plug":                  "Smart plug",
    "energy_monitoring":           "Energy monitor",
    "media_player":                "Media player",
    "room_temperature":            "Temperature sensor",
    "humidity":                    "Humidity sensor",
    # New explicit `has_*` keys (Prompt 2). Same labels as their legacy
    # equivalents — templates may use either key form interchangeably.
    "has_motion_sensor":           "Motion sensor",
    "has_door_sensor":             "Door sensor",
    "has_window_sensor":           "Window sensor",
    "has_mmwave_sensor":           "mmWave presence sensor",
    "has_smart_plug":              "Smart plug",
    "has_energy_monitoring_plug":  "Energy-monitoring plug",
    "has_power_monitoring":        "Power monitor",
    "has_dimmable_light":          "Dimmable lights",
    "has_color_temp_light":        "Color-temperature smart light",
    "has_climate_entity":          "Smart AC / thermostat",
    "has_weather_entity":          "Weather data",
    "has_ir_blaster":              "IR blaster",
    "has_zone_presence":           "Zone-tracked presence",
}


# ---------------------------------------------------------------------------
# Template registry
# ---------------------------------------------------------------------------

TEMPLATES: list[dict] = [

    # ── Presence ──────────────────────────────────────────────────────────

    {
        "id":                    "leave_home",
        "name":                  "Leave Home",
        "description":           "Turn off the lights and AC the moment everyone's left the house.",
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
        "description":           "Turn the lights on the second you open the front door.",
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
        "description":           "Start the AC on your way home so the room is already cool when you walk in.",
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
        "description":           "Lights off and AC at sleep temperature when you go to bed.",
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
        "description":           "Lights on and a comfortable temperature waiting for you when you wake up.",
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
        "description":           "Start the AC automatically when a room gets too warm.",
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
        "description":           "Send you an alert when a room gets too hot — handy for a kid's room.",
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
        "description":           "Light up the room with a gentle glow when you walk past at night.",
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

    # ── Safety (paired / multi-stage) ─────────────────────────────────────

    {
        "id":                    "night_watch",
        "name":                  "Night Watch",
        "description":           "Dim the lights once you're in bed, and quietly alert you if something stirs while you sleep.",
        "category":              "safety",
        "icon":                  "🌃",
        "required_capabilities": ["presence_sensor", "light_dimmable"],
        "optional_capabilities": ["motion_sensor", "light_on_off"],
        "relevant_capabilities": ["presence_sensor", "motion_sensor", "light_dimmable", "light_on_off"],
        "capability_labels": {
            "presence_sensor":  "mmWave presence sensors — bedroom (arms night) and living room (triggers alert)",
            "motion_sensor":    "Motion sensor — fallback alert trigger if living room has no mmWave",
            "light_dimmable":   "Dimmable lights — dimmed to 10% at night, restored at sunrise",
            "light_on_off":     "Smart lights — additional non-dimmable lights are turned off instead of dimmed",
        },
        "safety_level":          "safe",
        "tags":                  ["safety", "night", "presence", "security"],
        # Multi-stage automation. Creates three coordinated automations that
        # share a private local-state namespace ("night_watch"); no global
        # night_mode flag is touched.
        "paired":                True,
        "stages": [
            {
                "key":     "activate",
                "name":    "Night Watch — Activate",
                "purpose": "At the configured time, if bedroom mmWave confirms presence, dim non-bedroom lights and arm the alert.",
            },
            {
                "key":     "alert",
                "name":    "Night Watch — Living Room Alert",
                "purpose": "While the alert is armed, push a notification when the living room mmWave/motion fires.",
            },
            {
                "key":     "disarm",
                "name":    "Night Watch — Disarm at Sunrise",
                "purpose": "At sunrise, clear the local night_active flag and restore lights to their pre-dim state.",
            },
        ],
        # Re-surfacing hook: if the user has manually turned on lights late at
        # night repeatedly, the suggestion engine re-prompts the Night Watch card.
        "habit_signal": {
            "type":            "manual_repeat",
            "intent":          "lights_on_late",
            "min_occurrences": 4,
            "window_days":     14,
            "context":         "after_midnight",
            "re_surface":      True,
        },
    },

    # ── Lighting ──────────────────────────────────────────────────────────

    {
        "id":                    "circadian_lighting",
        "name":                  "Smart Light Schedule",
        "description":           "Match your lights to the time of day — cool and bright at noon, warm and soft at night.",
        "category":              "comfort",
        "icon":                  "🌅",
        "required_capabilities": ["has_color_temp_light"],
        "optional_capabilities": [],
        "relevant_capabilities": ["has_color_temp_light"],
        "capability_labels": {
            "has_color_temp_light": "Color-temperature smart light — colour & brightness adjusted throughout the day",
        },
        "safety_level":          "safe",
        "tags":                  ["lighting", "circadian", "comfort", "sleep"],
        # Marker consumed by Configure flow: this template doesn't slot into the
        # single-trigger wizard. The frontend reads `bundle: "circadian"` from
        # wizard_prefill and posts to /api/automations/circadian-bundle instead.
        "bundle":                "circadian",
    },

    # ── Climate Safety ────────────────────────────────────────────────────

    {
        "id":                    "ac_window_interlock",
        "name":                  "Window Open — AC Off",
        "description":           "When a window opens with the AC running, get a push with a one-tap shutoff.",
        "category":              "climate",
        "icon":                  "🪟",
        # ir_ac_control is the only universal requirement; a window OR door sensor
        # satisfies the trigger side (handled via required_any below).
        "required_capabilities": ["ir_ac_control"],
        "required_any":          [["window_sensor", "door_sensor"]],
        "optional_capabilities": ["door_sensor"],
        "relevant_capabilities": ["window_sensor", "door_sensor", "ir_ac_control"],
        "capability_labels": {
            "window_sensor":  "Window sensor — fires the moment a window opens (preferred trigger)",
            "door_sensor":    "Door sensor — used as the trigger if no window sensor is paired",
            "ir_ac_control":  "IR AC — the AC that gets paused / resumed via IR",
        },
        "safety_level":          "safe",
        "tags":                  ["climate", "energy", "comfort", "window", "ootb"],
        # Zero-habit suggestion — surface immediately at OOTB if both
        # capabilities are present. No usage trail needed to justify it.
        "habit_signal":          None,
        "ootb_priority":         True,
    },

    # ── Away / Safety ────────────────────────────────────────────────────────

    {
        "id":                    "fake_occupancy",
        "name":                  "Away — Simulate Presence",
        "name_he":               "מצב חופשה — הדמיית נוכחות",
        "description":           "Make the home look lived-in while you're away — Ziggy cycles lights and TV randomly through the day.",
        "category":              "safety",
        "icon":                  "🌙",
        "recommended_by_ziggy":  True,
        # Wants at least one dimmable light to drive. The wizard surfaces a
        # multi-room picker so the user can opt rooms in/out; the prefill
        # populates 2–3 rooms automatically when the registry has them.
        "required_capabilities": ["has_dimmable_light"],
        "optional_capabilities": ["has_ir_blaster"],
        "relevant_capabilities": ["has_dimmable_light", "has_ir_blaster"],
        "capability_labels": {
            "has_dimmable_light": "Dimmable lights — staged across rooms to simulate movement",
            "has_ir_blaster":     "IR blaster — used to power a TV on/off (optional)",
        },
        "safety_level":          "safe",
        "tags":                  ["away", "safety", "presence", "vacation"],
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
    # All entries in "required_capabilities" must be present (AND).
    if not all(bool(cap_map.get(c)) for c in template.get("required_capabilities", [])):
        return False
    # Each group in "required_any" must have at least one capability present
    # (AND of ORs). Lets a template say "needs a window OR a door sensor"
    # without forcing both — see ac_window_interlock.
    for group in template.get("required_any", []) or []:
        if not any(bool(cap_map.get(c)) for c in group):
            return False
    return True


def get_matched_caps(template: dict, cap_map: dict) -> list[str]:
    return [c for c in template.get("relevant_capabilities", []) if cap_map.get(c)]


def get_missing_required(template: dict, cap_map: dict) -> list[str]:
    missing = [c for c in template.get("required_capabilities", []) if not cap_map.get(c)]
    for group in template.get("required_any", []) or []:
        if not any(bool(cap_map.get(c)) for c in group):
            # Surface the first option of the unsatisfied group so the UI has
            # something to label as "missing".
            if group:
                missing.append(group[0])
    return missing


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
        "night_watch":         _night_watch,
        "circadian_lighting":  _circadian_lighting,
        "ac_window_interlock": _ac_window_interlock,
        "fake_occupancy":      _fake_occupancy,
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


# ── Night Watch (paired) ──────────────────────────────────────────────────────
#
# Three coordinated automations chained through the EXISTING `automation` step
# type — no new step types, no new condition types, no local-state primitive.
#
#   Stage 1 (time, always enabled)     → snapshots lights, dims them,
#                                         then `automation/mode=enable` Stage 2.
#   Stage 2 (state, saved DISABLED)    → push the Hebrew alert. The HA-managed
#                                         enabled/disabled state of this very
#                                         automation IS the gate.
#   Stage 3 (sunrise, always enabled)  → condition: automation.{stage2} is "on"
#                                         (standard entity condition);
#                                         `automation/mode=disable` Stage 2,
#                                         then restore_entity_states.
#
# Save-time fan-out lives in services.ha_automations._save_paired_automation:
# it reads `paired: True` + `stages: [...]`, creates the three automations
# atomically, and applies each stage's `_initial_enabled` hint so Stage 2 is
# saved disabled and not armed until Stage 1 fires.

def _night_watch(cap_map: dict) -> dict:
    bedroom_sensor      = first_entity(cap_map, "presence_sensor")
    living_room_sensor  = first_entity(cap_map, "presence_sensor", "motion_sensor")

    # Try to assign a distinct living-room sensor when only one is given.
    single_mmwave = False
    if living_room_sensor == bedroom_sensor:
        all_presence = cap_map.get("presence_sensor", []) + cap_map.get("motion_sensor", [])
        for eid in all_presence:
            if eid != bedroom_sensor:
                living_room_sensor = eid
                break
        if living_room_sensor == bedroom_sensor:
            # User has only one motion-class sensor total — wizard guard fires.
            single_mmwave = True

    dimmable     = first_entity(cap_map, "light_dimmable")
    onoff_lights = [e for e in cap_map.get("light_on_off", []) if e != dimmable]

    namespace        = "night_watch"
    dim_level        = 10        # percent — adjustable in the wizard
    default_time     = "00:00"   # adjustable in the wizard
    base_id          = "night_watch"
    stage_alert_id   = f"{base_id}_alert"
    stage_disarm_id  = f"{base_id}_disarm"

    # Stage 1 — saved enabled. Fires at the configured time and arms Stage 2.
    stage_activate: dict = {
        "name":        "Night Watch — Activate",
        "description": "Dims non-bedroom lights and arms the living-room alert once the bedroom mmWave confirms presence.",
        "trigger":     {"type": "time", "time": default_time},
        "conditions":  [
            {"entity_id": bedroom_sensor or "", "operator": "is", "value": "on"},
        ],
        "actions": [
            # Snapshot current state of every light we're about to touch so
            # Stage 3 can restore the pre-dim configuration at sunrise.
            {
                "type":       "save_entity_states",
                "namespace":  namespace,
                "state_key":  "saved_lights",
                "entity_ids": ([dimmable] if dimmable else []) + onoff_lights,
            },
            # Dim the dimmable light.
            *([{
                "type":         "call_service",
                "entity_id":    dimmable,
                "service":      "light.turn_on",
                "service_value": "turn_on",
                "service_data": {"brightness_pct": dim_level},
            }] if dimmable else []),
            # Plain on/off lights go off instead.
            *[{
                "type":         "call_service",
                "entity_id":    eid,
                "service":      "homeassistant.turn_off",
                "service_value": "turn_off",
            } for eid in onoff_lights],
            # Arm Stage 2 via the existing automation step type — `mode: enable`
            # routes to HA's automation.turn_on.
            {
                "type":          "automation",
                "automation_id": stage_alert_id,
                "mode":          "enable",
            },
        ],
        "rooms": [],
    }

    # Stage 2 — saved DISABLED. No condition; the enabled state IS the gate.
    stage_alert: dict = {
        "name":        "Night Watch — Living Room Alert",
        "description": "Pushes a silent alert when the living-room sensor fires. Automatically armed/disarmed by Night Watch.",
        "trigger":     {"type": "state", "entity_id": living_room_sensor or "", "state": "on"},
        "conditions":  [],
        "actions": [
            {
                "type":    "notify",
                "title":   "Ziggy",
                "message": "זוהתה תנועה בסלון 🚨",
            },
        ],
        "rooms": [],
        # Save-time hint read by _save_paired_automation: this stage must be
        # created disabled so the very first time it fires is when Stage 1 arms it.
        "_initial_enabled": False,
    }

    # Stage 3 — disarm at sunrise + restore lights. Standard entity-state
    # condition on the Stage 2 automation entity — no new primitive.
    stage_disarm: dict = {
        "name":        "Night Watch — Disarm at Sunrise",
        "description": "Disables the living-room alert and restores lights to their pre-dim state.",
        "trigger":     {"type": "sunrise", "offset": ""},
        "conditions":  [
            {"entity_id": f"automation.{stage_alert_id}", "operator": "is", "value": "on"},
        ],
        "actions": [
            {
                "type":          "automation",
                "automation_id": stage_alert_id,
                "mode":          "disable",
            },
            {
                "type":       "restore_entity_states",
                "namespace":  namespace,
                "state_key":  "saved_lights",
            },
        ],
        "rooms": [],
    }

    # Wizard-visible warnings — frontend renders any non-empty entries as a
    # banner above the trigger step. Currently only "single mmWave" fires.
    warnings: list[dict] = []
    if single_mmwave:
        warnings.append({
            "id":    "single_mmwave",
            "level": "warn",
            "text":  "נראה שיש לך חיישן אחד בלבד — Night Watch עובד הכי טוב עם חיישן בחדר שינה וחיישן נפרד בסלון.",
        })

    return {
        # Top-level fields mirror Stage 1 so the existing single-stage wizard
        # renders Stage 1 as-is. `paired` + `stages[]` ride along untouched;
        # the save layer reads them.
        **stage_activate,
        "name":          "Night Watch",
        "description":   "Three-stage night routine: arm after midnight, alert on living-room movement, restore at sunrise.",
        "paired":        True,
        "base_id":       base_id,
        "stages":        [stage_activate, stage_alert, stage_disarm],
        "warnings":      warnings,
        "wizard_fields": [
            {"key": "trigger_time",       "label": "Activation time",    "type": "time",   "default": default_time},
            {"key": "bedroom_sensor",     "label": "Bedroom mmWave",     "type": "entity", "capability": "presence_sensor", "default": bedroom_sensor or ""},
            {"key": "living_room_sensor", "label": "Living room sensor", "type": "entity", "capability": ["presence_sensor", "motion_sensor"], "default": living_room_sensor or ""},
            {"key": "lights_to_dim",      "label": "Lights to dim",      "type": "entities", "capability": ["light_dimmable", "light_on_off"], "default": ([dimmable] if dimmable else []) + onoff_lights, "multi": True},
            {"key": "dim_level",          "label": "Dim level (%)",      "type": "percent", "default": dim_level, "min": 1, "max": 100},
        ],
    }


def _circadian_lighting(cap_map: dict) -> dict:
    """Prefill for the Smart Light Schedule bundle.

    Covers 4 HA automations (sunrise / solar-noon / sunset / bedtime). The
    simplified trigger/action wizard can't represent that, so this prefill
    carries `wizard_fields` and a `bundle` marker; the Configure flow reads
    them and POSTs to /api/automations/circadian-bundle instead of the
    regular /api/automations endpoint.
    """
    ct_lights = cap_map.get("has_color_temp_light", []) or []

    return {
        "name":        "Smart Light Schedule",
        "description": "Adjusts colour temperature and brightness of your lights throughout the day",
        "bundle":      "circadian",
        "endpoint":    "/api/automations/circadian-bundle",
        # The only two user-adjustable parameters.
        "wizard_fields": [
            {
                "key": "lights",
                "label": "Lights to include",
                "type": "entities",
                "capability": "has_color_temp_light",
                "default": ct_lights,
                "multi": True,
                "help": "Only colour-temperature lights are selectable. Lights are only adjusted when they're already on — Ziggy never turns lights on or off here.",
            },
            {
                "key": "bedtime",
                "label": "Bedtime",
                "type": "time",
                "default": "22:00",
                "help": "Very warm, dim light kicks in at this time.",
            },
        ],
        # Defaults the wizard sends if the user doesn't touch anything.
        "defaults": {
            "lights":  ct_lights,
            "bedtime": "22:00",
        },
        # Empty placeholders so the regular wizard editor doesn't choke if it
        # ever receives this prefill before the bundle adapter wires up.
        "trigger":    {},
        "conditions": [],
        "actions":    [],
        "rooms":      [],
    }


def _ac_window_interlock(cap_map: dict) -> dict:
    # Sensor selection: prefer a window sensor (matches the user-facing name);
    # fall back to a door sensor so households with door-only contacts still
    # get the protection.
    window = first_entity(cap_map, "window_sensor")
    door   = first_entity(cap_map, "door_sensor")
    sensor = window or door

    ir_ac  = first_entity(cap_map, "ir_ac_control")

    # Trigger: the sensor opens. HA REST state trigger fires immediately.
    trigger = {"type": "state", "entity_id": sensor or "", "state": "on"}

    # Condition: the IR AC is currently on. Uses the new `ir_device_state`
    # condition type which reads ir_manager's assumed_state (IR ACs typically
    # have no HA entity). If the AC is already off, opening a window is a
    # no-op — we skip the push entirely.
    conditions: list[dict] = []
    if ir_ac:
        conditions.append({
            "type":         "ir_device_state",
            "ir_device_id": ir_ac,
            "operator":     "is",
            "value":        "on",
        })

    # Default prefill — auto_shutoff is OFF, so we only send the actionable
    # push. The button payload is a single `ir_command` turn_off step, so the
    # user gets one-tap shutoff from inside the notification.
    #
    # When the wizard exposes the auto_shutoff toggle (see wizard_options
    # below), turning it ON should extend `actions` with:
    #   1. ir_command turn_off                  (immediate pause)
    #   2. wait_for_state sensor → "off" (24 h) (block until window closes)
    #   3. ir_command turn_on                   (resume — only kept if user
    #                                            also leaves resume_on_close on)
    # The "ac_paused_by_interlock" local state described in the spec is
    # implicit: it's the fact that this single execution is mid-flight
    # through its own step list. _running_automations in the executor already
    # de-duplicates re-triggers on rapid open/close cycles, so no global flag
    # or shared file is needed.
    actions: list[dict] = [
        {
            "type":    "notify_actionable",
            "title":   "Window Open — AC Off",
            "message": "החלון פתוח והמזגן עובד 🪟",
            "actions": [
                {
                    "label":  "כבה מזגן",
                    "action": {
                        "type":         "ir_command",
                        "ir_device_id": ir_ac or "",
                        "ir_command":   "turn_off",
                    },
                },
            ],
        },
    ]

    return {
        "name":        "Window Open — AC Off",
        "description": "Notifies you when a window opens while the AC is running, with a one-tap button to turn the AC off.",
        "trigger":     trigger,
        "conditions":  conditions,
        "actions":     actions,
        "rooms":       [],
        # Wizard-visible knobs. Consumed by the Configure flow on the
        # frontend; the current single-trigger wizard renders these as
        # toggles once the form binding is added.
        "wizard_options": {
            "auto_shutoff": {
                "label":   "Auto-shutoff",
                "type":    "toggle",
                "default": False,
            },
            "resume_on_close": {
                "label":     "Resume when window closes",
                "type":      "toggle",
                "default":   True,
                # Only meaningful when auto_shutoff is enabled — the form
                # should hide this row otherwise.
                "shown_if":  {"auto_shutoff": True},
            },
        },
    }


def _fake_occupancy(cap_map: dict) -> dict:
    """Prefill for Away — Simulate Presence.

    Builds the multi-day activation step with a discovered room+light list and,
    if any TV is paired with an IR blaster, the TV's IR device id. The wizard
    surfaces these as editable fields (rooms multi-select, window pickers, day
    count, TV toggle) so the user can confirm or adjust before saving.

    All execution is deferred to services.fake_occupancy_scheduler — the saved
    automation just carries one `fake_occupancy_start` step, fired when the
    user taps Run from the Active tab.
    """
    rooms = _dimmable_lights_by_room(cap_map)
    tv = _first_tv_ir_device()

    # Israeli-evening defaults: 19:00 → 23:00, 7-day vacation length.
    # The user can override every field in the wizard before saving.
    return {
        "name":        "Away — Simulate Presence",
        "description": "Random light + TV activity makes the home look lived-in while you're away. Tap Run when you leave; it auto-stops after the configured number of days.",
        "trigger":     {"type": "manual"},
        "conditions":  [],
        "actions": [
            {
                "type": "fake_occupancy_start",
                "window_start":    "19:00",
                "window_end":      "23:00",
                "duration_days":   7,
                # Two-or-three rooms is the sweet spot — single-room is too
                # obviously a timer, four-plus rooms look choreographed.
                "rooms": rooms[:3],
                "tv_ir_device_id": tv.get("id") if tv else None,
                "brightness_pct":  70,
            },
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
