"""ANOM-12 — an occupancy sensor latched in one state while still alive.

Live failure (Canary, 2026-08-09): the Aqara office presence sensor latched `on`
at 15:06 and never moved. Both channels (mmWave + PIR) froze in the same second.
The device stayed alive the whole time — humidity, illuminance and battery kept
updating — only its presence channel wedged. Restart, re-interview and
reconfigure all failed; it needed the battery pulled.

Everything downstream froze with it: Day/Night needed an off→on edge that could
never come, and the Off rule needed "vacant for 2 min" that never arrived. Three
correct, enabled automations, silently dead, and the user found out because the
lights stopped behaving.

ANOM-10 already watches this entity, but its threshold is 24 h and it is aimed at
a different failure — silence meaning dead battery or dropped off the network. A
sensor that is alive but stuck needs a shorter fuse.

Why not a flat threshold: a BEDROOM presence sensor legitimately holds `on` for
8+ hours every night — that is exactly what the Smart Room sleeping guard is
built on. A flat 8 h rule would cry wolf every morning, and an alert you learn to
ignore is worse than no alert. So the hold must also be far outside what is
normal FOR THAT SENSOR, learned from its own history.
"""
import time

import pytest

from services import anomaly_engine as ae


HOUR = 3600


@pytest.fixture
def sweep(monkeypatch):
    """Run the sweep against a synthetic cache + controllable history."""
    monkeypatch.setattr(ae, "_cfg", lambda: {"enabled": True})
    monkeypatch.setattr(ae, "_is_snoozed", lambda *a, **k: False)
    monkeypatch.setattr(ae, "_cooldown_ok", lambda *a, **k: True)

    async def _no_areas():
        return {}
    monkeypatch.setattr(ae, "_get_area_map", _no_areas)

    norms: dict = {}

    async def fake_norm(eid, state="on"):
        # Per-state norm: the fixture keys on entity for simplicity, but the
        # signature mirrors production so a drift there breaks these tests.
        return norms.get(eid)
    monkeypatch.setattr(ae, "_typical_max_hold_s", fake_norm)

    def run(entity, device_class, held_s, normal_max_s, state="on"):
        norms.clear()
        norms[entity] = normal_max_s
        cache = {entity: {
            "state": state,
            "attributes": {"device_class": device_class, "friendly_name": "Office Presence"},
            "last_changed": ae._iso_ago(held_s),
        }}
        active: dict = {}
        import asyncio
        asyncio.run(ae.sweep_stuck_occupancy(cache, active))
        fired = [e for lst in active.values() for e in lst if e["rule_id"] == "ANOM-12"]
        return fired
    return run


# ── Fires on a genuine wedge ─────────────────────────────────────────────────

def test_fires_when_held_far_beyond_its_own_norm(sweep):
    """The office: normally clears in ~26 min, stuck 10 h."""
    fired = sweep("binary_sensor.office_presence", "presence", 10 * HOUR, 26 * 60)
    assert len(fired) == 1
    assert "Office Presence" in fired[0]["message"]


def test_fires_for_occupancy_and_motion_classes_too(sweep):
    for dc in ("occupancy", "motion", "presence"):
        assert sweep("binary_sensor.x", dc, 10 * HOUR, 20 * 60), f"{dc} should be watched"


def test_a_stuck_off_is_just_as_broken_as_a_stuck_on(sweep):
    """A sensor latched OFF never turns lights on again — equally dead, and
    harder to notice because nothing is visibly stuck."""
    assert sweep("binary_sensor.x", "presence", 10 * HOUR, 20 * 60, state="off")


# ── Does NOT fire on legitimate long occupancy ───────────────────────────────

def test_bedroom_overnight_does_not_alert(sweep):
    """9 h asleep, and this sensor routinely holds ~9 h. Normal. Silence."""
    assert sweep("binary_sensor.bedroom_presence", "presence", 9 * HOUR, 9 * HOUR) == []


def test_bedroom_still_alerts_when_genuinely_wedged(sweep):
    """Same sensor, but 30 h — far past even its own generous norm."""
    assert sweep("binary_sensor.bedroom_presence", "presence", 30 * HOUR, 9 * HOUR)


def test_under_the_floor_never_alerts_however_unusual(sweep):
    """2 h is odd for a 5-minute sensor but nowhere near worth waking someone."""
    assert sweep("binary_sensor.office_presence", "presence", 2 * HOUR, 5 * 60) == []


def test_no_history_means_no_alert(sweep, monkeypatch):
    """Unknown norm = we cannot judge. A brand-new sensor must not be accused."""
    async def none_norm(eid, state="on"):
        return None
    monkeypatch.setattr(ae, "_typical_max_hold_s", none_norm)
    assert sweep("binary_sensor.new_sensor", "presence", 20 * HOUR, 0) == []


# ── Scope + hygiene ─────────────────────────────────────────────────────────

def test_ignores_non_occupancy_sensors(sweep):
    """A door left open for 10 h is ANOM-03's job, not this one."""
    assert sweep("binary_sensor.front_door", "door", 10 * HOUR, 60) == []


def test_ignores_an_already_offline_sensor(sweep):
    """Unavailable is ANOM-07 / ANOM-10 territory — don't double-report."""
    assert sweep("binary_sensor.x", "presence", 10 * HOUR, 60, state="unavailable") == []
