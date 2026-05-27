"""Tests for the dormant HA-installer scheduler hook in
services/ziggy_scheduler.py — Prompt 4 chunk 1.E.

Coverage:
  - auto_install disabled (default) → apply_manifest NEVER called
  - inside window but no staged manifest → no apply
  - inside window, staged matches installed → no apply
  - inside window, staged differs → apply called once
  - outside window → no apply even with auto_install=true + staged
  - already applied today → no second apply same day
  - _within_window edges (inclusive start, exclusive end)
  - apply failure result surfaces via debug bus without crashing the tick
"""

from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from services import ziggy_scheduler


def _reset_module_state():
    """Each test starts with no prior apply claimed."""
    ziggy_scheduler._last_ha_apply_date = None


# ---------------------------------------------------------------------------
# _within_window edge cases
# ---------------------------------------------------------------------------

def test_within_window_inclusive_start():
    assert ziggy_scheduler._within_window("03:00", "03:00", "04:00") is True


def test_within_window_exclusive_end():
    assert ziggy_scheduler._within_window("04:00", "03:00", "04:00") is False


def test_within_window_inside():
    assert ziggy_scheduler._within_window("03:30", "03:00", "04:00") is True


def test_within_window_before():
    assert ziggy_scheduler._within_window("02:59", "03:00", "04:00") is False


def test_within_window_after():
    assert ziggy_scheduler._within_window("04:01", "03:00", "04:00") is False


# ---------------------------------------------------------------------------
# _maybe_apply_ha_install
# ---------------------------------------------------------------------------

def _patch_settings(monkeypatch, settings: dict) -> None:
    """Replace core.settings_loader.settings with a fresh dict."""
    import core.settings_loader
    monkeypatch.setattr(core.settings_loader, "settings", settings)


def _patch_ota_state(monkeypatch, state: dict) -> None:
    """Replace services.ota_client.load_state with a stub returning `state`."""
    import services.ota_client
    monkeypatch.setattr(services.ota_client, "load_state", lambda: state)


class _ApplyRecorder:
    """Replaces services.ha_installer.apply_manifest with a recorder."""
    def __init__(self, result: dict | None = None):
        self.calls: list[dict] = []
        self.result = result or {
            "ok": True, "reason": "installed",
            "from_version": "old", "to_version": "new",
            "duration_s": 1.0, "rolled_back": False,
            "detail": "ok", "applied_at": "now",
        }

    def __call__(self, manifest):
        self.calls.append(manifest)
        return self.result


def _patch_apply(monkeypatch, rec: _ApplyRecorder) -> None:
    import services.ha_installer
    monkeypatch.setattr(services.ha_installer, "apply_manifest", rec)


def _ts(hh: int, mm: int) -> datetime:
    return datetime(2026, 5, 28, hh, mm)


@pytest.mark.asyncio
async def test_dormant_by_default(monkeypatch):
    """auto_install absent / false → apply_manifest never called."""
    _reset_module_state()
    _patch_settings(monkeypatch, {})        # no ha block at all
    rec = _ApplyRecorder()
    _patch_apply(monkeypatch, rec)
    await ziggy_scheduler._maybe_apply_ha_install(_ts(3, 30))
    assert rec.calls == []


@pytest.mark.asyncio
async def test_no_apply_outside_window(monkeypatch):
    _reset_module_state()
    _patch_settings(monkeypatch, {"ha": {"auto_install": True}})
    _patch_ota_state(monkeypatch, {
        "installed": {"ha_version": "old"},
        "staged":    {"ha_version": "new", "release_id": 5},
    })
    rec = _ApplyRecorder()
    _patch_apply(monkeypatch, rec)
    await ziggy_scheduler._maybe_apply_ha_install(_ts(12, 0))   # noon
    assert rec.calls == []


@pytest.mark.asyncio
async def test_no_apply_without_staged(monkeypatch):
    _reset_module_state()
    _patch_settings(monkeypatch, {"ha": {"auto_install": True}})
    _patch_ota_state(monkeypatch, {"installed": {"ha_version": "x"}, "staged": None})
    rec = _ApplyRecorder()
    _patch_apply(monkeypatch, rec)
    await ziggy_scheduler._maybe_apply_ha_install(_ts(3, 30))
    assert rec.calls == []


