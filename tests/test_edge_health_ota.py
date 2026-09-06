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


def _write_updater_hb(eh, tmp_path, monkeypatch, delta_seconds):
    p = tmp_path / "update.heartbeat"
    p.write_text("%s idle git=deadbeef\n" % _now_z(delta_seconds))
    monkeypatch.setattr(eh, "_UPDATER_HEARTBEAT_PATH", str(p))


def test_ota_quiet_main_with_live_updater_is_ok(eh, tmp_path, monkeypatch):
    # Last deploy 8h ago (nothing to deploy) but the updater ran a minute ago:
    # the hub can take a fix any time — that is "ok", not "silent"/"down".
    log = tmp_path / "deploy_log"
    log.write_text("---\nts:        %s\nverified:  True\n" % _now_z(-8 * 3600))
    monkeypatch.setattr(eh, "_DEPLOY_LOG_PATH", str(log))
    _write_updater_hb(eh, tmp_path, monkeypatch, -60)
    snap = eh._ota_snapshot()
    assert snap["status"] == "ok"
    assert snap["seconds_since"] >= 8 * 3600 - 5          # deploy age still reported
    assert 0 <= snap["updater_seconds_since"] < 600


def test_ota_silent_when_updater_stopped(eh, tmp_path, monkeypatch):
    log = tmp_path / "deploy_log"
    log.write_text("---\nts:        %s\nverified:  True\n" % _now_z(-8 * 3600))
    monkeypatch.setattr(eh, "_DEPLOY_LOG_PATH", str(log))
    _write_updater_hb(eh, tmp_path, monkeypatch, -3 * 3600)
    assert eh._ota_snapshot()["status"] == "silent"


def test_ota_without_heartbeat_file_keeps_old_rule(eh, tmp_path, monkeypatch):
    log = tmp_path / "deploy_log"
    log.write_text("---\nts:        %s\nverified:  True\n" % _now_z(-8 * 3600))
    monkeypatch.setattr(eh, "_DEPLOY_LOG_PATH", str(log))
    monkeypatch.setattr(eh, "_UPDATER_HEARTBEAT_PATH", str(tmp_path / "nope"))
    snap = eh._ota_snapshot()
    assert snap["status"] == "silent" and snap["updater_seconds_since"] is None


def test_task_snapshot_tolerates_raw_newline_in_value(eh, tmp_path, monkeypatch):
    # what the Linux updater wrote when systemd said "activating": a literal
    # newline inside the JSON string — must not read as "unknown"
    p = tmp_path / "update_task.json"
    p.write_text('{"written_at":"%s","unit":"ziggy-update.service","active_state":"activating\nunknown",'
                 '"result":"success","exec_main_status":"0"}' % _now_z())
    monkeypatch.setattr(eh, "_TASK_HEARTBEAT_PATH", str(p))
    snap = eh._task_scheduler_snapshot()
    assert snap["status"] == "ok"
    assert snap["heartbeat_age_seconds"] is not None


def test_ota_normal_age(eh, tmp_path, monkeypatch):
    log = tmp_path / "deploy_log"
    log.write_text("---\nts:        %s\nverified:  True\n" % _now_z(-120))
    monkeypatch.setattr(eh, "_DEPLOY_LOG_PATH", str(log))
    snap = eh._ota_snapshot()
    assert snap["clock_skew_suspected"] is False
    assert 0 <= snap["seconds_since"] < 600
    assert snap["status"] == "ok"
