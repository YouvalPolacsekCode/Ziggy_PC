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


# Snapshot at import time so tests can restore anything they monkeypatched
# on the engine module.
_ORIG_ZIGGY_LOAD_PERSONS = engine._ziggy_load_persons
_ORIG_EVALUATE           = engine.evaluate


async def _sync_evaluate(*args, **kwargs):
    """Wrap evaluate() to also await its debounced rule-loop task.

    Production evaluate() schedules _debounced_rule_loop as an asyncio task
    (0.25 s sleep + rule dispatch) and returns. Tests that `await evaluate()`
    then assert immediately would race the debounce; this wrapper waits it
    out so every existing test call site keeps working unchanged.
    """
    await _ORIG_EVALUATE(*args, **kwargs)
    task = engine._eval_pending_task
    if task is not None:
        try:
            await task
        except Exception:
            pass


def _reset_state():
    engine._snooze.clear()
    engine._last_fired.clear()
    engine._last_on.clear()
    engine._last_off.clear()
    engine._all_away_since   = None
    engine._no_motion_since  = None
    engine._room_empty_since.clear()
    # Restore anything a previous test overrode on the engine module.
    engine._ziggy_load_persons = _ORIG_ZIGGY_LOAD_PERSONS
    # Force the anomaly engine to consider itself enabled regardless of the
    # dev machine's config/settings.yaml value. evaluate() short-circuits on
    # _cfg().get("enabled", True) being False, which is a common config on
    # a dev laptop and would silently mask every rule from ever firing.
    engine._cfg = lambda: {"enabled": True}
    # Force evaluate() to run its debounced rule loop inline so tests can
    # assert on `active` immediately after `await engine.evaluate(...)`.
    engine.evaluate = _sync_evaluate


# ── ANOM-01: all persons away + lights on ────────────────────────────────────

