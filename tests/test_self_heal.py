"""Tests for services.self_heal — detection gates + recovery ladder."""
import asyncio
import time

import pytest

import services.self_heal as sh
import services.command_ledger as cl


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    # Isolated DB + clean hot state for every test.
    monkeypatch.setattr(sh, "_DB", tmp_path / "t.db")
    sh._db_ready = False
    sh._revert_events.clear()
    sh._cooldown.clear()
    sh._healing.clear()
    sh._snooze.clear()
    sh._last_recover_telemetry.clear()
    cl._last.clear()
    # Feature on, default thresholds.
    monkeypatch.setattr(sh, "settings", {"features": {"self_heal": True}})
    # Collapse real delays to a zero-yield so recovery tests run fast while
    # still yielding control to the event loop (create_task must get to run).
    _real_sleep = asyncio.sleep
    async def _nosleep(*a, **k):
        await _real_sleep(0)
    monkeypatch.setattr(sh.asyncio, "sleep", _nosleep)
    yield


# ── _evidence_strong gates ────────────────────────────────────────────────────
def test_evidence_sustained_fires_at_3():
    now = time.time()
    sh._revert_events["light.k"] = [now - 5, now - 3, now - 1]
    assert "sustained" in (sh._evidence_strong("light.k", sh.config(), now) or "")


def test_evidence_two_reverts_no_fire():
    now = time.time()
    sh._revert_events["light.k"] = [now - 2, now - 1]
    assert sh._evidence_strong("light.k", sh.config(), now) is None


def test_evidence_retry_gate_strictly_greater_than_3():
    now = time.time()
    cfg = dict(sh.config())
    cfg["mismatch_count"] = 99  # disable sustained gate to isolate retry gate
    # exactly 3 within 60s → not > 3 → no fire
    sh._revert_events["light.k"] = [now - 3, now - 2, now - 1]
    assert sh._evidence_strong("light.k", cfg, now) is None
    # 4 within 60s → > 3 → fire
    sh._revert_events["light.k"] = [now - 4, now - 3, now - 2, now - 1]
    assert "user_retries" in (sh._evidence_strong("light.k", cfg, now) or "")


# ── observe() integration ─────────────────────────────────────────────────────
def _arm_intent(entity="light.k", state="on", origin="ziggy", ts=None):
    cl._last[entity] = {"state": state, "origin": origin,
                        "ts": ts or time.time(), "_exp": time.time() + 30}


@pytest.mark.asyncio
async def test_observe_fires_after_three_reverts(monkeypatch):
    calls = []
    async def _fake_recovery(eid, intended, trigger):
        calls.append((eid, intended, trigger))
    monkeypatch.setattr(sh, "_run_recovery", _fake_recovery)

    for _ in range(3):
        now = time.time()
        _arm_intent(state="on", ts=now)
        await sh.observe("light.k", {"state": "on"}, {"state": "off"}, ts=now)
        await asyncio.sleep(0)  # let create_task run
    assert len(calls) == 1
    assert calls[0][0] == "light.k" and calls[0][1] == "on"


@pytest.mark.asyncio
async def test_observe_ignores_self_heal_origin(monkeypatch):
    fired = []
    monkeypatch.setattr(sh, "_run_recovery",
                        lambda *a, **k: fired.append(1) or _coro())
    for _ in range(5):
        now = time.time()
        _arm_intent(state="on", origin="self_heal", ts=now)
        await sh.observe("light.k", {"state": "on"}, {"state": "off"}, ts=now)
    assert sh._revert_events.get("light.k") in (None, [])
    assert not fired


@pytest.mark.asyncio
async def test_observe_no_revert_when_state_matches_intent():
    now = time.time()
    _arm_intent(state="on", ts=now)
    await sh.observe("light.k", {"state": "off"}, {"state": "on"}, ts=now)
    assert not sh._revert_events.get("light.k")


@pytest.mark.asyncio
async def test_observe_snoozed_does_not_fire(monkeypatch):
    fired = []
    async def _fake(*a, **k):
        fired.append(1)
    monkeypatch.setattr(sh, "_run_recovery", _fake)
    sh.snooze("light.k", minutes=60)
    for _ in range(4):
        now = time.time()
        _arm_intent(ts=now)
        await sh.observe("light.k", {"state": "on"}, {"state": "off"}, ts=now)
        await asyncio.sleep(0)
    assert not fired


