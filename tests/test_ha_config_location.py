"""Product fix: a freshly-imaged hub onboards HA without a location (0,0), which
breaks every sun-based automation. ensure_home_location() must set a default
when unset, and must NEVER override a location that's already real.
"""
import asyncio
import pytest

from services import ha_config


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _patch(monkeypatch, current):
    async def fake_get():
        return current
    sets = []
    async def fake_set(lat, lon, elevation=None, time_zone=None):
        sets.append((lat, lon, elevation, time_zone))
        return {"ok": True}
    monkeypatch.setattr(ha_config, "get_core_location", fake_get)
    monkeypatch.setattr(ha_config, "set_core_location", fake_set)
    return sets


def test_sets_default_when_zero_zero(monkeypatch):
    sets = _patch(monkeypatch, {"latitude": 0, "longitude": 0, "elevation": 0, "time_zone": "Asia/Jerusalem"})
    _run(ha_config.ensure_home_location(retries=1, delay=0))
    assert len(sets) == 1
    lat, lon, elev, tz = sets[0]
    assert (round(lat, 3), round(lon, 3)) == (32.085, 34.782)
    assert tz == "Asia/Jerusalem"


def test_sets_default_when_none(monkeypatch):
    sets = _patch(monkeypatch, {"latitude": None, "longitude": None, "elevation": None, "time_zone": None})
    _run(ha_config.ensure_home_location(retries=1, delay=0))
    assert len(sets) == 1


def test_leaves_real_location_alone(monkeypatch):
    sets = _patch(monkeypatch, {"latitude": 31.77, "longitude": 35.21, "elevation": 750, "time_zone": "Asia/Jerusalem"})
    _run(ha_config.ensure_home_location(retries=1, delay=0))
    assert sets == []  # already located — untouched


def test_skips_when_ha_unreachable(monkeypatch):
    sets = _patch(monkeypatch, None)
    _run(ha_config.ensure_home_location(retries=2, delay=0))
    assert sets == []  # no location read -> do nothing (retry next boot)


def test_settings_override_default(monkeypatch):
    from core.settings_loader import settings
    home = dict(settings.get("home") or {})
    home["location"] = {"latitude": 40.7, "longitude": -74.0, "elevation": 5}
    monkeypatch.setitem(settings, "home", home)
    sets = _patch(monkeypatch, {"latitude": 0, "longitude": 0})
    _run(ha_config.ensure_home_location(retries=1, delay=0))
    assert (round(sets[0][0], 1), round(sets[0][1], 1)) == (40.7, -74.0)
