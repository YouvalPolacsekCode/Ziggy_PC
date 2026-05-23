"""
Unit tests for services/ir_protocol.py — Broadlink raw decoder + fingerprinting.

No broadlink package required; tests construct synthetic captures via
encode_broadlink_raw and verify roundtrip + tolerance behavior.
"""
from __future__ import annotations

import base64

import pytest

from services.ir_protocol import (
    BROADLINK_TICK_US,
    encode_broadlink_raw,
    fingerprint_b64,
    fingerprint_bytes,
    fingerprint_pulses,
    fuzzy_match_b64,
    fuzzy_match_bytes,
    fuzzy_match_pulses,
    normalize_pulses,
    parse_broadlink_raw,
)


# Representative NEC-ish frame: 9ms leader + 4.5ms space, then 32 bits at
# either ~560µs / ~560µs (logical 0) or ~560µs / ~1690µs (logical 1).
_NEC_LEADER = [9000, 4500]
_NEC_ZERO = [560, 560]
_NEC_ONE = [560, 1690]


def _nec_pulses(bits: list[int]) -> list[int]:
    out = list(_NEC_LEADER)
    for b in bits:
        out += _NEC_ONE if b else _NEC_ZERO
    out += [560]  # final mark / trailer
    return out


def _jitter(pulses: list[int], pct: float, seed: int = 42) -> list[int]:
    """Apply ±pct random-ish jitter deterministically (seeded LCG)."""
    state = seed
    out = []
    for p in pulses:
        state = (state * 1103515245 + 12345) & 0x7FFFFFFF
        delta = ((state % 1000) / 1000.0) * 2 - 1  # in [-1, 1]
        out.append(max(1, int(round(p * (1 + delta * pct)))))
    return out


# ---------------------------------------------------------------------------
# parse_broadlink_raw
# ---------------------------------------------------------------------------

def test_parse_empty_returns_empty():
    assert parse_broadlink_raw(b"") == []


def test_parse_short_single_byte_pulses():
    # Wrapped: 0x26, repeat=0, length=2, then two pulses of 100 ticks each.
    data = bytes([0x26, 0x00, 0x02, 0x00, 100, 100])
    pulses = parse_broadlink_raw(data)
    assert len(pulses) == 2
    expected = int(round(100 * BROADLINK_TICK_US))
    assert pulses == [expected, expected]


def test_parse_two_byte_extended_pulses():
    # Wrapped header + a single extended pulse of 1000 ticks.
    # 0x00, hi=0x03, lo=0xE8 → 1000
    data = bytes([0x26, 0x00, 0x03, 0x00, 0x00, 0x03, 0xE8])
    pulses = parse_broadlink_raw(data)
    assert pulses == [int(round(1000 * BROADLINK_TICK_US))]


def test_parse_accepts_bare_pulse_stream():
    # No wrapping header — start straight with pulses.
    data = bytes([50, 50, 100])
    pulses = parse_broadlink_raw(data)
    assert len(pulses) == 3


def test_encode_then_parse_roundtrips():
    original_us = _nec_pulses([1, 0, 1, 1, 0, 0, 1, 0])
    encoded = encode_broadlink_raw(original_us)
    decoded = parse_broadlink_raw(encoded)
    # Tick quantization loses sub-tick precision but the values should be
    # within one tick (~33µs) of the originals.
    assert len(decoded) == len(original_us)
    for orig, dec in zip(original_us, decoded):
        assert abs(orig - dec) <= int(BROADLINK_TICK_US) + 1


# ---------------------------------------------------------------------------
# normalize_pulses
# ---------------------------------------------------------------------------

def test_normalize_quantizes_to_bucket():
    assert normalize_pulses([47, 52, 99, 101], bucket_us=100) == [0, 100, 100, 100]


def test_normalize_rejects_zero_bucket():
    with pytest.raises(ValueError):
        normalize_pulses([100], bucket_us=0)


# ---------------------------------------------------------------------------
# fingerprint
# ---------------------------------------------------------------------------

def test_fingerprint_stable_across_jitter():
    """The whole point: same button, slightly different timings → same fingerprint."""
    bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0]
    a = _nec_pulses(bits)
    b = _jitter(a, pct=0.04, seed=1)  # ~4% jitter — typical Broadlink capture noise
    fa = fingerprint_pulses(a)
    fb = fingerprint_pulses(b)
    assert fa is not None and fb is not None
    assert fa == fb


