"""Shared helpers for the recipe builders."""
from __future__ import annotations

from typing import Optional

NO_MOTION_LIGHTING = [
    {"type": "mode", "mode": "sleep", "is": False},
    {"type": "mode", "mode": "movie", "is": False},
]
NOT_CLEANING = [{"type": "mode", "mode": "cleaning", "is": False}]
NOT_GUEST = [{"type": "mode", "mode": "guest", "is": False}]


def resolve_slug(room: str) -> str:
    try:
        from services.room_alias_bank import resolve_room
        return resolve_room((room or "").lower().strip())
    except Exception:
        return (room or "").lower().strip().replace(" ", "_")


def find_room(home: dict, room_slug: str) -> Optional[dict]:
    target = (room_slug or "").lower()
    for r in home.get("rooms") or []:
        if str(r.get("id", "")).lower() == target:
            return r
    return None


def room_label(room_slug: str, lang: str) -> str:
    from services.smart_room_recipe import _room_label
    return _room_label(room_slug, lang)


def entity_ids(room: dict, *buckets: str) -> list[str]:
    ents = room.get("entities") or {}
    out: list[str] = []
    for b in buckets:
        for e in ents.get(b) or []:
            eid = e.get("entity_id") if isinstance(e, dict) else None
            if eid and eid not in out:
                out.append(eid)
    return out


def all_rooms_entity_ids(home: dict, *buckets: str) -> list[str]:
    out: list[str] = []
    for r in home.get("rooms") or []:
        for eid in entity_ids(r, *buckets):
            if eid not in out:
                out.append(eid)
    return out


def light_on(entity_id: str, brightness_pct: Optional[int] = None) -> dict:
    step = {"type": "call_service", "entity_id": entity_id, "service": "light.turn_on",
            "service_value": "turn_on", "respect_hold": True}
    if brightness_pct is not None:
        step["service_data"] = {"brightness_pct": int(brightness_pct)}
    return step


def light_off(entity_id: str) -> dict:
    return {"type": "call_service", "entity_id": entity_id, "service": "light.turn_off",
            "service_value": "turn_off"}
