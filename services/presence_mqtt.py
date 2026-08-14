"""Publish Ziggy's household presence as a real Home Assistant entity.

Ziggy runs its own presence engine — GPS pings, geofences, LAN probes, dwell
and hysteresis — and Home Assistant cannot see any of it. That is why a Ziggy
automation's `{"type": "presence", "value": "all_away"}` condition has no HA
form: HA fires the compiled automation on its own weaker view, and Ziggy
re-checks presence afterwards. One automation, two evaluators.

They disagreed on 2026-08-14 and a home's AC was switched off on someone
sitting in the room. Both specific defects are fixed, but the shape that let
them happen is this gap. Publishing presence over MQTT discovery closes it:
HA gets a genuine `binary_sensor` it can gate on, so the compiled automation
carries the same condition Ziggy would apply rather than a weaker subset.

Deliberately ONE household roll-up rather than an entity per person. Every
automation that needs presence today asks "is anyone home?", and a per-person
entity is a bigger surface (renames, deletions, retained topics to garbage
collect) for no current caller. Per-person can follow when something needs it.

The entity is retained, so HA still has it after a broker or hub restart, and
availability is published so a dead Ziggy shows as `unavailable` rather than
silently reading "everyone out" — an automation must never fire on a stale
"away" from a hub that stopped reporting.
"""
from __future__ import annotations

import json
from typing import Optional

from core.logger_module import log_info, log_error

_DISCOVERY_PREFIX = "homeassistant"

UNIQUE_ID = "ziggy_anyone_home"
STATE_TOPIC = "ziggy/presence/household/state"
CONFIG_TOPIC = f"{_DISCOVERY_PREFIX}/binary_sensor/{UNIQUE_ID}/config"
AVAILABILITY_TOPIC = "ziggy/presence/availability"


def discovery_payload() -> dict:
    """The MQTT-discovery config HA turns into a binary_sensor."""
    return {
        "name": "Anyone home",
        "unique_id": UNIQUE_ID,
        "state_topic": STATE_TOPIC,
        "availability_topic": AVAILABILITY_TOPIC,
        "payload_on": "ON",
        "payload_off": "OFF",
        "device_class": "presence",
        "device": {
            "identifiers": ["ziggy_presence"],
            "name": "Ziggy Presence",
            "manufacturer": "Ziggy",
        },
    }


def state_payload(*, anyone_home: bool) -> bytes:
    return b"ON" if anyone_home else b"OFF"


def _publish(topic: str, payload: bytes) -> bool:
    """Retained publish over the long-lived client room_presence_engine owns.

    Deliberately NOT `services.mqtt_client.publish`: that one is async and
    connect-publish-disconnects per call with no retain, so HA would lose the
    entity on any restart. Retention is the whole point — a discovery config
    that vanishes takes the entity with it, and an automation gating on a
    missing entity silently never fires.
    """
    try:
        from services.room_presence_engine import _publish as retained_publish
        return bool(retained_publish(topic, payload))
    except Exception as exc:
        log_error(f"[PresenceMQTT] publish {topic} failed: {exc}")
        return False


def announce() -> bool:
    """Publish the retained discovery config + current state. Idempotent.

    Called at startup and after any transition. Re-announcing is free (retained
    topics overwrite) and is what rebuilds the entity on a wiped broker.
    """
    try:
        from services.presence_store import any_home
        home = bool(any_home())
    except Exception:
        home = False
    ok = _publish(CONFIG_TOPIC, json.dumps(discovery_payload()).encode())
    _publish(AVAILABILITY_TOPIC, b"online")
    ok = _publish(STATE_TOPIC, state_payload(anyone_home=home)) and ok
    if ok:
        log_info(f"[PresenceMQTT] announced binary_sensor.{UNIQUE_ID} (anyone_home={home})")
    return ok


def publish_state(*, anyone_home: bool) -> bool:
    """Push the household state after a confirmed transition."""
    return _publish(STATE_TOPIC, state_payload(anyone_home=anyone_home))


def entity_id() -> Optional[str]:
    """The entity_id HA actually assigned, or None if it hasn't discovered it.

    Callers MUST treat None as "do not reference this in a compiled automation".
    An HA state condition against an unknown entity evaluates False, so naming
    a not-yet-discovered entity would silently stop Leave Home firing — a much
    worse failure than the split-brain this module exists to close.
    """
    try:
        from services.room_presence_engine import lookup_mqtt_entity_id
        return lookup_mqtt_entity_id(UNIQUE_ID, attempts=2, delay=0.3)
    except Exception:
        return None
