"""Ziggy's presence must be something Home Assistant can evaluate itself.

The split-brain that caused 2026-08-14. Leave Home is compiled into HA and
fired by HA, but its `{"type": "presence", "value": "all_away"}` condition has
no HA representation — so HA runs the automation on its own (weaker) view and
Ziggy re-checks presence afterwards. One automation, two evaluators, and they
disagreed:

  * `_condition_to_ha` could not express `for:` at all, so HA's whole-house
    guard was an instantaneous sample while Ziggy's understood durations.
  * `ha_defers_action` mis-classified `notify`, so 2 of 3 steps ran.

Both are fixed, but the underlying shape remained: HA cannot see presence, so
it cannot gate on it. This publishes presence as a real MQTT-discovered
`binary_sensor`, which makes the condition compilable and gives HA and Ziggy
the same fact to reason about.

The dangerous failure mode is compiling a condition that names an entity Home
Assistant does not have: an HA state condition against an unknown entity is
False, so Leave Home would silently never fire again. So the compile is
CONDITIONAL — it only references the entity once its real entity_id is known,
and otherwise falls back to today's Ziggy-side check.
"""

import pytest

from services import ha_automations


@pytest.fixture(autouse=True)
def _no_entity_by_default(monkeypatch):
    """Default: HA doesn't know about the sensor yet."""
    monkeypatch.setattr(ha_automations, "presence_entity_id", lambda: None, raising=False)


class TestPresenceConditionCompiles:

    def test_all_away_becomes_a_state_condition_when_the_entity_exists(self, monkeypatch):
        monkeypatch.setattr(ha_automations, "presence_entity_id",
                            lambda: "binary_sensor.ziggy_anyone_home", raising=False)
        out = ha_automations._condition_to_ha({"type": "presence", "value": "all_away"})
        assert out == {
            "condition": "state",
            "entity_id": "binary_sensor.ziggy_anyone_home",
            "state": "off",
        }

    def test_anyone_home_is_the_inverse(self, monkeypatch):
        monkeypatch.setattr(ha_automations, "presence_entity_id",
                            lambda: "binary_sensor.ziggy_anyone_home", raising=False)
        out = ha_automations._condition_to_ha({"type": "presence", "value": "anyone_home"})
        assert out["state"] == "on"

    def test_a_duration_still_applies(self, monkeypatch):
        monkeypatch.setattr(ha_automations, "presence_entity_id",
                            lambda: "binary_sensor.ziggy_anyone_home", raising=False)
        out = ha_automations._condition_to_ha(
            {"type": "presence", "value": "all_away", "for_minutes": 15})
        assert out["for"] == "00:15:00"


class TestItNeverInventsAnEntity:
    """An HA state condition against an unknown entity is False — compiling one
    would silently stop Leave Home firing forever."""

    def test_no_entity_means_no_compiled_condition(self):
        assert ha_automations._condition_to_ha(
            {"type": "presence", "value": "all_away"}) is None

    def test_that_is_the_pre_existing_behaviour(self):
        """Dropping to None is exactly what happened before this change, so a
        home whose sensor hasn't been discovered yet behaves as it always did:
        HA fires, Ziggy re-checks presence."""
        assert ha_automations._condition_to_ha({"type": "presence"}) is None


class TestZiggySideCheckIsUnchanged:
    """Belt and braces. HA gating on presence does not remove Ziggy's own
    check — with two independent evaluators the safe design is BOTH, not
    whichever happens to run."""

    def test_ziggy_still_evaluates_presence_conditions(self, monkeypatch):
        from services import local_automation_actions as laa
        import services.presence_store as ps
        monkeypatch.setattr(ps, "load_persons", lambda: [{"id": "p1"}])
        monkeypatch.setattr(ps, "all_away", lambda: True)
        monkeypatch.setattr(ps, "any_home", lambda: False)
        passed, reason = laa._eval_single_condition({"type": "presence", "value": "all_away"})
        assert passed is True
        assert "all_away" in reason


class TestTheSensorContract:
    """What the MQTT entity must look like for HA to accept it."""

    def test_discovery_payload_is_a_binary_sensor_with_a_stable_unique_id(self):
        from services import presence_mqtt
        payload = presence_mqtt.discovery_payload()
        assert payload["unique_id"] == presence_mqtt.UNIQUE_ID
        assert payload["state_topic"] == presence_mqtt.STATE_TOPIC
        assert payload["device_class"] == "presence"
        assert payload["payload_on"] == "ON" and payload["payload_off"] == "OFF"

    def test_topics_are_namespaced_to_ziggy(self):
        from services import presence_mqtt
        assert presence_mqtt.STATE_TOPIC.startswith("ziggy/")
        assert presence_mqtt.CONFIG_TOPIC.startswith("homeassistant/binary_sensor/")

    def test_state_maps_household_occupancy_to_ON_OFF(self):
        from services import presence_mqtt
        assert presence_mqtt.state_payload(anyone_home=True) == b"ON"
        assert presence_mqtt.state_payload(anyone_home=False) == b"OFF"