class TestAnom01:
    def setup_method(self):
        _reset_state()
        # Isolate from services/presence_engine's on-disk registry, which can
        # turn "all persons away" into False even when the test cache says
        # everyone is away. Scoped to ANOM-01 tests only — other rules
        # (ANOM-04/05) genuinely require non-empty presence sources.
        engine._ziggy_load_persons = lambda: []

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

    @pytest.mark.asyncio
    async def test_no_fire_on_hidden_config_switch(self, monkeypatch):
        """A Z2M presence-sensor AI config toggle (switch.*_ai_*) is always 'on'
        by design and must never raise a 'device left on' alert. This was ~37%
        of all anomaly-alert spam on the real home."""
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        entity = "switch.bedroom_presence_ai_interference_source_selfidentification"
        cache  = {entity: {"state": "on",
                           "attributes": {"friendly_name": "Bedroom Presence AI"},
                           "last_changed": ""}}
        engine._last_on[entity] = time.time() - 5 * 3600
        active = {}
        await engine.evaluate("sensor.dummy", cache, active)
        assert not any(e["rule_id"] == "ANOM-06" for room in active.values() for e in room)

    @pytest.mark.asyncio
    async def test_fires_on_real_relay_switch(self, monkeypatch):
        """A real relay switch (no config-entity markers) still alerts — the
        hide-filter must not swallow genuine 'left it on' signals."""
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        entity = "switch.ronis_lamp"
        cache  = {entity: {"state": "on", "attributes": {"friendly_name": "Roni's Lamp"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 5 * 3600
        active = {}
        await engine.evaluate("sensor.dummy", cache, active)
        assert any(e["rule_id"] == "ANOM-06" for room in active.values() for e in room)


# ── Re-fire dedup: an ongoing episode logs once, not once per cooldown ────────

class TestReFireDedup:
    def setup_method(self):
        _reset_state()

    @pytest.mark.asyncio
    async def test_ongoing_condition_logs_history_once(self, monkeypatch):
        """While a condition stays true, later rule-loop runs (even past the
        cooldown) must refresh the live card in place — NOT log a new history
        row or re-push. A light left on used to log ~20 rows as it climbed."""
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        fired = []
        monkeypatch.setattr(engine, "_log_history_fired",
                            lambda *a, **k: fired.append(a))

        entity = "switch.iron"
        cache  = {entity: {"state": "on", "attributes": {"friendly_name": "Iron"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 5 * 3600
        active = {}

        await engine.evaluate("sensor.dummy", cache, active)
        assert len(fired) == 1
        since_first = next(e["since"] for room in active.values()
                           for e in room if e["rule_id"] == "ANOM-06")

        # Jump well past the 30-min cooldown; the switch is still on.
        frozen = time.time() + 3600
        monkeypatch.setattr(time, "time", lambda: frozen)
        await engine.evaluate("sensor.dummy", cache, active)

        # Still exactly one history write — same ongoing episode, refreshed.
        assert len(fired) == 1
        since_second = next(e["since"] for room in active.values()
                            for e in room if e["rule_id"] == "ANOM-06")
        assert since_second == since_first

    @pytest.mark.asyncio
    async def test_ongoing_condition_refreshes_message(self, monkeypatch):
        """The live card's message/confidence update as the episode ages even
        though no new history row is written."""
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        monkeypatch.setattr(engine, "_log_history_fired", lambda *a, **k: None)

        entity = "switch.iron"
        cache  = {entity: {"state": "on", "attributes": {"friendly_name": "Iron"}, "last_changed": ""}}
        engine._last_on[entity] = time.time() - 5 * 3600
        active = {}

        await engine.evaluate("sensor.dummy", cache, active)
        msg_first = next(e["message"] for room in active.values()
                         for e in room if e["rule_id"] == "ANOM-06")

        frozen = time.time() + 3 * 3600   # 3h later → longer "on for X hours"
        monkeypatch.setattr(time, "time", lambda: frozen)
        await engine.evaluate("sensor.dummy", cache, active)
        msg_second = next(e["message"] for room in active.values()
                          for e in room if e["rule_id"] == "ANOM-06")
        assert msg_first != msg_second   # duration climbed, card refreshed


# ── ANOM-09: bulk-offline must ignore Z2M config entities ────────────────────

class TestAnom09BulkOffline:
    def setup_method(self):
        _reset_state()
        engine._recent_unavailable.clear()

    @pytest.mark.asyncio
    async def test_config_entities_dont_count_as_offline(self, monkeypatch):
        """Z2M per-device config entities (select.*_power_on_behavior,
        number.*_calibration) all flip to 'unknown' together on a z2m restart.
        They are not real devices and must not trigger the bulk-offline critical
        (this was firing false criticals on the real home)."""
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        active = {}
        for eid in ("select.0xabc_power_on_behavior",
                    "select.0xdef_indicator_mode",
                    "number.0xabc_temperature_calibration",
                    "number.0xdef_humidity_calibration",
                    "select.0xghi_color_power_on_behavior"):
            cache = {eid: {"state": "unknown", "attributes": {}, "last_changed": ""}}
            await engine.evaluate(eid, cache, active)
        assert len(engine._recent_unavailable) == 0
        assert not any(e["rule_id"] == "ANOM-09" for room in active.values() for e in room)

    @pytest.mark.asyncio
    async def test_real_devices_offline_still_fire(self, monkeypatch):
        """Genuine physical devices dropping together still raise the critical."""
        monkeypatch.setattr(engine, "_get_area_map", lambda: {})
        active = {}
        cache = {eid: {"state": "unavailable", "attributes": {}, "last_changed": ""}
                 for eid in ("light.bedroom", "light.kitchen", "light.office")}
        for eid in ("light.bedroom", "light.kitchen", "light.office"):
            await engine.evaluate(eid, cache, active)
        assert any(e["rule_id"] == "ANOM-09" for room in active.values() for e in room)


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
