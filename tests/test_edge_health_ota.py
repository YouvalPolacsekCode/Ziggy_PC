"""Tests for /health.ota task-scheduler surfacing (Item 8) + clock-skew clamp (Item 7)."""
import importlib
import json
from datetime import datetime, timedelta, timezone

import pytest


@pytest.fixture
def eh(monkeypatch):
    return importlib.import_module("backend.routers.edge_health_router")


def _write_task_hb(eh, tmp_path, monkeypatch, **fields):
    p = tmp_path / "update_task.json"
    p.write_text(json.dumps(fields))
    monkeypatch.setattr(eh, "_TASK_HEARTBEAT_PATH", str(p))


def _now_z(delta_seconds=0):
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_task_scheduler_ok(eh, tmp_path, monkeypatch):
    _write_task_hb(eh, tmp_path, monkeypatch,
                   written_at=_now_z(), last_task_result=0,
                   last_run_time=_now_z(-60), number_of_missed_runs=0)
    snap = eh._task_scheduler_snapshot()
    assert snap["status"] == "ok"
    assert snap["last_task_result"] == 0
    assert snap["heartbeat_age_seconds"] is not None


def test_task_scheduler_failing(eh, tmp_path, monkeypatch):
    _write_task_hb(eh, tmp_path, monkeypatch,
                   written_at=_now_z(), last_task_result=1, number_of_missed_runs=0)
    assert eh._task_scheduler_snapshot()["status"] == "failing"


def test_task_scheduler_running(eh, tmp_path, monkeypatch):
    _write_task_hb(eh, tmp_path, monkeypatch,
                   written_at=_now_z(), last_task_result=0x00041301)
    assert eh._task_scheduler_snapshot()["status"] == "running"


def test_task_scheduler_stale(eh, tmp_path, monkeypatch):
    # Heartbeat 20 min old > 15 min stale threshold → task not firing.
    _write_task_hb(eh, tmp_path, monkeypatch,
                   written_at=_now_z(-20 * 60), last_task_result=0)
    assert eh._task_scheduler_snapshot()["status"] == "stale"


def test_task_scheduler_missing(eh, tmp_path, monkeypatch):
    monkeypatch.setattr(eh, "_TASK_HEARTBEAT_PATH", str(tmp_path / "nope.json"))
    snap = eh._task_scheduler_snapshot()
    assert snap["status"] == "unknown" and snap["last_task_result"] is None


def test_ota_clock_skew_clamps_negative(eh, tmp_path, monkeypatch):
    # deploy_log stamped 2h in the FUTURE (host clock skew) → negative age.
    log = tmp_path / "deploy_log"
    log.write_text("---\nts:        %s\nverified:  True\n" % _now_z(2 * 3600))
    monkeypatch.setattr(eh, "_DEPLOY_LOG_PATH", str(log))
    snap = eh._ota_snapshot()
    assert snap["clock_skew_suspected"] is True
    assert snap["seconds_since"] == 0
    assert snap["status"] == "ok"  # fresh, not mis-flagged stale/silent


def test_ota_normal_age(eh, tmp_path, monkeypatch):
    log = tmp_path / "deploy_log"
    log.write_text("---\nts:        %s\nverified:  True\n" % _now_z(-120))
    monkeypatch.setattr(eh, "_DEPLOY_LOG_PATH", str(log))
    snap = eh._ota_snapshot()
    assert snap["clock_skew_suspected"] is False
    assert 0 <= snap["seconds_since"] < 600
    assert snap["status"] == "ok"
