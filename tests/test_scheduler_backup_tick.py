"""Tests for the daily-backup scheduler hook in services/ziggy_scheduler.py.

Only the gate logic (`_maybe_fire_daily_backup`) is exercised. The actual
backup engine run-off-thread is not tested here — those paths have their
own coverage in tests/test_backup_engine.py.

The gate behavior under test:
  - off unless backup.enabled is true in settings
  - fires only when wall-clock HH:MM matches schedule_hour / schedule_minute
  - fires at most once per date (the _last_backup_date guard)
  - re-fires on the next day at the same HH:MM
"""
from __future__ import annotations

import asyncio
import datetime as dt
from unittest.mock import MagicMock

import pytest

from services import ziggy_scheduler as sched


@pytest.fixture(autouse=True)
def _reset_module_state(monkeypatch):
    """Clear the per-day idempotency guard before each test."""
    monkeypatch.setattr(sched, "_last_backup_date", None)
    yield


def _intercept_create_task(monkeypatch) -> list:
    """Replace asyncio.create_task with a recorder. Returns the list it appends to.

    Coroutines passed in are closed immediately so the actual backup function
    never runs (and Python doesn't warn about un-awaited coroutines).
    """
    fired: list = []

    def _fake(coro):
        try:
            coro.close()
        except Exception:
            pass
        fired.append(coro)
        return MagicMock()

    monkeypatch.setattr(asyncio, "create_task", _fake)
    return fired


def _settings(enabled=True, hour=2, minute=0):
    return {
        "backup": {
            "enabled": enabled,
            "schedule_hour": hour,
            "schedule_minute": minute,
        },
    }


@pytest.mark.asyncio
async def test_disabled_does_not_fire(monkeypatch):
    monkeypatch.setattr("core.settings_loader.settings", _settings(enabled=False))
    fired = _intercept_create_task(monkeypatch)
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 0))
    assert fired == []


@pytest.mark.asyncio
async def test_missing_backup_section_does_not_fire(monkeypatch):
    monkeypatch.setattr("core.settings_loader.settings", {})
    fired = _intercept_create_task(monkeypatch)
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 0))
    assert fired == []


@pytest.mark.asyncio
async def test_off_hour_does_not_fire(monkeypatch):
    monkeypatch.setattr("core.settings_loader.settings", _settings(hour=2, minute=0))
    fired = _intercept_create_task(monkeypatch)
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 14, 30))
    assert fired == []


@pytest.mark.asyncio
async def test_off_minute_does_not_fire(monkeypatch):
    monkeypatch.setattr("core.settings_loader.settings", _settings(hour=2, minute=0))
    fired = _intercept_create_task(monkeypatch)
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 1))
    assert fired == []


@pytest.mark.asyncio
async def test_matching_time_fires_once(monkeypatch):
    monkeypatch.setattr("core.settings_loader.settings", _settings(hour=2, minute=0))
    fired = _intercept_create_task(monkeypatch)
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 0))
    assert len(fired) == 1


@pytest.mark.asyncio
async def test_repeated_call_same_day_does_not_re_fire(monkeypatch):
    """The _last_backup_date guard prevents straddle-tick double-fires."""
    monkeypatch.setattr("core.settings_loader.settings", _settings(hour=2, minute=0))
    fired = _intercept_create_task(monkeypatch)
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 0))
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 0))
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 0))
    assert len(fired) == 1


@pytest.mark.asyncio
async def test_next_day_re_fires(monkeypatch):
    monkeypatch.setattr("core.settings_loader.settings", _settings(hour=2, minute=0))
    fired = _intercept_create_task(monkeypatch)
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 0))
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 28, 2, 0))
    assert len(fired) == 2


@pytest.mark.asyncio
async def test_custom_schedule_time(monkeypatch):
    monkeypatch.setattr("core.settings_loader.settings", _settings(hour=4, minute=15))
    fired = _intercept_create_task(monkeypatch)
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 4, 15))
    assert len(fired) == 1


@pytest.mark.asyncio
async def test_settings_lookup_failure_is_swallowed(monkeypatch):
    """If reading settings blows up, the scheduler keeps ticking (logs error)."""
    # Replace the settings attribute with something that raises on .get()
    class _Boom:
        def get(self, *a, **kw):
            raise RuntimeError("boom")

    monkeypatch.setattr("core.settings_loader.settings", _Boom())
    fired = _intercept_create_task(monkeypatch)
    # Should not raise — the try/except inside _maybe_fire_daily_backup catches.
    await sched._maybe_fire_daily_backup(dt.datetime(2026, 5, 27, 2, 0))
    assert fired == []
