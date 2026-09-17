"""ANOM-13: silent-device sweep reuses the anomaly alert framework.

Fills the gap ANOM-07/09 miss (they key on state 'unavailable'; a device can stop
reporting while still showing a stale on/off — the 13-day-silent kitchen light).
Fires through the shared _push_anomaly plumbing → push + snooze + cooldown + history.

OFF BY DEFAULT since 2026-09-17. With Zigbee2MQTT availability disabled (every
imaged hub), a light nobody touched for a day has the same `last_reported` as a
dead one, so the sweep called Kitchen Light "hasn't responded in 1 day" while it
had switched state that afternoon — on all three homes, ~130 pushes a day on the
Canary. The rule needs a real liveness signal before it may run unattended.
"""
import pytest

from services import anomaly_engine as ae
from services import down_device_detector as dd

_ONE_DOWN = [{"entity_id": "light.0xAAA", "name": "Entry Light", "domain": "light",
              "state": "off", "silent_hours": 336.0}]


def _wire(monkeypatch, *, down, snoozed=False, cooldown_ok=True, cfg=None):
    monkeypatch.setattr(dd, "find_down_devices", lambda stale_hours=48.0: down)
    monkeypatch.setattr(ae, "_cfg", lambda: cfg or {"enabled": True, "anom13_down_sweep_enabled": True})
    monkeypatch.setattr(ae, "_is_snoozed", lambda rid, rule_id: snoozed)
    monkeypatch.setattr(ae, "_cooldown_ok", lambda rid, rule_id, cd: cooldown_ok)


@pytest.mark.asyncio
async def test_sweep_is_off_by_default(monkeypatch):
    """Default config never even scans — the false positives were the product."""
    scanned = []
    monkeypatch.setattr(dd, "find_down_devices",
                        lambda stale_hours=48.0: scanned.append(stale_hours) or _ONE_DOWN)
    monkeypatch.setattr(ae, "_cfg", lambda: {"enabled": True})
    fired = []
    monkeypatch.setattr(ae, "_push_anomaly", lambda *a: fired.append(a))

    await ae.sweep_down_devices(active={})

    assert scanned == []
    assert fired == []


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


# ── the repair ladder is opt-in, never a side effect of an alert ─────────────
#
# Between 2026-09-06 and 09-17 the ladder sent Zigbee2MQTT re-interview requests
# to sleeping battery sensors (a bedroom FP300 twice, the office PIR three
# times) because an alert fired. Acting on a customer's radio network on the
# strength of a false alert is not a repair. Alerts may describe; acting needs
# `auto_repair_ladder: true`.

@pytest.mark.asyncio
async def test_ladder_not_invoked_by_default(monkeypatch):
    from services import repair_ladder
    _wire(monkeypatch, down=_ONE_DOWN)
    monkeypatch.setattr(ae, "_push_anomaly", lambda *a: None)
    monkeypatch.setattr(ae, "_clear_anomaly", lambda *a: None)
    asked = []
    monkeypatch.setattr(repair_ladder, "should_run", lambda eid, now=None: asked.append(eid) or True)

    async def _boom(*a, **kw):
        raise AssertionError("ladder ran without auto_repair_ladder")
    monkeypatch.setattr(repair_ladder, "run_ladder", _boom)

    await ae.sweep_down_devices(active={})
    assert asked == []


@pytest.mark.asyncio
async def test_ladder_runs_when_opted_in(monkeypatch):
    from services import repair_ladder
    _wire(monkeypatch, down=_ONE_DOWN,
          cfg={"enabled": True, "anom13_down_sweep_enabled": True, "auto_repair_ladder": True})
    monkeypatch.setattr(ae, "_push_anomaly", lambda *a: None)
    monkeypatch.setattr(ae, "_clear_anomaly", lambda *a: None)
    monkeypatch.setattr(repair_ladder, "should_run", lambda eid, now=None: True)
    ran = []

    async def _run(eid, *, trigger, kind):
        ran.append((eid, trigger, kind))
        return {"fixed": False, "rungs": []}
    monkeypatch.setattr(repair_ladder, "run_ladder", _run)
    monkeypatch.setattr(repair_ladder, "describe_attempts", lambda res, lang: "")

    await ae.sweep_down_devices(active={})
    assert ran == [("light.0xAAA", "ANOM-13", "device")]
