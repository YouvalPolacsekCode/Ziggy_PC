"""Controller buttons as automation triggers, both directions.

A button press must compile to a Home Assistant trigger that fires on *every*
press, and an existing automation must round-trip back into the Ziggy trigger
shape so the wizard can re-open and edit it.
"""
from __future__ import annotations

import pytest

from services import controllers as C
from services import ha_automations as A


IEEE = "0x54ef441001782d71"
TOPIC = f"zigbee2mqtt/{IEEE}/action"


@pytest.fixture(autouse=True)
def _cache(monkeypatch):
    """Pretend discovery has run, without touching a broker."""
    monkeypatch.setattr(C, "cached", lambda: [{
        "ieee": IEEE,
        "name": "Hallway Switch",
        "actions": [
            {"subtype": s, "label": C.action_label(s), "type": "action",
             "topic": TOPIC, "payload": s}
            for s in ("single_left", "single_right", "hold_both")
        ],
    }])


# ── Ziggy trigger → HA ─────────────────────────────────────────────────────

def test_controller_trigger_compiles_to_mqtt():
    out = A._trigger_to_ha({"type": "controller", "controller_id": IEEE,
                            "action": "single_left"})
    assert out == [{"platform": "mqtt", "topic": TOPIC, "payload": "single_left"}]


def test_resolves_from_the_live_cache_not_a_stale_stored_topic():
    """A re-pair can move the topic; the current one must win."""
    out = A._trigger_to_ha({"type": "controller", "controller_id": IEEE,
                            "action": "single_left",
                            "topic": "zigbee2mqtt/old_name/action",
                            "payload": "single_left"})
    assert out[0]["topic"] == TOPIC


def test_falls_back_to_the_stored_topic_when_the_cache_is_cold(monkeypatch):
    """A hub that just restarted must still load its existing automations."""
    monkeypatch.setattr(C, "cached", list)
    out = A._trigger_to_ha({"type": "controller", "controller_id": IEEE,
                            "action": "single_left", "topic": TOPIC,
                            "payload": "single_left"})
    assert out == [{"platform": "mqtt", "topic": TOPIC, "payload": "single_left"}]


def test_unknown_controller_with_no_stored_topic_yields_no_trigger():
    """Never emit a half-formed trigger — HA would accept it and never fire."""
    assert A._trigger_to_ha({"type": "controller", "controller_id": "0xnope",
                             "action": "single_left"}) == []


def test_missing_action_yields_no_trigger():
    assert A._trigger_to_ha({"type": "controller", "controller_id": IEEE}) == []


# ── HA → Ziggy (round-trip for the wizard) ─────────────────────────────────

def test_mqtt_trigger_reads_back_as_a_controller_trigger():
    z = A._ha_trigger_to_ziggy([{"platform": "mqtt", "topic": TOPIC,
                                 "payload": "single_left"}])
    assert z["type"] == "controller"
    assert z["controller_id"] == IEEE
    assert z["action"] == "single_left"


def test_round_trip_is_stable():
    original = {"type": "controller", "controller_id": IEEE, "action": "hold_both"}
    back = A._ha_trigger_to_ziggy(A._trigger_to_ha(original))
    assert back["controller_id"] == original["controller_id"]
    assert back["action"] == original["action"]


def test_read_back_carries_a_plain_language_label():
    z = A._ha_trigger_to_ziggy([{"platform": "mqtt", "topic": TOPIC,
                                 "payload": "hold_both"}])
    assert z["label"] == "Both buttons — long press"
    assert z["controller_name"] == "Hallway Switch"


def test_non_controller_mqtt_trigger_is_left_alone():
    """Some other MQTT trigger must not be mislabelled as a button."""
    z = A._ha_trigger_to_ziggy([{"platform": "mqtt", "topic": "some/other/topic",
                                 "payload": "x"}])
    assert z["type"] != "controller"
