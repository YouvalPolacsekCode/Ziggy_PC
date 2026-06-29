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
from dataclasses import dataclass, field
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


# ===========================================================================
# Phase 2 — Protocol decoders
#
# For stateless remotes (NEC, Sony, Samsung, LG) we extract the symbolic
# address/command payload so two captures of the same button match even if
# their fingerprints differ by one bit due to noise. For stateful AC remotes
# (Mitsubishi, Daikin) we go further: decode the actual power/mode/temp/fan
# fields so an *unlearned* AC packet can still update device state — the AC
# remote tells us what it wants, regardless of which button was learned.
#
# Each protocol decoder takes the parsed pulse array (microseconds) and
# returns a ProtocolDecode on success, or None if the pulse pattern doesn't
# match the protocol. Decoders are tolerant — they use percentage tolerance
# on pulse durations, not exact matches.
# ===========================================================================


@dataclass(frozen=True)
class AcState:
    """Decoded HVAC state from a stateful AC remote packet."""
    power: Optional[str] = None       # 'on' | 'off' | None (unknown for this protocol)
    mode: Optional[str] = None        # 'cool' | 'heat' | 'fan' | 'auto' | 'dry'
    temp: Optional[int] = None        # Celsius
    fan: Optional[str] = None         # 'low' | 'medium' | 'high' | 'auto'
    brand: str = ""                   # for diagnostics — which decoder produced this


@dataclass(frozen=True)
class AcCommand:
    """
    Decoded command from a short-form AC remote packet (e.g. TEMP+, TEMP-,
    FAN, SWING). Distinct from AcState because the short packet carries
    only the action, not the resulting state — Ziggy applies the action
    as an increment against its tracked ac_memory.
    """
    action: str                       # 'temp_up' | 'temp_down' | 'fan_cycle' | 'swing' | 'unknown'
    brand: str = ""


@dataclass(frozen=True)
class ProtocolDecode:
    """Result of decoding a Broadlink capture against a known IR protocol."""
    family: str                       # 'nec' | 'sony' | 'samsung' | 'lg' | 'mitsubishi_ac' | 'daikin_ac' | 'tadiran_ac' | 'tadiran_short'
    payload_hex: str                  # canonical hex of decoded payload — usable as a match key
    payload_bits: int = 0             # bit length of the payload
    ac_state: Optional[AcState] = None    # populated for stateful AC full-state packets
    ac_command: Optional[AcCommand] = None  # populated for short command packets


# ---------------------------------------------------------------------------
# Pulse-level helpers
# ---------------------------------------------------------------------------

def _near(value: int, target: int, tolerance_pct: float = 0.30) -> bool:
    """True if value is within tolerance_pct of target."""
    if target <= 0:
        return False
    return abs(value - target) / target <= tolerance_pct


def _decode_pulse_distance_bits(
    pulses: list[int],
    start: int,
    n_bits: int,
    *,
    mark_us: int,
    zero_space_us: int,
    one_space_us: int,
    mark_tol: float = 0.45,
    space_tol: float = 0.30,
) -> Optional[list[int]]:
    """
    Decode pulse-distance encoded bits (NEC family).

    Each bit is: mark (constant) + space (varies: short=0, long=1).
    Reads `n_bits` bits starting at pulse index `start`. Returns the bit list,
    or None if any pair doesn't conform to the protocol.
    """
    needed = start + n_bits * 2
    if len(pulses) < needed:
        return None

    bits: list[int] = []
    for i in range(n_bits):
        mark = pulses[start + i * 2]
        space = pulses[start + i * 2 + 1]
        if not _near(mark, mark_us, mark_tol):
            return None
        if _near(space, zero_space_us, space_tol):
            bits.append(0)
        elif _near(space, one_space_us, space_tol):
            bits.append(1)
        else:
            return None
    return bits


def _decode_pulse_width_bits(
    pulses: list[int],
    start: int,
    n_bits: int,
    *,
    zero_mark_us: int,
    one_mark_us: int,
    space_us: int,
    mark_tol: float = 0.30,
    space_tol: float = 0.45,
) -> Optional[list[int]]:
    """
    Decode pulse-width encoded bits (Sony SIRC family).

    Each bit is: mark (varies: short=0, long=1) + space (constant).
    """
    needed = start + n_bits * 2
    if len(pulses) < needed:
        return None

    bits: list[int] = []
    for i in range(n_bits):
        mark = pulses[start + i * 2]
        space = pulses[start + i * 2 + 1]
        if not _near(space, space_us, space_tol):
            return None
        if _near(mark, zero_mark_us, mark_tol):
            bits.append(0)
        elif _near(mark, one_mark_us, mark_tol):
            bits.append(1)
        else:
            return None
    return bits


def _bits_to_bytes(bits: list[int], lsb_first: bool = True) -> bytes:
    """Pack a bit list into bytes, padding the last byte with zeros."""
    out = bytearray()
    byte = 0
    for i, b in enumerate(bits):
        if lsb_first:
            byte |= (b & 1) << (i % 8)
        else:
            byte = (byte << 1) | (b & 1)
        if i % 8 == 7:
            out.append(byte)
            byte = 0
    if len(bits) % 8 != 0:
        if not lsb_first:
            byte <<= (8 - (len(bits) % 8))
        out.append(byte)
    return bytes(out)


# ---------------------------------------------------------------------------
# NEC family (9000/4500 leader, pulse-distance) — TVs, cable boxes, soundbars
# Many vendor variants reuse the leader; Samsung uses 4500/4500.
# ---------------------------------------------------------------------------

_NEC_LEADER_MARK = 9000
_NEC_LEADER_SPACE = 4500
_NEC_BIT_MARK = 560
_NEC_BIT_ZERO_SPACE = 560
_NEC_BIT_ONE_SPACE = 1690

_SAMSUNG_LEADER_MARK = 4500
_SAMSUNG_LEADER_SPACE = 4500

_LG_LEADER_MARK = 8800
_LG_LEADER_SPACE = 4400


