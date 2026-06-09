"""
Tests for the legacy <-> universal-state-engine compat shim.

These pin the migration contract: existing AC devices must continue to read
assumed_state/ac_memory consistently while the new `device["state"]` field
becomes the source of truth.
"""
from __future__ import annotations

import time

from services.device_state_compat import (
    ac_state_to_dict,
    apply_button,
    apply_decoded_state,
    ensure_state,
    initial_state_from_legacy,
    mirror_state_to_legacy,
    state_snapshot,
    template_for_device_type,
)


# ---------------------------------------------------------------------------
# Template selection
# ---------------------------------------------------------------------------

class TestTemplateLookup:
    def test_ac_type_maps_to_ac_template(self):
        assert template_for_device_type("ac").id == "ac"

    def test_tv_type_maps_to_tv_template(self):
        assert template_for_device_type("tv").id == "tv"

    def test_legacy_settopbox_aliased_to_stb(self):
        assert template_for_device_type("settopbox").id == "stb"

    def test_unknown_type_falls_back_to_custom(self):
        assert template_for_device_type("microwave").id == "custom"

    def test_none_type_falls_back_to_custom(self):
        assert template_for_device_type(None).id == "custom"


# ---------------------------------------------------------------------------
# Migration from legacy fields
# ---------------------------------------------------------------------------

class TestInitialStateFromLegacy:
    def test_ac_legacy_record_promotes_assumed_state_to_power(self):
        device = {
            "type": "ac",
            "assumed_state": "on",
            "ac_memory": {"mode": "cool", "temp": 25, "fan": "low"},
        }
        rec = initial_state_from_legacy(device)
        assert rec["template"] == "ac"
        assert rec["values"]["power"] is True
        assert rec["values"]["mode"] == "cool"
        assert rec["values"]["temp"] == 25
        assert rec["values"]["fan"] == "low"

    def test_ac_legacy_off_state(self):
        device = {"type": "ac", "assumed_state": "off", "ac_memory": {"temp": 22}}
        rec = initial_state_from_legacy(device)
        assert rec["values"]["power"] is False
        assert rec["values"]["temp"] == 22

    def test_ac_unknown_state_uses_default_power(self):
        device = {"type": "ac", "assumed_state": "unknown", "ac_memory": {}}
        rec = initial_state_from_legacy(device)
        # Default for AC is power=False per Israel-first defaults
        assert rec["values"]["power"] is False
        assert rec["values"]["mode"] == "cool"
        assert rec["values"]["temp"] == 24

    def test_tv_legacy_record(self):
        device = {"type": "tv", "assumed_state": "on"}
        rec = initial_state_from_legacy(device)
        assert rec["template"] == "tv"
        assert rec["values"]["power"] is True
        assert rec["values"]["volume"] == 30   # TV template default

    def test_legacy_timestamp_promoted_to_estimated_at(self):
        device = {
            "type": "ac",
            "assumed_state": "on",
            "assumed_state_at": "2026-05-23 18:30:00",
        }
        rec = initial_state_from_legacy(device)
        assert rec["estimated_at"] is not None
        assert rec["live_at"] is None   # legacy history is never live-confirmed

    def test_legacy_temp_out_of_range_gets_clamped(self):
        # A corrupt ac_memory shouldn't poison the new state record.
        device = {
            "type": "ac",
            "assumed_state": "on",
            "ac_memory": {"temp": 999, "mode": "sport"},
        }
        rec = initial_state_from_legacy(device)
        assert rec["values"]["temp"] == 30           # clamped to max
        assert rec["values"]["mode"] == "cool"       # invalid enum → default


# ---------------------------------------------------------------------------
# Idempotency — ensure_state safe to call repeatedly
# ---------------------------------------------------------------------------

class TestEnsureState:
    def test_first_call_creates_state(self):
        device = {"id": "x", "type": "ac", "assumed_state": "off"}
        ensure_state(device)
        assert "state" in device
        assert device["state"]["values"]["power"] is False

    def test_idempotent(self):
        device = {"id": "x", "type": "ac", "assumed_state": "off"}
        ensure_state(device)
        ensure_state(device)["state"]["values"]["temp"] = 28
        ensure_state(device)
        # Second call must NOT overwrite the mutation
        assert device["state"]["values"]["temp"] == 28

    def test_corrupt_state_dict_gets_repaired(self):
        # Engine-touched but template id missing — fix the record
        device = {
            "id": "x", "type": "tv",
            "state": {"values": {"power": True}},
        }
        ensure_state(device)
        assert device["state"]["template"] == "tv"


