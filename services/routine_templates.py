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

ROUTINE_TEMPLATES: list[dict] = [
    # Intentionally empty. Prompts 3+ add the 4 curated routines here.
    # Schema verified by _validate_routine_template() at import time.
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
