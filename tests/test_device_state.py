"""
Tests for the universal device-state engine.

Covers:
  - Templates exist with sensible defaults and Israel-first values
  - Mutations apply correctly for set / toggle / incr / decr / cycle
  - Clamping respects field min/max and enum values
  - Decoded full-state replaces fields cleanly (the AC stateful-protocol path)
  - Confidence banding matches the live/estimated/stale boundaries
  - State records round-trip through update_state_from_button correctly
"""
from __future__ import annotations

import time

import pytest

from services.device_state import (
    LIVE_WINDOW_S, STALE_WINDOW_S,
    Mutation, StateField,
    apply_button_press, apply_decoded_full_state,
    confidence_band, merged_confidence,
    get_template, list_templates, make_state_record,
    state_with_confidence,
    update_state_from_button, update_state_from_decoded,
)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

class TestBuiltinTemplates:
    def test_ac_template_israel_first_defaults(self):
        ac = get_template("ac")
        assert ac is not None
        defaults = ac.make_initial_state()
        assert defaults["mode"] == "cool"   # Israel-first dominant mode
        assert defaults["temp"] == 24       # Israeli industry standard
        assert defaults["fan"] == "auto"
        assert defaults["power"] is False

    def test_tv_template_has_volume_and_input(self):
        tv = get_template("tv")
        assert tv is not None
        defaults = tv.make_initial_state()
        assert "volume" in defaults and "input" in defaults and "muted" in defaults
        assert defaults["volume"] == 30

    def test_streamer_template(self):
        s = get_template("streamer")
        assert s is not None
        assert "playing" in s.make_initial_state()

    def test_soundbar_template(self):
        s = get_template("soundbar")
        assert s is not None
        assert "volume" in s.make_initial_state()

    def test_stb_template(self):
        s = get_template("stb")
        assert s is not None
        assert "channel" in s.make_initial_state()

    def test_fan_template(self):
        f = get_template("fan")
        assert f is not None
        assert "speed" in f.make_initial_state()
        assert "swing" in f.make_initial_state()

    def test_custom_template_minimal(self):
        c = get_template("custom")
        assert c is not None
        # Custom intentionally has just power so any wizard-trained device fits.
        assert list(c.schema.keys()) == ["power"]

    def test_unknown_template_returns_none(self):
        assert get_template("nonexistent") is None
        assert get_template("") is None

    def test_list_templates_covers_all_builtins(self):
        tpls = list_templates()
        ids = {t["id"] for t in tpls}
        assert {"ac", "tv", "streamer", "soundbar", "stb", "fan", "custom"} <= ids


# ---------------------------------------------------------------------------
# Field clamping
# ---------------------------------------------------------------------------

class TestStateFieldClamp:
    def test_int_clamp_respects_bounds(self):
        f = StateField("temp", "int", 24, min=16, max=30)
        assert f.clamp(20) == 20
        assert f.clamp(50) == 30
        assert f.clamp(10) == 16
        assert f.clamp(None) == 24      # default

    def test_int_clamp_coerces_strings(self):
        f = StateField("temp", "int", 24, min=16, max=30)
        assert f.clamp("25") == 25
        assert f.clamp("not-a-number") == 24

    def test_enum_clamp_rejects_out_of_set(self):
        f = StateField("mode", "enum", "cool", values=["cool", "heat", "fan"])
        assert f.clamp("heat") == "heat"
        assert f.clamp("sport") == "cool"   # unknown value -> default

    def test_bool_clamp(self):
        f = StateField("power", "bool", False)
        assert f.clamp(True) is True
        assert f.clamp(0) is False
        assert f.clamp("yes") is True       # truthy string


# ---------------------------------------------------------------------------
# Mutations
# ---------------------------------------------------------------------------

class TestMutations:
    def test_set_overrides_value(self):
        ac = get_template("ac")
        state = ac.make_initial_state()
        out = apply_button_press(state, ac, "mode_heat")
        assert out["mode"] == "heat"
        assert out["power"] is True   # mode_heat implicitly turns AC on

    def test_toggle_flips_bool(self):
        tv = get_template("tv")
        state = tv.make_initial_state()
        out = apply_button_press(state, tv, "mute")
        assert out["muted"] is True
        out2 = apply_button_press(out, tv, "mute")
        assert out2["muted"] is False

    def test_incr_clamps_to_max(self):
        tv = get_template("tv")
        state = tv.make_initial_state()
        state["volume"] = 99
        out = apply_button_press(state, tv, "vol_up")
        assert out["volume"] == 100

    def test_decr_clamps_to_min(self):
        tv = get_template("tv")
        state = tv.make_initial_state()
        state["volume"] = 1
        out = apply_button_press(state, tv, "vol_down")
        assert out["volume"] == 0

    def test_compound_vol_up_unmutes(self):
        tv = get_template("tv")
        state = tv.make_initial_state()
        state["muted"] = True
        out = apply_button_press(state, tv, "vol_up")
        assert out["muted"] is False
        assert out["volume"] == 32

    def test_temp_buttons_for_ac(self):
        ac = get_template("ac")
        state = ac.make_initial_state()
        out = apply_button_press(state, ac, "temp_27")
        assert out["temp"] == 27

    def test_temp_up_clamps_at_30(self):
        ac = get_template("ac")
        state = ac.make_initial_state()
        state["temp"] = 30
        out = apply_button_press(state, ac, "temp_up")
        assert out["temp"] == 30

    def test_unknown_button_is_noop(self):
        ac = get_template("ac")
        state = ac.make_initial_state()
        out = apply_button_press(state, ac, "definitely_not_a_real_button")
        assert out == state

    def test_streamer_play_pause_toggles(self):
        s = get_template("streamer")
        state = s.make_initial_state()
        out = apply_button_press(state, s, "play_pause")
        assert out["playing"] is True
        out2 = apply_button_press(out, s, "play_pause")
        assert out2["playing"] is False

    def test_streamer_home_resets_to_home(self):
        s = get_template("streamer")
        state = s.make_initial_state()
        state["app"] = "netflix"
        state["playing"] = True
        out = apply_button_press(state, s, "home")
        assert out["app"] == "home"
        assert out["playing"] is False


