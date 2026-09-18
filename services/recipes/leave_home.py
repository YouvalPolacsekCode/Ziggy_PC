"""Recipe: Leave Home — everything off once the house is genuinely empty.

Server-side twin of the app's Leave Home wizard
(frontend/src/components/automations/bundles/recipes/leaveHome.jsx), same id
(`ziggy_leave_home`), same guard: "quiet" is a DURATION, not an instant. Every
motion sensor must have been off for `quiet_minutes` (the trigger AND each
condition carry the window), because one idle room hitting the trigger while a
living-room PIR sat in a blink-gap once read as "house empty" and killed the AC
on someone sitting right there (2026-08-14).

Adds what the wizard didn't have: `mode guest is false` — with guests in the
house, "everyone left" must not run.

params: quiet_minutes=30, ac=True, notify=True
"""
from __future__ import annotations

from services.recipes._common import NOT_GUEST, all_rooms_entity_ids

AUTO_ID = "ziggy_leave_home"


def build(params: dict, *, home: dict, language: str = "en") -> dict:
    lang = "he" if language == "he" else "en"
    try:
        quiet = max(5, int(params.get("quiet_minutes") or 30))
    except (TypeError, ValueError):
        quiet = 30
    motion = all_rooms_entity_ids(home, "motion", "presence", "occupancy")
    doors = all_rooms_entity_ids(home, "door")
    persons = home.get("persons") or []
    if not motion and not doors and not persons:
        return {"ok": False, "error": "no_presence_signal"}

    if motion:
        trigger = {"type": "state", "entity_id": motion, "state": "off", "for_minutes": quiet}
        primary = "motion"
    elif doors:
        trigger = {"type": "state", "entity_id": doors[0], "state": "off"}
        primary = "door"
    else:
        trigger = {"type": "all_persons_left"}
        primary = "phone"

    conditions: list[dict] = []
    for m in motion:
        conditions.append({"entity_id": m, "operator": "is", "value": "off", "for_minutes": quiet})
    if doors and primary != "door":
        conditions.append({"entity_id": doors[0], "operator": "is", "value": "off"})
    if persons and primary != "phone":
        conditions.append({"type": "presence", "value": "all_away"})
    conditions += list(NOT_GUEST)

    actions: list[dict] = [{"type": "turn_off_all_lights"}]
    turned_off_en, turned_off_he = ["the lights"], ["האורות"]
    if params.get("ac", True):
        climates = all_rooms_entity_ids(home, "climate")
        if climates:
            actions.append({"type": "call_service", "entity_id": climates[0],
                            "service": "climate.turn_off", "service_value": "turn_off"})
            turned_off_en.append("the AC"); turned_off_he.append("המזגן")
    if params.get("notify", True):
        actions.append({"type": "notify", "title": "Leave Home",
                        "message": (f"כולם יצאו — כיביתי את {' ו'.join(turned_off_he)}."
                                    if lang == "he" else
                                    f"Everyone left — turned off {' and '.join(turned_off_en)}.")})

    auto = {
        "name": "Leave Home",
        "alias": "Leave Home",
        "auto_id": AUTO_ID,
        "description": ("כשכולם יוצאים והבית שקט, האורות (והמזגן) נכבים."
                        if lang == "he" else
                        "When everyone has left and the house has been still, the lights (and AC) go off."),
        "bundle": "leave_home",
        "source": "custom",
        "trigger": trigger,
        "conditions": conditions,
        "actions": actions,
        "mode": "single",
        "rooms": [],
    }
    return {"ok": True, "automations": [auto], "occupancy_sensors": []}
