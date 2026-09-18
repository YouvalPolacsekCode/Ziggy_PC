"""Publish each home mode as a real Home Assistant entity.

Home Assistant runs most of Ziggy's compiled automations, and it cannot read
Ziggy's KV store. So a `{"type": "mode"}` condition would have no HA form and
we would be back to one automation, two evaluators — the split brain behind
the 2026-08-14 incident. Mirroring every mode over retained MQTT discovery
gives HA a genuine `binary_sensor` to gate on (see `services.presence_mqtt`
for the identical pattern and its reasoning).

Read-only in HA on purpose: Ziggy is the only product surface, and every way
to flip a mode (app, chat, button, automation step) goes through
`services.modes.set_mode`, which republishes here.

Retained config + state + availability, announced at every boot: a wiped
broker rebuilds the entities, and a dead hub reads `unavailable` rather than a
stale "sleep on".
"""
from __future__ import annotations

import json
from typing import Optional

from core.logger_module import log_error, log_info

_DISCOVERY_PREFIX = "homeassistant"
AVAILABILITY_TOPIC = "ziggy/modes/availability"


def unique_id(mode: str) -> str:
    return f"ziggy_mode_{mode}"


def state_topic(mode: str) -> str:
    return f"ziggy/modes/{mode}/state"


def config_topic(mode: str) -> str:
    return f"{_DISCOVERY_PREFIX}/binary_sensor/{unique_id(mode)}/config"


def discovery_payload(mode: str) -> dict:
    from services.modes import _META
    label = (_META.get(mode) or {}).get("label_en") or mode.title()
    return {
        "name": f"{label} mode",
        "unique_id": unique_id(mode),
        # Pin the entity's object id on FIRST discovery. Without it HA derives
        # `ziggy_modes_sleep_mode` from the device name (what Canary got);
        # existing entities keep whatever id they already have.
        "object_id": unique_id(mode),
        "state_topic": state_topic(mode),
        "availability_topic": AVAILABILITY_TOPIC,
        "payload_on": "ON",
        "payload_off": "OFF",
        "device": {
            "identifiers": ["ziggy_modes"],
            "name": "Ziggy Modes",
            "manufacturer": "Ziggy",
        },
    }


def _publish(topic: str, payload: bytes) -> bool:
    """Retained publish over the long-lived client room_presence_engine owns
    (the per-call `services.mqtt_client.publish` does not retain, and a
    discovery config that vanishes takes the entity with it)."""
    try:
        from services.room_presence_engine import _publish as retained_publish
        return bool(retained_publish(topic, payload))
    except Exception as exc:
        log_error(f"[ModesMQTT] publish {topic} failed: {exc}")
        return False


def _state_of(mode: str) -> bool:
    from services.modes import is_on
    return bool(is_on(mode))


def _lookup(uid: str) -> Optional[str]:
    from services.room_presence_engine import lookup_mqtt_entity_id
    return lookup_mqtt_entity_id(uid, attempts=2, delay=0.3)


def publish_state(mode: str, on: bool) -> bool:
    return _publish(state_topic(mode), b"ON" if on else b"OFF")


def announce() -> bool:
    """Retained discovery config + availability + current state for every
    mode. Idempotent; called at startup."""
    from services.modes import MODES
    ok = True
    for mode in MODES:
        ok = _publish(config_topic(mode), json.dumps(discovery_payload(mode)).encode()) and ok
    ok = _publish(AVAILABILITY_TOPIC, b"online") and ok
    for mode in MODES:
        ok = publish_state(mode, _state_of(mode)) and ok
    if ok:
        log_info(f"[ModesMQTT] announced {len(MODES)} mode entities")
    return ok


def entity_id(mode: str) -> Optional[str]:
    """The entity_id HA assigned, or None when not (yet) discovered.

    None means "do not compile a condition against it": an HA state condition
    naming an unknown entity evaluates False and would silently stop the
    automation from ever firing.
    """
    try:
        return _lookup(unique_id(mode))
    except Exception:
        return None
