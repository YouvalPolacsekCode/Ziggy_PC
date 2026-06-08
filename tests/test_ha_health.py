"""Unit tests for services.ha_health — the layered failure model + recovery
state machine.

Tests are PURE: no HA, no asyncio loop required for the classifier. The
auto-recovery side-effect uses asyncio.create_task; we stub it out so we
can inspect state transitions deterministically.
"""
from __future__ import annotations

import asyncio
import pytest

from services import ha_health
from services.ha_health import (
    CoordinatorState,
    ISSUE_OK,
    ISSUE_HA_UNREACHABLE,
    ISSUE_COORDINATOR_LOADING,
    ISSUE_COORDINATOR_FAILED,
    ISSUE_COORDINATOR_DEVS_GONE,
    ISSUE_DEVICES_OFFLINE_MANY,
    ISSUE_DEVICES_OFFLINE,
    LEVEL_OK,
    LEVEL_DEGRADED,
    LEVEL_DOWN,
    MANUAL_REPLUG_DONGLE,
)


# ── Fixtures ────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_module_state():
    """Reset ha_health's in-memory state before/after every test."""
    ha_health._reset_state_for_tests()
    yield
    ha_health._reset_state_for_tests()


@pytest.fixture
def loaded_coord():
    return CoordinatorState(entry_id="ent_zha", domain="zha",
                            title="Zigbee hub", state="loaded",
                            raw_title="Zigbee Home Automation")


@pytest.fixture
def failed_coord():
    return CoordinatorState(entry_id="ent_zha", domain="zha",
                            title="Zigbee hub", state="setup_retry",
                            raw_title="Zigbee Home Automation")


@pytest.fixture
def stub_no_create_task(monkeypatch):
    """Prevent compute_system_health from spawning real asyncio tasks. We
    inspect the classifier output directly instead. The would-be coroutine
    is closed so pytest doesn't complain about an un-awaited coro."""
    def _stub(coro, *_a, **_kw):
        try:
            coro.close()
        except Exception:
            pass
        return None
    monkeypatch.setattr(asyncio, "create_task", _stub)


# ── Classification: HA-level signals ────────────────────────────────────────

class TestClassifyHA:
    def test_ha_unreachable_overrides_everything(self, failed_coord, stub_no_create_task):
        out = ha_health.compute_system_health(
            ha_connected=False,
            offline_primary_ids=set(),
            total_devices=10,
            coordinator=failed_coord,
        )
        assert out["primary"] == ISSUE_HA_UNREACHABLE
        assert out["level"]   == LEVEL_DOWN
        # No auto-recovery while HA is unreachable.
        assert ha_health._peek_state_for_tests()["recovery"]["last_attempt_at"] is None

    def test_ha_reachable_no_coordinator_is_ok(self, stub_no_create_task):
        out = ha_health.compute_system_health(
            ha_connected=True,
            offline_primary_ids=set(),
            total_devices=0,
            coordinator=None,
        )
        assert out["primary"] == ISSUE_OK
        assert out["level"]   == LEVEL_OK


# ── Classification: coordinator-level signals ───────────────────────────────

class TestClassifyCoordinator:
    def test_setup_in_progress_is_loading(self, stub_no_create_task):
        coord = CoordinatorState(entry_id="x", domain="zha", title="Zigbee hub",
                                 state="setup_in_progress")
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=coord,
        )
        assert out["primary"] == ISSUE_COORDINATOR_LOADING
        assert out["level"]   == LEVEL_DEGRADED

    @pytest.mark.parametrize("bad_state", [
        "setup_retry", "setup_error", "migration_error",
        "failed_unload", "not_loaded",
    ])
    def test_bad_coordinator_states_route_to_failed(self, bad_state, stub_no_create_task):
        coord = CoordinatorState(entry_id="x", domain="zha", title="Zigbee hub",
                                 state=bad_state)
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=coord,
        )
        assert out["primary"] == ISSUE_COORDINATOR_FAILED
        assert out["level"]   == LEVEL_DOWN

    def test_loaded_with_80pct_offline_is_devs_gone(self, loaded_coord, stub_no_create_task):
        out = ha_health.compute_system_health(
            ha_connected=True,
            offline_primary_ids={f"dev.{i}" for i in range(8)},
            total_devices=10,
            coordinator=loaded_coord,
        )
        assert out["primary"] == ISSUE_COORDINATOR_DEVS_GONE
        assert out["level"]   == LEVEL_DOWN

    def test_loaded_with_50pct_offline_is_many(self, loaded_coord, stub_no_create_task):
        out = ha_health.compute_system_health(
            ha_connected=True,
            offline_primary_ids={f"dev.{i}" for i in range(5)},
            total_devices=10,
            coordinator=loaded_coord,
        )
        assert out["primary"] == ISSUE_DEVICES_OFFLINE_MANY
        assert out["level"]   == LEVEL_DEGRADED

    def test_loaded_with_1_offline_is_devices_offline(self, loaded_coord, stub_no_create_task):
        out = ha_health.compute_system_health(
            ha_connected=True,
            offline_primary_ids={"dev.1"},
            total_devices=10,
            coordinator=loaded_coord,
        )
        assert out["primary"] == ISSUE_DEVICES_OFFLINE
        assert out["level"]   == LEVEL_DEGRADED

    def test_loaded_zero_offline_is_ok(self, loaded_coord, stub_no_create_task):
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=loaded_coord,
        )
        assert out["primary"] == ISSUE_OK
        assert out["level"]   == LEVEL_OK

    def test_tiny_total_skips_share_threshold(self, loaded_coord, stub_no_create_task):
        """A 2-device home with 1 offline is just 'devices_offline', not 50% panic."""
        out = ha_health.compute_system_health(
            ha_connected=True,
            offline_primary_ids={"dev.1"},
            total_devices=2,
            coordinator=loaded_coord,
        )
        assert out["primary"] == ISSUE_DEVICES_OFFLINE


