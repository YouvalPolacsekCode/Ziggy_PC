"""
Unit tests for services/anomaly_engine.py (v2).

All tests use a synthetic state cache — no HA connection required.
Time-sensitive globals are pre-seeded so timers fire immediately on first call.
"""
import time
import pytest

import services.anomaly_engine as engine


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cache(**entity_states):
    """Build a minimal state cache from kwargs.  Use __ for dots: light__bedroom → light.bedroom."""
    cache = {}
    for eid, val in entity_states.items():
        eid = eid.replace("__", ".")
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
    engine._all_away_since   = None
    engine._no_motion_since  = None
    engine._room_empty_since.clear()


# ── ANOM-01: all persons away + lights on ────────────────────────────────────

class TestAnom01:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_fires_when_all_away_with_lights_on(self):
        # Pre-seed away timer so buffer is satisfied
        engine._all_away_since = time.time() - 400
        active = {}
        cache  = _cache(**{"person.alice": "not_home", "light.living_room": "on"})
        await engine.evaluate("light.living_room", cache, active)
        assert any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_no_fire_when_person_home(self):
        engine._all_away_since = time.time() - 400
        active = {}
        cache  = _cache(**{"person.alice": "home", "light.living_room": "on"})
        await engine.evaluate("light.living_room", cache, active)
        assert not any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_suppressed_within_buffer(self):
        """Buffer not met — should NOT fire even if all persons are away."""
        engine._all_away_since = None   # first call sets it to now, buffer not met
        active = {}
        cache  = _cache(**{"person.alice": "not_home", "light.living_room": "on"})
        await engine.evaluate("light.living_room", cache, active)
        assert not any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_no_fire_no_person_entities(self):
        active = {}
        cache  = _cache(**{"light.living_room": "on"})
        await engine.evaluate("light.living_room", cache, active)
        assert not any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_snooze_suppresses(self):
        engine._all_away_since = time.time() - 400
        active = {}
        cache  = _cache(**{"person.alice": "not_home", "light.living_room": "on"})
        engine.snooze("home", "ANOM-01", duration_minutes=60)
        await engine.evaluate("light.living_room", cache, active)
        assert not any(e["rule_id"] == "ANOM-01" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_confidence_higher_with_more_lights(self):
        engine._all_away_since = time.time() - 400
        active = {}
        cache  = _cache(**{
            "person.alice": "not_home",
            "light.living_room": "on",
            "light.bedroom": "on",
            "light.kitchen": "on",
        })
        await engine.evaluate("light.living_room", cache, active)
        entry = next((e for e in active.get("home", []) if e["rule_id"] == "ANOM-01"), None)
        assert entry is not None
        assert entry["confidence"] > 0.80


# ── ANOM-02: climate + room empty ────────────────────────────────────────────

class TestAnom02:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_fires_only_after_empty_timer(self, monkeypatch):
        threshold_s = 30 * 60

        async def _mock_areas():
            return {"living": {"id": "living", "name": "Living Room",
                               "entities": ["climate.living", "binary_sensor.living_motion"]}}
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)

        cache = {
            "climate.living": {"state": "cool", "attributes": {}, "last_changed": ""},
            "binary_sensor.living_motion": {"state": "off",
                                            "attributes": {"device_class": "motion"}, "last_changed": ""},
        }
        active = {}

        # First call — timer starts now, should NOT fire
        await engine.evaluate("climate.living", cache, active)
        assert not any(e["rule_id"] == "ANOM-02" for e in active.get("living", []))

        # Simulate 31 min elapsed by backdating the timer
        engine._room_empty_since["living"] = time.time() - threshold_s - 60

        await engine.evaluate("climate.living", cache, active)
        assert any(e["rule_id"] == "ANOM-02" for e in active.get("living", []))

    @pytest.mark.asyncio
    async def test_clears_when_motion_detected(self, monkeypatch):
        async def _mock_areas():
            return {"living": {"id": "living", "name": "Living Room",
                               "entities": ["climate.living", "binary_sensor.living_motion"]}}
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)

        # Pre-seed the timer so it would fire
        engine._room_empty_since["living"] = time.time() - 40 * 60

        cache = {
            "climate.living": {"state": "cool", "attributes": {}, "last_changed": ""},
            "binary_sensor.living_motion": {"state": "on",
                                            "attributes": {"device_class": "motion"}, "last_changed": ""},
        }
        active = {}
        await engine.evaluate("binary_sensor.living_motion", cache, active)
        assert not any(e["rule_id"] == "ANOM-02" for e in active.get("living", []))


