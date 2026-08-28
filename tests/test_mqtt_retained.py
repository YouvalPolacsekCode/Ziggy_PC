"""Reading a retained MQTT topic — how the hub learns what the radio knows.

The pairing doctor asks the Z2M bridge for its device list. A home with no
broker (or a broker that's down) must still get an answer, so this read is
contractually best-effort: it returns None instead of raising.
"""
import pytest

from services import mqtt_client


def test_json_payloads_come_back_as_objects():
    assert mqtt_client._decode_retained(b'[{"friendly_name": "Lamp"}]') == [
        {"friendly_name": "Lamp"}]


def test_a_non_json_payload_comes_back_as_text():
    assert mqtt_client._decode_retained(b"online") == "online"


@pytest.mark.asyncio
async def test_an_unreachable_broker_yields_nothing_rather_than_an_error(monkeypatch):
    def boom(topic, timeout):
        raise OSError("connection refused")
    monkeypatch.setattr(mqtt_client, "_read_retained_sync", boom)

    assert await mqtt_client.read_retained("zigbee2mqtt/bridge/devices") is None


@pytest.mark.asyncio
async def test_a_retained_message_is_returned_decoded(monkeypatch):
    monkeypatch.setattr(mqtt_client, "_read_retained_sync",
                        lambda topic, timeout: b'{"permit_join": true}')
    assert await mqtt_client.read_retained("zigbee2mqtt/bridge/info") == {"permit_join": True}
