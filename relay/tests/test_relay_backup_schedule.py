"""relay/app/backup_schedule.py — the nightly DB backup actually runs.

db_backup.py had a documented `--once` CLI and no caller. These tests pin:
the 03:00 Asia/Jerusalem arithmetic, the silent skip when secrets are unset,
that the loop calls db_backup's public `run_relay_db_backup` (not a copy),
and that the relay lifespan starts it.
"""
from __future__ import annotations

import datetime as dt
import inspect
import logging
from zoneinfo import ZoneInfo

import pytest

from relay.app import backup_schedule as bs


IL = ZoneInfo("Asia/Jerusalem")
FULL_ENV = {"RELAY_BACKUP_KEY": "k", "RELAY_B2_KEY_ID": "id", "RELAY_B2_APP_KEY": "app"}


class TestConfigured:
    def test_all_three_required(self):
        assert bs.backup_configured(FULL_ENV)
        for k in bs.REQUIRED_ENV:
            env = dict(FULL_ENV); env[k] = ""
            assert not bs.backup_configured(env)
            assert bs.missing_env(env) == [k]
        assert bs.missing_env({}) == list(bs.REQUIRED_ENV)


class TestSchedule:
    def test_before_three_am_runs_today(self):
        now = dt.datetime(2026, 9, 18, 1, 30, tzinfo=IL)
        assert bs.seconds_until_next_run(now, tz=IL) == 90 * 60

    def test_after_three_am_runs_tomorrow(self):
        now = dt.datetime(2026, 9, 18, 3, 0, 1, tzinfo=IL)
        assert bs.seconds_until_next_run(now, tz=IL) == pytest.approx(24 * 3600 - 1)

    def test_exactly_three_am_schedules_the_next_day(self):
        now = dt.datetime(2026, 9, 18, 3, 0, 0, tzinfo=IL)
        assert bs.seconds_until_next_run(now, tz=IL) == 24 * 3600

    def test_utc_input_is_converted(self):
        # 22:00 UTC on the 17th is 01:00 Israel (IDT, +3) on the 18th → 2 h.
        now = dt.datetime(2026, 9, 17, 22, 0, tzinfo=dt.timezone.utc)
        assert bs.seconds_until_next_run(now, tz=IL) == 2 * 3600

    def test_default_target_is_0300_jerusalem(self):
        assert (bs.BACKUP_HOUR, bs.BACKUP_MINUTE, bs.BACKUP_TZ) == (3, 0, "Asia/Jerusalem")


class TestLoop:
    async def test_skips_silently_when_unset(self, caplog):
        caplog.set_level(logging.INFO, logger="relay.backup_schedule")
        calls = []
        runs = await bs.run_nightly_backup_loop(env={}, runner=lambda: calls.append(1) or {"ok": True},
                                                sleep=_no_sleep, max_runs=1)
        assert runs == 0 and calls == []
        assert any("not scheduled" in r.message for r in caplog.records)

    async def test_runs_the_public_backup_function(self, monkeypatch):
        slept, calls = [], []

        async def fake_sleep(s):
            slept.append(s)

        def runner():
            calls.append(1)
            return {"ok": True, "daily_key": "daily/2026-09-18.db.enc", "encrypted_bytes": 10}

        async def fake_log_event(*a, **k):
            pass
        monkeypatch.setattr("relay.app.audit.log_event", fake_log_event)

        runs = await bs.run_nightly_backup_loop(env=FULL_ENV, runner=runner,
                                                sleep=fake_sleep, max_runs=2)
        assert runs == 2 and len(calls) == 2
        # Sleeps until the next 03:00, then a >1 min guard after each run.
        assert len(slept) == 4 and slept[1] == 61 and 0 <= slept[0] <= 24 * 3600

    async def test_failure_is_logged_not_raised(self, monkeypatch, caplog):
        caplog.set_level(logging.ERROR, logger="relay.backup_schedule")

        async def fake_log_event(*a, **k):
            pass
        monkeypatch.setattr("relay.app.audit.log_event", fake_log_event)

        def bad_runner():
            raise OSError("disk gone")

        res = await bs.run_backup_once(runner=bad_runner)
        assert res["ok"] is False and "OSError" in res["error"]
        assert any("FAILED" in r.message for r in caplog.records)

    def test_default_runner_is_db_backup_run_relay_db_backup(self):
        from relay.app.db_backup import run_relay_db_backup
        sig = inspect.signature(bs.run_nightly_backup_loop)
        assert sig.parameters["runner"].default is run_relay_db_backup


async def _no_sleep(_s):
    pass


def test_lifespan_starts_the_nightly_loop():
    from relay.app import main
    src = inspect.getsource(main.lifespan)
    assert "run_nightly_backup_loop()" in src
    assert "backup_task" in src and "backup_task.cancel" not in src  # cancelled via the shared loop
    assert "(retention_task, remediator_task, backup_task)" in src
