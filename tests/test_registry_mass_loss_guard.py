"""Regression tests for the 2026-08-09 "all devices Removed from hub" incident.

An unclean power cut restarted a customer hub. Ziggy reconciled its device
registry 42 s before Zigbee2MQTT finished re-registering its entities in HA, so
every device looked deleted and was stamped LOST. Nothing re-reconciled (the
self-heal loop lives in core/ziggy_main.py, which the container never runs), so
23 live devices sat falsely "Removed from hub" — with delete buttons — for 19 h.

Two independent defences are tested here:
  1. _reconcile refuses a snapshot that would mass-lose healthy devices.
  2. The veto is time-boxed, so a REAL mass deletion still converges.
"""

import time

import pytest

from services import device_registry as dr


@pytest.fixture(autouse=True)
def _reset_veto_state():
    dr._mass_loss_first_seen_at = None
    yield
    dr._mass_loss_first_seen_at = None


def _devices(n: int, status: str = dr.CONNECTED) -> list[dict]:
    return [
        {"entity_id": f"light.dev_{i}", "status": status, "room": "living_room"}
        for i in range(n)
    ]


class TestMassLossVeto:
    def test_partial_ha_snapshot_does_not_mark_everything_lost(self):
        """The incident itself: HA up, Z2M entities not registered yet."""
        devices = _devices(23)
        # HA answers, but only with its own core entities — none of ours.
        live_ids = {"sun.sun", "person.david", "zone.home"}

        out = dr._reconcile(devices, live_ids)

        assert [d["status"] for d in out] == [dr.CONNECTED] * 23
        assert all("_lost_since" not in d for d in out)

    def test_single_real_deletion_still_marks_lost(self):
        """One device removed in HA is a real deletion, not a bad snapshot."""
        devices = _devices(23)
        live_ids = {d["entity_id"] for d in devices} - {"light.dev_7"}

        out = dr._reconcile(devices, live_ids)

        by_id = {d["entity_id"]: d for d in out}
        assert by_id["light.dev_7"]["status"] == dr.LOST
        assert "_lost_since" in by_id["light.dev_7"]
        assert by_id["light.dev_0"]["status"] == dr.CONNECTED

    def test_minority_loss_is_believed(self):
        """A third of devices going offline is plausible (one dead radio)."""
        devices = _devices(9)
        live_ids = {f"light.dev_{i}" for i in range(6)}  # 3 of 9 missing

        out = dr._reconcile(devices, live_ids)

        lost = [d for d in out if d["status"] == dr.LOST]
        assert len(lost) == 3

    def test_tiny_registry_is_not_vetoed(self):
        """With 2 devices, 'all of them' carries no signal — believe HA."""
        devices = _devices(2)
        out = dr._reconcile(devices, {"sun.sun"})
        assert [d["status"] for d in out] == [dr.LOST, dr.LOST]

    def test_already_lost_rows_do_not_trigger_the_veto(self):
        """Rows lost on a previous pass aren't a NEW loss, so a genuine single
        deletion on top of them must still be recorded."""
        devices = _devices(20, status=dr.LOST) + [
            {"entity_id": "light.fresh", "status": dr.CONNECTED, "room": "kitchen"}
        ]
        out = dr._reconcile(devices, {"sun.sun"})
        assert out[-1]["status"] == dr.LOST

    def test_empty_ha_snapshot_is_ignored_entirely(self):
        """Pre-existing guard: HA totally unreachable changes nothing."""
        devices = _devices(5)
        assert dr._reconcile(devices, set()) == devices


class TestVetoIsTimeBoxed:
    def test_real_mass_deletion_converges_after_grace_window(self, monkeypatch):
        """If the devices really are gone, we must eventually believe it —
        otherwise 'I factory-reset my HA' could never converge."""
        devices = _devices(23)
        live_ids = {"sun.sun"}

        t0 = time.time()
        monkeypatch.setattr(time, "time", lambda: t0)
        out = dr._reconcile(devices, live_ids)
        assert all(d["status"] == dr.CONNECTED for d in out), "first pass vetoes"

        # Same mass loss still observed after the grace window expires.
        monkeypatch.setattr(time, "time", lambda: t0 + dr._MASS_LOSS_GRACE_S + 1)
        out = dr._reconcile(out, live_ids)
        assert all(d["status"] == dr.LOST for d in out), "eventually believed"

    def test_recovery_clears_the_veto_timer(self, monkeypatch):
        """HA coming back mid-grace must reset the clock, so a LATER unrelated
        mass loss gets its own full grace window rather than being believed
        instantly."""
        devices = _devices(23)
        all_ids = {d["entity_id"] for d in devices}

        t0 = time.time()
        monkeypatch.setattr(time, "time", lambda: t0)
        dr._reconcile(devices, {"sun.sun"})
        assert dr._mass_loss_first_seen_at is not None

        monkeypatch.setattr(time, "time", lambda: t0 + 60)
        out = dr._reconcile(devices, all_ids)   # HA back with everything
        assert dr._mass_loss_first_seen_at is None
        assert all(d["status"] == dr.CONNECTED for d in out)


class TestSelfHealActuallyRuns:
    """The veto alone was not enough: nothing re-reconciled after boot."""

    def test_scheduler_owns_a_reconcile_tick(self):
        from services import ziggy_scheduler
        assert hasattr(ziggy_scheduler, "_device_registry_reconcile_tick")

    @pytest.mark.asyncio
    async def test_tick_refreshes_when_no_thread_owns_the_job(self, monkeypatch):
        from services import ziggy_scheduler

        called = []
        monkeypatch.setattr(dr, "reconcile_loop_running", lambda: False)
        monkeypatch.setattr(dr, "refresh", lambda: called.append(1))

        await ziggy_scheduler._device_registry_reconcile_tick()
        assert called == [1]

    @pytest.mark.asyncio
    async def test_tick_defers_to_a_dedicated_thread(self, monkeypatch):
        """core/ziggy_main.py starts its own loop — don't reconcile twice."""
        from services import ziggy_scheduler

        called = []
        monkeypatch.setattr(dr, "reconcile_loop_running", lambda: True)
        monkeypatch.setattr(dr, "refresh", lambda: called.append(1))

        await ziggy_scheduler._device_registry_reconcile_tick()
        assert called == []
