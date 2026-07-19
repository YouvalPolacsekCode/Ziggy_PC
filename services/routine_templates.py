"""
Curated routine-template library (Prompt 2 infrastructure).

Parallel to automation_templates.py but for the Routines tab. Each entry is a
prefab routine (Movie Mode, Work From Home, Shabbat Mode, Kid Bedtime, etc.)
that the Suggested-Routines surface offers as a one-tap configuration.

Design rules (same as automation_templates.py):
- required_capabilities  — ALL must be present for can_run = True
- optional_capabilities  — improves the routine when present
- relevant_capabilities  — ANY single match causes the template to surface
- wizard_prefill         — matches RoutineWizard's {name, description, icon, steps[]}
                           and the routine_router.RoutineBody schema. Built lazily
                           per-cap-map so prefilled entity_ids reflect what the
                           user actually has.

Suggested routines never auto-deploy. The Configure button opens RoutineWizard
prefilled with the routine's steps; the user adjusts and saves.

The actual 4 curated routines (Movie Mode, Work From Home, Shabbat Mode, Kid
Bedtime) are added in later prompts. This file only defines the registry
shape and helper functions so subsequent prompts can drop entries in without
further plumbing.
"""
from __future__ import annotations

from services.automation_templates import CAP_FRIENDLY


# ---------------------------------------------------------------------------
# Routine template registry
# ---------------------------------------------------------------------------
# Each entry shape:
#   {
#     "id":                    str,    # stable id, e.g. "movie_mode"
#     "name":                  str,    # user-facing routine name
#     "description":           str,    # short tagline
#     "icon":                  str,    # emoji shown in card
#     "category":              str,    # entertainment | productivity | family | observance
#     "required_capabilities": [str],  # ALL must be present for can_run
#     "optional_capabilities": [str],  # improves the routine
#     "relevant_capabilities": [str],  # ANY match surfaces in Suggested
#     "capability_labels":     dict,   # per-cap friendly text override
#     "tags":                  [str],
#     "build_steps":           callable(cap_map) -> list[dict]  # see below
#   }
#
# build_steps returns the list of routine steps in the shape RoutineWizard's
# step types expect: {type, action|entity_id|service|service_data|...}.
# It receives the live cap_map so it can pick concrete entity_ids when
# present and emit placeholder steps the user fills in when absent.

# ── Step builders ────────────────────────────────────────────────────────────
# Steps use the RoutineWizard vocabulary: {type:'message', text} rides the
# intent pipeline (works on any home), {type:'device', entity_id, action}
# binds a concrete cap_map entity, {type:'fake_occupancy_start', ...} is run
# natively by execute_ziggy_actions. Builders only add device-bound steps when
# the home actually has the device — never an empty entity_id.

def _first(cap_map: dict, *caps: str) -> str:
    from services.capability_matcher import first_entity
    for c in caps:
        e = first_entity(cap_map, c)
        if e:
            return e
    return ""


def _good_night_steps(cap_map: dict) -> list[dict]:
    steps: list[dict] = [{"type": "message", "text": "Turn off all lights"}]
    ac = _first(cap_map, "climate_control", "has_climate_entity")
    if ac:
        # Israeli sleep default — quiet cool, not off. User tunes in the wizard.
        steps.append({"type": "message", "text": "Set the AC to 26 degrees"})
    return steps


def _good_morning_steps(cap_map: dict) -> list[dict]:
    steps: list[dict] = [{"type": "message", "text": "Turn on the lights in the living room"}]
    ac = _first(cap_map, "climate_control", "has_climate_entity")
    if ac:
        steps.append({"type": "message", "text": "Set the AC to 24 degrees"})
    return steps


def _movie_night_steps(cap_map: dict) -> list[dict]:
    steps: list[dict] = [{"type": "message", "text": "Dim the living room lights to 30%"}]
    try:
        from services.ir_manager import list_ir_devices
        tvs = list_ir_devices(device_type="tv")
        if tvs:
            tv = tvs[0]
            steps.append({
                "type": "ir_command", "ir_device_id": tv.get("id", ""),
                "ir_device_name": tv.get("name", "TV"), "ir_command": "power",
            })
    except Exception:
        pass
    ac = _first(cap_map, "climate_control", "has_climate_entity")
    if ac:
        steps.append({"type": "device", "entity_id": ac, "action": "turn_on"})
    return steps


