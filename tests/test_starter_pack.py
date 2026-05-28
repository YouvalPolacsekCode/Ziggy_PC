"""Tests for services/starter_pack.py — Prompt 7 chunk 3.3.

Coverage of the pure resolver (no HTTP):
  - load_starters returns [] on missing file
  - load_starters parses a valid YAML round-trip
  - resolve_payload fills placeholders for a fully-matched starter
  - resolve_payload returns None when device_type is missing in manifest
  - resolve_payload returns None when HA has no entity in the right domain
  - resolve_payload skips an entity already used by an earlier slot
  - list_available returns only resolvable starters, preserving YAML order
  - The shipped v1.yaml smoke-loads (no syntax errors)
"""
from __future__ import annotations

from pathlib import Path
import textwrap

import pytest

from services import starter_pack


def _write_yaml(p: Path, body: str) -> None:
    p.write_text(textwrap.dedent(body).lstrip(), encoding="utf-8")


# ── load_starters ────────────────────────────────────────────────────────────

def test_load_starters_missing_file_returns_empty(tmp_path: Path):
    assert starter_pack.load_starters(tmp_path / "absent.yaml") == []


def test_load_starters_parses_valid_yaml(tmp_path: Path):
    p = tmp_path / "starters.yaml"
    _write_yaml(p, """
        - id: a
          label_en: A
          label_he: א
          slots: []
          ha_payload:
            name: Test
        - id: b
          label_en: B
          label_he: ב
          slots: []
          ha_payload:
            name: Test 2
    """)
    starters = starter_pack.load_starters(p)
    assert len(starters) == 2
    assert starters[0]["id"] == "a"
    assert starters[1]["id"] == "b"


def test_load_starters_skips_non_dict_entries(tmp_path: Path):
    p = tmp_path / "starters.yaml"
    _write_yaml(p, """
        - "a string item"
        - id: real
          label_en: Real
          slots: []
          ha_payload: {}
        - null
    """)
    out = starter_pack.load_starters(p)
    assert len(out) == 1
    assert out[0]["id"] == "real"


def test_load_starters_yaml_root_not_list_returns_empty(tmp_path: Path):
    p = tmp_path / "starters.yaml"
    _write_yaml(p, "id: not-a-list\n")
    assert starter_pack.load_starters(p) == []


# ── resolve_payload ──────────────────────────────────────────────────────────

def _starter_motion_to_light() -> dict:
    return {
        "id": "motion_to_light",
        "slots": [
            {"name": "motion_entity", "device_type": "motion", "ha_domain": "binary_sensor"},
            {"name": "light_entity",  "device_type": "bulb",   "ha_domain": "light"},
        ],
        "ha_payload": {
            "name": "Motion → light",
            "trigger":  {"type": "state", "entity_id": "{{motion_entity}}", "state": "on"},
            "actions": [{"type": "call_service", "entity_id": "{{light_entity}}", "service": "light.turn_on"}],
        },
    }


def test_resolve_payload_substitutes_when_all_slots_match():
    starter = _starter_motion_to_light()
    manifest = [
        {"device_type": "motion", "zigbee_mac": "00:11:22:33:44:55"},
        {"device_type": "bulb",   "zigbee_mac": "aa:bb:cc:dd:ee:ff"},
    ]
    devices = [
        {"id": "dev_motion", "connections": [["zigbee", "00:11:22:33:44:55"]]},
        {"id": "dev_bulb",   "connections": [["zigbee", "AA:BB:CC:DD:EE:FF"]]},
    ]
    entities = [
        {"entity_id": "binary_sensor.living_motion", "device_id": "dev_motion"},
        {"entity_id": "sensor.living_motion_battery", "device_id": "dev_motion"},
        {"entity_id": "light.living_bulb",            "device_id": "dev_bulb"},
    ]
    payload = starter_pack.resolve_payload(
        starter,
        manifest_sensors=manifest, ha_devices=devices, ha_entities=entities,
    )
    assert payload is not None
    assert payload["trigger"]["entity_id"] == "binary_sensor.living_motion"
    assert payload["actions"][0]["entity_id"] == "light.living_bulb"


def test_resolve_payload_none_when_manifest_missing_device_type():
    starter = _starter_motion_to_light()
    manifest = [{"device_type": "motion", "zigbee_mac": "aa:bb"}]  # no bulb
    devices  = [{"id": "dev1", "connections": [["zigbee", "aa:bb"]]}]
    entities = [{"entity_id": "binary_sensor.x", "device_id": "dev1"}]
    assert starter_pack.resolve_payload(
        starter,
        manifest_sensors=manifest, ha_devices=devices, ha_entities=entities,
    ) is None


