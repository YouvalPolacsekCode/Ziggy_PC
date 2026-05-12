"""
Unit tests for services/anomaly_engine.py.

All tests use a synthetic state_cache — no HA connection required.
Time is mocked via monkeypatching time.time() and the local-hour helper.
"""
import time
import pytest
import pytest_asyncio

import services.anomaly_engine as engine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cache(**entity_states):
    """Build a minimal state_cache from keyword args: entity_id=state or (state, attrs)."""
    cache = {}
    for eid, val in entity_states.items():
        eid = eid.replace("__", ".")  # e.g. light__bedroom → light.bedroom
        if isinstance(val, tuple):
            state, attrs = val
        else:
            state, attrs = val, {}
        cache[eid] = {"state": state, "attributes": attrs, "last_changed": ""}
    return cache


def _reset_state():
    engine._snooze.clear()
    engine._last_fired.clear()
    engine._last_on.clear()
    engine._last_off.clear()


# ---------------------------------------------------------------------------
# ANOM-01: everyone away + lights on
# ---------------------------------------------------------------------------

class TestAnom01:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_fires_when_all_away_with_lights_on(self):
        active = {}
        cache = _cache(
            **{"person.alice": "not_home", "light.living_room": "on"}
        )
        await engine.evaluate("light.living_room", cache, active)
        assert any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_no_fire_when_person_home(self):
        active = {}
        cache = _cache(
            **{"person.alice": "home", "light.living_room": "on"}
        )
        await engine.evaluate("light.living_room", cache, active)
        assert not any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_no_fire_no_person_entities(self):
        """No person entities → rule disabled (unknown home state)."""
        active = {}
        cache = _cache(**{"light.living_room": "on"})
        await engine.evaluate("light.living_room", cache, active)
        assert not any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_snooze_suppresses(self):
        active = {}
        cache = _cache(**{"person.alice": "not_home", "light.living_room": "on"})
        engine.snooze("home", "ANOM-01", duration_minutes=60)
        await engine.evaluate("light.living_room", cache, active)
        assert not any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))


# ---------------------------------------------------------------------------
# ANOM-04: motion in quiet hours
# ---------------------------------------------------------------------------

class TestAnom04:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_fires_in_quiet_hours(self, monkeypatch):
        monkeypatch.setattr(engine, "_local_hour", lambda: 2)  # 2am
        active = {}
        # binary_sensor with device_class motion
        cache = {
            "binary_sensor.bedroom_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            }
        }
        # Need area map — patch _get_area_map to return one area
        async def _mock_areas():
            return {
                "bedroom": {
                    "id": "bedroom",
                    "name": "Bedroom",
                    "entities": ["binary_sensor.bedroom_motion"],
                }
            }
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        assert any(e["rule_id"] == "ANOM-04" for e in active.get("bedroom", []))

    @pytest.mark.asyncio
    async def test_no_fire_outside_quiet_hours(self, monkeypatch):
        monkeypatch.setattr(engine, "_local_hour", lambda: 14)  # 2pm
        active = {}
        cache = {
            "binary_sensor.bedroom_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            }
        }
        async def _mock_areas():
            return {
                "bedroom": {
                    "id": "bedroom",
                    "name": "Bedroom",
                    "entities": ["binary_sensor.bedroom_motion"],
                }
            }
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        assert not any(e["rule_id"] == "ANOM-04" for e in active.get("bedroom", []))

    @pytest.mark.asyncio
    async def test_timezone_uses_settings_not_utc(self, monkeypatch):
        """Verify _local_hour uses pytz, not raw datetime.now()."""
        import pytz
        from unittest.mock import patch
        from datetime import datetime
        # Simulate 23:00 local (Israel, UTC+3) = 20:00 UTC
        local_dt = datetime(2026, 5, 11, 23, 0, 0, tzinfo=pytz.timezone("Asia/Jerusalem"))
        with patch("services.anomaly_engine.datetime") as mock_dt:
            mock_dt.now.return_value = local_dt
            # quiet hours start at 23 → should be IN quiet hours
            assert engine._in_quiet_hours()

    @pytest.mark.asyncio
    async def test_per_room_snooze_suppresses(self, monkeypatch):
        monkeypatch.setattr(engine, "_local_hour", lambda: 2)
        active = {}
        cache = {
            "binary_sensor.bedroom_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            }
        }
        async def _mock_areas():
            return {
                "bedroom": {
                    "id": "bedroom",
                    "name": "Bedroom",
                    "entities": ["binary_sensor.bedroom_motion"],
                }
            }
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)
        engine.snooze("bedroom", "ANOM-04", duration_minutes=60)
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        assert not any(e["rule_id"] == "ANOM-04" for e in active.get("bedroom", []))


# ---------------------------------------------------------------------------
# ANOM-06: device on >4h continuously
# ---------------------------------------------------------------------------

class TestAnom06:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_fires_after_4h_on(self, monkeypatch):
        active = {}
        entity = "switch.iron"
        cache = {entity: {"state": "on", "attributes": {"friendly_name": "Iron"}, "last_changed": ""}}
        # Simulate entity turned on 5 hours ago
        five_hours_ago = time.time() - 5 * 3600
        engine._last_on[entity] = five_hours_ago
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        await engine.evaluate(entity, cache, active)
        assert any(e["rule_id"] == "ANOM-06" for e in active.get(entity, []))

    @pytest.mark.asyncio
    async def test_no_fire_under_threshold(self, monkeypatch):
        active = {}
        entity = "switch.iron"
        cache = {entity: {"state": "on", "attributes": {"friendly_name": "Iron"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 1 * 3600  # 1 hour ago
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        await engine.evaluate(entity, cache, active)
        assert not any(e["rule_id"] == "ANOM-06" for e in active.get(entity, []))

    @pytest.mark.asyncio
    async def test_exemption_list_prevents_fire(self, monkeypatch):
        active = {}
        entity = "switch.nas"
        cache = {entity: {"state": "on", "attributes": {"friendly_name": "NAS"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 10 * 3600
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        # switch.nas is in the settings.yaml exemptions list
        await engine.evaluate(entity, cache, active)
        assert not any(e["rule_id"] == "ANOM-06" for e in active.get(entity, []))


# ---------------------------------------------------------------------------
# Snooze API
# ---------------------------------------------------------------------------

class TestSnooze:
    def setup_method(self):
        _reset_state()

    def test_snooze_sets_until(self):
        engine.snooze("bedroom", "ANOM-04", duration_minutes=60)
        assert engine._is_snoozed("bedroom", "ANOM-04")

    def test_snooze_expires(self, monkeypatch):
        engine.snooze("bedroom", "ANOM-04", duration_minutes=60)
        # Advance time by 61 minutes
        monkeypatch.setattr(time, "time", lambda: time.time() + 61 * 60)
        assert not engine._is_snoozed("bedroom", "ANOM-04")