def _try_decode_nec_family(pulses: list[int]) -> Optional[ProtocolDecode]:
    """
    NEC, Samsung-NEC, and LG-NEC variants. They share pulse-distance bit
    encoding and differ only in the leader pulse magnitudes and bit count.

    Length-strict: an NEC-family frame is at most 2 + 32*2 + 4 = 70 pulses.
    Refuse to decode longer streams as NEC — those are likely Gree or another
    NEC-look-alike with a much bigger payload, and a partial NEC decode of
    them would produce a misleading "match".
    """
    if len(pulses) < 4:
        return None
    if len(pulses) > 80:
        return None
    leader_mark, leader_space = pulses[0], pulses[1]

    candidates = [
        # (family, leader_mark, leader_space, expected_bits)
        ("nec",      _NEC_LEADER_MARK,     _NEC_LEADER_SPACE,     32),
        ("samsung",  _SAMSUNG_LEADER_MARK, _SAMSUNG_LEADER_SPACE, 32),
        ("lg",       _LG_LEADER_MARK,      _LG_LEADER_SPACE,      28),
    ]
    for family, lm, ls, n_bits in candidates:
        if not (_near(leader_mark, lm, 0.20) and _near(leader_space, ls, 0.20)):
            continue
        bits = _decode_pulse_distance_bits(
            pulses, start=2, n_bits=n_bits,
            mark_us=_NEC_BIT_MARK,
            zero_space_us=_NEC_BIT_ZERO_SPACE,
            one_space_us=_NEC_BIT_ONE_SPACE,
        )
        if bits is None:
            continue
        payload = _bits_to_bytes(bits, lsb_first=True)
        return ProtocolDecode(
            family=family,
            payload_hex=payload.hex(),
            payload_bits=n_bits,
        )
    return None


# ---------------------------------------------------------------------------
# Gree AC (9000/4500 leader — looks NEC-ish until you count bits).
#
# Used by many Asian-OEM split units sold under regional brand names:
# Tadiran (IL), Pioneer, Cooper&Hunter, Sinclair, Argo, Innova, etc.
# The vast majority of Israeli Tadiran inverters are Gree underneath.
#
# Frame layout: two 70-bit halves separated by a ~20ms gap, each half is
# leader + 32 data bits + 3-bit separator + 32 data bits + trailer.
# Byte layout (first half is enough to extract HVAC state):
#   byte 0 bits 0-3: mode  (0=auto 1=cool 2=dry 3=fan 4=heat)
#   byte 0 bit 3:    power (1=on)  — overlaps mode bit 3, but the convention
#                                    is that this bit toggles power and a
#                                    separate flag in byte 5 says "fresh state"
#   byte 1 bits 0-3: temp = T - 16  (T in °C, 16..30)
#   byte 4 bits 4-6: fan   (0=auto 1=low 2=med 3=high)
#
# Bit positions vary slightly across Gree sub-protocols (Yaa1FB9, Yan1F8F,
# Yap1F6, …). We use the most common layout (YAA1FB9 / YAP1F6). Test on the
# physical remote first — temp and mode bit positions may need tweaking
# for a specific sub-variant.
# ---------------------------------------------------------------------------

_GREE_LEADER_MARK = 9000
_GREE_LEADER_SPACE = 4500
_GREE_BIT_MARK = 620
_GREE_BIT_ZERO_SPACE = 540
_GREE_BIT_ONE_SPACE = 1620
# We decode the first 32 bits of the half-frame (4 clean bytes). Real Gree
# transmits 35 bits + separator + 32 bits per frame; byte 4 (where fan lives)
# is split across the separator, so a single-half decode covers power, mode,
# and temp reliably but not fan. Full-frame parsing is a TODO once we have a
# real Tadiran capture to validate against — fan_bits position in byte 4's
# upper nibble may also vary across Gree sub-protocols.
_GREE_BITS_DECODED = 32


def _decode_gree_ac_state(payload: bytes) -> Optional[AcState]:
    if len(payload) < 2:
        return None
    mode_bits = payload[0] & 0x07
    mode_map = {0: "auto", 1: "cool", 2: "dry", 3: "fan", 4: "heat"}
    mode = mode_map.get(mode_bits)
    power = "on" if (payload[0] & 0x08) else "off"
    temp_b = payload[1] & 0x0F
    temp = 16 + temp_b if 0 <= temp_b <= 14 else None
    # Fan is in byte 4 upper nibble in the full frame — not in our 32-bit
    # single-half decode. Leave as None until we wire two-half decoding.
    fan = None
    return AcState(power=power, mode=mode, temp=temp, fan=fan, brand="gree")


def _try_decode_gree(pulses: list[int]) -> Optional[ProtocolDecode]:
    """
    Best-effort Gree single-half decode (32 bits ≈ 4 bytes covers power/mode/
    temp). Stricter than NEC: requires >100 pulses so we don't consume
    well-formed 32-bit NEC frames.
    """
    if len(pulses) < 2 + _GREE_BITS_DECODED * 2:
        return None
    if len(pulses) < 100:
        return None
    if not (_near(pulses[0], _GREE_LEADER_MARK, 0.15)
            and _near(pulses[1], _GREE_LEADER_SPACE, 0.20)):
        return None
    bits = _decode_pulse_distance_bits(
        pulses, start=2, n_bits=_GREE_BITS_DECODED,
        mark_us=_GREE_BIT_MARK,
        zero_space_us=_GREE_BIT_ZERO_SPACE,
        one_space_us=_GREE_BIT_ONE_SPACE,
        mark_tol=0.40,
    )
    if bits is None:
        return None
    payload = _bits_to_bytes(bits, lsb_first=True)
    ac = _decode_gree_ac_state(payload)
    return ProtocolDecode(
        family="gree_ac",
        payload_hex=payload.hex(),
        payload_bits=_GREE_BITS_DECODED,
        ac_state=ac,
    )


# ---------------------------------------------------------------------------
# Sony SIRC (2400/600 leader, pulse-width) — Sony TVs, audio receivers
# Three variants: 12-bit, 15-bit, 20-bit.
# ---------------------------------------------------------------------------

_SONY_LEADER_MARK = 2400
_SONY_LEADER_SPACE = 600
_SONY_BIT_ZERO_MARK = 600
_SONY_BIT_ONE_MARK = 1200
_SONY_BIT_SPACE = 600


