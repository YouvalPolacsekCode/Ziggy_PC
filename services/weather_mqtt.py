"""Publish Ziggy's weather facts as Home Assistant entities.

Most of Ziggy's compiled automations run inside Home Assistant, which cannot
read Ziggy's forecast cache. Mirroring the facts over retained MQTT discovery
gives HA real entities to gate on, so a weather condition on an HA-run rule
(a button press, a sensor) is checked by HA itself — same pattern and same
reasoning as services/modes_mqtt.py and services/presence_mqtt.py.

Unknown is published as *unavailable* (availability "offline"), never as
"off": a "skip if it rains" rule must not read a missing forecast as a dry
day. HA's state condition fails on an unavailable entity, and Ziggy's own
evaluator (services/weather.evaluate) fails the same way, so both agree.
"""
from __future__ import annotations

import json
from typing import Optional

from core.logger_module import log_error, log_info

_DISCOVERY_PREFIX = "homeassistant"
AVAILABILITY_TOPIC = "ziggy/weather/availability"
_MAX_TEMP = "max_temp_today"

_LABELS = {
    "rain_yesterday": "Rained yesterday",
    "rain_today":     "Rain today",
    "rain_tomorrow":  "Rain tomorrow",
    "cloudy_today":   "Cloudy today",
    _MAX_TEMP:        "High temperature today",
}

_announced = False


def unique_id(fact: str) -> str:
    return f"ziggy_weather_{fact}"


def _component(fact: str) -> str:
    return "sensor" if fact == _MAX_TEMP else "binary_sensor"


def state_topic(fact: str) -> str:
    return f"ziggy/weather/{fact}/state"


def config_topic(fact: str) -> str:
    return f"{_DISCOVERY_PREFIX}/{_component(fact)}/{unique_id(fact)}/config"


def discovery_payload(fact: str) -> dict:
    p = {
        "name": _LABELS[fact],
        "unique_id": unique_id(fact),
        "object_id": unique_id(fact),
        "state_topic": state_topic(fact),
        "availability_topic": AVAILABILITY_TOPIC,
        "device": {"identifiers": ["ziggy_weather"], "name": "Ziggy Weather", "manufacturer": "Ziggy"},
    }
    if fact == _MAX_TEMP:
        p.update({"device_class": "temperature", "unit_of_measurement": "°C", "state_class": "measurement"})
    else:
        p.update({"payload_on": "ON", "payload_off": "OFF"})
    return p


def _publish(topic: str, payload: bytes) -> bool:
    try:
        from services.room_presence_engine import _publish as retained_publish
        return bool(retained_publish(topic, payload))
    except Exception as exc:
        log_error(f"[WeatherMQTT] publish {topic} failed: {exc}")
        return False


def announce() -> bool:
    global _announced
    ok = True
    for fact in _LABELS:
        ok = _publish(config_topic(fact), json.dumps(discovery_payload(fact)).encode()) and ok
    _announced = ok
    if ok:
        log_info(f"[WeatherMQTT] announced {len(_LABELS)} weather entities")
    return ok


def publish(facts: Optional[dict]) -> bool:
    """Publish the current facts, or mark everything unavailable when unknown."""
    if not _announced:
        announce()
    if not facts:
        return _publish(AVAILABILITY_TOPIC, b"offline")
    ok = True
    for fact in _LABELS:
        v = facts.get(fact)
        if v is None:
            continue
        payload = f"{float(v):.1f}".encode() if fact == _MAX_TEMP else (b"ON" if v else b"OFF")
        ok = _publish(state_topic(fact), payload) and ok
    return _publish(AVAILABILITY_TOPIC, b"online") and ok


def entity_id(fact: str) -> Optional[str]:
    """The entity_id HA assigned, or None when not (yet) discovered."""
    try:
        from services.room_presence_engine import lookup_mqtt_entity_id
        return lookup_mqtt_entity_id(unique_id(fact), attempts=2, delay=0.3)
    except Exception:
        return None