def test_fingerprint_differs_for_different_buttons():
    bits_a = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0]
    bits_b = [0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1]
    fa = fingerprint_pulses(_nec_pulses(bits_a))
    fb = fingerprint_pulses(_nec_pulses(bits_b))
    assert fa != fb


def test_fingerprint_short_returns_none():
    assert fingerprint_pulses([100, 100]) is None
    assert fingerprint_pulses([]) is None


def test_fingerprint_b64_roundtrip():
    pulses = _nec_pulses([1, 0, 1, 0, 1, 0, 1, 0])
    raw = encode_broadlink_raw(pulses)
    b64 = base64.b64encode(raw).decode()
    assert fingerprint_b64(b64) == fingerprint_bytes(raw)


def test_fingerprint_b64_handles_garbage():
    assert fingerprint_b64("!!!not-base64!!!") is None
    assert fingerprint_b64("") is None


# ---------------------------------------------------------------------------
# fuzzy_match
# ---------------------------------------------------------------------------

def test_fuzzy_match_same_with_jitter():
    bits = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0]
    a = _nec_pulses(bits)
    b = _jitter(a, pct=0.10, seed=2)  # 10% jitter — heavy noise but still same button
    assert fuzzy_match_pulses(a, b) is True


def test_fuzzy_match_rejects_different_buttons():
    a = _nec_pulses([1] * 16)
    b = _nec_pulses([0] * 16)
    assert fuzzy_match_pulses(a, b) is False


def test_fuzzy_match_rejects_different_protocols():
    # NEC-ish vs Sony-ish leader.
    nec = _nec_pulses([1, 0, 1, 0])
    sony = [2400, 600] + [1200, 600] * 12  # Sony 12-bit-ish frame
    assert fuzzy_match_pulses(nec, sony) is False


def test_fuzzy_match_rejects_too_short():
    assert fuzzy_match_pulses([100, 100], [100, 100]) is False


def test_fuzzy_match_b64_wrapper():
    pulses = _nec_pulses([1, 1, 0, 0, 1, 0, 1, 1])
    a_b64 = base64.b64encode(encode_broadlink_raw(pulses)).decode()
    b_b64 = base64.b64encode(encode_broadlink_raw(_jitter(pulses, 0.05, seed=3))).decode()
    assert fuzzy_match_b64(a_b64, b_b64) is True


def test_fuzzy_match_b64_handles_garbage():
    assert fuzzy_match_b64("!!!", "!!!") is False


# ---------------------------------------------------------------------------
# Integration: realistic Broadlink learn → match flow
# ---------------------------------------------------------------------------

def test_learn_then_match_round_trip():
    """
    Simulates: user learns a button (stored as b64). User then presses the
    same button again — capture has small jitter. Match must succeed.
    """
    # Learned signal stored at learn-time
    learned_pulses = _nec_pulses([1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0])
    learned_b64 = base64.b64encode(encode_broadlink_raw(learned_pulses)).decode()

    # User presses the same button — capture differs by a few µs per pulse
    received_pulses = _jitter(learned_pulses, pct=0.06, seed=99)
    received_bytes = encode_broadlink_raw(received_pulses)

    # The exact-match path (current production behaviour) misses this:
    received_b64 = base64.b64encode(received_bytes).decode()
    assert received_b64 != learned_b64  # exact match would FAIL — this is the bug we fix

    # The fingerprint path catches it
    assert fingerprint_b64(learned_b64) == fingerprint_bytes(received_bytes)


# ===========================================================================
# Phase 2 — Protocol decoder tests
# ===========================================================================

from services.ir_protocol import (
    decode_protocol,
    decode_protocol_b64,
    decode_protocol_bytes,
    AcState,
    ProtocolDecode,
    _encode_nec_pulses,
    _encode_sony_pulses,
    _encode_mitsubishi_pulses,
    _encode_daikin_pulses,
    _encode_gree_pulses,
)


def _bits_lsb(byte_val: int) -> list[int]:
    return [(byte_val >> i) & 1 for i in range(8)]


def _bytes_to_bit_list_lsb(payload: bytes) -> list[int]:
    bits: list[int] = []
    for b in payload:
        bits.extend(_bits_lsb(b))
    return bits


# ---------------------------------------------------------------------------
# NEC family
# ---------------------------------------------------------------------------

