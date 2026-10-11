"""Identify-by-pulse — telling four identical air conditioners apart.

A multi-split home hands Ziggy several climate units that are indistinguishable
on screen: same manufacturer, often the same reported name, no room. You cannot
blink an air conditioner, so the only honest way to ask "which one is this?" is
to make the unit do something the user can hear from the doorway, then put it
back exactly as it was.

"Put it back exactly as it was" is the whole risk. This runs in a customer's
real house: leaving a bedroom AC blasting at 3am because a restore was skipped
is a worse bug than the one we set out to fix. These tests pin the restore.
"""
from __future__ import annotations

import asyncio

import pytest

import services.device_identify as di


class FakeHA:
    """Records service calls; serves a scripted state snapshot."""

    def __init__(self, state):
        self.state = state
        self.calls: list[tuple[str, str, dict]] = []

    def get_state(self, entity_id):
        return self.state

    def call_service(self, domain, service, data, origin="ziggy"):
        self.calls.append((domain, service, dict(data)))
        return {"ok": True}

    def services(self):
        return [f"{d}.{s}" for d, s, _ in self.calls]


def _wire(monkeypatch, state):
    ha = FakeHA(state)
    monkeypatch.setattr(di, "get_state", ha.get_state)
    monkeypatch.setattr(di, "call_service", ha.call_service)
    return ha


OFF_UNIT = {
    "entity_id": "climate.ac_a", "state": "off",
    "attributes": {"temperature": 24, "fan_mode": "low", "swing_mode": "off",
                   "fan_modes": ["low", "medium", "high"], "hvac_modes": ["off", "cool"]},
}

ON_UNIT = {
    "entity_id": "climate.ac_b", "state": "cool",
    "attributes": {"temperature": 23, "fan_mode": "low", "swing_mode": "off",
                   "fan_modes": ["low", "medium", "high"], "hvac_modes": ["off", "cool"]},
}


# ── The pulse has to be perceptible ─────────────────────────────────────────

def test_an_off_unit_is_turned_on(monkeypatch):
    """The clearest possible signal for a unit that's off: it starts."""
    ha = _wire(monkeypatch, OFF_UNIT)
    asyncio.run(di.identify("climate.ac_a", seconds=0))
    assert "climate.turn_on" in ha.services()


def test_an_already_running_unit_changes_something_audible(monkeypatch):
    """Turning on an already-on unit does nothing the user can notice, so push
    the fan instead."""
    ha = _wire(monkeypatch, ON_UNIT)
    asyncio.run(di.identify("climate.ac_b", seconds=0))

    fan = [d for d in ha.calls if d[1] == "set_fan_mode"]
    assert fan, "a running unit must change fan speed to be identifiable"
    assert fan[0][2]["fan_mode"] == "high", "pick the loudest mode the unit offers"


# ── Restore is non-negotiable ───────────────────────────────────────────────

def test_off_unit_is_turned_back_off(monkeypatch):
    ha = _wire(monkeypatch, OFF_UNIT)
    asyncio.run(di.identify("climate.ac_a", seconds=0))
    assert ha.services()[-1] == "climate.turn_off", "an off unit must end up off"


def test_running_unit_gets_its_exact_settings_back(monkeypatch):
    ha = _wire(monkeypatch, ON_UNIT)
    asyncio.run(di.identify("climate.ac_b", seconds=0))

    restored = {}
    for _d, s, data in ha.calls:
        if s == "set_fan_mode":
            restored["fan"] = data["fan_mode"]
    assert restored["fan"] == "low", "fan must come back to what the user had"
    assert "climate.turn_off" not in ha.services(), "never switch off a unit the user had running"


def test_restore_still_runs_when_the_pulse_fails(monkeypatch):
    """A failure half-way through must not strand the AC in the pulsed state."""
    ha = _wire(monkeypatch, ON_UNIT)
    calls = {"n": 0}

    def flaky(domain, service, data, origin="ziggy"):
        calls["n"] += 1
        ha.calls.append((domain, service, dict(data)))
        if calls["n"] == 1:
            raise RuntimeError("HA hiccup")
        return {"ok": True}

    monkeypatch.setattr(di, "call_service", flaky)
    asyncio.run(di.identify("climate.ac_b", seconds=0))

    assert any(s == "set_fan_mode" and d.get("fan_mode") == "low"
               for _dom, s, d in ha.calls), "restore must run despite the failure"


# ── Boundaries ──────────────────────────────────────────────────────────────

def test_refuses_domains_we_cannot_safely_pulse(monkeypatch):
    """This drives hardware in someone's home. Only domains with an instant,
    fully reversible action are allowed. A cover is excluded on purpose:
    moving a shutter is slow, physical, and can hit something."""
    ha = _wire(monkeypatch, {"entity_id": "cover.salon", "state": "open",
                             "attributes": {}})
    with pytest.raises(ValueError):
        asyncio.run(di.identify("cover.salon", seconds=0))
    assert ha.calls == []

    ha2 = _wire(monkeypatch, {"entity_id": "sensor.x", "state": "5", "attributes": {}})
    with pytest.raises(ValueError):
        asyncio.run(di.identify("sensor.x", seconds=0))
    assert ha2.calls == []


# ── Other pulsable domains ──────────────────────────────────────────────────

LIGHT_OFF = {"entity_id": "light.k", "state": "off", "attributes": {}}
LIGHT_ON  = {"entity_id": "light.k", "state": "on",  "attributes": {"brightness": 120}}


def test_a_light_that_is_off_is_turned_on_then_off_again(monkeypatch):
    """Lights are the easy case — they can literally blink."""
    ha = _wire(monkeypatch, LIGHT_OFF)
    asyncio.run(di.identify("light.k", seconds=0))
    assert ha.services()[0] == "light.turn_on"
    assert ha.services()[-1] == "light.turn_off"


def test_a_light_that_is_on_is_left_on(monkeypatch):
    """Never leave a light the user had on switched off."""
    ha = _wire(monkeypatch, LIGHT_ON)
    asyncio.run(di.identify("light.k", seconds=0))
    assert ha.services()[-1] == "light.turn_on"


def test_a_switch_toggles_and_returns(monkeypatch):
    ha = _wire(monkeypatch, {"entity_id": "switch.p", "state": "off", "attributes": {}})
    asyncio.run(di.identify("switch.p", seconds=0))
    assert ha.services() == ["switch.turn_on", "switch.turn_off"]


def test_unknown_entity_is_rejected(monkeypatch):
    _wire(monkeypatch, {})
    with pytest.raises(ValueError):
        asyncio.run(di.identify("climate.ghost", seconds=0))