@pytest.mark.asyncio
async def test_observe_cooldown_blocks(monkeypatch):
    fired = []
    async def _fake(*a, **k):
        fired.append(1)
    monkeypatch.setattr(sh, "_run_recovery", _fake)
    sh._cooldown["light.k"] = time.time() + 999
    for _ in range(4):
        now = time.time()
        _arm_intent(ts=now)
        await sh.observe("light.k", {"state": "on"}, {"state": "off"}, ts=now)
        await asyncio.sleep(0)
    assert not fired


async def _coro():
    return None


# ── recovery ladder ───────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_recovery_early_success(monkeypatch):
    monkeypatch.setattr(sh, "_reassert", lambda e, i: None)
    monkeypatch.setattr(sh, "_matches", lambda e, i: True)   # succeeds immediately
    notified = []
    async def _fake_notify(outcome, eid):
        notified.append(outcome)
    monkeypatch.setattr(sh, "_notify", _fake_notify)
    monkeypatch.setattr(sh, "_report_telemetry", lambda *a, **k: None)

    sh._healing.add("light.k")
    await sh._run_recovery("light.k", "on", "sustained_mismatch:3")
    log = sh.get_log()
    assert log and log[0]["outcome"] == "recovered"
    assert log[0]["steps"] == ["reassert"]
    assert "light.k" not in sh._healing
    assert notified == ["recovered"]


@pytest.mark.asyncio
async def test_recovery_gives_up_and_cooldowns(monkeypatch):
    monkeypatch.setattr(sh, "_reassert", lambda e, i: None)
    monkeypatch.setattr(sh, "_force_poll", lambda e: None)
    monkeypatch.setattr(sh, "_jolt", lambda e, i: None)
    monkeypatch.setattr(sh, "_matches", lambda e, i: False)  # never recovers
    notified = []
    async def _fake_notify(outcome, eid):
        notified.append(outcome)
    monkeypatch.setattr(sh, "_notify", _fake_notify)
    monkeypatch.setattr(sh, "_report_telemetry", lambda *a, **k: None)

    sh._healing.add("light.k")
    await sh._run_recovery("light.k", "on", "sustained_mismatch:3")
    log = sh.get_log()
    assert log[0]["outcome"] == "failed"
    assert sh._cooldown.get("light.k", 0) > time.time()
    assert notified == ["failed"]
    assert "light.k" not in sh._healing


def test_reassert_tags_self_heal_origin(monkeypatch):
    seen = {}
    import services.home_automation as ha
    monkeypatch.setattr(ha, "toggle_light",
                        lambda eid, turn_on=True, origin="ziggy": seen.update(origin=origin, on=turn_on))
    sh._reassert("light.k", "on")
    assert seen == {"origin": "self_heal", "on": True}


def test_telemetry_payload_shape(monkeypatch):
    captured = {}
    import services.telemetry_client as tc
    monkeypatch.setattr(tc, "post_once", lambda extra=None, **k: captured.update(extra or {}))
    # run synchronously by replacing Thread with immediate call
    monkeypatch.setattr(sh.threading, "Thread",
                        lambda target, **k: type("T", (), {"start": staticmethod(target)})())
    sh._report_telemetry("light.0xabc", "failed", 5, "sustained_mismatch:3")
    fd = captured.get("flaky_device")
    assert fd and fd["outcome"] == "failed" and fd["attempts"] == 5
    assert fd["symptom"] == "sustained_mismatch:3"
    assert isinstance(fd["anon_id"], str) and len(fd["anon_id"]) == 16


def test_recovered_telemetry_throttled(monkeypatch):
    count = {"n": 0}
    import services.telemetry_client as tc
    monkeypatch.setattr(tc, "post_once", lambda extra=None, **k: count.__setitem__("n", count["n"] + 1))
    monkeypatch.setattr(sh.threading, "Thread",
                        lambda target, **k: type("T", (), {"start": staticmethod(target)})())
    sh._report_telemetry("light.k", "recovered", 3, "x")
    sh._report_telemetry("light.k", "recovered", 3, "x")  # within throttle window
    assert count["n"] == 1
