"""The circadian ramp must run on the timezone the user set in Settings.

Settings → Display writes `system.timezone` (backend/routers/status_router.py),
and the anomaly engine, the agent context and home_context all read it. The
circadian engine read `home.timezone` — a key nothing writes — so the setting
never reached the light ramp and it silently ran on whatever HA reported.
"""
from __future__ import annotations

from zoneinfo import ZoneInfo

import pytest

from services import circadian_engine


@pytest.fixture
def clean_tz_cache():
    circadian_engine._home_tz_cache = None
    yield
    circadian_engine._home_tz_cache = None


def _no_ha(monkeypatch):
    # If the setting is honoured, HA must never be consulted.
    import services.home_automation as ha

    def boom(*_a, **_k):
        raise AssertionError("HA config was queried although system.timezone is set")

    monkeypatch.setattr(ha, "_ha_url", boom, raising=False)


def test_reads_system_timezone_from_settings(monkeypatch, clean_tz_cache):
    from core.settings_loader import settings as live

    monkeypatch.setitem(live, "system", {"timezone": "Asia/Tokyo"})
    monkeypatch.setitem(live, "home", {})
    _no_ha(monkeypatch)

    assert circadian_engine._home_tz() == ZoneInfo("Asia/Tokyo")


def test_legacy_home_timezone_still_honoured(monkeypatch, clean_tz_cache):
    from core.settings_loader import settings as live

    monkeypatch.setitem(live, "system", {})
    monkeypatch.setitem(live, "home", {"timezone": "Europe/Paris"})
    _no_ha(monkeypatch)

    assert circadian_engine._home_tz() == ZoneInfo("Europe/Paris")


def test_system_wins_over_legacy_home(monkeypatch, clean_tz_cache):
    from core.settings_loader import settings as live

    monkeypatch.setitem(live, "system", {"timezone": "Asia/Tokyo"})
    monkeypatch.setitem(live, "home", {"timezone": "Europe/Paris"})
    _no_ha(monkeypatch)

    assert circadian_engine._home_tz() == ZoneInfo("Asia/Tokyo")
