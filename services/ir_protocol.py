"""
IR protocol primitives — Broadlink raw decoder, fingerprinting, fuzzy match.

Phase 1 of the "IR feedback" upgrade: makes signal matching tolerant of the
~few-µs jitter present in any two captures of the same button press. The
default exact-base64 comparison misses real matches because Broadlink stores
pulse durations as integer ticks (~32.84µs each) and the same press yields
slightly different counts on each capture.

This module is pure (no I/O, no broadlink dependency), so it imports cleanly
in tests and on hosts that don't have the broadlink package installed.

Phase 2 will extend this module with protocol detection (NEC, Sony, Samsung,
Daikin, Mitsubishi, LG, Panasonic) and AC state decoding.
"""
from __future__ import annotations

import base64
import hashlib
from typing import Iterable, Optional

# Broadlink RM family encodes each pulse duration as an integer count of
# ~32.84µs ticks. (Precise value: 269.83 / 8192 ms ≈ 32.94 µs; the community
# convention is 32.84, which is what python-broadlink uses.)
BROADLINK_TICK_US: float = 32.84

# Packet type bytes seen at the front of a wrapped Broadlink capture.
# 0x26 = IR, 0xb2 = RF 315MHz, 0xd7 = RF 433MHz.
_WRAPPED_TYPES = (0x26, 0xb2, 0xd7)


# ---------------------------------------------------------------------------
# Raw parser
# ---------------------------------------------------------------------------

def parse_broadlink_raw(data: bytes) -> list[int]:
    """
    Parse a Broadlink raw IR capture into pulse durations in microseconds.

    Accepts either the wrapped form (begins with 0x26/0xb2/0xd7 + repeat byte
    + 2-byte little-endian length) or the bare pulse stream. Single-byte
    durations represent the count directly; `0x00 hi lo` encodes a 16-bit
    big-endian count for durations that don't fit in one byte.

    Returns alternating mark/space durations in µs. Returns [] on malformed
    input — callers are matchers that should treat unparseable data as "no
    match" not "crash".
    """
    if not data:
        return []

    offset = 0
    if data[0] in _WRAPPED_TYPES and len(data) >= 4:
        offset = 4

    pulses: list[int] = []
    i = offset
    n = len(data)
    while i < n:
        b = data[i]
        if b == 0x00:
            if i + 2 >= n:
                break
            val = (data[i + 1] << 8) | data[i + 2]
            i += 3
        else:
            val = b
            i += 1
        if val == 0:
            continue
        pulses.append(int(round(val * BROADLINK_TICK_US)))

    return pulses


def encode_broadlink_raw(pulses_us: Iterable[int], *, repeat: int = 0) -> bytes:
    """
    Inverse of `parse_broadlink_raw`. Builds a wrapped Broadlink IR packet.

    Used by tests to construct synthetic captures; not used at runtime.
    """
    body = bytearray()
    for us in pulses_us:
        ticks = max(1, int(round(us / BROADLINK_TICK_US)))
        if ticks < 256:
            body.append(ticks)
        else:
            body.append(0x00)
            body.append((ticks >> 8) & 0xFF)
            body.append(ticks & 0xFF)
    length = len(body)
    header = bytes([0x26, repeat & 0xFF, length & 0xFF, (length >> 8) & 0xFF])
    return header + bytes(body)


# ---------------------------------------------------------------------------
# Normalization + fingerprinting
# ---------------------------------------------------------------------------

