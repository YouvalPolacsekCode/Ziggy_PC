"""
Tests for the Toshiba (Electra) and Midea (Tornado) AC decoders.

These pin the decoders against synthetic test vectors built from the
documented bit layouts. Real-hardware validation happens during beta —
when an actual Electra/Tornado capture lands, that goes in as a pinned
real-capture test alongside the synthetic ones (matching the pattern
established by the Tadiran captures in test_ir_protocol.py).

Until real captures arrive, treat these decoders as 'identifies the
family correctly + extracts canonical payload_hex for matching' rather
than 'every state bit is gospel'. The state-extraction tests pin
specific bit positions per the documented IRremoteESP8266 reference;
sub-protocol drift in real units will show up as mode/fan mismatches
that we fix from the field captures.
"""
from __future__ import annotations

import pytest

from services.ir_protocol import (
    decode_protocol,
    _encode_toshiba_pulses,
    _encode_midea_pulses,
)


# ---------------------------------------------------------------------------
# Toshiba (Electra internals)
# ---------------------------------------------------------------------------

class TestToshibaDecoder:
    def test_canonical_toshiba_state_frame_identifies_family(self):
        # Canonical Toshiba RAS state frame: signature 0xF2 0x0D, length 0x03,
        # temp byte = 0x70 (T-17 = 7 → 24°C), mode/fan byte = 0x21
        # (mode bits 001 = cool, fan bits 001 = low — varies by sub-family).
        payload = bytes([0xF2, 0x0D, 0x03, 0x00, 0x00, 0x70, 0x21, 0x00, 0x21])
        pulses = _encode_toshiba_pulses(payload)
        result = decode_protocol(pulses)
        assert result is not None
        assert result.family == "toshiba_ac"
        assert result.payload_hex == payload.hex()

    def test_toshiba_state_extracts_temp(self):
        # T - 17 = 7, so b5 = 0x70 → 24°C
        payload = bytes([0xF2, 0x0D, 0x03, 0x00, 0x00, 0x70, 0x21, 0x00, 0x21])
        result = decode_protocol(_encode_toshiba_pulses(payload))
        assert result.ac_state is not None
        assert result.ac_state.temp == 24
        assert result.ac_state.brand == "toshiba"

    def test_toshiba_state_extracts_mode_cool(self):
        # Mode bits 001 in upper nibble of byte 6 = 0x20 → cool
        payload = bytes([0xF2, 0x0D, 0x03, 0x00, 0x00, 0x70, 0x20, 0x00, 0x00])
        result = decode_protocol(_encode_toshiba_pulses(payload))
        assert result.ac_state.mode == "cool"

    def test_toshiba_state_extracts_mode_heat(self):
        # Mode bits 011 = 0x60 → heat
        payload = bytes([0xF2, 0x0D, 0x03, 0x00, 0x00, 0x70, 0x60, 0x00, 0x00])
        result = decode_protocol(_encode_toshiba_pulses(payload))
        assert result.ac_state.mode == "heat"

    def test_toshiba_state_power_inferred_on_for_state_frame(self):
        # Toshiba encodes power-off as a separate short frame; state frames
        # always imply power=on.
        payload = bytes([0xF2, 0x0D, 0x03, 0x00, 0x00, 0x70, 0x20, 0x00, 0x00])
        result = decode_protocol(_encode_toshiba_pulses(payload))
        assert result.ac_state.power == "on"

    def test_toshiba_rejects_non_toshiba_magic(self):
        # Same leader timing, but wrong magic — must NOT claim toshiba_ac
        payload = bytes([0x00, 0x00, 0x03, 0x00, 0x00, 0x70, 0x20, 0x00, 0x00])
        result = decode_protocol(_encode_toshiba_pulses(payload))
        # Could be None (no decoder claims) or another family — must not be toshiba
        if result is not None:
            assert result.family != "toshiba_ac"

    def test_toshiba_max_temp(self):
        # T - 17 = 13 → 30°C (documented max)
        payload = bytes([0xF2, 0x0D, 0x03, 0x00, 0x00, 0xD0, 0x20, 0x00, 0x00])
        result = decode_protocol(_encode_toshiba_pulses(payload))
        assert result.ac_state.temp == 30