# ── ANOM-04: motion in quiet hours ───────────────────────────────────────────

class TestAnom04:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_fires_in_quiet_hours(self, monkeypatch):
        monkeypatch.setattr(engine, "_local_hour", lambda: 2)
        active = {}
        cache  = {
            "binary_sensor.bedroom_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            }
        }
        async def _mock_areas():
            return {"bedroom": {"id": "bedroom", "name": "Bedroom",
                                "entities": ["binary_sensor.bedroom_motion"]}}
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        assert any(e["rule_id"] == "ANOM-04" for e in active.get("bedroom", []))

    @pytest.mark.asyncio
    async def test_no_fire_outside_quiet_hours(self, monkeypatch):
        monkeypatch.setattr(engine, "_local_hour", lambda: 14)
        active = {}
        cache  = {
            "binary_sensor.bedroom_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            }
        }
        async def _mock_areas():
            return {"bedroom": {"id": "bedroom", "name": "Bedroom",
                                "entities": ["binary_sensor.bedroom_motion"]}}
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        assert not any(e["rule_id"] == "ANOM-04" for e in active.get("bedroom", []))

    @pytest.mark.asyncio
    async def test_clears_when_quiet_hours_end(self, monkeypatch):
        """ANOM-04 entry in active should clear when quiet hours end."""
        monkeypatch.setattr(engine, "_local_hour", lambda: 2)
        cache = {
            "binary_sensor.bedroom_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            }
        }
        async def _mock_areas():
            return {"bedroom": {"id": "bedroom", "name": "Bedroom",
                                "entities": ["binary_sensor.bedroom_motion"]}}
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)
        active = {}
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        assert any(e["rule_id"] == "ANOM-04" for e in active.get("bedroom", []))

        # Now simulate daytime — ANOM-04 should clear on next evaluate
        engine._last_fired.clear()   # reset cooldown so dispatch runs
        monkeypatch.setattr(engine, "_local_hour", lambda: 10)
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        assert not any(e["rule_id"] == "ANOM-04" for e in active.get("bedroom", []))

    @pytest.mark.asyncio
    async def test_per_room_snooze_suppresses(self, monkeypatch):
        monkeypatch.setattr(engine, "_local_hour", lambda: 2)
        active = {}
        cache  = {
            "binary_sensor.bedroom_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            }
        }
        async def _mock_areas():
            return {"bedroom": {"id": "bedroom", "name": "Bedroom",
                                "entities": ["binary_sensor.bedroom_motion"]}}
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)
        engine.snooze("bedroom", "ANOM-04", duration_minutes=60)
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        assert not any(e["rule_id"] == "ANOM-04" for e in active.get("bedroom", []))

    @pytest.mark.asyncio
    async def test_away_mode_boosts_confidence(self, monkeypatch):
        monkeypatch.setattr(engine, "_local_hour", lambda: 2)
        cache = {
            "person.alice": {"state": "not_home", "attributes": {}, "last_changed": ""},
            "binary_sensor.bedroom_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            },
        }
        async def _mock_areas():
            return {"bedroom": {"id": "bedroom", "name": "Bedroom",
                                "entities": ["binary_sensor.bedroom_motion"]}}
        monkeypatch.setattr(engine, "_get_area_map", _mock_areas)
        active = {}
        await engine.evaluate("binary_sensor.bedroom_motion", cache, active)
        entry = next((e for e in active.get("bedroom", []) if e["rule_id"] == "ANOM-04"), None)
        assert entry is not None
        assert entry["confidence"] >= 0.90   # 0.65 base + 0.30 away boost


# ── ANOM-05: no motion >24h ───────────────────────────────────────────────────