@pytest.mark.asyncio
async def test_no_apply_when_staged_matches_installed(monkeypatch):
    _reset_module_state()
    _patch_settings(monkeypatch, {"ha": {"auto_install": True}})
    _patch_ota_state(monkeypatch, {
        "installed": {"ha_version": "1.2.3"},
        "staged":    {"ha_version": "1.2.3", "release_id": 5},
    })
    rec = _ApplyRecorder()
    _patch_apply(monkeypatch, rec)
    await ziggy_scheduler._maybe_apply_ha_install(_ts(3, 30))
    assert rec.calls == []


@pytest.mark.asyncio
async def test_apply_fires_inside_window_with_delta(monkeypatch):
    _reset_module_state()
    _patch_settings(monkeypatch, {"ha": {"auto_install": True}})
    _patch_ota_state(monkeypatch, {
        "installed": {"ha_version": "1.2.3"},
        "staged":    {"ha_version": "1.2.4", "release_id": 5},
    })
    rec = _ApplyRecorder()
    _patch_apply(monkeypatch, rec)
    await ziggy_scheduler._maybe_apply_ha_install(_ts(3, 30))
    assert len(rec.calls) == 1
    assert rec.calls[0]["release_id"] == 5
    # Per-day guard claimed
    assert ziggy_scheduler._last_ha_apply_date == "2026-05-28"


@pytest.mark.asyncio
async def test_apply_only_once_per_day(monkeypatch):
    _reset_module_state()
    _patch_settings(monkeypatch, {"ha": {"auto_install": True}})
    _patch_ota_state(monkeypatch, {
        "installed": {"ha_version": "old"},
        "staged":    {"ha_version": "new", "release_id": 5},
    })
    rec = _ApplyRecorder()
    _patch_apply(monkeypatch, rec)
    await ziggy_scheduler._maybe_apply_ha_install(_ts(3, 30))
    await ziggy_scheduler._maybe_apply_ha_install(_ts(3, 31))
    assert len(rec.calls) == 1


@pytest.mark.asyncio
async def test_apply_failure_does_not_crash_tick(monkeypatch):
    """A failing apply result must surface via the debug bus but not raise."""
    _reset_module_state()
    _patch_settings(monkeypatch, {"ha": {"auto_install": True}})
    _patch_ota_state(monkeypatch, {
        "installed": {"ha_version": "old"},
        "staged":    {"ha_version": "new", "release_id": 5},
    })
    rec = _ApplyRecorder(result={
        "ok": False, "reason": "recreate_failed: docker_non_zero",
        "from_version": "old", "to_version": "new", "duration_s": 0.5,
        "rolled_back": True, "detail": "...", "applied_at": "now",
    })
    _patch_apply(monkeypatch, rec)
    await ziggy_scheduler._maybe_apply_ha_install(_ts(3, 30))   # must not raise
    assert len(rec.calls) == 1


@pytest.mark.asyncio
async def test_apply_with_custom_window(monkeypatch):
    """A non-default maintenance_window is honored."""
    _reset_module_state()
    _patch_settings(monkeypatch, {
        "ha": {
            "auto_install": True,
            "maintenance_window": {"start": "02:00", "end": "02:30"},
        },
    })
    _patch_ota_state(monkeypatch, {
        "installed": {"ha_version": "old"},
        "staged":    {"ha_version": "new", "release_id": 5},
    })
    rec = _ApplyRecorder()
    _patch_apply(monkeypatch, rec)
    # Outside the narrower window — must NOT fire
    await ziggy_scheduler._maybe_apply_ha_install(_ts(3, 30))
    assert rec.calls == []
    # Inside the narrower window — must fire
    _reset_module_state()
    await ziggy_scheduler._maybe_apply_ha_install(_ts(2, 15))
    assert len(rec.calls) == 1
