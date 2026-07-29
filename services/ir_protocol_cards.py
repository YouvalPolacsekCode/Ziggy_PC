"""
AC protocol cards — data-driven decode/encode for stateful IR protocols.

A card is a JSON-serializable description of one AC protocol family:
pulse timings, frame structure, field layout (where temp/mode/fan/swing/
power live and how they're coded), and the checksum formula. One generic
engine executes every card in both directions — cracking a new brand
means writing DATA, not code. This is the substrate for the walk-wizard
auto-analyzer (its output is a card) and the cloud protocol registry
(which ships cards between homes).

Field spec mini-language (per field name):
  {"byte": N, "mask": M, "shift": S}          — where the raw bits live
  + one of:
    "map":   {raw_value: label, ...}          — enum fields (mode, fan)
    "codec": {"type": "scale", "mul": k, "offset": o}
                                              — numeric fields: raw = (v+o)*k
    "kind":  "value_flag",  "on": V, "off": V2 — whole-byte flag (swing)
    "kind":  "toggle_marker", "marker": V, "rest": V2
                                              — power press marker (Tadiran):
                                                decode → "toggle"/None,
                                                encode(power_toggle=True) → marker
    "kind":  "bit_flag", "on_is": 1           — power as a real state bit

Checksum spec: {"type": "nibble_sum"|"byte_sum"|"xor"|"none", "byte": N}
Validators: [{"type": "byte_pair_complement", "pairs": [[0,1],[2,3]]}]
            (Midea-style a ^ b == 0xFF integrity pairs)

Validation flags per card:
  rx_validated — decode confirmed against real captures from a real unit
  tx_validated — a real AC obeyed a frame this card composed
Only tx_validated cards may be used for command synthesis (ir_manager).
NEVER flip these flags without real-hardware evidence — the user's rule.
"""
from __future__ import annotations

from typing import Any, Optional

from services.ir_protocol import encode_broadlink_raw


# ---------------------------------------------------------------------------
# Checksums + validators
# ---------------------------------------------------------------------------

def card_checksum(card: dict, payload: bytes) -> Optional[int]:
    spec = card.get("checksum") or {}
    ctype, target = spec.get("type", "none"), spec.get("byte")
    if ctype == "none" or target is None:
        return None
    data = payload[:target]
    if ctype == "nibble_sum":
        return sum((b >> 4) + (b & 0x0F) for b in data) & 0xFF
    if ctype == "byte_sum":
        return sum(data) & 0xFF
    if ctype == "xor":
        out = 0
        for b in data:
            out ^= b
        return out
    return None


def card_checksum_ok(card: dict, payload: bytes) -> Optional[bool]:
    spec = card.get("checksum") or {}
    target = spec.get("byte")
    if target is None or len(payload) != card["timings"]["frame_bytes"]:
        return None
    expected = card_checksum(card, payload)
    return None if expected is None else expected == payload[target]


def _validators_ok(card: dict, payload: bytes) -> bool:
    for v in card.get("validators") or []:
        if v.get("type") == "byte_pair_complement":
            for a, b in v.get("pairs", []):
                if len(payload) <= max(a, b):
                    return False
                if bin((payload[a] ^ payload[b]) ^ 0xFF).count("1") > 2:
                    return False
    return True


# ---------------------------------------------------------------------------
# Field decode / encode
# ---------------------------------------------------------------------------

def _field_raw(payload: bytes, spec: dict) -> Optional[int]:
    byte = spec.get("byte")
    if byte is None or byte >= len(payload):
        return None
    return (payload[byte] & spec.get("mask", 0xFF)) >> spec.get("shift", 0)


def decode_payload(card: dict, payload: bytes) -> Optional[dict]:
    """Payload bytes → {"temp": 24, "mode": "cool", ...}. None = reject.

    Semantics mirror the hand-written Tadiran decoder the 2026-07-27 walk
    validated: checksum-gated, range-gated numerics return None per-field,
    toggle markers decode to "toggle"/None, all-unrecognizable → reject.
    """
    frame_bytes = card["timings"]["frame_bytes"]
    if len(payload) < frame_bytes:
        return None
    if card_checksum_ok(card, payload) is False:
        return None
    if not _validators_ok(card, payload):
        return None

    out: dict[str, Any] = {}
    for name, spec in (card.get("fields") or {}).items():
        raw = _field_raw(payload, spec)
        if raw is None:
            out[name] = None
            continue
        kind = spec.get("kind")
        if kind == "toggle_marker":
            whole = payload[spec["byte"]]
            out[name] = "toggle" if whole == spec["marker"] else None
        elif kind == "value_flag":
            out[name] = payload[spec["byte"]] == spec["on"]
        elif kind == "bit_flag":
            out[name] = "on" if raw == spec.get("on_is", 1) else "off"
        elif "map" in spec:
            out[name] = spec["map"].get(str(raw), spec["map"].get(raw))
        elif "codec" in spec:
            c = spec["codec"]
            if c.get("type") == "scale":
                mul = c.get("mul", 1)
                if mul and raw % mul == 0:
                    val = raw // mul - c.get("offset", 0)
                else:
                    val = None
                if val is not None and not (spec.get("min", -999) <= val <= spec.get("max", 999)):
                    val = None
                out[name] = val
            else:
                out[name] = raw
        else:
            out[name] = raw

    if all(v in (None, False) for v in out.values()):
        return None
    return out