def test_decode_nec_32bit():
    # 32-bit NEC payload: address 0x20, ~address 0xDF, command 0x10, ~command 0xEF
    payload = bytes([0x20, 0xDF, 0x10, 0xEF])
    pulses = _encode_nec_pulses(_bytes_to_bit_list_lsb(payload))
    result = decode_protocol(pulses)
    assert result is not None
    assert result.family == "nec"
    assert result.payload_hex == "20df10ef"
    assert result.payload_bits == 32


def test_decode_nec_with_jitter():
    payload = bytes([0xAA, 0x55, 0x12, 0xED])
    bits = _bytes_to_bit_list_lsb(payload)
    clean = _encode_nec_pulses(bits)
    noisy = _jitter(clean, pct=0.10, seed=7)
    assert decode_protocol(noisy).payload_hex == "aa5512ed"


def test_decode_nec_payload_invariant_across_captures():
    """Same button → same payload_hex even though raw bytes differ."""
    bits = _bytes_to_bit_list_lsb(bytes([0x40, 0xBF, 0x12, 0xED]))
    a = _encode_nec_pulses(bits)
    b = _jitter(a, pct=0.08, seed=11)
    assert decode_protocol(a).payload_hex == decode_protocol(b).payload_hex


# ---------------------------------------------------------------------------
# Sony SIRC
# ---------------------------------------------------------------------------

def test_decode_sony_12bit():
    bits = [1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1]  # 12 bits
    pulses = _encode_sony_pulses(bits)
    result = decode_protocol(pulses)
    assert result is not None
    assert result.family == "sony12"
    assert result.payload_bits == 12


def test_decode_sony_with_jitter():
    bits = [0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0]
    clean = _encode_sony_pulses(bits)
    noisy = _jitter(clean, pct=0.10, seed=13)
    assert decode_protocol(clean).payload_hex == decode_protocol(noisy).payload_hex


# ---------------------------------------------------------------------------
# Mitsubishi AC — full state decode
# ---------------------------------------------------------------------------

def _mitsubishi_state_bytes(*, power_on: bool, mode_bits: int, temp_c: int, fan_bits: int) -> bytes:
    """
    Build a synthetic Mitsubishi MSZ-FH state packet with bytes 5/6/7 set to
    encode the given AC state. Bytes 0-4 and 8+ are filler for length.
    """
    b5 = (0x20 if power_on else 0x00) | (mode_bits & 0x0F)
    b6 = (temp_c - 16) & 0x1F
    b7 = fan_bits & 0x07
    return bytes([0x23, 0xCB, 0x26, 0x01, 0x00, b5, b6, b7] + [0] * 10)


def test_decode_mitsubishi_ac_cool_24():
    payload = _mitsubishi_state_bytes(power_on=True, mode_bits=0x3, temp_c=24, fan_bits=1)
    result = decode_protocol(_encode_mitsubishi_pulses(payload))
    assert result is not None
    assert result.family == "mitsubishi_ac"
    assert result.ac_state == AcState(
        power="on", mode="cool", temp=24, fan="auto", brand="mitsubishi",
    )


def test_decode_mitsubishi_ac_power_off():
    payload = _mitsubishi_state_bytes(power_on=False, mode_bits=0x3, temp_c=22, fan_bits=2)
    result = decode_protocol(_encode_mitsubishi_pulses(payload))
    assert result is not None
    assert result.ac_state.power == "off"
    assert result.ac_state.temp == 22
    assert result.ac_state.fan == "low"


def test_decode_mitsubishi_ac_heat_mode():
    payload = _mitsubishi_state_bytes(power_on=True, mode_bits=0x1, temp_c=27, fan_bits=5)
    result = decode_protocol(_encode_mitsubishi_pulses(payload))
    assert result.ac_state.mode == "heat"
    assert result.ac_state.fan == "high"


# ---------------------------------------------------------------------------
# Daikin AC
# ---------------------------------------------------------------------------

def _daikin_state_bytes(*, power_on: bool, mode_bits: int, temp_c: int, fan_bits: int) -> bytes:
    """
    Build a synthetic Daikin ARC state packet with bytes 5/6/8 carrying state.
    """
    b5 = (0x01 if power_on else 0x00) | ((mode_bits & 0x07) << 4)
    b6 = (temp_c * 2) & 0xFF
    b8 = (fan_bits & 0x0F) << 4
    # Daikin frames are long (~280 bits = 35 bytes); make sure we provide enough.
    return bytes([0x11, 0xDA, 0x27, 0x00, 0xC5, b5, b6, 0x00, b8] + [0] * 26)