def _try_decode_sony(pulses: list[int]) -> Optional[ProtocolDecode]:
    if len(pulses) < 4:
        return None
    if not (_near(pulses[0], _SONY_LEADER_MARK, 0.20)
            and _near(pulses[1], _SONY_LEADER_SPACE, 0.30)):
        return None

    for n_bits in (20, 15, 12):
        bits = _decode_pulse_width_bits(
            pulses, start=2, n_bits=n_bits,
            zero_mark_us=_SONY_BIT_ZERO_MARK,
            one_mark_us=_SONY_BIT_ONE_MARK,
            space_us=_SONY_BIT_SPACE,
        )
        if bits is not None:
            payload = _bits_to_bytes(bits, lsb_first=True)
            return ProtocolDecode(
                family=f"sony{n_bits}",
                payload_hex=payload.hex(),
                payload_bits=n_bits,
            )
    return None


# ---------------------------------------------------------------------------
# Mitsubishi AC (3400/1750 leader, pulse-distance) — single-frame 144 bits.
#
# Bit layout (common Mitsubishi MSZ models; bytes are LSB-first within bits
# but BIG-endian within the byte stream):
#   byte 5: power (bit 5) + mode (bits 3-0)  — 0=auto 1=heat 3=cool 7=dry 8=fan
#                                              (varies by sub-protocol;
#                                              we use the MSZ-FH convention)
#   byte 6: temp = byte_value - 16  (i.e. byte=8 → 24°C)
#   byte 7: fan/vane: fan in bits 0-2 (1=auto 2=low ... 5=high)
#
# Mitsubishi has multiple sub-protocols (MSZ-FH, MSZ-GE, etc.) with slightly
# different bit positions. We use the most common (MSZ-FH) and return the
# decoded state with brand='mitsubishi' so the caller can take it with a
# pinch of salt.
# ---------------------------------------------------------------------------

_MITSU_LEADER_MARK = 3400
_MITSU_LEADER_SPACE = 1750
_MITSU_BIT_MARK = 450
_MITSU_BIT_ZERO_SPACE = 450
_MITSU_BIT_ONE_SPACE = 1300
_MITSU_BITS = 144


def _decode_mitsubishi_ac_state(payload: bytes) -> Optional[AcState]:
    if len(payload) < 8:
        return None
    # Byte 5: bit 5 = power, bits 3-0 = mode
    b5 = payload[5]
    power = "on" if (b5 & 0x20) else "off"
    mode_bits = b5 & 0x0F
    mode_map = {0x0: "auto", 0x1: "heat", 0x3: "cool", 0x7: "dry", 0x8: "fan"}
    mode = mode_map.get(mode_bits)
    # Byte 6: temp encoded as (T - 16)
    temp_b = payload[6] & 0x1F
    temp = temp_b + 16 if 0 <= temp_b <= 15 else None
    # Byte 7: fan in bits 0-2
    fan_bits = payload[7] & 0x07
    fan_map = {1: "auto", 2: "low", 3: "medium", 5: "high"}
    fan = fan_map.get(fan_bits)
    return AcState(power=power, mode=mode, temp=temp, fan=fan, brand="mitsubishi")


# Magic bytes at the start of well-formed AC frames. These let us
# disambiguate between AC brands that share ~3500µs/1750µs leader pulses.
_MITSU_MAGIC = (0x23, 0xCB, 0x26)
_DAIKIN_MAGIC = (0x11, 0xDA, 0x27)


def _matches_magic(payload: bytes, magic: tuple[int, ...]) -> bool:
    return len(payload) >= len(magic) and tuple(payload[: len(magic)]) == magic


def _try_decode_mitsubishi_ac(pulses: list[int]) -> Optional[ProtocolDecode]:
    if len(pulses) < 2 + _MITSU_BITS * 2:
        return None
    if not (_near(pulses[0], _MITSU_LEADER_MARK, 0.20)
            and _near(pulses[1], _MITSU_LEADER_SPACE, 0.20)):
        return None
    bits = _decode_pulse_distance_bits(
        pulses, start=2, n_bits=_MITSU_BITS,
        mark_us=_MITSU_BIT_MARK,
        zero_space_us=_MITSU_BIT_ZERO_SPACE,
        one_space_us=_MITSU_BIT_ONE_SPACE,
    )
    if bits is None:
        return None
    payload = _bits_to_bytes(bits, lsb_first=True)
    # Reject Daikin packets that share Mitsubishi's leader timing.
    if not _matches_magic(payload, _MITSU_MAGIC):
        return None
    ac = _decode_mitsubishi_ac_state(payload)
    return ProtocolDecode(
        family="mitsubishi_ac",
        payload_hex=payload.hex(),
        payload_bits=_MITSU_BITS,
        ac_state=ac,
    )


# ---------------------------------------------------------------------------
# Daikin AC (multi-frame, ~3500/1750 leader) — single-frame decode of the
# state frame only. Daikin transmits 3 frames per command; the state frame
# is the longest (~280 bits) and carries the full HVAC state.
#
# Bit positions (Daikin ARC type; the most common consumer protocol):
#   byte 5: mode in bits 4-6   (0=auto 1=heat 2=cool 3=fan 4=dry — varies)
#   byte 5: power in bit 0
#   byte 6: temp = byte_value / 2  (Daikin uses 0.5°C steps; we round)
#   byte 8: fan in bits 4-7    (0xA=auto 0xB=quiet 3-7=speeds)
# ---------------------------------------------------------------------------

_DAIKIN_LEADER_MARK = 3500
_DAIKIN_LEADER_SPACE = 1750
_DAIKIN_BIT_MARK = 430
_DAIKIN_BIT_ZERO_SPACE = 430
_DAIKIN_BIT_ONE_SPACE = 1290