def encode_state(card: dict, *, power_toggle: bool = False, **values) -> Optional[bytes]:
    """Target state → payload bytes, or None outside the validated envelope.

    Never guess on TX — a wrong frame changes someone's real AC.
    """
    frame_bytes = card["timings"]["frame_bytes"]
    payload = bytearray(frame_bytes)
    for pos, val in (card.get("const_bytes") or {}).items():
        payload[int(pos)] = val

    for name, spec in (card.get("fields") or {}).items():
        kind = spec.get("kind")
        byte, shift = spec.get("byte"), spec.get("shift", 0)
        if kind == "toggle_marker":
            payload[byte] = spec["marker"] if power_toggle else spec["rest"]
        elif kind == "value_flag":
            payload[byte] = spec["on"] if values.get(name) else spec.get("off", 0)
        elif kind == "bit_flag":
            if values.get(name) in ("on", True):
                payload[byte] |= (spec.get("on_is", 1) << shift) & spec.get("mask", 0xFF)
        elif "map" in spec:
            val = values.get(name)
            if val is None:
                return None
            inv = {v: k for k, v in spec["map"].items()}
            raw = inv.get(val)
            if raw is None:
                return None
            payload[byte] |= (int(raw) << shift) & spec.get("mask", 0xFF)
        elif "codec" in spec:
            val = values.get(name)
            try:
                val = int(val)
            except (TypeError, ValueError):
                return None
            if not (spec.get("min", -999) <= val <= spec.get("max", 999)):
                return None
            c = spec["codec"]
            if c.get("type") == "scale":
                raw = (val + c.get("offset", 0)) * c.get("mul", 1)
                payload[byte] |= (raw << shift) & spec.get("mask", 0xFF)

    spec = card.get("checksum") or {}
    if spec.get("type", "none") != "none" and spec.get("byte") is not None:
        payload[spec["byte"]] = card_checksum(card, bytes(payload))
    return bytes(payload)


# ---------------------------------------------------------------------------
# Pulse-level encode (TX). Both AC pulse encodings.
# ---------------------------------------------------------------------------

def encode_pulses(card: dict, payload: bytes) -> bytes:
    """Payload → full Broadlink-wrapped raw transmission per card timings."""
    t = card["timings"]
    bit1, bit0 = tuple(t["bit1"]), tuple(t["bit0"])
    bit_pulses: list[int] = []
    for byte in payload:
        bit_range = range(8) if t.get("lsb_first", True) else range(7, -1, -1)
        for i in bit_range:
            bit_pulses.extend(bit1 if (byte >> i) & 1 else bit0)
    half = list(t["leader"]) + bit_pulses
    halves = t.get("halves", 1)
    pulses: list[int] = []
    for h in range(halves):
        if h == 0 or t.get("repeat_leader", True):
            pulses += half
        else:
            pulses += bit_pulses
        pulses += list(t["inter_frame"] if h < halves - 1 else t["trailer"])
    return encode_broadlink_raw(pulses)


# ---------------------------------------------------------------------------
# The card registry
# ---------------------------------------------------------------------------