# ---------------------------------------------------------------------------
# Button application + legacy mirroring
# ---------------------------------------------------------------------------

class TestApplyButton:
    def test_power_on_writes_legacy_assumed_state(self):
        device = {"id": "x", "type": "ac"}
        apply_button(device, "power_on", source="estimated")
        assert device["state"]["values"]["power"] is True
        assert device["assumed_state"] == "on"            # legacy mirror
        assert device["state"]["estimated_at"] is not None

    def test_power_off_writes_legacy(self):
        device = {"id": "x", "type": "ac", "assumed_state": "on"}
        apply_button(device, "power_off", source="estimated")
        assert device["state"]["values"]["power"] is False
        assert device["assumed_state"] == "off"

    def test_ac_temp_mutates_legacy_ac_memory(self):
        device = {"id": "x", "type": "ac"}
        apply_button(device, "temp_27", source="estimated")
        assert device["state"]["values"]["temp"] == 27
        assert device["ac_memory"]["temp"] == 27          # legacy mirror

    def test_tv_volume_does_not_touch_ac_memory(self):
        device = {"id": "x", "type": "tv"}
        apply_button(device, "vol_up", source="estimated")
        assert device["state"]["values"]["volume"] == 32
        # No ac_memory field added for TV — only AC-like fields mirror
        assert "ac_memory" not in device or not device["ac_memory"].get("temp")

    def test_live_source_sets_live_at(self):
        device = {"id": "x", "type": "ac"}
        apply_button(device, "power_on", source="live")
        assert device["state"]["live_at"] is not None
        assert device["state"]["estimated_at"] is None


class TestApplyDecodedState:
    def test_full_state_replace_is_live(self):
        device = {"id": "x", "type": "ac"}
        before = time.time()
        apply_decoded_state(device, {"power": True, "mode": "cool", "temp": 26, "fan": "high"})
        assert device["state"]["values"]["power"] is True
        assert device["state"]["values"]["temp"] == 26
        assert device["state"]["live_at"] is not None
        assert device["state"]["live_at"] >= before

    def test_mirrors_to_legacy_after_decoded(self):
        device = {"id": "x", "type": "ac", "assumed_state": "off"}
        apply_decoded_state(device, {"power": True, "temp": 25, "mode": "cool", "fan": "auto"})
        assert device["assumed_state"] == "on"
        assert device["ac_memory"]["temp"] == 25
        assert device["ac_memory"]["mode"] == "cool"


# ---------------------------------------------------------------------------
# AcState → dict adapter
# ---------------------------------------------------------------------------

class TestAcStateAdapter:
    def test_none_returns_empty(self):
        assert ac_state_to_dict(None) == {}

    def test_string_power_normalized(self):
        class S:
            power = "on"; mode = "cool"; temp = 24; fan = None
        d = ac_state_to_dict(S())
        assert d["power"] is True
        assert d["mode"] == "cool"
        assert d["temp"] == 24
        assert "fan" not in d   # None fields dropped

    def test_drops_unknown_attributes(self):
        class S:
            power = "off"; mode = None; temp = None; fan = None
            extra_field = "ignored"
        d = ac_state_to_dict(S())
        assert d == {"power": False}


# ---------------------------------------------------------------------------
# Snapshot — what the UI sees
# ---------------------------------------------------------------------------

class TestSnapshot:
    def test_snapshot_includes_confidence(self):
        device = {"id": "x", "type": "ac"}
        apply_decoded_state(device, {"power": True, "temp": 25, "mode": "cool", "fan": "auto"})
        snap = state_snapshot(device)
        assert snap["confidence"] == "live"
        assert snap["values"]["power"] is True
        assert snap["template"] == "ac"

    def test_snapshot_unknown_before_any_observation(self):
        device = {"id": "x", "type": "tv"}
        snap = state_snapshot(device)
        assert snap["confidence"] == "unknown"
        assert snap["template"] == "tv"
