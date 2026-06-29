"""
Cross-check Tadiran decoder against the arikfe/IRTadiran public reference.

Provenance: https://github.com/arikfe/IRTadiran — Sming/Arduino implementation
based on real Israeli Tadiran captures. The arikfe protocol structure is:

    code[0]: 0x01                          (fixed header)
    code[1]: (fan << 4) | mode             (fan upper nibble, mode lower)
    code[2]: temp * 2                      (e.g. 24°C → 0x30)
    code[3]: 0x00
    code[4]: 0x00
    code[5]: power                         (0x30 = on, 0xc0 = off)
    code[6]: swing                         (0xc0 in top bits when active)
    code[7]: sum(0..6)
             - (0x0f * (3 + temp/8) + fan * 0x0f + (swing ? 0xb4 : 0))

These tests document, with verifiable evidence, exactly which parts of the
arikfe reference match the user's specific Tadiran inverter (captures from
2026-05-23) and which parts diverge. The conclusion is that our unit is a
SIBLING sub-model, NOT identical:

  - byte 0 fixed header, byte 1 nibble layout: MATCHES arikfe
  - byte 2 = temp*2: DOES NOT MATCH (our unit uses byte 2 bit 1 for power)
  - byte 5 = power: DOES NOT MATCH (our unit uses byte 5 for temp encoding)
  - arikfe checksum formula: matches 2/3 captures (off→on transitions), fails
    on the C2→C3 temp change

Our decoder takes the locally-validated layout (byte 2 bit 1 = power,
byte 5/6 = temp two-bit-window) as authoritative, since it's grounded in
real captures from the user's actual hardware.

These tests are NOT a substitute for real-life validation. They lock down
what we currently know and would fail loudly if a future change drifted
from the validated bit positions.
"""
from __future__ import annotations

from services.ir_protocol import (
    _decode_tadiran_ac_state,
    _TADIRAN_TENTATIVE_FAN_MAP,
    _TADIRAN_TENTATIVE_MODE_MAP,
)


# The three pinned real captures (Tadiran inverter, 2026-05-23, user's home).
# These are the load-bearing ground truth for the entire Tadiran decoder.
CAP_OFF_24_COOL = bytes.fromhex("014130000030000c")
CAP_ON_24_COOL  = bytes.fromhex("014132000030000e")
CAP_ON_25_COOL  = bytes.fromhex("0141320000c00017")


