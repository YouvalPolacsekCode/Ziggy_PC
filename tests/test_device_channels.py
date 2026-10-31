"""Multi-channel devices: real channels are found, everything else is untouched.

Fixtures are David's live hub (2026-10-31): a SONOFF SWV-ZF2 dual valve, its
~40 schedule switches, a Gree AC with uncategorised feature switches, an
Aqara FP300 with uncategorised setting switches, and single-channel relays.
"""
from __future__ import annotations

import pytest

from services import device_channels as D

VALVE = "0xa4c138dd4d2e1b8c"


def _row(eid, name=None):
    return {"entity_id": eid, "domain": eid.split(".")[0], "display_name": name or eid}


def _meta(uid=None, cat=None, orig=None):
    return {"unique_id": uid, "entity_category": cat, "original_name": orig}


BRIDGE = [
    {"ieee_address": VALVE, "definition": {"exposes": [
        {"type": "switch", "endpoint": "1", "features": [{"property": "state_1"}]},
        {"type": "switch", "endpoint": "2", "features": [{"property": "state_2"}]},
        {"type": "binary", "property": "irrigation_plan_enabled_1"},
        {"type": "numeric", "property": "battery"},
    ]}},
    {"ieee_address": "0x6ce4a4fffe9a0a04", "definition": {"exposes": [
        {"type": "switch", "features": [{"property": "state"}]}]}},
    {"ieee_address": "0x006ce4a4ffbe9c3d", "definition": {"exposes": [
        {"type": "light", "features": [{"property": "state"}]}]}},
    {"ieee_address": "0xdead", "definition": None},
    "garbage",
]


def _valve_group():
    rows = [
        _row(f"switch.{VALVE}_1", "מים לגינון 1"),
        _row(f"switch.{VALVE}_2", "מים לגינון 2"),
        _row(f"switch.{VALVE}_irrigation_plan_enabled_1", "מים לגינון Irrigation plan enabled 1"),
        _row(f"switch.{VALVE}_child_lock", "מים לגינון Child lock"),
        _row(f"sensor.{VALVE}_battery", "מים לגינון Battery"),
    ]
    by_entity = {
        f"switch.{VALVE}_1": _meta(f"{VALVE}_switch_1_zigbee2mqtt", None, "1"),
        f"switch.{VALVE}_2": _meta(f"{VALVE}_switch_2_zigbee2mqtt", None, "2"),
        f"switch.{VALVE}_irrigation_plan_enabled_1":
            _meta(f"{VALVE}_switch_irrigation_plan_enabled_1_zigbee2mqtt", "config", "Irrigation plan enabled 1"),
        f"switch.{VALVE}_child_lock": _meta(f"{VALVE}_switch_child_lock_zigbee2mqtt", "config", "Child lock"),
        f"sensor.{VALVE}_battery": _meta(f"{VALVE}_battery_zigbee2mqtt", "diagnostic", "Battery"),
    }
    return rows, by_entity


def test_bridge_parse_keeps_only_multi_channel_devices():
    assert D.parse_z2m_channels(BRIDGE) == {VALVE: {("switch", "1"), ("switch", "2")}}


def test_bridge_parse_survives_junk():
    assert D.parse_z2m_channels(None) == {}
    assert D.parse_z2m_channels([None, 1, {"definition": {"exposes": None}}]) == {}


def test_davids_valve_from_z2m():
    rows, by_entity = _valve_group()
    out = D.detect_channels(rows, f"switch.{VALVE}_1", by_entity, "מים לגינון",
                            z2m=D.parse_z2m_channels(BRIDGE))
    assert out == [
        {"entity_id": f"switch.{VALVE}_1", "channel": "1", "name": "מים לגינון 1"},
        {"entity_id": f"switch.{VALVE}_2", "channel": "2", "name": "מים לגינון 2"},
    ]


def test_davids_valve_from_names_when_z2m_map_is_cold():
    """Right after a restart the Z2M map is empty; the name rule gives the same answer."""
    rows, by_entity = _valve_group()
    out = D.detect_channels(rows, f"switch.{VALVE}_1", by_entity, "מים לגינון", z2m={})
    assert [c["entity_id"] for c in out] == [f"switch.{VALVE}_1", f"switch.{VALVE}_2"]


def test_gree_ac_feature_switches_are_not_channels():
    rows = [_row("climate.ac"), *[_row(f"switch.7cb8_{s}") for s in ("panel_light", "quiet_mode", "fresh_air", "xtra_fan")]]
    by_entity = {f"switch.7cb8_{s}": _meta(f"7cb8_{s}", None, s.replace("_", " ").title())
                 for s in ("panel_light", "quiet_mode", "fresh_air", "xtra_fan")}
    assert D.detect_channels(rows, "climate.ac", by_entity, "AC", z2m={}) == []
    # …even if a switch were somehow the primary.
    assert D.detect_channels(rows, "switch.7cb8_quiet_mode", by_entity, "AC", z2m={}) == []