# Tadiran — FULLY REAL-HARDWARE VALIDATED (2026-07-27 walk, 40+ captures;
# TX synthesis obeyed by the user's inverter on 2026-07-29).
TADIRAN_V1 = {
    "id": "tadiran_v1",
    "family": "tadiran_ac",
    "brand": "tadiran",
    "rx_validated": True,
    "tx_validated": True,
    "timings": {
        "encoding": "pulse_pair_inversion",
        "leader": [8470, 4680], "bit1": [1840, 700], "bit0": [600, 1950],
        "frame_bytes": 8, "halves": 2, "lsb_first": True,
        "inter_frame": [1700, 33000], "trailer": [1700, 100000],
        "repeat_leader": True,
    },
    "checksum": {"type": "nibble_sum", "byte": 7},
    "const_bytes": {"0": 0x01},
    "fields": {
        "temp":  {"byte": 2, "mask": 0xFF, "shift": 0,
                  "codec": {"type": "scale", "mul": 2, "offset": 0},
                  "min": 16, "max": 31},
        "mode":  {"byte": 1, "mask": 0x0F, "shift": 0,
                  "map": {"1": "cool", "2": "dry", "3": "fan",
                          "4": "heat", "5": "auto"}},
        "fan":   {"byte": 1, "mask": 0xF0, "shift": 4,
                  "map": {"1": "low", "2": "medium", "3": "high", "4": "auto"}},
        "swing": {"byte": 6, "kind": "value_flag", "on": 0xC0, "off": 0x00},
        "power": {"byte": 5, "kind": "toggle_marker",
                  "marker": 0xC0, "rest": 0x30},
    },
}

# Toshiba family (Electra-internals candidate) — layout mirrors the hand
# decoder pinned against IRremoteESP8266 synthetic vectors. EXPERIMENTAL:
# no real Electra/Toshiba captures yet; tx stays OFF until a beta walk.
TOSHIBA_ELECTRA_V0 = {
    "id": "toshiba_electra_v0",
    "family": "toshiba_ac",
    "brand": "toshiba",
    "rx_validated": False,
    "tx_validated": False,
    "timings": {
        "encoding": "pulse_distance",
        "leader": [4400, 4400], "bit1": [543, 1623], "bit0": [543, 472],
        "frame_bytes": 9, "halves": 1, "lsb_first": True,
        "inter_frame": [543, 7048], "trailer": [543, 7048],
        "repeat_leader": True,
    },
    "checksum": {"type": "none"},
    "const_bytes": {"0": 0xF2, "1": 0x0D, "2": 0x03, "3": 0xFC},
    "fields": {
        "temp": {"byte": 5, "mask": 0xF0, "shift": 4,
                 "codec": {"type": "scale", "mul": 1, "offset": -17},
                 "min": 17, "max": 30},
        "mode": {"byte": 6, "mask": 0xE0, "shift": 5,
                 "map": {"0": "auto", "1": "cool", "2": "dry",
                         "3": "heat", "4": "fan"}},
        "fan":  {"byte": 6, "mask": 0x07, "shift": 0,
                 "map": {"0": "auto", "2": "low", "3": "medium", "5": "medium",
                         "7": "high"}},
    },
}

# Midea family (Tornado-internals candidate) — mirrors the hand decoder's
# byte-4 layout + the a^b==0xFF integrity pairs. EXPERIMENTAL like Toshiba.
MIDEA_TORNADO_V0 = {
    "id": "midea_tornado_v0",
    "family": "midea_ac",
    "brand": "midea",
    "rx_validated": False,
    "tx_validated": False,
    "timings": {
        "encoding": "pulse_distance",
        "leader": [4480, 4480], "bit1": [560, 1680], "bit0": [560, 560],
        "frame_bytes": 6, "halves": 2, "lsb_first": True,
        "inter_frame": [560, 5600], "trailer": [560, 100000],
        "repeat_leader": True,
    },
    "checksum": {"type": "none"},
    "validators": [{"type": "byte_pair_complement", "pairs": [[0, 1], [2, 3], [4, 5]]}],
    "const_bytes": {"0": 0xB2},
    "fields": {
        "power": {"byte": 4, "mask": 0x10, "shift": 4, "kind": "bit_flag", "on_is": 1},
        "mode":  {"byte": 4, "mask": 0xE0, "shift": 5,
                  "map": {"0": "cool", "1": "dry", "2": "auto",
                          "3": "heat", "4": "fan"}},
        "temp":  {"byte": 4, "mask": 0x0F, "shift": 0,
                  "codec": {"type": "scale", "mul": 1, "offset": -17},
                  "min": 17, "max": 30},
    },
}

CARDS: dict[str, dict] = {c["id"]: c for c in (TADIRAN_V1, TOSHIBA_ELECTRA_V0,
                                               MIDEA_TORNADO_V0)}


def card_for_family(family: str, *, tx_only: bool = False) -> Optional[dict]:
    """Find the card handling a decode family (e.g. 'tadiran_ac')."""
    for card in CARDS.values():
        if card["family"] == family and (card.get("tx_validated") or not tx_only):
            return card
    return None