def _leaving_steps(cap_map: dict) -> list[dict]:
    # One step, whole home — the intent pipeline's turn_off_everything.
    return [{"type": "message", "text": "Turn off everything"}]


def _away_steps(cap_map: dict) -> list[dict]:
    from services.automation_templates import _dimmable_lights_by_room, _first_tv_ir_device
    rooms = _dimmable_lights_by_room(cap_map)
    tv = _first_tv_ir_device()
    return [
        {"type": "message", "text": "Turn off everything"},
        {
            # Multi-day simulate-presence — executed by fake_occupancy_scheduler.
            # Same defaults as the retired fake_occupancy automation template.
            "type": "fake_occupancy_start",
            "window_start":    "19:00",
            "window_end":      "23:00",
            "duration_days":   7,
            "rooms":           rooms[:3],
            "tv_ir_device_id": tv.get("id") if tv else None,
            "brightness_pct":  70,
        },
    ]


def _shabbat_steps(cap_map: dict) -> list[dict]:
    # A fixed pre-Shabbat state, run once before candle-lighting: lights you
    # want for the evening ON, AC set — then nothing switches mid-Shabbat.
    steps: list[dict] = [{"type": "message", "text": "Turn on the lights in the living room"}]
    ac = _first(cap_map, "climate_control", "has_climate_entity")
    if ac:
        steps.append({"type": "message", "text": "Set the AC to 24 degrees"})
    return steps


ROUTINE_TEMPLATES: list[dict] = [
    # The 6 curated On-demand starters (2026-07-19 IA addendum A4/A6).
    # trigger_kind is "tap" for ALL of them today — the spoken-phrase surface
    # (phrase / phrase_he below) is metadata for Phase 2, which registers the
    # phrases through the voice/phrase engine. Until then the chips honestly
    # show 👆 only; claiming 🗣 before it works would violate the no-fake gate.
    {
        "id":                    "good_night",
        "name":                  "Good Night",
        "name_he":               "לילה טוב",
        "description":           "Lights off, AC to a quiet sleep setting.",
        "icon":                  "🌙",
        "category":              "family",
        "trigger_kind":          "tap",
        "phrase":                "good night",
        "phrase_he":             "לילה טוב",
        "required_capabilities": ["light_on_off"],
        "optional_capabilities": ["climate_control"],
        "relevant_capabilities": ["light_on_off", "climate_control"],
        "capability_labels":     {"light_on_off": "Smart lights — turned off",
                                  "climate_control": "Smart AC — set to sleep temperature"},
        "tags":                  ["night", "lights", "climate"],
        "build_steps":           _good_night_steps,
    },
    {
        "id":                    "good_morning",
        "name":                  "Good Morning",
        "name_he":               "בוקר טוב",
        "description":           "Lights on and a comfortable temperature to start the day.",
        "icon":                  "☀️",
        "category":              "family",
        "trigger_kind":          "tap",
        "phrase":                "good morning",
        "phrase_he":             "בוקר טוב",
        "required_capabilities": ["light_on_off"],
        "optional_capabilities": ["climate_control"],
        "relevant_capabilities": ["light_on_off", "climate_control"],
        "capability_labels":     {"light_on_off": "Smart lights — turned on",
                                  "climate_control": "Smart AC — set to a comfortable temperature"},
        "tags":                  ["morning", "lights", "climate"],
        "build_steps":           _good_morning_steps,
    },
    {
        "id":                    "movie_night",
        "name":                  "Movie Night",
        "name_he":               "ערב סרט",
        "description":           "Living-room lights dim low, TV on, AC comfortable.",
        "icon":                  "🎬",
        "category":              "entertainment",
        "trigger_kind":          "tap",
        "phrase":                "movie night",
        "phrase_he":             "מצב סרט",
        "required_capabilities": ["light_on_off"],
        "optional_capabilities": ["has_ir_blaster", "climate_control"],
        "relevant_capabilities": ["light_on_off", "has_ir_blaster", "media_player"],
        "capability_labels":     {"light_on_off": "Smart lights — dimmed low",
                                  "has_ir_blaster": "IR blaster — powers the TV on",
                                  "climate_control": "Smart AC — comfort while you watch"},
        "tags":                  ["entertainment", "lights", "tv"],
        "build_steps":           _movie_night_steps,
    },
    {
        "id":                    "leaving",
        "name":                  "Leaving",
        "name_he":               "יוצאים מהבית",
        "description":           "Everything off in one tap on your way out the door.",
        "icon":                  "🚪",
        "category":              "productivity",
        "trigger_kind":          "tap",
        "required_capabilities": ["light_on_off"],
        "optional_capabilities": ["climate_control", "smart_plug"],
        "relevant_capabilities": ["light_on_off", "climate_control", "smart_plug"],
        "capability_labels":     {"light_on_off": "Smart lights — turned off",
                                  "climate_control": "Smart AC — turned off",
                                  "smart_plug": "Smart plugs — turned off"},
        "tags":                  ["leaving", "energy"],
        "build_steps":           _leaving_steps,
    },
    {
        "id":                    "away_vacation",
        "name":                  "Away / Vacation",
        "name_he":               "נסיעה / חופשה",
        "description":           "Everything off, then the home looks lived-in while you're away — lights (and TV) cycle randomly each evening.",
        "icon":                  "🧳",
        "category":              "productivity",
        "trigger_kind":          "tap",
        "required_capabilities": ["light_dimmable"],
        "optional_capabilities": ["has_ir_blaster"],
        "relevant_capabilities": ["light_dimmable", "has_ir_blaster"],
        "capability_labels":     {"light_dimmable": "Dimmable lights — cycled to simulate presence",
                                  "has_ir_blaster": "IR blaster — adds TV flicker to the simulation"},
        "tags":                  ["away", "vacation", "presence", "safety"],
        "build_steps":           _away_steps,
    },
    {
        "id":                    "shabbat",
        "name":                  "Shabbat",
        "name_he":               "שבת",
        "description":           "Set the home for Shabbat before candle-lighting — evening lights on, AC set, and nothing switches until you say so.",
        "icon":                  "🕯️",
        "category":              "observance",
        "trigger_kind":          "tap",
        "phrase":                "shabbat shalom",
        "phrase_he":             "שבת שלום",
        "required_capabilities": ["light_on_off"],
        "optional_capabilities": ["climate_control"],
        "relevant_capabilities": ["light_on_off", "climate_control"],
        "capability_labels":     {"light_on_off": "Smart lights — set to the Shabbat state",
                                  "climate_control": "Smart AC — set once for the evening"},
        "tags":                  ["shabbat", "observance", "lights", "climate"],
        "build_steps":           _shabbat_steps,
    },
]