def test_resolve_payload_none_when_ha_has_no_matching_domain_entity():
    starter = _starter_motion_to_light()
    manifest = [
        {"device_type": "motion", "zigbee_mac": "aa:bb"},
        {"device_type": "bulb",   "zigbee_mac": "cc:dd"},
    ]
    devices = [
        {"id": "dev_m", "connections": [["zigbee", "aa:bb"]]},
        {"id": "dev_l", "connections": [["zigbee", "cc:dd"]]},
    ]
    # No light.* entity for dev_l — bulb slot can't resolve
    entities = [
        {"entity_id": "binary_sensor.m", "device_id": "dev_m"},
        {"entity_id": "sensor.battery",  "device_id": "dev_l"},
    ]
    assert starter_pack.resolve_payload(
        starter,
        manifest_sensors=manifest, ha_devices=devices, ha_entities=entities,
    ) is None


def test_resolve_payload_two_same_type_slots_pick_different_entities():
    starter = {
        "id": "two_motions",
        "slots": [
            {"name": "a", "device_type": "motion", "ha_domain": "binary_sensor"},
            {"name": "b", "device_type": "motion", "ha_domain": "binary_sensor"},
        ],
        "ha_payload": {
            "name": "Two motions",
            "trigger":  {"type": "state", "entity_id": "{{a}}", "state": "on"},
            "actions": [{"type": "notify", "message": "{{b}} also active"}],
        },
    }
    manifest = [
        {"device_type": "motion", "zigbee_mac": "aa"},
        {"device_type": "motion", "zigbee_mac": "bb"},
    ]
    devices = [
        {"id": "dev_aa", "connections": [["zigbee", "aa"]]},
        {"id": "dev_bb", "connections": [["zigbee", "bb"]]},
    ]
    entities = [
        {"entity_id": "binary_sensor.aa", "device_id": "dev_aa"},
        {"entity_id": "binary_sensor.bb", "device_id": "dev_bb"},
    ]
    payload = starter_pack.resolve_payload(
        starter,
        manifest_sensors=manifest, ha_devices=devices, ha_entities=entities,
    )
    assert payload is not None
    a_eid = payload["trigger"]["entity_id"]
    b_eid = payload["actions"][0]["message"].split()[0]
    assert a_eid != b_eid
    assert {a_eid, b_eid} == {"binary_sensor.aa", "binary_sensor.bb"}


# ── list_available ───────────────────────────────────────────────────────────

def test_list_available_returns_only_resolvable_in_yaml_order(tmp_path: Path):
    p = tmp_path / "s.yaml"
    _write_yaml(p, """
        - id: needs_bulb
          label_en: A
          label_he: א
          slots:
            - name: light_entity
              device_type: bulb
              ha_domain: light
          ha_payload:
            name: A
            trigger: {type: state, entity_id: "{{light_entity}}", state: "on"}
            actions: []
            rooms: []
        - id: needs_motion
          label_en: B
          label_he: ב
          slots:
            - name: motion_entity
              device_type: motion
              ha_domain: binary_sensor
          ha_payload:
            name: B
            trigger: {type: state, entity_id: "{{motion_entity}}", state: "on"}
            actions: []
            rooms: []
    """)
    manifest = [{"device_type": "motion", "zigbee_mac": "aa"}]
    devices  = [{"id": "dev_m", "connections": [["zigbee", "aa"]]}]
    entities = [{"entity_id": "binary_sensor.m", "device_id": "dev_m"}]
    out = starter_pack.list_available(
        manifest_sensors=manifest, ha_devices=devices, ha_entities=entities, path=p,
    )
    assert len(out) == 1
    assert out[0]["id"] == "needs_motion"
    assert out[0]["ha_payload"]["trigger"]["entity_id"] == "binary_sensor.m"


def test_list_available_empty_when_no_starters_resolvable(tmp_path: Path):
    p = tmp_path / "s.yaml"
    _write_yaml(p, """
        - id: needs_door
          label_en: A
          label_he: א
          slots:
            - name: door_entity
              device_type: door
              ha_domain: binary_sensor
          ha_payload:
            name: A
            trigger: {type: state, entity_id: "{{door_entity}}", state: "on"}
            actions: []
            rooms: []
    """)
    # Manifest has no door
    out = starter_pack.list_available(
        manifest_sensors=[], ha_devices=[], ha_entities=[], path=p,
    )
    assert out == []


# ── Shipped v1.yaml smoke ────────────────────────────────────────────────────

def test_shipped_v1_yaml_parses_without_errors():
    """The real curated file must always load. If this test fails the
    starter pack is broken in production."""
    starters = starter_pack.load_starters()
    assert isinstance(starters, list)
    assert len(starters) >= 3                # we shipped 5 at writing time
    for s in starters:
        assert "id" in s
        assert "label_en" in s
        assert "label_he" in s
        assert "slots" in s
        assert "ha_payload" in s