def _decode_daikin_ac_state(payload: bytes) -> Optional[AcState]:
    if len(payload) < 9:
        return None
    b5 = payload[5]
    power = "on" if (b5 & 0x01) else "off"
    mode_bits = (b5 >> 4) & 0x07
    mode_map = {0: "auto", 1: "heat", 2: "cool", 3: "fan", 4: "dry", 6: "heat"}
    mode = mode_map.get(mode_bits)
    # Temperature is byte 6 in half-degree steps
    temp = max(16, min(32, payload[6] // 2)) if payload[6] else None
    fan_bits = (payload[8] >> 4) & 0x0F
    fan_map = {0xA: "auto", 0xB: "low", 3: "low", 4: "medium", 5: "high",
               6: "high", 7: "high"}
    fan = fan_map.get(fan_bits)
    return AcState(power=power, mode=mode, temp=temp, fan=fan, brand="daikin")


def _try_decode_daikin_ac(pulses: list[int]) -> Optional[ProtocolDecode]:
    # Daikin frames vary in length (80-280 bits). We accept any frame that
    # has the right leader and at least 64 well-formed bits — that's enough
    # to extract state from the most common payload layout.
    if len(pulses) < 2 + 64 * 2:
        return None
    if not (_near(pulses[0], _DAIKIN_LEADER_MARK, 0.20)
            and _near(pulses[1], _DAIKIN_LEADER_SPACE, 0.20)):
        return None
    # Try the largest plausible bit count first so we capture the state frame
    # rather than a header frame.
    for n_bits in (280, 224, 144, 80, 64):
        if len(pulses) < 2 + n_bits * 2:
            continue
        bits = _decode_pulse_distance_bits(
            pulses, start=2, n_bits=n_bits,
            mark_us=_DAIKIN_BIT_MARK,
            zero_space_us=_DAIKIN_BIT_ZERO_SPACE,
            one_space_us=_DAIKIN_BIT_ONE_SPACE,
        )
        if bits is None:
            continue
        payload = _bits_to_bytes(bits, lsb_first=True)
        if not _matches_magic(payload, _DAIKIN_MAGIC):
            # Could be a Mitsubishi frame caught by the Daikin decoder — let
            # the next decoder try.
            continue
        ac = _decode_daikin_ac_state(payload)
        return ProtocolDecode(
            family="daikin_ac",
            payload_hex=payload.hex(),
            payload_bits=n_bits,
            ac_state=ac,
        )
    return None


# ---------------------------------------------------------------------------
# "Tadiran" AC (real-capture-driven; the user's specific protocol).
#
# This is a 64-bit-per-half frame with PULSE-PAIR INVERSION encoding — both
# the mark and the space vary, in inverted patterns:
#   Bit 0: SHORT mark (~620µs) + LONG  space (~1938µs)
#   Bit 1: LONG  mark (~1870µs) + SHORT space (~690µs)
# Leader: ~8500µs / ~4630µs (magnitude class LM, similar to NEC but with
# narrower mark). Two halves of 64 bits transmitted with a ~33ms gap.
#
# Named "tadiran" because that's where this was first observed (Israeli
# market). The encoding scheme isn't brand-exclusive — several AC OEMs
# use pulse-pair inversion — so any AC that captures with this leader +
# encoding will route here. State decoding (power/mode/temp/fan from bits)
# is NOT yet implemented; we'd need known-state captures to map bit
# positions. For now, this decoder enables exact same-button matching
# across presses (Pass 3 of the listener), which is the Phase-1-grade win.
# ---------------------------------------------------------------------------

_TADIRAN_LEADER_MARK = 8500
_TADIRAN_LEADER_SPACE = 4630
_TADIRAN_LEADER_TOL = 0.15
_TADIRAN_PAIR_RATIO_MIN = 1.5  # mark/space (or space/mark) must differ by ≥1.5×
_TADIRAN_MIN_BITS = 32         # reject very short frames as not-Tadiran
_TADIRAN_MAX_BITS = 96         # one half's worth + slack


# Tentative mode/fan maps for byte 1 (per arikfe/IRTadiran reference layout
# "fan upper nibble + mode lower nibble"). MARKED EXPERIMENTAL because we
# only have captures where mode=cool and fan=auto (constant byte 1 = 0x41
# across all 3 pinned captures). The maps below are the arikfe nibble values
# extrapolated to other modes/fans; they have NOT been validated against
# our hardware. If a beta user captures a mode-change or fan-change press
# and the byte 1 nibble matches these maps, we promote them to validated.
_TADIRAN_TENTATIVE_MODE_MAP = {
    0x0: "auto",   # arikfe default
    0x1: "cool",   # CONFIRMED for our captures (byte 1 = 0x41, cool mode active)
    0x2: "dry",    # arikfe
    0x3: "fan",    # arikfe
    0x4: "heat",   # arikfe
}
_TADIRAN_TENTATIVE_FAN_MAP = {
    0x0: "auto",   # arikfe
    0x1: "low",    # arikfe
    0x2: "medium", # arikfe
    0x3: "high",   # arikfe
    0x4: "auto",   # CONFIRMED for our captures (byte 1 = 0x41, fan auto active)
}


def _decode_tadiran_ac_state(payload: bytes) -> Optional[AcState]:
    """
    Extract HVAC state fields from a decoded Tadiran payload.

    Bit-position mapping derived from real captures (2026-05-23, user's
    own Tadiran inverter) and cross-checked against arikfe/IRTadiran
    (sibling Tadiran sub-model — see below for what matches and what doesn't).

      Power: byte 2 bit 1 (set = on, clear = off). VALIDATED by all 3 pinned
             captures. arikfe places power at byte 5 (0x30/0xc0) — does NOT
             match our unit; byte 2 bit 1 toggling between captures 1→2 (the
             only press was power-on) is the load-bearing evidence.

      Temperature: two consecutive set bits sliding through bytes 5-6,
             position = 2 * (temp - 22). VALIDATED for 24°C and 25°C from
             captures. 22-23°C, 26-29°C extrapolated from same pattern;
             16-21°C and 30°C entirely unverified — return None rather than
             guess wrong values. arikfe places temp at byte 2 (value = T*2)
             — does NOT match our unit; byte 5/6 changing between captures
             2→3 (the only press was TEMP+) is the load-bearing evidence.

      Mode: tentative — byte 1 lower nibble, per arikfe layout. Our captures
             have byte 1 = 0x41 (mode_nibble = 1 = "cool") which is consistent
             with the captures being in cool mode. UNVALIDATED for other
             modes — needs mode-change captures from real hardware. Returned
             value is best-effort; callers should treat as low confidence.

      Fan: tentative — byte 1 upper nibble. Our captures have fan_nibble = 4
             which we map to "auto" (consistent with constant fan across
             captures). The 0-3 range follows arikfe's documented map.
             UNVALIDATED for non-auto fan settings.

      Swing: per arikfe, byte 6 high bits (0xc0 = on). Our captures have
             byte 6 = 0 across all three (no swing). Pass-through for
             when beta captures land.

    Checksum cross-check vs arikfe formula
        byte[7] = sum(0..6) - (0xf*(3 + temp/8) + fan*0xf + (swing?0xb4:0))
      Captures 1 and 2 satisfy this formula EXACTLY. Capture 3 does NOT
      (expected 0x9e, actual 0x17 — diff of 135). This confirms our unit
      is a sibling-but-not-identical Tadiran sub-model. The decoder makes
      no use of the arikfe checksum at runtime; it's documented here as
      reverse-engineering provenance.
    """
    if len(payload) < 8:
        return None

    power = "on" if (payload[2] & 0x02) else "off"

    temp: Optional[int] = None
    # Scan byte 5 for the two-consecutive-ones pattern → temp 22-25
    for i in range(0, 8, 2):
        if (payload[5] >> i) & 0x03 == 0x03:
            temp = 22 + (i // 2)
            break
    if temp is None:
        # Scan byte 6 → temp 26-29
        for i in range(0, 8, 2):
            if (payload[6] >> i) & 0x03 == 0x03:
                temp = 26 + (i // 2)
                break

    # Tentative mode/fan from byte 1 nibbles (arikfe layout).
    fan_nibble = (payload[1] >> 4) & 0x0F
    mode_nibble = payload[1] & 0x0F
    mode = _TADIRAN_TENTATIVE_MODE_MAP.get(mode_nibble)
    fan = _TADIRAN_TENTATIVE_FAN_MAP.get(fan_nibble)

    # Swing: byte 6 bits 6-7 per arikfe. 0xc0 (top two bits set) = swing on.
    # Distinct from the temp bit-pattern (which puts pairs of 1s at lower
    # positions). When byte 6 == 0xc0 AND we already extracted temp 25 via
    # byte 5, we know byte 6 isn't being used for temp on this frame — so
    # 0xc0 is unambiguously swing. (Captures C3 uses 0xc0 for temp=25 via
    # byte 5 NOT being 0; in our captures byte 5=0xc0 means temp=25 — and
    # byte 6=0 means no swing. The two are disambiguated by whichever byte
    # carries the two-bit pattern at the right position.)
    # NOTE: this is brittle on the boundary case temp=29 (byte 6 = 0xc0).
    # Real hardware captures with swing-on will resolve.

    return AcState(power=power, mode=mode, temp=temp, fan=fan, brand="tadiran")


def _try_decode_tadiran(pulses: list[int]) -> Optional[ProtocolDecode]:
    """
    Pulse-pair-inversion 64-bit AC frame. Decodes the FIRST half only;
    the second half is a redundant repeat for transmission reliability.
    """
    if len(pulses) < 2 + _TADIRAN_MIN_BITS * 2:
        return None
    if not (_near(pulses[0], _TADIRAN_LEADER_MARK, _TADIRAN_LEADER_TOL)
            and _near(pulses[1], _TADIRAN_LEADER_SPACE, _TADIRAN_LEADER_TOL)):
        return None

    bits: list[int] = []
    ambiguous_count = 0
    # Real-world Broadlink captures occasionally narrow the mark/space ratio
    # on one or two pulse-pairs (jitter near a bit boundary). We tolerate a
    # small number of borderline pairs by guessing from whichever side is
    # larger, but bail above this — keeps NEC/Sony frames (where every pair
    # is ratio ~1.0) from being misread as a partial Tadiran decode.
    _MAX_AMBIGUOUS = 3
    i = 2
    while i + 1 < len(pulses):
        mark, space = pulses[i], pulses[i + 1]
        if mark <= 0 or space <= 0:
            break
        # End-of-half detector: a very large pulse (>~3000µs) on either side
        # is the trailer or inter-half gap, not a bit.
        if mark > 3000 or space > 3000:
            break
        if mark >= space * _TADIRAN_PAIR_RATIO_MIN:
            bits.append(1)
        elif space >= mark * _TADIRAN_PAIR_RATIO_MIN:
            bits.append(0)
        else:
            ambiguous_count += 1
            if ambiguous_count > _MAX_AMBIGUOUS:
                return None
            bits.append(1 if mark > space else 0)
        i += 2
        if len(bits) >= _TADIRAN_MAX_BITS:
            break

    if len(bits) < _TADIRAN_MIN_BITS:
        return None
    payload = _bits_to_bytes(bits, lsb_first=True)
    ac_state = _decode_tadiran_ac_state(payload)
    return ProtocolDecode(
        family="tadiran_ac",
        payload_hex=payload.hex(),
        payload_bits=len(bits),
        ac_state=ac_state,
    )


# ---------------------------------------------------------------------------
# Tadiran SHORT command packets — emitted by temp+/-, fan, swing buttons.
#
# Unlike the full-state LM packets (which carry the AC's complete state),
# these short packets carry only the *command*. They have no long leader —
# the capture starts immediately with a data-bit pulse-pair (1850/690 = a
# Tadiran "bit 1", which my full-state decoder rejects as a malformed
# leader). Total length is ~262 pulses, encoding ~130 bits of data.
#
# Bit-position mapping for command type is NOT yet reverse-engineered
# (needs paired captures: TEMP+ vs TEMP-, FAN vs SWING). Until then the
# decoder identifies these as tadiran_short packets and surfaces the
# payload bytes via logs — so they stop polluting the unassigned-signals
# queue and we can compare bytes across button types.
# ---------------------------------------------------------------------------

_TADIRAN_SHORT_MIN_PULSES = 200
_TADIRAN_SHORT_MAX_PULSES = 320
_TADIRAN_SHORT_MIN_BITS = 48


def _try_decode_tadiran_short(pulses: list[int]) -> Optional[ProtocolDecode]:
    """
    Tadiran command-code packet. No long leader; the first pulse-pair is
    already a data bit. Distinguished from full-state Tadiran by the
    absence of the 8500/4630 leader.
    """
    n = len(pulses)
    if n < _TADIRAN_SHORT_MIN_PULSES or n > _TADIRAN_SHORT_MAX_PULSES:
        return None
    # Reject if it actually has a long Tadiran leader — that's a full-state
    # packet and belongs to _try_decode_tadiran (full).
    if _near(pulses[0], _TADIRAN_LEADER_MARK, _TADIRAN_LEADER_TOL):
        return None
    # The first pulse-pair should look like a Tadiran bit pair: one side
    # ~600µs short, the other ~1850µs long. Use this as the discriminator.
    p0, p1 = pulses[0], pulses[1]
    lo, hi = min(p0, p1), max(p0, p1)
    if not (300 <= lo <= 1000 and 1300 <= hi <= 2300):
        return None
    if hi < lo * _TADIRAN_PAIR_RATIO_MIN:
        return None

    bits: list[int] = []
    ambiguous_count = 0
    _MAX_AMBIGUOUS = 4
    i = 0
    while i + 1 < n:
        mark, space = pulses[i], pulses[i + 1]
        if mark <= 0 or space <= 0:
            break
        if mark > 3000 or space > 3000:
            break  # trailer or end-of-frame
        if mark >= space * _TADIRAN_PAIR_RATIO_MIN:
            bits.append(1)
        elif space >= mark * _TADIRAN_PAIR_RATIO_MIN:
            bits.append(0)
        else:
            ambiguous_count += 1
            if ambiguous_count > _MAX_AMBIGUOUS:
                return None
            bits.append(1 if mark > space else 0)
        i += 2
        # Cap at one half-frame worth of bits; Tadiran short packets seem
        # to also transmit twice, so we'd otherwise double-decode.
        if len(bits) >= 80:
            break

    if len(bits) < _TADIRAN_SHORT_MIN_BITS:
        return None

    payload = _bits_to_bytes(bits, lsb_first=True)
    # Real captures show the "short" packet actually carries full state in
    # the same byte layout as the long-leader version — Tadiran just sends
    # one transmission with a leader and a second without, both containing
    # state bytes. Apply the same state extractor; the listener treats
    # this packet as another state snapshot.
    ac_state = _decode_tadiran_ac_state(payload) if len(payload) >= 8 else None
    return ProtocolDecode(
        family="tadiran_short",
        payload_hex=payload.hex(),
        payload_bits=len(bits),
        ac_state=ac_state,
    )


# ---------------------------------------------------------------------------
# Toshiba AC (4400/4400 leader, pulse-distance) — 72 bits / 9 bytes.
#
# Israel-first relevance: Electra units are commonly Toshiba- or Hitachi-
# derived internals. This decoder targets the Toshiba RAS family, which is
# also what many Electra inverters speak.
#
# Frame structure (from IRremoteESP8266 / k3a/toshiba-ac references):
#   bytes 0-1: signature 0xF2 0x0D     (used as magic-byte filter)
#   byte  2:  0x03 (length field, lower nibble = state byte count - 5)
#   byte  3:  reserved / sub-state
#   byte  4:  reserved
#   byte  5:  temperature in upper nibble — temp = 17 + (b5 >> 4)
#             (so b5=0x00 → 17°C, b5=0xD0 → 30°C)
#   byte  6:  mode (bits 5-7) + fan (bits 0-2) + power state
#             - mode bits:  0=auto, 1=cool, 2=dry, 3=heat, 4=fan
#             - fan bits:   0=auto, 2=low, 5=medium, 7=high
#             - power: this protocol family encodes power as "off" via
#                      a separate short frame (kToshibaAcLengthByte == 4
#                      with mode=fan=0xff) and "on" via the normal frame.
#   byte  7:  reserved / vane (swing) bits
#   byte  8:  XOR checksum of bytes 0-7
#
# Bit positions can vary across Toshiba RAS sub-families. The state
# extractor below is best-effort; until we have real Electra captures it
# should be considered experimental — it'll identify the frame family and
# extract a canonical payload_hex for matching, with state bits surfaced
# where confident. Sub-protocol fix-ups are a fast follow-up once real
# beta captures land.
# ---------------------------------------------------------------------------

_TOSHIBA_LEADER_MARK = 4400
_TOSHIBA_LEADER_SPACE = 4400
_TOSHIBA_BIT_MARK = 543
_TOSHIBA_BIT_ZERO_SPACE = 543
_TOSHIBA_BIT_ONE_SPACE = 1623
_TOSHIBA_BITS = 72                 # 9 bytes; some variants emit 80 or 112
_TOSHIBA_MAGIC = (0xF2, 0x0D)


def _decode_toshiba_ac_state(payload: bytes) -> Optional[AcState]:
    """Best-effort Toshiba/Electra state extractor.

    Returns brand='toshiba'. Mode/temp confidence is reasonable across
    documented RAS variants; fan is more variable. Power is not extracted
    here because the Toshiba family encodes power as a separate short
    frame, not a bit in the state frame — Ziggy infers power=on from
    receiving any state frame and uses the legacy short-frame as off.
    """
    if len(payload) < 7:
        return None
    # Temp: upper nibble of byte 5, value = (T - 17). Clamp to documented range.
    temp_raw = (payload[5] >> 4) & 0x0F
    temp = 17 + temp_raw if temp_raw <= 13 else None  # 17-30°C valid

    # Mode: bits 5-7 of byte 6
    mode_raw = (payload[6] >> 5) & 0x07
    mode_map = {0: "auto", 1: "cool", 2: "dry", 3: "heat", 4: "fan"}
    mode = mode_map.get(mode_raw)

    # Fan: bits 0-2 of byte 6
    fan_raw = payload[6] & 0x07
    fan_map = {0: "auto", 2: "low", 5: "medium", 7: "high",
               1: "low", 3: "medium", 4: "high"}
    fan = fan_map.get(fan_raw)

    # State-frame receipt implies power=on; explicit off arrives as a
    # different-shaped short frame the decoder doesn't accept as state.
    return AcState(power="on", mode=mode, temp=temp, fan=fan, brand="toshiba")


def _try_decode_toshiba_ac(pulses: list[int]) -> Optional[ProtocolDecode]:
    if len(pulses) < 2 + _TOSHIBA_BITS * 2:
        return None
    if not (_near(pulses[0], _TOSHIBA_LEADER_MARK, 0.18)
            and _near(pulses[1], _TOSHIBA_LEADER_SPACE, 0.18)):
        return None
    # Try standard 72-bit frame first; some variants emit longer state.
    for n_bits in (_TOSHIBA_BITS, 80, 112):
        if len(pulses) < 2 + n_bits * 2:
            continue
        bits = _decode_pulse_distance_bits(
            pulses, start=2, n_bits=n_bits,
            mark_us=_TOSHIBA_BIT_MARK,
            zero_space_us=_TOSHIBA_BIT_ZERO_SPACE,
            one_space_us=_TOSHIBA_BIT_ONE_SPACE,
        )
        if bits is None:
            continue
        payload = _bits_to_bytes(bits, lsb_first=True)
        if not _matches_magic(payload, _TOSHIBA_MAGIC):
            continue
        ac = _decode_toshiba_ac_state(payload)
        return ProtocolDecode(
            family="toshiba_ac",
            payload_hex=payload.hex(),
            payload_bits=n_bits,
            ac_state=ac,
        )
    return None


# ---------------------------------------------------------------------------
# Midea AC (4480/4480 leader, pulse-distance) — 48 bits / 6 bytes, sent twice.
#
# Israel-first relevance: Tornado units are commonly Midea- or Hisense-
# derived internals. This decoder targets the canonical Midea protocol
# (also covers many Tornado inverters and the Pioneer/Comfee rebrands).
#
# Frame structure (from IRremoteESP8266 + mpetroff.net analysis):
#   byte 0: 0xB2 (state command) or 0xB5 (extended). Used as magic.
#   byte 1: inverted byte 0
#   byte 2: fan (bits 5-7) + sleep flag (bit 4) + constant low nibble
#           fan bits: 1=high, 5=medium, 9=low, 7=auto (encoded reversed-MSB)
#   byte 3: inverted byte 2
#   byte 4: temp (bits 0-3, value = T - 17 in reversed-MSB) +
#           mode (bits 5-7) + on/off flag (bit 4)
#           mode: 0=cool, 1=dry, 2=auto, 3=heat, 4=fan
#   byte 5: inverted byte 4
#
# Frame is transmitted twice with a 5ms gap between halves; second half is
# an exact replica of the first. We decode the first half only.
# ---------------------------------------------------------------------------

_MIDEA_LEADER_MARK = 4480
_MIDEA_LEADER_SPACE = 4480
_MIDEA_BIT_MARK = 560
_MIDEA_BIT_ZERO_SPACE = 560
_MIDEA_BIT_ONE_SPACE = 1680
_MIDEA_BITS = 48
_MIDEA_MAGIC = (0xB2,)              # accept any 0xB? byte 0 → command class


def _decode_midea_ac_state(payload: bytes) -> Optional[AcState]:
    """Best-effort Midea/Tornado state extractor.

    The fan/mode/temp bit positions are documented but Midea's
    reversed-MSB encoding makes the temp extraction fragile across
    sub-protocols. Like Toshiba, treat as experimental until real
    Tornado captures arrive during beta.
    """
    if len(payload) < 6:
        return None

    # Sanity check: bytes 1, 3, 5 should be the bitwise inverse of bytes 0, 2, 4.
    # Tolerate single-bit corruption (allow up to 2 mismatching bits per pair
    # to survive light capture noise without false-positive matching on
    # arbitrary frames that share Midea's leader timing).
    for i in (0, 2, 4):
        a, b = payload[i], payload[i + 1]
        if bin((a ^ b) ^ 0xFF).count("1") > 2:
            return None

    # Power: byte 4 bit 4 (0 = off, 1 = on) — matches mpetroff.net analysis
    power = "on" if (payload[4] & 0x10) else "off"

    # Mode: bits 5-7 of byte 4
    mode_raw = (payload[4] >> 5) & 0x07
    mode_map = {0: "cool", 1: "dry", 2: "auto", 3: "heat", 4: "fan"}
    mode = mode_map.get(mode_raw)

    # Temp: bits 0-3 of byte 4. Midea stores T as (T - 17) bit-reversed in
    # some variants and direct in others. Try direct first; if it's out of
    # range, try reversed.
    temp_raw = payload[4] & 0x0F
    temp = 17 + temp_raw if temp_raw <= 13 else None
    if temp is None:
        # Try bit-reversed: 0xF - raw
        rev = (0x0F - temp_raw) & 0x0F
        if rev <= 13:
            temp = 17 + rev

    # Fan: bits 5-7 of byte 2 (Midea fan codes are sparse and reversed)
    fan_raw = (payload[2] >> 5) & 0x07
    fan_map = {1: "high", 2: "high", 4: "medium", 5: "medium",
               6: "low", 7: "auto", 0: "auto"}
    fan = fan_map.get(fan_raw)

    return AcState(power=power, mode=mode, temp=temp, fan=fan, brand="midea")


def _try_decode_midea_ac(pulses: list[int]) -> Optional[ProtocolDecode]:
    if len(pulses) < 2 + _MIDEA_BITS * 2:
        return None
    if not (_near(pulses[0], _MIDEA_LEADER_MARK, 0.15)
            and _near(pulses[1], _MIDEA_LEADER_SPACE, 0.15)):
        return None
    bits = _decode_pulse_distance_bits(
        pulses, start=2, n_bits=_MIDEA_BITS,
        mark_us=_MIDEA_BIT_MARK,
        zero_space_us=_MIDEA_BIT_ZERO_SPACE,
        one_space_us=_MIDEA_BIT_ONE_SPACE,
    )
    if bits is None:
        return None
    payload = _bits_to_bytes(bits, lsb_first=True)
    if (payload[0] & 0xF0) != 0xB0:
        # Not a Midea command class — could be a coincidental leader match.
        return None
    ac = _decode_midea_ac_state(payload)
    if ac is None:
        # Inverse-pair check failed → not really a Midea frame.
        return None
    return ProtocolDecode(
        family="midea_ac",
        payload_hex=payload.hex(),
        payload_bits=_MIDEA_BITS,
        ac_state=ac,
    )


# ---------------------------------------------------------------------------
# Top-level entry point
# ---------------------------------------------------------------------------

_DECODERS = (
    # Gree first: it shares NEC's leader but the frame is much longer, so
    # the stricter length check disambiguates cleanly.
    _try_decode_gree,
    # Tadiran full-state before NEC: distinctive narrower leader (~8500 vs
    # NEC's 9000) and varying marks that NEC's constant-mark check rejects.
    _try_decode_tadiran,
    # Tadiran short before NEC too: starts with a bit-pair (not a leader)
    # that NEC's strict leader check rejects, so order isn't critical, but
    # being explicit keeps the precedence clear.
    _try_decode_tadiran_short,
    _try_decode_nec_family,
    _try_decode_sony,
    # AC decoders run last because their leaders are shorter and could
    # false-positive on partial captures of other frames otherwise.
    _try_decode_mitsubishi_ac,
    _try_decode_daikin_ac,
    # Israel-first additions: Electra (Toshiba internals) and Tornado
    # (Midea/Hisense internals). Magic-byte filters keep these safe even
    # though their leader timings (4400, 4480) are similar to each other
    # and to the existing Mitsubishi (3400) leader.
    _try_decode_toshiba_ac,
    _try_decode_midea_ac,
)


def decode_protocol(pulses_us: list[int]) -> Optional[ProtocolDecode]:
    """
    Try each known decoder. Returns the first match or None.

    Decoders are ordered to prefer well-formed stateless matches before
    the more permissive AC-state decoders.
    """
    if not pulses_us or len(pulses_us) < 8:
        return None
    for decoder in _DECODERS:
        try:
            result = decoder(pulses_us)
        except Exception:
            result = None
        if result is not None:
            return result
    return None


def decode_protocol_bytes(data: bytes) -> Optional[ProtocolDecode]:
    """Parse raw Broadlink bytes and try to decode the IR protocol."""
    return decode_protocol(parse_broadlink_raw(data))


def decode_protocol_b64(code_b64: str) -> Optional[ProtocolDecode]:
    """Decode b64 -> raw bytes -> pulses -> protocol."""
    try:
        raw = base64.b64decode(code_b64)
    except Exception:
        return None
    return decode_protocol_bytes(raw)


# ---------------------------------------------------------------------------
# Synthetic encoders — used by tests to construct known-good captures
# for each protocol. Production code does NOT call these.
# ---------------------------------------------------------------------------

def _encode_nec_pulses(payload_bits: list[int]) -> list[int]:
    out = [_NEC_LEADER_MARK, _NEC_LEADER_SPACE]
    for b in payload_bits:
        out.append(_NEC_BIT_MARK)
        out.append(_NEC_BIT_ONE_SPACE if b else _NEC_BIT_ZERO_SPACE)
    out.append(_NEC_BIT_MARK)
    return out


def _encode_sony_pulses(payload_bits: list[int]) -> list[int]:
    out = [_SONY_LEADER_MARK, _SONY_LEADER_SPACE]
    for b in payload_bits:
        out.append(_SONY_BIT_ONE_MARK if b else _SONY_BIT_ZERO_MARK)
        out.append(_SONY_BIT_SPACE)
    return out


def _encode_mitsubishi_pulses(payload_bytes: bytes) -> list[int]:
    out = [_MITSU_LEADER_MARK, _MITSU_LEADER_SPACE]
    bits: list[int] = []
    for byte in payload_bytes:
        for i in range(8):  # LSB-first
            bits.append((byte >> i) & 1)
    for b in bits:
        out.append(_MITSU_BIT_MARK)
        out.append(_MITSU_BIT_ONE_SPACE if b else _MITSU_BIT_ZERO_SPACE)
    out.append(_MITSU_BIT_MARK)
    return out


def _encode_daikin_pulses(payload_bytes: bytes) -> list[int]:
    out = [_DAIKIN_LEADER_MARK, _DAIKIN_LEADER_SPACE]
    bits: list[int] = []
    for byte in payload_bytes:
        for i in range(8):
            bits.append((byte >> i) & 1)
    for b in bits:
        out.append(_DAIKIN_BIT_MARK)
        out.append(_DAIKIN_BIT_ONE_SPACE if b else _DAIKIN_BIT_ZERO_SPACE)
    out.append(_DAIKIN_BIT_MARK)
    return out


def _encode_gree_pulses(payload_bits: list[int]) -> list[int]:
    """Synthetic Gree first-half frame. Tests use this to validate decoding."""
    out = [_GREE_LEADER_MARK, _GREE_LEADER_SPACE]
    for b in payload_bits:
        out.append(_GREE_BIT_MARK)
        out.append(_GREE_BIT_ONE_SPACE if b else _GREE_BIT_ZERO_SPACE)
    # Pad so the capture exceeds 100 pulses (the Gree decoder's length check).
    # Real Gree captures contain two full halves with a separator, which
    # always pushes them well past 100 pulses; tests need to mimic that.
    while len(out) < 110:
        out.append(_GREE_BIT_MARK)
        out.append(_GREE_BIT_ZERO_SPACE)
    return out


def _encode_toshiba_pulses(payload_bytes: bytes) -> list[int]:
    """Synthetic Toshiba/Electra AC frame. Tests use this to validate decode."""
    out = [_TOSHIBA_LEADER_MARK, _TOSHIBA_LEADER_SPACE]
    for byte in payload_bytes:
        for i in range(8):  # LSB-first
            bit = (byte >> i) & 1
            out.append(_TOSHIBA_BIT_MARK)
            out.append(_TOSHIBA_BIT_ONE_SPACE if bit else _TOSHIBA_BIT_ZERO_SPACE)
    out.append(_TOSHIBA_BIT_MARK)
    return out


def _encode_midea_pulses(payload_bytes: bytes) -> list[int]:
    """Synthetic Midea/Tornado AC frame. Tests use this to validate decode."""
    out = [_MIDEA_LEADER_MARK, _MIDEA_LEADER_SPACE]
    for byte in payload_bytes:
        for i in range(8):  # LSB-first
            bit = (byte >> i) & 1
            out.append(_MIDEA_BIT_MARK)
            out.append(_MIDEA_BIT_ONE_SPACE if bit else _MIDEA_BIT_ZERO_SPACE)
    out.append(_MIDEA_BIT_MARK)
    return out