# ---------------------------------------------------------------------------
# Matching / capability helpers (mirror automation_templates.py)
# ---------------------------------------------------------------------------

def matches_suggestion(template: dict, cap_map: dict) -> bool:
    """Surface the routine template if the user has ANY relevant device."""
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
# Wizard prefill
# ---------------------------------------------------------------------------

def build_wizard_prefill(template: dict, cap_map: dict) -> dict:
    """
    Return the {name, description, icon, steps[]} dict that RoutineWizard's
    `initial` prop expects. Calls the template's build_steps callable if
    provided, otherwise returns an empty-steps shell so the wizard opens
    cleanly and the user can fill it in by hand.
    """
    steps_builder = template.get("build_steps")
    steps: list[dict] = []
    if callable(steps_builder):
        try:
            steps = steps_builder(cap_map) or []
        except Exception:
            # Never let a bad builder break the suggested-routines list —
            # fall back to an empty steps array. The wizard will still open.
            steps = []

    return {
        "name":        template.get("name", ""),
        "description": template.get("description", ""),
        "icon":        template.get("icon", "⚡"),
        "steps":       steps,
    }


# ---------------------------------------------------------------------------
# Internal validation (cheap, run at import time)
# ---------------------------------------------------------------------------

def _validate_routine_template(t: dict) -> None:
    """Lightweight schema check — raises ValueError on malformed templates."""
    required_keys = ("id", "name", "icon", "required_capabilities",
                     "relevant_capabilities")
    for k in required_keys:
        if k not in t:
            raise ValueError(f"Routine template missing required key: {k!r}")
    if not isinstance(t["required_capabilities"], list):
        raise ValueError(f"{t['id']}: required_capabilities must be a list")
    if not isinstance(t["relevant_capabilities"], list):
        raise ValueError(f"{t['id']}: relevant_capabilities must be a list")


for _t in ROUTINE_TEMPLATES:
    _validate_routine_template(_t)


__all__ = [
    "ROUTINE_TEMPLATES",
    "matches_suggestion",
    "can_run",
    "get_matched_caps",
    "get_missing_required",
    "get_missing_optional",
    "friendly_cap",
    "build_wizard_prefill",
]
