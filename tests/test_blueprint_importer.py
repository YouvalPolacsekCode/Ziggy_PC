"""Tests for services/blueprint_importer.py — Session C.

Coverage of the pure parser (no HTTP, no HA):
  - parse_blueprint_yaml accepts a minimal valid blueprint
  - parse_blueprint_yaml rejects empty / non-mapping / wrong-domain inputs
  - !input tag round-trips to InputRef
  - inputs flatten nested HA "sections" form
  - validate_inputs catches missing required keys
  - instantiate_blueprint substitutes scalar + Jinja-style refs
  - instantiate_blueprint surfaces a friendly error when required inputs are missing
  - bundled blueprints all parse without errors
  - bundled motion_light instantiates into an HA-shaped payload with for_minutes
    plumbed through to the Ziggy-shaped trigger
  - HA-native bodies (choose:, wait_for_trigger:) pass through via ha_native_body
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services import blueprint_importer as bi


# ── parse_blueprint_yaml ──────────────────────────────────────────────────────


_MIN_BP = """
blueprint:
  name: Test Blueprint
  description: Trivial.
  domain: automation
  input:
    something:
      name: Something
      selector:
        text: {}
triggers:
  - platform: time
    at: !input something
actions:
  - service: light.turn_on
    target:
      entity_id: light.x
"""


def test_parse_minimal_blueprint():
    bp = bi.parse_blueprint_yaml(_MIN_BP, source="bundled", fallback_id="test")
    assert bp.id == "test"   # explicit fallback wins
    assert bp.name == "Test Blueprint"
    assert bp.source == "bundled"
    assert len(bp.inputs) == 1
    assert bp.inputs[0].key == "something"
    assert bp.inputs[0].selector_kind == "text"
    assert bp.raw_body["triggers"][0]["at"] == bi.InputRef("something")


def test_parse_empty_blueprint_rejected():
    with pytest.raises(ValueError, match="empty"):
        bi.parse_blueprint_yaml("", source="bundled")


def test_parse_non_mapping_rejected():
    with pytest.raises(ValueError, match="mapping"):
        bi.parse_blueprint_yaml("- just\n- a\n- list", source="bundled")


def test_parse_missing_blueprint_block_rejected():
    with pytest.raises(ValueError, match="top-level"):
        bi.parse_blueprint_yaml("not_a_blueprint: yes", source="bundled")


def test_parse_wrong_domain_rejected():
    bad = "blueprint:\n  name: x\n  domain: script\n"
    with pytest.raises(ValueError, match="automation blueprints"):
        bi.parse_blueprint_yaml(bad, source="bundled")


def test_input_tag_constructor_rejects_non_scalar():
    # `!input` must be a scalar key; a sequence-tagged !input should fail.
    bad = "x: !input [a, b]"
    with pytest.raises(ValueError):
        bi.parse_blueprint_yaml(
            "blueprint:\n  name: x\n  domain: automation\n" + bad,
            source="bundled",
        )


# ── _parse_inputs (nested sections form) ──────────────────────────────────────


def test_nested_sections_flatten():
    text = """
blueprint:
  name: Nested
  domain: automation
  input:
    group_a:
      name: Group A
      input:
        key_one:
          name: Key One
          selector:
            text: {}
        key_two:
          name: Key Two
          selector:
            number:
              min: 0
              max: 10
"""
    bp = bi.parse_blueprint_yaml(text, source="bundled")
    keys = sorted(i.key for i in bp.inputs)
    assert keys == ["key_one", "key_two"]
    by_key = {i.key: i for i in bp.inputs}
    assert by_key["key_two"].selector_kind == "number"
    assert by_key["key_two"].selector_meta == {"min": 0, "max": 10}


# ── validate_inputs ──────────────────────────────────────────────────────────


def test_validate_inputs_detects_missing():
    bp = bi.parse_blueprint_yaml(_MIN_BP, source="bundled")
    ok, missing = bi.validate_inputs(bp, {})
    assert ok is False
    assert missing == ["something"]
    ok, missing = bi.validate_inputs(bp, {"something": "hello"})
    assert ok is True
    assert missing == []


def test_validate_inputs_ignores_optional_with_default():
    text = """
blueprint:
  name: Has Default
  domain: automation
  input:
    threshold:
      name: T
      default: 5
      selector:
        number: {}
"""
    bp = bi.parse_blueprint_yaml(text, source="bundled")
    ok, missing = bi.validate_inputs(bp, {})
    assert ok is True


# ── instantiate_blueprint ────────────────────────────────────────────────────


def test_instantiate_substitutes_input_refs():
    # Direct parse → register in the cache so instantiate_blueprint can find it.
    bp = bi.parse_blueprint_yaml(_MIN_BP, source="bundled", fallback_id="round_trip_test")
    bi._BLUEPRINT_CACHE[bp.id] = bp
    try:
        payload = bi.instantiate_blueprint(bp.id, {"something": "08:30:00"})
        assert payload["trigger"] == {"type": "time", "time": "08:30"}
        assert payload["blueprint_meta"]["id"] == bp.id
    finally:
        bi._BLUEPRINT_CACHE.pop(bp.id, None)


def test_instantiate_friendly_missing_error():
    bp = bi.parse_blueprint_yaml(_MIN_BP, source="bundled", fallback_id="missing_err_test")
    bi._BLUEPRINT_CACHE[bp.id] = bp
    try:
        with pytest.raises(ValueError, match="Something"):
            bi.instantiate_blueprint(bp.id, {})
    finally:
        bi._BLUEPRINT_CACHE.pop(bp.id, None)


def test_instantiate_unknown_blueprint_error():
    with pytest.raises(ValueError, match="Template not found"):
        bi.instantiate_blueprint("definitely_not_a_blueprint_12345", {})


def test_jinja_style_substitution_in_strings():
    text = """
