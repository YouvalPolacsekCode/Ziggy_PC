"""The stale (ANOM-10) and stuck (ANOM-12) sweeps must ignore Ziggy's OWN sensors.

Found on every home after release-2026.09.06: "Ziggy Presence Anyone home hasn't
reported in 118 hours. Check the battery" and "Office Occupied has read off for
8 hours … try removing and refitting its battery". Those entities are Ziggy's
template helpers, its engine-backed MQTT presence entities and the anyone-home
mirror — no battery, no radio, nothing to refit. An alert that cannot be acted
on teaches people to ignore the ones that can.
"""
import pytest

from services import anomaly_engine as ae

PHYSICAL = "binary_sensor.0x00158d008c7d0d8e_occupancy"
ANYONE_HOME = "binary_sensor.ziggy_presence_anyone_home"
TEMPLATE_MAIN = "binary_sensor.office_occupied"
TEMPLATE_SUFFIXED = "binary_sensor.office_occupied_2"
ENGINE_DOUBLED = "binary_sensor.bathroom_occupied_bathroom_occupied"
ENGINE_KV_ONLY = "binary_sensor.bathroom_presence_bathroom_presence"


def test_virtual_sensor_recognition():
    known = {ENGINE_KV_ONLY}
    assert ae.is_ziggy_virtual_sensor(ANYONE_HOME, known)
    assert ae.is_ziggy_virtual_sensor(TEMPLATE_MAIN, known)
    assert ae.is_ziggy_virtual_sensor(TEMPLATE_SUFFIXED, known)
    assert ae.is_ziggy_virtual_sensor(ENGINE_DOUBLED, known)
    assert ae.is_ziggy_virtual_sensor(ENGINE_KV_ONLY, known)
    # A real radio-backed sensor, even one whose id ends in _presence, is not.
    assert not ae.is_ziggy_virtual_sensor(PHYSICAL, known)
    assert not ae.is_ziggy_virtual_sensor("binary_sensor.0x54ef4410015c03e9_presence", known)


def _entry(dc: str, state: str, ago_s: float, name: str) -> dict:
    return {"state": state, "last_changed": ae._iso_ago(ago_s),
            "attributes": {"device_class": dc, "friendly_name": name}}


def _wire(monkeypatch, cfg: dict):
    monkeypatch.setattr(ae, "_cfg", lambda: cfg)
    monkeypatch.setattr(ae, "_is_snoozed", lambda rid, rule_id: False)
    monkeypatch.setattr(ae, "_cooldown_ok", lambda rid, rule_id, cd: True)
    monkeypatch.setattr(ae, "_clear_anomaly", lambda active, rid, rule_id: None)
    monkeypatch.setattr(ae, "_ziggy_occupancy_entity_ids", lambda: {ENGINE_KV_ONLY})

    async def _no_areas():
        return {}
    monkeypatch.setattr(ae, "_get_area_map", _no_areas)


@pytest.mark.asyncio
async def test_anom10_skips_ziggy_virtual_sensors(monkeypatch):
    _wire(monkeypatch, {"enabled": True, "anom10_stale_hours": 24})
    fired = []
    monkeypatch.setattr(ae, "_push_anomaly",
                        lambda active, rid, rule, res: fired.append((rid, rule.rule_id)))
    cache = {
        PHYSICAL:      _entry("occupancy", "off", 30 * 3600, "Office Motion"),
        ANYONE_HOME:   _entry("presence",  "on",  30 * 3600, "Ziggy Presence Anyone home"),
        TEMPLATE_MAIN: _entry("occupancy", "off", 30 * 3600, "Office Occupied"),
        ENGINE_KV_ONLY: _entry("occupancy", "off", 30 * 3600, "Bathroom Occupied"),
    }
    await ae.sweep_stale_sensors(cache, {})
    assert fired == [(PHYSICAL, "ANOM-10")]


@pytest.mark.asyncio
async def test_anom12_skips_ziggy_virtual_sensors(monkeypatch):
    _wire(monkeypatch, {"enabled": True, "anom12_stuck_hours": 8, "anom12_norm_multiple": 2.5})

    async def _norm(eid, state="on"):
        return 600.0                      # "usually changes every 10 minutes"
    monkeypatch.setattr(ae, "_typical_max_hold_s", _norm)
    fired = []
    monkeypatch.setattr(ae, "_push_anomaly",
                        lambda active, rid, rule, res: fired.append((rid, rule.rule_id)))
    cache = {
        PHYSICAL:         _entry("occupancy", "off", 20 * 3600, "Office Motion"),
        ANYONE_HOME:      _entry("presence",  "off", 20 * 3600, "Ziggy Presence Anyone home"),
        TEMPLATE_SUFFIXED: _entry("occupancy", "off", 20 * 3600, "Office Occupied"),
        ENGINE_DOUBLED:   _entry("occupancy", "off", 20 * 3600, "Bathroom Occupied"),
    }
    await ae.sweep_stuck_occupancy(cache, {})
    assert fired == [(PHYSICAL, "ANOM-12")]