def normalize_pulses(pulses_us: Iterable[int], bucket_us: int = 100) -> list[int]:
    """Quantize pulse durations to the nearest `bucket_us`-µs bucket."""
    if bucket_us <= 0:
        raise ValueError("bucket_us must be positive")
    return [((p + bucket_us // 2) // bucket_us) * bucket_us for p in pulses_us]


def _classify_uniform(seq: list[int], uniformity_threshold: float = 0.25) -> str:
    """
    Map a sequence to a binary string by median split.

    If the sequence is essentially uniform (range < threshold × median),
    classify everything as '0' — there's no signal in this dimension.

    Median split is invariant under multiplicative scaling and tolerant of
    additive jitter, which is exactly the regime Broadlink captures live in.
    """
    if not seq:
        return ""
    sorted_seq = sorted(seq)
    median = sorted_seq[len(sorted_seq) // 2]
    if median == 0:
        return "0" * len(seq)
    if (max(seq) - min(seq)) < uniformity_threshold * median:
        return "0" * len(seq)
    return "".join("1" if p >= median else "0" for p in seq)


def _magnitude_class(us: int) -> str:
    """
    Coarse pulse-duration class. Bands are wide enough that ±10% jitter
    on common IR pulse values stays inside one band:
      S (<1500µs)   Sony space, NEC body, Daikin body
      M (1500-5000) Samsung leader, Daikin leader, Panasonic leader
      L (5000-12000) NEC leader, LG leader
      X (>=12000)   long marks (uncommon)
    """
    if us < 1500:
        return "S"
    if us < 5000:
        return "M"
    if us < 12000:
        return "L"
    return "X"


def fingerprint_pulses(
    pulses_us: list[int],
    *,
    leader_count: int = 2,
    sample_count: int = 32,
) -> Optional[str]:
    """
    Short stable fingerprint of an IR signal — jitter-tolerant.

    Strategy:
      • Leader (first `leader_count` pulses): mapped to magnitude classes
        (S/M/L/X). Jitter-stable because band boundaries sit between common
        IR pulse values, not on them.
      • Body (next `sample_count` pulses): split into marks (even indices)
        and spaces (odd indices), median-classified independently so info
        is preserved regardless of which side encodes the bits.

    Truncated SHA-1 keeps the fingerprint short for logs/UI.
    Returns None for sequences too short to fingerprint meaningfully.
    """
    if len(pulses_us) < leader_count + 4:
        return None

    leader = pulses_us[:leader_count]
    body = pulses_us[leader_count : leader_count + sample_count]
    if not body:
        return None

    leader_str = "".join(_magnitude_class(p) for p in leader)
    marks = body[0::2]
    spaces = body[1::2]
    body_str = _classify_uniform(marks) + "|" + _classify_uniform(spaces)

    payload = leader_str + ":" + body_str
    return hashlib.sha1(payload.encode("ascii")).hexdigest()[:16]


def fingerprint_b64(code_b64: str, **kwargs) -> Optional[str]:
    """Decode b64 → parse → fingerprint. Returns None on any failure."""
    try:
        raw = base64.b64decode(code_b64)
    except Exception:
        return None
    pulses = parse_broadlink_raw(raw)
    if not pulses:
        return None
    return fingerprint_pulses(pulses, **kwargs)


def fingerprint_bytes(data: bytes, **kwargs) -> Optional[str]:
    """Parse raw bytes → fingerprint. Returns None on any failure."""
    pulses = parse_broadlink_raw(data)
    if not pulses:
        return None
    return fingerprint_pulses(pulses, **kwargs)


# ---------------------------------------------------------------------------
# Fuzzy match (fallback when fingerprints differ)
# ---------------------------------------------------------------------------

def fuzzy_match_pulses(
    a: list[int],
    b: list[int],
    *,
    max_pulses: int = 40,
    leader_tolerance: float = 0.25,
    body_tolerance: float = 0.20,
    max_body_mismatches: int = 3,
) -> bool:
    """
    Compare two pulse sequences with per-pulse tolerance.

    The leader (first two pulses) defines the protocol — held to a tighter
    bound. Body pulses get a looser tolerance and we allow a small number
    of outlier mismatches (Broadlink captures occasionally drop or add a
    noise pulse near the end of the signal).
    """
    if not a or not b:
        return False
    if abs(len(a) - len(b)) > 4:
        return False

    a = a[:max_pulses]
    b = b[:max_pulses]
    n = min(len(a), len(b))
    if n < 6:
        return False

    leader_n = min(2, n)
    for i in range(leader_n):
        m = max(a[i], b[i])
        if m == 0:
            continue
        if abs(a[i] - b[i]) / m > leader_tolerance:
            return False

    mismatches = 0
    for i in range(leader_n, n):
        m = max(a[i], b[i])
        if m == 0:
            continue
        if abs(a[i] - b[i]) / m > body_tolerance:
            mismatches += 1
            if mismatches > max_body_mismatches:
                return False

    return True


def fuzzy_match_bytes(a: bytes, b: bytes, **kwargs) -> bool:
    """Parse and fuzzy-compare two raw Broadlink captures."""
    return fuzzy_match_pulses(parse_broadlink_raw(a), parse_broadlink_raw(b), **kwargs)


def fuzzy_match_b64(a_b64: str, b_b64: str, **kwargs) -> bool:
    """Decode and fuzzy-compare two base64 Broadlink captures."""
    try:
        a = base64.b64decode(a_b64)
        b = base64.b64decode(b_b64)
    except Exception:
        return False
    return fuzzy_match_bytes(a, b, **kwargs)