# ── Auto-recovery state machine ─────────────────────────────────────────────

class TestAutoRecovery:
    def test_first_detection_triggers_one_reload(self, failed_coord, monkeypatch):
        """A coordinator in setup_retry → create_task is fired exactly once."""
        calls = []
        monkeypatch.setattr(asyncio, "create_task", lambda coro, *a, **kw: calls.append(coro) or None)
        ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=failed_coord,
        )
        assert len(calls) == 1, "auto-recovery should fire once"
        # Subsequent polls within the cooldown should NOT re-fire.
        ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=failed_coord,
        )
        assert len(calls) == 1, "cooldown should suppress re-firing"
        # Clean up the un-awaited coro to silence the test runner warning.
        for c in calls:
            c.close()

    def test_cooldown_blocks_repeated_attempts(self, failed_coord, monkeypatch):
        monkeypatch.setattr(asyncio, "create_task", lambda coro, *a, **kw: coro.close())
        # First call → schedules a task → records last_attempt_at to NOW.
        import time
        ha_health._recovery.last_attempt_at = time.time()  # simulate "we just tried"
        ha_health._recovery.in_progress     = False
        # Now compute again — cooldown should block.
        calls = []
        monkeypatch.setattr(asyncio, "create_task",
                            lambda coro, *a, **kw: calls.append(coro) or coro.close())
        ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=failed_coord,
        )
        assert calls == []

    def test_manual_action_blocks_future_auto_attempts(self, failed_coord, monkeypatch):
        """Once we've escalated to manual_action, stop auto-trying."""
        ha_health._recovery.manual_action_code = MANUAL_REPLUG_DONGLE
        ha_health._recovery.last_attempt_at = 0  # cooldown elapsed
        calls = []
        monkeypatch.setattr(asyncio, "create_task",
                            lambda coro, *a, **kw: calls.append(coro) or coro.close())
        ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=failed_coord,
        )
        assert calls == [], "manual_action queued → no further auto-recovery"

    def test_in_progress_blocks_concurrent_attempts(self, failed_coord, monkeypatch):
        ha_health._recovery.in_progress = True
        calls = []
        monkeypatch.setattr(asyncio, "create_task",
                            lambda coro, *a, **kw: calls.append(coro) or coro.close())
        ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=failed_coord,
        )
        assert calls == []

    def test_disabled_by_env(self, failed_coord, monkeypatch):
        monkeypatch.setenv("ZIGGY_HEALTH_AUTORECOVER", "0")
        calls = []
        monkeypatch.setattr(asyncio, "create_task",
                            lambda coro, *a, **kw: calls.append(coro) or coro.close())
        ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=failed_coord,
        )
        assert calls == [], "ZIGGY_HEALTH_AUTORECOVER=0 disables auto-recovery"
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=failed_coord,
        )
        assert out["recovery"]["auto_enabled"] is False


# ── Auto-recovery body: success vs. failure ────────────────────────────────

