"""Recipe: Motion Light — light on when someone walks in, off a while after
the room goes still. Server-side twin of the app's Motion Light wizard
(frontend/src/components/automations/bundles/recipes/motionLight.jsx), so
chat builds the same rule the wizard does.

params: room (required), lights? (subset), sensors? (subset), brightness_pct=100,
        linger_minutes=5, night_only=False, after="19:00", before="06:30"

Shape (one rule, mode=restart so continued movement re-arms the off timer):
  trigger    any motion/presence sensor in the room → on
  conditions not sleep / not movie (+ time window when night_only)
  actions    lights on (respect_hold) → wait until every sensor is off (1 h cap)
             → linger → lights off
"""
from __future__ import annotations

from services.recipes._common import (
    NO_MOTION_LIGHTING, entity_ids, find_room, light_off, light_on, resolve_slug, room_label,
)

WAIT_TIMEOUT_S = 60 * 60


def build(params: dict, *, home: dict, language: str = "en") -> dict:
    lang = "he" if language == "he" else "en"
    slug = resolve_slug(str(params.get("room") or ""))
    room = find_room(home, slug) if slug else None
    if not room:
        return {"ok": False, "error": f"unknown room {params.get('room')!r}"}

    lights = entity_ids(room, "light")
    sensors = entity_ids(room, "motion", "presence", "occupancy")
    if isinstance(params.get("lights"), list) and params["lights"]:
        wanted = {str(x) for x in params["lights"]}
        lights = [l for l in lights if l in wanted]
    if isinstance(params.get("sensors"), list) and params["sensors"]:
        wanted = {str(x) for x in params["sensors"]}
        sensors = [s for s in sensors if s in wanted]
    if not lights:
        return {"ok": False, "error": "no_lights", "room": slug}
    if not sensors:
        return {"ok": False, "error": "no_motion_sensor", "room": slug}

    try:
        brightness = int(params.get("brightness_pct") or 100)
    except (TypeError, ValueError):
        brightness = 100
    try:
        linger_min = max(1, int(params.get("linger_minutes") or 5))
    except (TypeError, ValueError):
        linger_min = 5

    conditions = list(NO_MOTION_LIGHTING)
    if params.get("night_only"):
        conditions.insert(0, {"type": "time", "after": str(params.get("after") or "19:00"),
                              "before": str(params.get("before") or "06:30")})

    actions = [light_on(l, brightness) for l in lights]
    actions += [{"type": "wait_for_state", "entity_id": s, "state": "off",
                 "timeout_seconds": WAIT_TIMEOUT_S, "on_timeout": "continue"} for s in sensors]
    actions.append({"type": "delay", "seconds": linger_min * 60})
    actions += [light_off(l) for l in lights]

    label = room_label(slug, lang)
    en_label = room_label(slug, "en")
    auto = {
        "name": (f"אור לפי תנועה — {label}" if lang == "he" else f"Motion light — {label}"),
        "alias": f"Ziggy Motion Light {en_label}",
        "description": ("האור נדלק כשנכנסים ונכבה כמה דקות אחרי שהחדר נרגע."
                        if lang == "he" else
                        "Light on when you walk in, off a few minutes after the room goes still."),
        "source": "custom",
        "trigger": {"type": "state", "entity_id": sensors, "state": "on"},
        "conditions": conditions,
        "actions": actions,
        "mode": "restart",
        "rooms": [slug],
    }
    return {"ok": True, "automations": [auto], "occupancy_sensors": []}