def test_uncategorised_setting_switches_are_not_channels():
    """Aqara FP300: 'Ai sensitivity adaptive' etc. carry no category in HA."""
    p = "0x54ef4410015bf46c"
    rows = [_row(f"binary_sensor.{p}_presence"),
            _row(f"switch.{p}_ai_interference_source_selfidentification"),
            _row(f"switch.{p}_ai_sensitivity_adaptive")]
    by_entity = {r["entity_id"]: _meta(None, None, "Ai something") for r in rows}
    assert D.detect_channels(rows, rows[0]["entity_id"], by_entity, "FP300", z2m={}) == []


@pytest.mark.parametrize("primary", ["switch.0x6ce4a4fffe9a0a04", "light.0x006ce4a4ffbe9c3d"])
def test_single_channel_devices_are_untouched(primary):
    rows = [_row(primary), _row(primary.replace(primary.split(".")[0], "sensor") + "_power")]
    assert D.detect_channels(rows, primary, {}, "x", z2m=D.parse_z2m_channels(BRIDGE)) == []


def test_two_gang_wall_switch_by_name():
    rows = [_row("switch.hall_l1", "Hall L1"), _row("switch.hall_l2", "Hall L2"), _row("sensor.hall_power")]
    by_entity = {"switch.hall_l1": _meta(orig="L1"), "switch.hall_l2": _meta(orig="L2")}
    out = D.detect_channels(rows, "switch.hall_l1", by_entity, "Hall", z2m={})
    assert [(c["channel"], c["name"]) for c in out] == [("1", "Hall L1"), ("2", "Hall L2")]


def test_channel_order_is_natural():
    rows = [_row(f"switch.r_{n}") for n in (10, 2, 1)]
    by_entity = {r["entity_id"]: _meta(orig=r["entity_id"].rsplit("_", 1)[1]) for r in rows}
    out = D.detect_channels(rows, "switch.r_1", by_entity, "Relay", z2m={})
    assert [c["channel"] for c in out] == ["1", "2", "10"]
    assert out[0]["name"] == "Relay 1", "a raw entity id is never shown as a channel name"


def test_bare_token_names_get_the_device_name():
    rows = [_row("switch.r_1", "1"), _row("switch.r_2", "2")]
    out = D.detect_channels(rows, "switch.r_1", {}, "Relay", z2m={})
    assert [c["name"] for c in out] == ["Relay 1", "Relay 2"]


def test_a_setting_ending_in_a_digit_is_not_a_channel_even_without_ha_metadata():
    """Found by the live dry run: with no category/name from HA, the valve's
    `…_irrigation_plan_enabled_1` ends in `_1` like zone 1 does. Only the part
    after the device's shared prefix may be the channel token."""
    rows, _ = _valve_group()
    out = D.detect_channels(rows, f"switch.{VALVE}_1", {}, "מים לגינון", z2m={})
    assert [c["entity_id"] for c in out] == [f"switch.{VALVE}_1", f"switch.{VALVE}_2"]


def test_object_id_fallback_on_a_wall_switch():
    rows = [_row("switch.hall_l1"), _row("switch.hall_l2"), _row("switch.hall_backlight"), _row("sensor.hall_power")]
    out = D.detect_channels(rows, "switch.hall_l1", {}, "Hall", z2m={})
    assert [(c["channel"], c["name"]) for c in out] == [("1", "Hall 1"), ("2", "Hall 2")]


def test_primary_must_be_a_channel():
    """A light whose two config switches happen to be numbered is not a 2-channel light."""
    rows = [_row("light.x"), _row("switch.x_1"), _row("switch.x_2")]
    assert D.detect_channels(rows, "light.x", {}, "X", z2m={}) == []


def test_categorised_numbered_switches_are_settings():
    rows = [_row("switch.v_1"), _row("switch.v_irrigation_plan_enabled_1")]
    by_entity = {"switch.v_1": _meta(orig="1"),
                 "switch.v_irrigation_plan_enabled_1": _meta(cat="config", orig="Irrigation plan enabled 1")}
    assert D.detect_channels(rows, "switch.v_1", by_entity, "V", z2m={}) == []


def test_duplicate_channel_tokens_are_ambiguous():
    rows = [_row("switch.a_1"), _row("switch.b_channel_1")]
    assert D.detect_channels(rows, "switch.a_1", {}, "X", z2m={}) == []


def test_build_groups_adds_channels_and_never_breaks(monkeypatch):
    from services import device_groups as G
    rows, by_entity = _valve_group()
    for r in rows:
        r.update({"ha_state": "off", "ha_attributes": {}, "status": "connected"})
    reg = {"by_entity": {k: {**v, "device_id": "dev1"} for k, v in by_entity.items()},
           "device_names": {"dev1": "מים לגינון"}, "canonical_id": {}}
    monkeypatch.setattr(D, "_z2m", D.parse_z2m_channels(BRIDGE))
    groups = G.build_groups(rows, reg)
    valve = [g for g in groups if g["primary_entity_id"] == f"switch.{VALVE}_1"]
    assert valve and [c["channel"] for c in valve[0]["channels"]] == ["1", "2"]

    def boom(*a, **k):
        raise RuntimeError("detector bug")
    monkeypatch.setattr(D, "detect_channels", boom)
    groups = G.build_groups(rows, reg)
    assert all(g["channels"] == [] for g in groups), "a detector failure must degrade to no channels"