class TestAnom05:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_no_fire_before_24h(self, monkeypatch):
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        cache  = {"person.alice": {"state": "home", "attributes": {}, "last_changed": ""}}
        active = {}
        # _no_motion_since = None on first call, gets set to now — 0 h elapsed
        await engine.evaluate("person.alice", cache, active)
        assert not any(e["rule_id"] == "ANOM-05" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_fires_after_24h(self, monkeypatch):
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        engine._no_motion_since = time.time() - 25 * 3600   # 25 hours ago
        cache  = {"person.alice": {"state": "home", "attributes": {}, "last_changed": ""}}
        active = {}
        await engine.evaluate("person.alice", cache, active)
        assert any(e["rule_id"] == "ANOM-05" for e in active.get("home", []))

    @pytest.mark.asyncio
    async def test_clears_when_motion_detected(self, monkeypatch):
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        engine._no_motion_since = time.time() - 25 * 3600
        cache = {
            "person.alice": {"state": "home", "attributes": {}, "last_changed": ""},
            "binary_sensor.hall_motion": {
                "state": "on",
                "attributes": {"device_class": "motion"},
                "last_changed": "",
            },
        }
        active = {}
        await engine.evaluate("binary_sensor.hall_motion", cache, active)
        assert not any(e["rule_id"] == "ANOM-05" for e in active.get("home", []))
        assert engine._no_motion_since is None

    @pytest.mark.asyncio
    async def test_no_fire_no_person_home(self, monkeypatch):
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        engine._no_motion_since = time.time() - 25 * 3600
        cache  = {"person.alice": {"state": "not_home", "attributes": {}, "last_changed": ""}}
        active = {}
        await engine.evaluate("person.alice", cache, active)
        assert not any(e["rule_id"] == "ANOM-05" for e in active.get("home", []))


# ── ANOM-06: device on >4h ────────────────────────────────────────────────────

class TestAnom06:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_fires_after_threshold(self, monkeypatch):
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        entity = "switch.iron"
        cache  = {entity: {"state": "on", "attributes": {"friendly_name": "Iron"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 5 * 3600
        active = {}
        # Trigger via a neutral entity so evaluate() doesn't overwrite the pre-seeded _last_on
        await engine.evaluate("sensor.dummy", cache, active)
        assert any(e["rule_id"] == "ANOM-06" for room in active.values() for e in room)

    @pytest.mark.asyncio
    async def test_no_fire_under_threshold(self, monkeypatch):
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        entity = "switch.iron"
        cache  = {entity: {"state": "on", "attributes": {"friendly_name": "Iron"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 1 * 3600
        active = {}
        await engine.evaluate("sensor.dummy", cache, active)
        assert not any(e["rule_id"] == "ANOM-06" for room in active.values() for e in room)

    @pytest.mark.asyncio
    async def test_exemption_list(self, monkeypatch):
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        entity = "switch.nas"
        cache  = {entity: {"state": "on", "attributes": {"friendly_name": "NAS"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 10 * 3600
        active = {}
        await engine.evaluate("sensor.dummy", cache, active)
        assert not any(e["rule_id"] == "ANOM-06" for room in active.values() for e in room)

    @pytest.mark.asyncio
    async def test_action_available(self, monkeypatch):
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        entity = "switch.iron"
        cache  = {entity: {"state": "on", "attributes": {"friendly_name": "Iron"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 5 * 3600
        active = {}
        await engine.evaluate("sensor.dummy", cache, active)
        entry = next((e for room in active.values() for e in room if e["rule_id"] == "ANOM-06"), None)
        assert entry is not None
        assert entry["action_available"] is True
        assert entry["suggested_action"] == f"turn_off:{entity}"


# ── Snooze persistence ────────────────────────────────────────────────────────

class TestSnooze:
    def setup_method(self):
        _reset_state()

    def test_snooze_sets_until(self):
        engine.snooze("bedroom", "ANOM-04", duration_minutes=60)
        assert engine._is_snoozed("bedroom", "ANOM-04")

    def test_snooze_expires(self, monkeypatch):
        engine.snooze("bedroom", "ANOM-04", duration_minutes=60)
        frozen = time.time()   # capture real timestamp before patching
        monkeypatch.setattr(time, "time", lambda: frozen + 61 * 60)
        assert not engine._is_snoozed("bedroom", "ANOM-04")
