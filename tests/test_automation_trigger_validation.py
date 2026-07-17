"""Bug 5: saving an automation whose trigger points at a missing/empty entity
must be rejected (not silently 'saved' then vanish)."""
from services import ha_automations as h


def _mk(platform, entity_id):
    return [{"platform": platform, "entity_id": entity_id}]


def test_empty_state_entity_is_rejected():
    err = h._validate_trigger_entities(_mk("state", ""))
    assert err and err["reason"] == "trigger_entity_missing"
    assert err["entity"] == ""


def test_nonexistent_state_entity_is_rejected(monkeypatch):
    monkeypatch.setattr(h, "_known_entity_ids", lambda: {"binary_sensor.real_one"})
    err = h._validate_trigger_entities(_mk("state", "binary_sensor.ghost"))
    assert err and err["reason"] == "trigger_entity_missing"
    assert err["entity"] == "binary_sensor.ghost"


def test_existing_state_entity_passes(monkeypatch):
    monkeypatch.setattr(h, "_known_entity_ids", lambda: {"binary_sensor.bedroom_occupied"})
    assert h._validate_trigger_entities(_mk("state", "binary_sensor.bedroom_occupied")) is None


def test_time_trigger_needs_no_entity():
    assert h._validate_trigger_entities([{"platform": "time", "at": "08:00:00"}]) is None


def test_unreachable_ha_does_not_block_existing_looking_save(monkeypatch):
    # No snapshot available -> only empty ids are blocked, real-looking ids pass.
    monkeypatch.setattr(h, "_known_entity_ids", lambda: set())
    assert h._validate_trigger_entities(_mk("state", "binary_sensor.something")) is None


def test_list_entity_ids_all_empty_rejected():
    err = h._validate_trigger_entities([{"platform": "state", "entity_id": []}])
    assert err and err["reason"] == "trigger_entity_missing"