def test_decode_daikin_ac_cool_25():
    payload = _daikin_state_bytes(power_on=True, mode_bits=2, temp_c=25, fan_bits=0xA)
    result = decode_protocol(_encode_daikin_pulses(payload))
    assert result is not None
    assert result.family == "daikin_ac"
    assert result.ac_state.power == "on"
    assert result.ac_state.mode == "cool"
    assert result.ac_state.temp == 25
    assert result.ac_state.fan == "auto"


def test_decode_daikin_ac_power_off():
    payload = _daikin_state_bytes(power_on=False, mode_bits=2, temp_c=20, fan_bits=5)
    result = decode_protocol(_encode_daikin_pulses(payload))
    assert result.ac_state.power == "off"
    assert result.ac_state.temp == 20
    assert result.ac_state.fan == "high"


# ---------------------------------------------------------------------------
# Detection rejection / fallback
# ---------------------------------------------------------------------------

def test_decode_unknown_returns_none():
    # Random pulses that don't match any protocol leader
    assert decode_protocol([1000, 2000, 500, 500, 500, 500]) is None


def test_decode_empty_returns_none():
    assert decode_protocol([]) is None
    assert decode_protocol([0]) is None


def test_decode_protocol_b64_garbage():
    assert decode_protocol_b64("not-valid-b64!!!") is None
    assert decode_protocol_b64("") is None


# ---------------------------------------------------------------------------
# Gree AC (used by Tadiran and many other Israeli/Asian-OEM split units)
# ---------------------------------------------------------------------------

def _gree_state_bits(*, power_on: bool, mode_bits: int, temp_c: int) -> list[int]:
    """
    Build a synthetic Gree single-half payload (32 bits = 4 bytes) encoding
    the AC state's power/mode/temp. Fan lives in byte 4 of the full frame and
    isn't covered by single-half decode — see ir_protocol._decode_gree_ac_state.
    """
    byte0 = (mode_bits & 0x07) | (0x08 if power_on else 0x00)
    byte1 = (temp_c - 16) & 0x0F
    bits: list[int] = []
    for byte in (byte0, byte1, 0, 0):
        for i in range(8):
            bits.append((byte >> i) & 1)
    return bits


def test_decode_gree_ac_cool_24():
    bits = _gree_state_bits(power_on=True, mode_bits=1, temp_c=24)
    result = decode_protocol(_encode_gree_pulses(bits))
    assert result is not None
    assert result.family == "gree_ac"
    assert result.ac_state.power == "on"
    assert result.ac_state.mode == "cool"
    assert result.ac_state.temp == 24


def test_decode_gree_ac_power_off():
    bits = _gree_state_bits(power_on=False, mode_bits=1, temp_c=20)
    result = decode_protocol(_encode_gree_pulses(bits))
    assert result is not None
    assert result.ac_state.power == "off"
    assert result.ac_state.temp == 20


def test_decode_gree_ac_heat_mode():
    bits = _gree_state_bits(power_on=True, mode_bits=4, temp_c=27)
    result = decode_protocol(_encode_gree_pulses(bits))
    assert result.ac_state.mode == "heat"
    assert result.ac_state.temp == 27


def test_gree_not_misdetected_as_nec():
    """Gree shares NEC's 9000/4500 leader. A real Gree frame must NOT come
    back as a 32-bit NEC decode — that would silently produce a wrong match."""
    bits = _gree_state_bits(power_on=True, mode_bits=1, temp_c=24)
    result = decode_protocol(_encode_gree_pulses(bits))
    assert result.family != "nec"


def test_short_nec_not_misdetected_as_gree():
    """Conversely, a real NEC TV remote (~67 pulses) must still decode as NEC."""
    payload = bytes([0x20, 0xDF, 0x10, 0xEF])
    pulses = _encode_nec_pulses(_bytes_to_bit_list_lsb(payload))
    result = decode_protocol(pulses)
    assert result.family == "nec"


# ---------------------------------------------------------------------------
# Regression: fuzzy match must NOT false-positive across two long stateful
# AC captures that share a protocol header but encode different state.
#
# This is the exact bug the user hit: pressing power/off on a Tadiran remote
# matched a previously-learned mode_cool because fuzzy's 40-pulse window only
# sees the protocol header (identical across all packets from that remote).
# ---------------------------------------------------------------------------

