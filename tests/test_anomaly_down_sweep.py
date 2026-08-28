"""ANOM-13: silent-device sweep reuses the anomaly alert framework.

Fills the gap ANOM-07/09 miss (they key on state 'unavailable'; a device can stop
reporting while still showing a stale on/off — the 13-day-silent kitchen light).
Fires through the shared _push_anomaly plumbing → push + snooze + cooldown + history.
"""
import pytest

from services import anomaly_engine as ae
from services import down_device_detector as dd

_ONE_DOWN = [{"entity_id": "light.0xAAA", "name": "Entry Light", "domain": "light",
              "state": "off", "silent_hours": 336.0}]


def _wire(monkeypatch, *, down, snoozed=False, cooldown_ok=True):
    monkeypatch.setattr(dd, "find_down_devices", lambda stale_hours=48.0: down)
    monkeypatch.setattr(ae, "_cfg", lambda: {"enabled": True})
    monkeypatch.setattr(ae, "_is_snoozed", lambda rid, rule_id: snoozed)
    monkeypatch.setattr(ae, "_cooldown_ok", lambda rid, rule_id, cd: cooldown_ok)


@pytest.mark.asyncio
async def test_fires_anom13_for_silent_device(monkeypatch):
    _wire(monkeypatch, down=_ONE_DOWN)
    fired = []
    monkeypatch.setattr(ae, "_push_anomaly",
                        lambda active, rid, rule, res: fired.append((rid, rule.rule_id, res.message)))
    monkeypatch.setattr(ae, "_clear_anomaly", lambda active, rid, rule_id: None)

    await ae.sweep_down_devices(active={})

    assert len(fired) == 1
    rid, rule_id, msg = fired[0]
    assert rid == "light.0xAAA"          # keyed per-device
    assert rule_id == "ANOM-13"
    assert "Entry Light" in msg
    for bad in ("unavailable", "zigbee", "coordinator"):
        assert bad not in msg.lower()


@pytest.mark.asyncio
async def test_clears_device_that_recovered(monkeypatch):
    _wire(monkeypatch, down=_ONE_DOWN)
    cleared = []
    monkeypatch.setattr(ae, "_push_anomaly", lambda *a: None)
    monkeypatch.setattr(ae, "_clear_anomaly",
                        lambda active, rid, rule_id: cleared.append((rid, rule_id)))
    # a device previously flagged ANOM-13 that is no longer in the down list
    active = {"light.0xOLD": [{"rule_id": "ANOM-13"}],
              "light.0xAAA": [{"rule_id": "ANOM-13"}]}

    await ae.sweep_down_devices(active=active)

    assert ("light.0xOLD", "ANOM-13") in cleared        # recovered → cleared
    assert ("light.0xAAA", "ANOM-13") not in cleared     # still down → kept


@pytest.mark.asyncio
async def test_snoozed_device_not_pushed(monkeypatch):
    _wire(monkeypatch, down=_ONE_DOWN, snoozed=True)
    fired = []
    monkeypatch.setattr(ae, "_push_anomaly", lambda *a: fired.append(a))
    monkeypatch.setattr(ae, "_clear_anomaly", lambda *a: None)

    await ae.sweep_down_devices(active={})

    assert fired == []