# ---------------------------------------------------------------------------
# Midea (Tornado internals)
# ---------------------------------------------------------------------------

class TestMideaDecoder:
    def test_midea_state_frame_identifies_family(self):
        # Midea state command (byte 0 = 0xB2), byte 1 = ~B2, byte 2 = fan/auto,
        # byte 3 = ~byte2, byte 4 = mode+temp+power, byte 5 = ~byte4.
        # Build: cool mode (0), temp 24 (T-17 = 7), power on (bit 4 set).
        b4 = 0x17     # mode 000 + power bit 4 set + temp lower nibble 0x07
        b2 = 0x7F     # fan auto (7) in bits 5-7, low nibble all 1 per docs
        payload = bytes([0xB2, 0xB2 ^ 0xFF, b2, b2 ^ 0xFF, b4, b4 ^ 0xFF])
        result = decode_protocol(_encode_midea_pulses(payload))
        assert result is not None
        assert result.family == "midea_ac"

    def test_midea_extracts_power_on(self):
        b4 = 0x17     # bit 4 set = power on, temp = 24
        b2 = 0x7F
        payload = bytes([0xB2, 0xB2 ^ 0xFF, b2, b2 ^ 0xFF, b4, b4 ^ 0xFF])
        result = decode_protocol(_encode_midea_pulses(payload))
        assert result.ac_state.power == "on"

    def test_midea_extracts_temp(self):
        # temp lower nibble = 7 → 24°C
        b4 = 0x17
        b2 = 0x7F
        payload = bytes([0xB2, 0xB2 ^ 0xFF, b2, b2 ^ 0xFF, b4, b4 ^ 0xFF])
        result = decode_protocol(_encode_midea_pulses(payload))
        assert result.ac_state.temp == 24

    def test_midea_rejects_invalid_inverse_pair(self):
        # If byte 1 is NOT the inverse of byte 0, decoder must reject.
        b4 = 0x17
        b2 = 0x7F
        payload = bytes([0xB2, 0xFF, b2, b2 ^ 0xFF, b4, b4 ^ 0xFF])
        result = decode_protocol(_encode_midea_pulses(payload))
        # Either None or a non-midea family
        if result is not None:
            assert result.family != "midea_ac"

    def test_midea_rejects_wrong_command_class(self):
        # Byte 0 must be 0xB? (Midea command class). Non-Midea byte 0 rejected.
        b4 = 0x17
        b2 = 0x7F
        payload = bytes([0x42, 0x42 ^ 0xFF, b2, b2 ^ 0xFF, b4, b4 ^ 0xFF])
        result = decode_protocol(_encode_midea_pulses(payload))
        if result is not None:
            assert result.family != "midea_ac"

    def test_midea_payload_round_trip(self):
        # Two captures of the same logical button → same payload_hex
        b4 = 0x37     # mode bits change but inverse pair still valid
        b2 = 0x7F
        payload = bytes([0xB2, 0xB2 ^ 0xFF, b2, b2 ^ 0xFF, b4, b4 ^ 0xFF])
        a = decode_protocol(_encode_midea_pulses(payload))
        b = decode_protocol(_encode_midea_pulses(payload))
        assert a.payload_hex == b.payload_hex


# ---------------------------------------------------------------------------
# Cascade integration — the new decoders coexist with existing ones
# ---------------------------------------------------------------------------

class TestCascadeIntegration:
    def test_toshiba_does_not_false_positive_on_random_frame(self):
        # 144-pulse random frame with no leader signature shouldn't match.
        from services.ir_protocol import decode_protocol
        random_pulses = [500, 500] * 100
        result = decode_protocol(random_pulses)
        # Could be None or another family — just must not falsely claim Toshiba.
        if result is not None:
            assert result.family != "toshiba_ac"

    def test_midea_does_not_false_positive_on_random_frame(self):
        random_pulses = [500, 500] * 100
        result = decode_protocol(random_pulses)
        if result is not None:
            assert result.family != "midea_ac"
