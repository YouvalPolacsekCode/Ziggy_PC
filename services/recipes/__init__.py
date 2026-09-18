"""Recipes — the tested, deterministic bundles the chat designer composes from.

The designer (services/orchestra_designer.py) is told to PREFER a recipe
whenever an outcome is a room going smart, motion lighting, or the house
reacting to arrivals and departures, and to compose raw rules only for what
no recipe covers. Each recipe is a pure builder:

    build(params: dict, *, home: dict, language: str) -> dict
        {"ok": True,  "automations": [ {name, alias, auto_id?, trigger,
                                         conditions, actions, mode, ...} ],
                      "occupancy_sensors": []}
        {"ok": False, "error": "<short reason>", ...}

`home` is services.home_context.load_home_context(language). Every automation
has a STABLE English alias so a re-apply overwrites in place (never a _2
duplicate), and its light turn_ons carry `respect_hold` so a light a person
switched off stays off (services/light_hold.py). Rules that turn lights on
from motion carry the sleep/movie mode conditions; rules that turn lights off
when a room empties carry the cleaning one (services/modes.py).
"""
from __future__ import annotations

from typing import Callable

from services.recipes import leave_home, motion_light, smart_room, welcome_home

REGISTRY: dict[str, Callable[..., dict]] = {
    "smart_room":   smart_room.build,
    "motion_light": motion_light.build,
    "welcome_home": welcome_home.build,
    "leave_home":   leave_home.build,
}

__all__ = ["REGISTRY"]
