"""Recipe: Smart Room — thin wrapper over services.smart_room_recipe.

params: room (required), occupancy_entity?, lights?, off_delay_minutes?,
        night_start?, night_end?, day_brightness?, night_brightness?
"""
from __future__ import annotations

from services.recipes._common import resolve_slug


def build(params: dict, *, home: dict, language: str = "en") -> dict:
    from services.smart_room_recipe import build_smart_room_bundle
    room = resolve_slug(str(params.get("room") or ""))
    if not room:
        return {"ok": False, "error": "room is required"}
    options = {k: v for k, v in (params or {}).items()
               if k in ("lights", "off_delay_minutes", "night_start", "night_end",
                        "day_brightness", "night_brightness", "night_kelvin")}
    res = build_smart_room_bundle(room, occupancy_entity=params.get("occupancy_entity"),
                                  home=home, language=language, options=options or None)
    if res.get("needs_occupancy"):
        return {"ok": False, "error": "needs_occupancy", "room": room,
                "sensors": res.get("sensors")}
    if not res.get("ok"):
        b = res.get("bundle") or {}
        return {"ok": False, "error": b.get("decline") or res.get("error") or "could not build"}
    bundle = res["bundle"]
    return {"ok": True,
            "automations": list((bundle.get("artifacts") or {}).get("automations") or []),
            "occupancy_sensors": [],
            "name": bundle.get("name"), "rationale": bundle.get("rationale"),
            "recipe_meta": {k: bundle.get(k) for k in ("occupancy_entity", "zone", "lights", "has_presence")}}