blueprint:
  name: Jinja Test
  domain: automation
  input:
    wait_secs:
      name: Wait
      default: 60
      selector:
        number: {}
triggers:
  - platform: state
    entity_id: binary_sensor.x
    to: "on"
actions:
  - delay: "00:00:{{ wait_secs }}"
"""
    bp = bi.parse_blueprint_yaml(text, source="bundled", fallback_id="jinja_test")
    bi._BLUEPRINT_CACHE[bp.id] = bp
    try:
        payload = bi.instantiate_blueprint(bp.id, {"wait_secs": 45})
        # Jinja substitution lives inside the HA-native body, not the Ziggy
        # delay (which already gets translated). Confirm both paths see 45s.
        assert payload["actions"][0]["seconds"] == 45
        assert "00:00:45" in str(payload["ha_native_body"]["actions"][0]["delay"])
    finally:
        bi._BLUEPRINT_CACHE.pop(bp.id, None)


# ── Bundled blueprints (the shipped library) ─────────────────────────────────


def test_all_bundled_blueprints_parse():
    """No bundled blueprint should fail to parse — guards against typos."""
    bi.reload_bundled()
    bps = bi.list_blueprints()
    assert len(bps) >= 10, f"Expected at least 10 bundled blueprints, got {len(bps)}"
    for bp in bps:
        assert bp.name, f"{bp.id} has empty name"
        assert bp.source == "bundled"


def test_bundled_motion_light_for_minutes_roundtrip():
    """Motion light has wait_for_trigger with for.seconds — verify the
    Ziggy-shaped trigger doesn't carry that, but the HA-native body does.
    """
    bi.reload_bundled()
    payload = bi.instantiate_blueprint("motion_light", {
        "motion_entity": "binary_sensor.test_motion",
        "light_target":  "light.test_light",
        "no_motion_wait": 120,
    })
    # Ziggy trigger is the simple state-on trigger.
    assert payload["trigger"]["type"] == "state"
    assert payload["trigger"]["entity_id"] == "binary_sensor.test_motion"
    # HA-native body preserves the wait_for_trigger step verbatim.
    actions = payload["ha_native_body"]["actions"]
    waited = [a for a in actions if "wait_for_trigger" in a]
    assert len(waited) == 1
    assert waited[0]["wait_for_trigger"][0]["for"]["seconds"] == 120
    # Mode propagated from blueprint.
    assert payload["ha_native_body"]["mode"] == "restart"


def test_bundled_ac_schedule_preserves_choose():
    """AC schedule uses `choose:` for trigger-id branching. Ziggy can't
    translate that, but it must survive in ha_native_body so HA can execute it.
    """
    bi.reload_bundled()
    payload = bi.instantiate_blueprint("ac_schedule", {
        "ac_entity":   "climate.living_room",
        "on_time":     "18:00:00",
        "off_time":    "23:00:00",
        "target_temp": 24,
    })
    # Israeli default — 24°C — substituted into the choose: data.
    chooses = payload["ha_native_body"]["actions"][0]["choose"]
    on_branch = chooses[0]["sequence"][0]["data"]
    assert on_branch["temperature"] == 24
    assert on_branch["hvac_mode"] == "cool"


def test_bundled_blueprints_have_hebrew_strings():
    """Israel/Hebrew defaults rule — bundled blueprints must carry Hebrew names."""
    bi.reload_bundled()
    for bp in bi.list_blueprints():
        assert bp.name_he, f"{bp.id} is missing Hebrew name (Israel/Hebrew defaults rule)"


# ── load_user_blueprint ─────────────────────────────────────────────────────


def test_load_user_blueprint_collides_with_bundled():
    """If a user pastes a blueprint whose id collides with a bundled one,
    the bundled version stays canonical and the user one gets a salted id.

    The collision is by ID, not name — a user can intentionally try to
    override with a custom `blueprint.id` field.
    """
    bi.reload_bundled()
    user_text = """
blueprint:
  id: motion_light
  name: Custom Motion Light
  description: User override attempt.
  domain: automation
  input:
    x:
      name: x
      selector:
        text: {}
triggers: []
actions: []
"""
    bp = bi.load_user_blueprint(user_text)
    assert bp.id != "motion_light"
    assert "_user_" in bp.id
    # Bundled motion_light remains canonical.
    canonical = bi.get_blueprint("motion_light")
    assert canonical is not None
    assert canonical.source == "bundled"
