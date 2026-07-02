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


def _stub_fetch_coordinator_state(value):
    """Helper to monkeypatch the now-async fetch_coordinator_state with a
    callable that returns a coroutine resolving to `value`. monkeypatch
    needs a regular function pointer, but the production code awaits the
    result, so we return a coroutine on each call."""
    async def _impl(*, force=False):
        return value
    return _impl


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
            _stub_fetch_coordinator_state(CoordinatorState(
                entry_id="ent_zha", domain="zha", title="Zigbee hub",
                state="loaded", raw_title="Zigbee Home Automation",
            )),
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
            _stub_fetch_coordinator_state(CoordinatorState(
                entry_id="ent_zha", domain="zha", title="Zigbee hub",
                state="setup_retry", raw_title="Zigbee Home Automation",
            )),
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
            _stub_fetch_coordinator_state(CoordinatorState(
                entry_id="ent_zha", domain="zha", title="Zigbee hub",
                state="loaded", raw_title="Zigbee Home Automation",
            )),
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

    def test_ack_suppresses_small_offline_banner(self, loaded_coord, stub_no_create_task):
        """Acknowledgement also works for the small (< 50%) offline case.

        Previously the banner's body said "Tap to review, or acknowledge if
        you know" but no Ack button rendered because `ack_can_show` only
        flipped True for ISSUE_DEVICES_OFFLINE_MANY. Same suppression now
        applies to ISSUE_DEVICES_OFFLINE so dead batteries etc can be
        dismissed without the misleading body copy.
        """
        offline = {"dev.1", "dev.2", "dev.3"}  # 3/20 = 15% → DEVICES_OFFLINE
        ha_health.acknowledge_offline(offline)
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=offline,
            total_devices=20, coordinator=loaded_coord,
        )
        assert out["primary"]      == ISSUE_OK
        assert out["ack"]["active"] is True

    def test_small_offline_exposes_can_acknowledge(self, loaded_coord, stub_no_create_task):
        """Without an ack in place, the small-offline banner offers the Ack
        button (`ack.can_acknowledge=True`)."""
        out = ha_health.compute_system_health(
            ha_connected=True,
            offline_primary_ids={"dev.1", "dev.2", "dev.3"},
            total_devices=20, coordinator=loaded_coord,
        )
        assert out["primary"] == ISSUE_DEVICES_OFFLINE
        assert out["ack"]["can_acknowledge"] is True

    def test_ack_cleared_when_ha_drops(self, loaded_coord, stub_no_create_task):
        offline_initial = {f"dev.{i}" for i in range(6)}
        ha_health.acknowledge_offline(offline_initial)
        out = ha_health.compute_system_health(
            ha_connected=False, offline_primary_ids=offline_initial,
            total_devices=10, coordinator=loaded_coord,
        )
        assert out["primary"]      == ISSUE_HA_UNREACHABLE
        assert out["ack"]["active"] is False


# ── Coordinator-scoped dead-device detection (2026-07-02 incident) ──────────
#
# Incident: power cut killed the Z2M addon. Mosquitto's persisted retained
# `zigbee2mqtt/bridge/state = online` survived, no LWT fired (the broker died
# with Z2M), so the bridge sensor read "on" and coordinator_status said "ok"
# while every Zigbee device sat in `unknown`. The global offline share
# (dead-coordinator entities diluted across ALL HA entities) stayed under the
# 80% threshold, so ISSUE_COORDINATOR_DEVS_GONE never fired and no alert went
# out. Fix: count dead entities WITHIN the coordinator's own config entry.

class TestCoordinatorScopedDeadDevices:
    def _coord(self, total, dead):
        return CoordinatorState(entry_id="ent_mqtt", domain="zigbee2mqtt",
                                title="Zigbee hub", state="loaded",
                                devices_total=total, devices_dead=dead)

    def test_all_coordinator_devices_dead_is_devs_gone_despite_low_global_share(
            self, stub_no_create_task):
        # Global picture looks calm (0 offline of 95) — exactly the incident.
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=95, coordinator=self._coord(25, 25),
        )
        assert out["primary"] == ISSUE_COORDINATOR_DEVS_GONE
        assert out["level"]   == LEVEL_DOWN

    def test_partial_coordinator_deaths_do_not_trigger(self, stub_no_create_task):
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=95, coordinator=self._coord(25, 10),
        )
        assert out["primary"] == ISSUE_OK

    def test_single_device_coordinator_is_exempt(self, stub_no_create_task):
        # One paired device that's asleep must not page anyone.
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=95, coordinator=self._coord(1, 1),
        )
        assert out["primary"] == ISSUE_OK

    def test_defaults_keep_legacy_behavior(self, stub_no_create_task):
        # CoordinatorState built without the new fields (all existing call
        # sites) must behave exactly as before.
        coord = CoordinatorState(entry_id="x", domain="zha",
                                 title="Zigbee hub", state="loaded")
        out = ha_health.compute_system_health(
            ha_connected=True, offline_primary_ids=set(),
            total_devices=10, coordinator=coord,
        )
        assert out["primary"] == ISSUE_OK


class TestCountCoordinatorDevices:
    REGISTRY = [
        {"entity_id": "sensor.0xaaa_temperature", "config_entry_id": "ent_mqtt"},
        {"entity_id": "sensor.0xaaa_battery",     "config_entry_id": "ent_mqtt"},
        {"entity_id": "light.0xbbb",              "config_entry_id": "ent_mqtt"},
        # Bridge's own entities must not count as devices — they are exactly
        # the retained-topic liars this check exists to cross-examine.
        {"entity_id": "binary_sensor.zigbee2mqtt_bridge_connection_state",
         "config_entry_id": "ent_mqtt"},
        {"entity_id": "sensor.zigbee2mqtt_bridge_version",
         "config_entry_id": "ent_mqtt"},
        # Different integration — out of scope.
        {"entity_id": "sensor.other_thing", "config_entry_id": "ent_other"},
    ]

    def test_counts_dead_and_total_within_entry(self):
        states = {
            "sensor.0xaaa_temperature": "unknown",
            "sensor.0xaaa_battery":     "unavailable",
            "light.0xbbb":              "on",
            "binary_sensor.zigbee2mqtt_bridge_connection_state": "on",
            "sensor.zigbee2mqtt_bridge_version": "2.12.0",
            "sensor.other_thing": "unknown",
        }
        total, dead = ha_health._count_coordinator_devices(
            self.REGISTRY, "ent_mqtt", states.get)
        assert (total, dead) == (3, 2)

    def test_entities_missing_from_state_cache_are_excluded(self):
        # Cold subscriber cache must not read as "everything dead".
        total, dead = ha_health._count_coordinator_devices(
            self.REGISTRY, "ent_mqtt", lambda eid: None)
        assert (total, dead) == (0, 0)
