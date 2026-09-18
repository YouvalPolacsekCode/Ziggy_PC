"""Recipe: Welcome Home — lights on when a household member arrives.

Runs on Ziggy's own presence engine (`person_arrives`, fired by
services.presence_side_effects), not on an HA person/zone trigger, so it
works with the phones Ziggy already tracks and needs no HA companion setup.

params: lights (required list of light entity ids), only_after_dark=True,
        person="*" (or a name)
"""
from __future__ import annotations

from services.recipes._common import all_rooms_entity_ids, light_on

AUTO_ID = "ziggy_welcome_home"


def build(params: dict, *, home: dict, language: str = "en") -> dict:
    lang = "he" if language == "he" else "en"
    known = set(all_rooms_entity_ids(home, "light"))
    lights = [str(l) for l in (params.get("lights") or []) if str(l) in known] if known else \
             [str(l) for l in (params.get("lights") or [])]
    if not lights:
        return {"ok": False, "error": "no_lights"}
    conditions: list[dict] = []
    if params.get("only_after_dark", True):
        conditions.append({"type": "sun", "after": "sunset"})
    person = str(params.get("person") or "*")
    auto = {
        "name": ("אור כשמגיעים הביתה" if lang == "he" else "Lights on when you arrive"),
        "alias": "Ziggy Welcome Home",
        "auto_id": AUTO_ID,
        "description": ("כשמישהו מהבית מגיע, האורות שבחרת נדלקים."
                        + (" רק אחרי השקיעה." if conditions else "")
                        if lang == "he" else
                        "When someone from the household arrives, the lights you chose come on."
                        + (" Only after sunset." if conditions else "")),
        "source": "custom",
        "trigger": {"type": "person_arrives", "person": person},
        "conditions": conditions,
        "actions": [light_on(l) for l in lights],
        "mode": "single",
        "rooms": [],
    }
    return {"ok": True, "automations": [auto], "occupancy_sensors": []}