class TestRecoveryBody:
    @pytest.mark.asyncio
    async def test_reload_then_loaded_marks_success(self, failed_coord, monkeypatch):
        # Reload call returns ok; post-verify shows the integration loaded.
        monkeypatch.setattr(
            "services.home_automation.call_service",
            lambda *a, **kw: {"ok": True, "message": "ok"},
        )
        # Skip the verify sleep so the test runs fast.
        monkeypatch.setattr(ha_health, "RECOVERY_VERIFY_DELAY_S", 0)
        # After reload, fetch_coordinator_state(force=True) returns a "loaded" entry.
        monkeypatch.setattr(
            ha_health, "fetch_coordinator_state",
            lambda *, force=False: CoordinatorState(
                entry_id="ent_zha", domain="zha", title="Zigbee hub",
                state="loaded", raw_title="Zigbee Home Automation",
            ),
        )
        await ha_health._run_auto_recover(failed_coord)
        state = ha_health._peek_state_for_tests()["recovery"]
        assert state["last_result"]        == "success"
        assert state["manual_action_code"] is None
        assert state["in_progress"]        is False

    @pytest.mark.asyncio
    async def test_reload_succeeds_but_still_unhealthy_escalates_to_manual(
        self, failed_coord, monkeypatch
    ):
        """Reload succeeds, but post-verify still shows setup_retry → user must replug."""
        monkeypatch.setattr(
            "services.home_automation.call_service",
            lambda *a, **kw: {"ok": True, "message": "ok"},
        )
        monkeypatch.setattr(ha_health, "RECOVERY_VERIFY_DELAY_S", 0)
        monkeypatch.setattr(
            ha_health, "fetch_coordinator_state",
            lambda *, force=False: CoordinatorState(
                entry_id="ent_zha", domain="zha", title="Zigbee hub",
                state="setup_retry", raw_title="Zigbee Home Automation",
            ),
        )
        await ha_health._run_auto_recover(failed_coord)
        state = ha_health._peek_state_for_tests()["recovery"]
        assert state["last_result"]        == "failed"
        assert state["manual_action_code"] == MANUAL_REPLUG_DONGLE
        assert state["in_progress"]        is False

    @pytest.mark.asyncio
    async def test_reload_call_failed_escalates_immediately(self, failed_coord, monkeypatch):
        monkeypatch.setattr(
            "services.home_automation.call_service",
            lambda *a, **kw: {"ok": False, "message": "HA returned 500"},
        )
        monkeypatch.setattr(ha_health, "RECOVERY_VERIFY_DELAY_S", 0)
        await ha_health._run_auto_recover(failed_coord)
        state = ha_health._peek_state_for_tests()["recovery"]
        assert state["last_result"]        == "failed"
        assert state["manual_action_code"] == MANUAL_REPLUG_DONGLE

    @pytest.mark.asyncio
    async def test_user_retry_clears_manual_action_when_now_healthy(self, monkeypatch):
        """User physically replugs the dongle, taps Retry — health is restored."""
        ha_health._recovery.manual_action_code = MANUAL_REPLUG_DONGLE
        ha_health._recovery.last_result        = "failed"
        # Simulate: by the time the user taps Retry, HA reports loaded.
        monkeypatch.setattr(
            ha_health, "fetch_coordinator_state",
            lambda *, force=False: CoordinatorState(
                entry_id="ent_zha", domain="zha", title="Zigbee hub",
                state="loaded", raw_title="Zigbee Home Automation",
            ),
        )
        out = await ha_health.trigger_recover_now()
        assert out["ok"] is True
        assert out.get("already_healthy") is True
        state = ha_health._peek_state_for_tests()["recovery"]
        assert state["manual_action_code"] is None


# ── Acknowledgement ─────────────────────────────────────────────────────────

class TestAcknowledgement:
    def test_ack_suppresses_many_offline_banner(self, loaded_coord, stub_no_create_task):
        offline = {f"dev.{i}" for i in range(6)}  # 60% of 10
        ha_health.acknowledge_offline(offline)
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=offline,
            total_devices=10, coordinator=loaded_coord,
        )
        assert out["primary"]      == ISSUE_OK
        assert out["ack"]["active"] is True

    def test_ack_invalidated_when_new_device_goes_offline(self, loaded_coord, stub_no_create_task):
        offline_initial = {f"dev.{i}" for i in range(6)}
        ha_health.acknowledge_offline(offline_initial)
        offline_new = offline_initial | {"dev.NEW"}
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=offline_new,
            total_devices=10, coordinator=loaded_coord,
        )
        # New device → ack cleared, warning visible again.
        assert out["primary"]      == ISSUE_DEVICES_OFFLINE_MANY
        assert out["ack"]["active"] is False

    def test_ack_invalidated_at_80pct(self, loaded_coord, stub_no_create_task):
        offline_initial = {f"dev.{i}" for i in range(6)}  # 60%
        ha_health.acknowledge_offline(offline_initial)
        # Two more devices go offline — but they were in the original universe,
        # not new. Wait — the ack-set IS the same; share crosses 80%.
        # Simpler model: same 6 acked devices, but the *universe* shrank so
        # share climbs. We test this via offline_primary_ids being a strict
        # subset that nevertheless trips share. Mimic: keep offline set the
        # same; pretend total dropped from 10 to 7 so 6/7 = 85%.
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=offline_initial,
            total_devices=7, coordinator=loaded_coord,
        )
        assert out["primary"]      == ISSUE_COORDINATOR_DEVS_GONE
        assert out["ack"]["active"] is False

    def test_ack_persists_when_devices_come_back(self, loaded_coord, stub_no_create_task):
        offline_initial = {f"dev.{i}" for i in range(6)}
        ha_health.acknowledge_offline(offline_initial)
        # One device came back online → set shrinks, still ⊆ acked set.
        offline_shrunk = {f"dev.{i}" for i in range(5)}
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=offline_shrunk,
            total_devices=10, coordinator=loaded_coord,
        )
        assert out["ack"]["active"] is True

    def test_ack_cleared_when_ha_drops(self, loaded_coord, stub_no_create_task):
        offline_initial = {f"dev.{i}" for i in range(6)}
        ha_health.acknowledge_offline(offline_initial)
        out = ha_health.compute_system_health(
            ha_connected=False, offline_primary_ids=offline_initial,
            total_devices=10, coordinator=loaded_coord,
        )
        assert out["primary"]      == ISSUE_HA_UNREACHABLE
        assert out["ack"]["active"] is False