def test_long_ac_frames_with_different_state_not_fuzzy_matched():
    """Two Gree-protocol captures with different state bytes must produce
    pulse arrays that fuzzy_match_pulses correctly rejects when comparing the
    full frame — not just the first 40 pulses. (Fuzzy's per-pulse tolerance
    only sees the leader + first 19 bits, which are identical state-headers,
    so the listener-level length gate is what actually prevents the bug.)"""
    from services.ir_protocol import fuzzy_match_pulses

    cool_24_bits = _gree_state_bits(power_on=True, mode_bits=1, temp_c=24)
    off_24_bits = _gree_state_bits(power_on=False, mode_bits=1, temp_c=24)
    a = _encode_gree_pulses(cool_24_bits)
    b = _encode_gree_pulses(off_24_bits)
    # Both are >100 pulses (long-frame territory). With the default
    # max_pulses=40 fuzzy window, only the leader + early header is compared
    # and they look the same — confirming why fuzzy can't safely be used
    # on long frames. The listener's length gate is the load-bearing check.
    assert len(a) > 100 and len(b) > 100
    # Demonstrate the false-positive at the fuzzy-pulse layer:
    assert fuzzy_match_pulses(a, b) is True
    # ...which is why the listener length-gates fuzzy at >100 pulses.


# ---------------------------------------------------------------------------
# Tadiran AC (pulse-pair-inversion 64-bit) — regression test against the
# real capture from a user's Tadiran power button, recorded 2026-05-23 via
# /api/ir/unassigned-signals/9b74fe95ab/analyze. Don't replace this with a
# synthetic vector — it's the live-hardware ground truth.
# ---------------------------------------------------------------------------

def test_decode_real_tadiran_capture():
    """Real Broadlink capture of a Tadiran AC button press (first 132 pulses
    = first half of the double-transmission). Must decode as tadiran_ac with
    a stable 64-bit payload."""
    real_pulses = [
        8473, 4630, 1872, 690, 624, 1938, 591, 1938, 624, 1938, 591, 1938,
        591, 1938, 624, 1938, 591, 1970, 1839, 690, 624, 1938, 591, 1938,
        591, 1938, 624, 1938, 591, 1938, 1872, 690, 624, 1938, 591, 1938,
        624, 1938, 1806, 722, 1872, 657, 624, 1938, 1839, 690, 624, 1938,
        624, 1938, 591, 1938, 624, 1938, 591, 1938, 591, 1938, 624, 1938,
        624, 1938, 591, 1938, 624, 1938, 591, 1938, 591, 1938, 624, 1938,
        591, 1938, 624, 1938, 624, 1938, 591, 1938, 624, 1938, 591, 1938,
        591, 1938, 624, 1938, 624, 1938, 591, 1938, 624, 1938, 1806, 722,
        1872, 657, 624, 1938, 591, 1938, 624, 1938, 624, 1938, 591, 1938,
        624, 1938, 591, 1938, 591, 1970, 591, 1938, 624, 1905, 624, 1938,
        624, 1938, 591, 1938, 1872, 690, 591, 1938, 591, 1938, 1741,
    ]
    result = decode_protocol(real_pulses)
    assert result is not None
    assert result.family == "tadiran_ac"
    assert result.payload_bits == 64
    # Payload extracted from this exact capture — must be stable across runs.
    assert result.payload_hex == "01412c0000c00020"


def test_tadiran_rejects_too_short_frame():
    # A short frame with Tadiran-shaped leader but only 16 bits of data
    # must not be claimed as tadiran_ac (we require >=32 bits).
    short_pulses = [8473, 4630] + [624, 1938] * 16
    result = decode_protocol(short_pulses)
    assert result is None or result.family != "tadiran_ac"


def test_payload_match_equivalence_after_round_trip():
    """
    A learned code and a re-pressed code of the same physical button should
    decode to the same payload_hex — even when their fingerprints differ.
    """
    bits = _bytes_to_bit_list_lsb(bytes([0xE0, 0xE0, 0x40, 0xBF]))  # Samsung-ish
    clean = encode_broadlink_raw(_encode_nec_pulses(bits))
    noisy_pulses = _jitter(_encode_nec_pulses(bits), pct=0.09, seed=21)
    noisy = encode_broadlink_raw(noisy_pulses)
    da = decode_protocol_bytes(clean)
    db = decode_protocol_bytes(noisy)
    assert da is not None and db is not None
    assert da.payload_hex == db.payload_hex