def _arikfe_expected_checksum(payload: bytes, *, temp: int, fan: int, swing: bool) -> int:
    """Replicate arikfe's checksum formula. Public reference."""
    s = sum(payload[:7])
    return (s - (0x0f * (3 + temp // 8) + fan * 0x0f + (0xb4 if swing else 0))) & 0xFF


# ---------------------------------------------------------------------------
# Structural agreement with arikfe (the parts that MATCH)
# ---------------------------------------------------------------------------

class TestArikfeStructuralMatch:
    """The parts of arikfe's layout that survive on our unit."""

    def test_byte_0_is_fixed_header_0x01(self):
        for cap in (CAP_OFF_24_COOL, CAP_ON_24_COOL, CAP_ON_25_COOL):
            assert cap[0] == 0x01

    def test_byte_1_is_invariant_across_same_mode_and_fan(self):
        """All 3 captures were in cool mode with auto fan. Byte 1 must be
        identical across them — which it is, locking in arikfe's claim that
        byte 1 carries fan + mode (and only those)."""
        b1s = {cap[1] for cap in (CAP_OFF_24_COOL, CAP_ON_24_COOL, CAP_ON_25_COOL)}
        assert b1s == {0x41}

    def test_byte_1_lower_nibble_is_mode_cool(self):
        """arikfe map: 1 = cool. Our captures: byte 1 lower nibble = 1.
        Consistent. (We can't validate other modes without new captures.)"""
        mode_nibble = CAP_ON_25_COOL[1] & 0x0F
        assert mode_nibble == 0x1
        assert _TADIRAN_TENTATIVE_MODE_MAP[mode_nibble] == "cool"

    def test_byte_1_upper_nibble_maps_to_auto_fan(self):
        """Our captures: byte 1 upper nibble = 4. Tentative map: 4 = auto."""
        fan_nibble = (CAP_ON_25_COOL[1] >> 4) & 0x0F
        assert fan_nibble == 0x4
        assert _TADIRAN_TENTATIVE_FAN_MAP[fan_nibble] == "auto"


# ---------------------------------------------------------------------------
# Structural divergence from arikfe (the parts that DO NOT MATCH)
# ---------------------------------------------------------------------------

class TestArikfeStructuralDivergence:
    """The parts where our unit diverges from arikfe. These tests are
    deliberately phrased as 'arikfe would say X, our unit actually has Y'.
    They lock in the divergence so a future change to match arikfe blindly
    would fail loud."""

    def test_byte_2_is_power_not_temp(self):
        """arikfe: byte 2 = temp * 2. Our unit: byte 2 bit 1 is power; the
        rest of byte 2 is invariant within a mode/fan/temp configuration.

        Evidence: between C1 (off @ 24°C) and C2 (on @ 24°C), the only
        physical press was power-on. byte 2 changed 0x30 → 0x32, which is
        bit 1 flipping. If arikfe were right, byte 2 should reflect
        temperature, but temp didn't change — power did. Conclusion: byte 2
        bit 1 = power for our sub-model.
        """
        # C1 vs C2: only the power bit flips
        diff = CAP_OFF_24_COOL[2] ^ CAP_ON_24_COOL[2]
        assert diff == 0x02  # bit 1 only
        # And C2 vs C3 (temp 24 → 25): byte 2 is UNCHANGED
        assert CAP_ON_24_COOL[2] == CAP_ON_25_COOL[2]

    def test_byte_5_is_temp_not_power(self):
        """arikfe: byte 5 = power (0x30 = on, 0xc0 = off). Our unit:
        byte 5 carries the temp 2-bit window (0x30 = 24°C, 0xc0 = 25°C).

        Evidence: between C2 (on @ 24°C) and C3 (on @ 25°C), the only press
        was TEMP+. byte 5 changed 0x30 → 0xc0 — far more than a single-bit
        toggle. If arikfe were right, byte 5 should reflect power, but power
        didn't change — temp did. Conclusion: byte 5 carries temp for our
        sub-model.
        """
        assert CAP_ON_24_COOL[5] != CAP_ON_25_COOL[5]
        # AND: arikfe would interpret byte 5 = 0xc0 in C3 as "off". Our pin
        # says C3 is "on". So arikfe's byte 5 interpretation is inverted /
        # absent for this unit.


# ---------------------------------------------------------------------------
# arikfe checksum cross-check — 2/3 captures match
# ---------------------------------------------------------------------------

class TestArikfeChecksum:
    """The arikfe checksum formula. Pinning the partial-match result so we
    have an honest record of what does and doesn't transfer."""

    def test_off_24c_matches_arikfe_checksum(self):
        actual = CAP_OFF_24_COOL[7]
        expected = _arikfe_expected_checksum(
            CAP_OFF_24_COOL, temp=24, fan=4, swing=False,
        )
        assert actual == expected == 0x0c

    def test_on_24c_matches_arikfe_checksum(self):
        actual = CAP_ON_24_COOL[7]
        expected = _arikfe_expected_checksum(
            CAP_ON_24_COOL, temp=24, fan=4, swing=False,
        )
        assert actual == expected == 0x0e

    def test_on_25c_FAILS_arikfe_checksum(self):
        """The smoking-gun divergence. arikfe's formula predicts 0x9e for
        C3 but the real capture has 0x17. This is what proves our unit is
        a sub-model and not arikfe's exact target.

        If a future port "fixes" the decoder to satisfy this formula, it
        will silently corrupt state extraction on the user's actual unit.
        Keep this test as a tripwire."""
        actual = CAP_ON_25_COOL[7]
        arikfe_predicts = _arikfe_expected_checksum(
            CAP_ON_25_COOL, temp=25, fan=4, swing=False,
        )
        assert actual == 0x17
        assert arikfe_predicts == 0x9e
        assert actual != arikfe_predicts


# ---------------------------------------------------------------------------
# Decoder integration — the tentative mode/fan extraction works
# ---------------------------------------------------------------------------

class TestDecoderWithArikfeTentativeMaps:
    """Verify the decoder now surfaces mode + fan for the byte 1 = 0x41 case.
    These were None before the arikfe cross-check; with the tentative maps
    they read as cool + auto, consistent with the capture-time AC config."""

    def test_off_24c_surfaces_cool_auto(self):
        s = _decode_tadiran_ac_state(CAP_OFF_24_COOL)
        assert s is not None
        assert s.power == "off"
        assert s.temp == 24
        assert s.mode == "cool"   # was None pre-arikfe — now tentative
        assert s.fan == "auto"    # was None pre-arikfe — now tentative
        assert s.brand == "tadiran"

    def test_on_24c_surfaces_cool_auto(self):
        s = _decode_tadiran_ac_state(CAP_ON_24_COOL)
        assert s.power == "on"
        assert s.temp == 24
        assert s.mode == "cool"
        assert s.fan == "auto"

    def test_on_25c_surfaces_cool_auto(self):
        s = _decode_tadiran_ac_state(CAP_ON_25_COOL)
        assert s.power == "on"
        assert s.temp == 25
        assert s.mode == "cool"
        assert s.fan == "auto"


# ---------------------------------------------------------------------------
# Documented open questions — real-hardware captures needed
# ---------------------------------------------------------------------------

class TestOpenQuestions:
    """Tests that DOCUMENT what we don't know yet. They pass trivially but
    serve as a checklist for the next real-hardware capture session."""

    def test_mode_change_capture_needed(self):
        """Need: press MODE on the Tadiran remote enough times to cycle
        through heat/fan/auto/dry. Compare byte 1 nibble across captures.
        Expected (per arikfe): cool=1, heat=4, fan=3, auto=0, dry=2.
        If observed nibbles match, promote map confidence from tentative
        to validated."""
        pass  # placeholder — pending real captures

    def test_fan_change_capture_needed(self):
        """Need: press FAN on the Tadiran remote to step through speeds.
        Compare byte 1 upper nibble. Expected (per arikfe): auto=0,
        low=1, med=2, high=3. Our captures all have 4 which arikfe
        doesn't enumerate — likely a Tadiran-specific 'auto-mode' marker."""
        pass

    def test_swing_change_capture_needed(self):
        """Need: press SWING on the Tadiran remote. Compare byte 6.
        Expected (per arikfe): bits 6-7 set = on, clear = off."""
        pass

    def test_low_and_high_temp_captures_needed(self):
        """Need: captures at 16-23°C and 26-30°C to verify the byte 5/6
        two-bit sliding pattern extrapolation. Currently only 24°C and
        25°C are validated."""
        pass
