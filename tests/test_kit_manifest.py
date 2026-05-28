"""Tests for services/kit_manifest.py — Prompt 7 chunk 2.2.

Coverage:
  - load_manifest returns the empty skeleton when the file is missing
  - load_manifest reads a well-formed YAML manifest end-to-end
  - sensor normalization fills the right Hebrew + English fallback labels
  - sensor normalization drops non-dict entries silently
  - find_sensor_by_mac is case-insensitive
  - malformed YAML / non-mapping root logs an error but doesn't raise
"""
from __future__ import annotations

from pathlib import Path
import textwrap

import pytest

from services import kit_manifest


@pytest.fixture
def manifest_file(tmp_path: Path) -> Path:
    return tmp_path / "kit_manifest.yaml"


def _write(p: Path, body: str) -> None:
    p.write_text(textwrap.dedent(body).lstrip(), encoding="utf-8")


# ── load_manifest ────────────────────────────────────────────────────────────

def test_load_manifest_missing_file_returns_empty_skeleton(tmp_path: Path):
    p = tmp_path / "does_not_exist.yaml"
    m = kit_manifest.load_manifest(p)
    assert m == {
        "kit_sku":          None,
        "owner_email":      None,
        "coordinator_type": None,
        "coordinator_ip":   None,
        "bulk_order_id":    None,
        "sensors":          [],
        "irs":              [],
    }


def test_load_manifest_reads_well_formed_yaml(manifest_file: Path):
    _write(manifest_file, """
        kit_sku: home-v1
        owner_email: user@example.com
        coordinator_type: smlight
        coordinator_ip: 192.168.1.42
        bulk_order_id: BO-2026-05-01
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: 00:15:8d:00:01:23:45:67
            intended_room_label_he: סלון
            intended_room_label_en: Living Room
          - device_type: door
            vendor_model: aqara_t1
            zigbee_mac: 00:15:8d:00:01:23:45:68
            intended_room_label_he: דלת ראשית
            intended_room_label_en: Front Door
        irs:
          - device_type: ir_blaster
            vendor_model: broadlink_rm4_mini
            intended_room_label_he: סלון
            intended_room_label_en: Living Room
    """)
    m = kit_manifest.load_manifest(manifest_file)
    assert m["kit_sku"] == "home-v1"
    assert m["owner_email"] == "user@example.com"
    assert m["coordinator_type"] == "smlight"
    assert m["coordinator_ip"] == "192.168.1.42"
    assert m["bulk_order_id"] == "BO-2026-05-01"
    assert len(m["sensors"]) == 2
    assert m["sensors"][0]["device_type"] == "motion"
    assert m["sensors"][0]["intended_room_label_he"] == "סלון"
    assert m["sensors"][0]["intended_room_label_en"] == "Living Room"
    assert len(m["irs"]) == 1
    assert m["irs"][0]["vendor_model"] == "broadlink_rm4_mini"


# ── normalization + fallbacks ────────────────────────────────────────────────

def test_normalize_fills_hebrew_fallback_when_only_english_given(manifest_file: Path):
    _write(manifest_file, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: AA:BB
            intended_room_label_en: Kitchen
    """)
    sensors = kit_manifest.get_sensors(manifest_file)
    assert sensors[0]["intended_room_label_en"] == "Kitchen"
    # Hebrew falls back to the English label, not the device-type default
    assert sensors[0]["intended_room_label_he"] == "Kitchen"


def test_normalize_fills_device_type_default_when_both_missing(manifest_file: Path):
    _write(manifest_file, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: AA:BB
    """)
    sensors = kit_manifest.get_sensors(manifest_file)
    assert sensors[0]["intended_room_label_he"] == "חיישן תנועה"
    assert sensors[0]["intended_room_label_en"] == "Motion sensor"


def test_normalize_drops_non_dict_entries(manifest_file: Path):
    _write(manifest_file, """
        sensors:
          - "this is a string"
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: AA:BB
          - null
    """)
    sensors = kit_manifest.get_sensors(manifest_file)
    assert len(sensors) == 1
    assert sensors[0]["device_type"] == "motion"


def test_normalize_drops_entries_with_no_type_and_no_vendor(manifest_file: Path):
    _write(manifest_file, """
        sensors:
          - zigbee_mac: AA:BB
            intended_room_label_en: Lonely
          - device_type: door
            vendor_model: aqara_t1
            zigbee_mac: CC:DD
    """)
    sensors = kit_manifest.get_sensors(manifest_file)
    assert len(sensors) == 1
    assert sensors[0]["device_type"] == "door"


# ── find_sensor_by_mac ───────────────────────────────────────────────────────

def test_find_sensor_by_mac_is_case_insensitive(manifest_file: Path):
    _write(manifest_file, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: 00:15:8d:00:AA:BB
            intended_room_label_en: Living Room
            intended_room_label_he: סלון
    """)
    s = kit_manifest.find_sensor_by_mac("00:15:8D:00:aa:bb", manifest_file)
    assert s is not None
    assert s["intended_room_label_en"] == "Living Room"


def test_find_sensor_by_mac_returns_none_for_unknown(manifest_file: Path):
    _write(manifest_file, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: AA:BB
    """)
    assert kit_manifest.find_sensor_by_mac("XX:YY", manifest_file) is None


def test_find_sensor_by_mac_empty_input_returns_none(manifest_file: Path):
    _write(manifest_file, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: AA:BB
    """)
    assert kit_manifest.find_sensor_by_mac("", manifest_file) is None
    assert kit_manifest.find_sensor_by_mac(None, manifest_file) is None  # type: ignore[arg-type]


# ── malformed YAML tolerance ─────────────────────────────────────────────────

def test_malformed_yaml_returns_empty_skeleton(manifest_file: Path):
    manifest_file.write_text("this: is: not: valid: yaml:\n  - [unbalanced", encoding="utf-8")
    m = kit_manifest.load_manifest(manifest_file)
    assert m["sensors"] == []
    assert m["kit_sku"] is None


def test_yaml_root_not_a_mapping_returns_empty_skeleton(manifest_file: Path):
    _write(manifest_file, """
        - just a list
        - at the root
    """)
    m = kit_manifest.load_manifest(manifest_file)
    assert m["sensors"] == []


# ── ZIGGY_KIT_MANIFEST_PATH env override ─────────────────────────────────────

def test_env_var_overrides_default_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    p = tmp_path / "from_env.yaml"
    _write(p, """
        kit_sku: from-env
        sensors: []
        irs: []
    """)
    monkeypatch.setenv("ZIGGY_KIT_MANIFEST_PATH", str(p))
    m = kit_manifest.load_manifest()  # no path arg — uses env
    assert m["kit_sku"] == "from-env"