# ---------------------------------------------------------------------------
# Decoded full-state replace
# ---------------------------------------------------------------------------

class TestDecodedFullState:
    def test_ac_decoded_state_replaces(self):
        ac = get_template("ac")
        state = ac.make_initial_state()
        state["temp"] = 22
        state["power"] = False
        decoded = {"power": True, "mode": "cool", "temp": 25, "fan": "high"}
        out = apply_decoded_full_state(state, ac, decoded)
        assert out["power"] is True
        assert out["mode"] == "cool"
        assert out["temp"] == 25
        assert out["fan"] == "high"
        # Swing was not in decoded, so it stays unchanged
        assert out["swing"] is False

    def test_decoded_state_ignores_unknown_fields(self):
        ac = get_template("ac")
        state = ac.make_initial_state()
        decoded = {"temp": 26, "random_field": "ignored"}
        out = apply_decoded_full_state(state, ac, decoded)
        assert out["temp"] == 26
        assert "random_field" not in out

    def test_decoded_state_clamps_invalid_values(self):
        ac = get_template("ac")
        state = ac.make_initial_state()
        # Bad temp value from a buggy decoder shouldn't poison state
        decoded = {"temp": 999}
        out = apply_decoded_full_state(state, ac, decoded)
        assert out["temp"] == 30


# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------

class TestConfidence:
    def test_no_observation_is_unknown(self):
        assert confidence_band(None) == "unknown"

    def test_recent_observation_is_live(self):
        now = 1_000_000.0
        assert confidence_band(now - 1, now=now) == "live"
        assert confidence_band(now - LIVE_WINDOW_S, now=now) == "live"

    def test_old_observation_is_estimated(self):
        now = 1_000_000.0
        assert confidence_band(now - LIVE_WINDOW_S - 1, now=now) == "estimated"
        assert confidence_band(now - 1000, now=now) == "estimated"

    def test_very_old_observation_is_stale(self):
        now = 1_000_000.0
        assert confidence_band(now - STALE_WINDOW_S - 1, now=now) == "stale"

    def test_merged_picks_live_when_rx_recent(self):
        now = 1_000_000.0
        band, age = merged_confidence(now - 5, now - 60, now=now)
        assert band == "live"
        assert age == pytest.approx(5)

    def test_merged_picks_estimated_when_no_recent_rx(self):
        now = 1_000_000.0
        band, age = merged_confidence(None, now - 60, now=now)
        assert band == "estimated"
        assert age == pytest.approx(60)

    def test_merged_estimated_does_not_promote_to_live(self):
        # Even if the Ziggy-side timestamp is very recent, that's "estimated".
        # Only RX-confirmed observations earn the "live" badge.
        now = 1_000_000.0
        band, _ = merged_confidence(None, now - 1, now=now)
        assert band == "estimated"


# ---------------------------------------------------------------------------
# State record round-trips
# ---------------------------------------------------------------------------

class TestStateRecord:
    def test_make_record_uses_template_defaults(self):
        ac = get_template("ac")
        rec = make_state_record(ac)
        assert rec["template"] == "ac"
        assert rec["values"]["temp"] == 24
        assert rec["live_at"] is None
        assert rec["estimated_at"] is None

    def test_update_from_button_estimated_sets_estimated_at(self):
        ac = get_template("ac")
        rec = make_state_record(ac)
        out = update_state_from_button(rec, ac, "mode_heat", source="estimated")
        assert out["values"]["mode"] == "heat"
        assert out["values"]["power"] is True
        assert out["estimated_at"] is not None
        assert out["live_at"] is None

    def test_update_from_button_live_sets_live_at(self):
        ac = get_template("ac")
        rec = make_state_record(ac)
        out = update_state_from_button(rec, ac, "power_on", source="live")
        assert out["values"]["power"] is True
        assert out["live_at"] is not None
        assert out["estimated_at"] is None

    def test_update_from_decoded_always_live(self):
        ac = get_template("ac")
        rec = make_state_record(ac)
        out = update_state_from_decoded(rec, ac, {"power": True, "temp": 26})
        assert out["values"]["temp"] == 26
        assert out["live_at"] is not None

    def test_state_with_confidence_live_after_recent_decode(self):
        ac = get_template("ac")
        rec = make_state_record(ac)
        rec = update_state_from_decoded(rec, ac, {"power": True, "temp": 25})
        snap = state_with_confidence(rec)
        assert snap["confidence"] == "live"
        assert snap["values"]["temp"] == 25
        assert snap["age_seconds"] is not None and snap["age_seconds"] < 1

    def test_state_with_confidence_estimated_after_command_only(self):
        ac = get_template("ac")
        rec = make_state_record(ac)
        rec = update_state_from_button(rec, ac, "mode_heat", source="estimated")
        snap = state_with_confidence(rec)
        # No live observation — even though the command just happened, it's
        # estimated until the receiver hears something.
        assert snap["confidence"] == "estimated"

    def test_state_with_confidence_unknown_at_cold_start(self):
        ac = get_template("ac")
        rec = make_state_record(ac)
        snap = state_with_confidence(rec)
        assert snap["confidence"] == "unknown"
