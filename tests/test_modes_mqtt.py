"""services/modes_mqtt — each home mode as a retained HA binary_sensor."""
from services import modes_mqtt as MM
from services import entity_filter


def test_discovery_payload_shape():
    p = MM.discovery_payload("sleep")
    assert p["unique_id"] == "ziggy_mode_sleep"
    assert p["state_topic"] == "ziggy/modes/sleep/state"
    assert p["availability_topic"] == MM.AVAILABILITY_TOPIC
    assert p["device"]["identifiers"] == ["ziggy_modes"]
    assert "Home Assistant" not in p["name"]


def test_announce_publishes_every_mode_retained(monkeypatch):
    sent = []
    monkeypatch.setattr(MM, "_publish", lambda t, p: sent.append((t, p)) or True)
    monkeypatch.setattr(MM, "_state_of", lambda mode: mode == "guest")
    assert MM.announce()
    topics = [t for t, _ in sent]
    for m in ("sleep", "movie", "cleaning", "guest", "vacation"):
        assert f"homeassistant/binary_sensor/ziggy_mode_{m}/config" in topics
        assert f"ziggy/modes/{m}/state" in topics
    assert MM.AVAILABILITY_TOPIC in topics
    assert dict(sent)["ziggy/modes/guest/state"] == b"ON"
    assert dict(sent)["ziggy/modes/sleep/state"] == b"OFF"


def test_announce_reports_failure(monkeypatch):
    monkeypatch.setattr(MM, "_publish", lambda t, p: False)
    monkeypatch.setattr(MM, "_state_of", lambda mode: False)
    assert MM.announce() is False


def test_publish_state(monkeypatch):
    sent = []
    monkeypatch.setattr(MM, "_publish", lambda t, p: sent.append((t, p)) or True)
    assert MM.publish_state("movie", True)
    assert sent == [("ziggy/modes/movie/state", b"ON")]


def test_entity_id_none_when_not_discovered(monkeypatch):
    monkeypatch.setattr(MM, "_lookup", lambda uid: None)
    assert MM.entity_id("movie") is None
    monkeypatch.setattr(MM, "_lookup", lambda uid: "binary_sensor.movie_mode")
    assert MM.entity_id("movie") == "binary_sensor.movie_mode"


def test_mode_entities_hidden_from_device_lists():
    assert entity_filter.is_hidden_entity("binary_sensor.ziggy_mode_sleep")
    # the id HA actually minted on Canary from the device name
    assert entity_filter.is_hidden_entity("binary_sensor.ziggy_modes_sleep_mode")
    assert entity_filter.is_hidden_entity("binary_sensor.ziggy_modes_guests_mode")
    assert not entity_filter.is_hidden_entity("binary_sensor.kitchen_motion")


def test_discovery_pins_object_id():
    assert MM.discovery_payload("movie")["object_id"] == "ziggy_mode_movie"
