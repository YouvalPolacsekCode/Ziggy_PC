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
