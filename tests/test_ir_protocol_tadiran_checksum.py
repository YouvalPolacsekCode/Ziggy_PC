"""
Tadiran checksum — byte 7 = sum of all nibbles of bytes 0-6 (mod 256).

Derived independently from the 3 real captures (2026-05-23, user's Tadiran
inverter). Unlike the arikfe checksum formula (which fails on capture 3 —
see test_ir_protocol_arikfe_cross.py), the nibble-sum fits all three:

    014130000030000c   off @ 24°C   nibbles 0+1+4+1+3+0+3 = 0x0c
    014132000030000e   on  @ 24°C   nibbles 0+1+4+1+3+2+3 = 0x0e
    0141320000c00017   on  @ 25°C   nibbles 0+1+4+1+3+2+c = 0x17

Nibble-sum checksums are characteristic of Gree-family protocols, which
corroborates the Gree-adjacent-sibling conclusion.

EVIDENCE STATUS: three captures, all cool/auto. The temp/mode/fan walk on
real hardware will confirm or kill the formula. If a real capture ever
fails this checksum while the AC visibly responded to the press, the
formula is wrong — remove the gate, keep the raw capture.
"""
import pytest

from services.ir_protocol import (
    _decode_tadiran_ac_state,
    tadiran_checksum,
    tadiran_checksum_ok,
)

# (label, payload_hex, expected power/temp) — the 3 pinned real May captures,
# expectations CORRECTED by the 2026-07-27 walk (temp = byte2/2; power only
# readable on the byte5 ON edge). The original "off@24 / on@24" labels were a
# mislabeled pair one degree apart — see tests/test_ir_protocol_tadiran_walk.py.
CAPTURES = [
    ("state_24c",    "014130000030000c", None, 24),
    ("state_25c",    "014132000030000e", None, 25),
    ("power_on_25c", "0141320000c00017", "on", 25),
]


@pytest.mark.parametrize("label,hex_payload,_p,_t", CAPTURES)
def test_checksum_matches_byte7_on_all_pinned_captures(label, hex_payload, _p, _t):
    payload = bytes.fromhex(hex_payload)
    assert tadiran_checksum(payload) == payload[7]


@pytest.mark.parametrize("label,hex_payload,_p,_t", CAPTURES)
def test_checksum_ok_true_for_pinned_captures(label, hex_payload, _p, _t):
    assert tadiran_checksum_ok(bytes.fromhex(hex_payload)) is True


@pytest.mark.parametrize("label,hex_payload,power,temp", CAPTURES)
def test_valid_captures_still_decode_state(label, hex_payload, power, temp):
    """The checksum gate must not break decoding of known-good payloads."""
    state = _decode_tadiran_ac_state(bytes.fromhex(hex_payload))
    assert state is not None
    assert state.power == power
    assert state.temp == temp


def test_corrupted_temp_bit_fails_checksum_and_yields_no_state():
    """Flip one temp bit without fixing byte 7 — a realistic single-bit RX
    misread. The checksum must catch it and the decoder must refuse to emit
    state rather than report a wrong temperature."""
    corrupted = bytearray(bytes.fromhex("014132000030000e"))
    corrupted[2] &= ~0x02  # temp 25 -> 24, checksum now stale
    corrupted = bytes(corrupted)
    assert tadiran_checksum_ok(corrupted) is False
    assert _decode_tadiran_ac_state(corrupted) is None


def test_corrupted_power_byte_fails_checksum_and_yields_no_state():
    corrupted = bytearray(bytes.fromhex("014132000030000e"))
    corrupted[5] = 0xC0  # forge a power-ON edge, checksum stale
    corrupted = bytes(corrupted)
    assert tadiran_checksum_ok(corrupted) is False
    assert _decode_tadiran_ac_state(corrupted) is None


def test_non_8_byte_payload_is_not_gated():
    """Checksum position is only known for 8-byte frames. Longer/shorter
    payloads return None from the checker and must NOT be rejected by the
    decoder on checksum grounds (current behavior preserved)."""
    payload_10 = bytes.fromhex("014132000030000e") + b"\x00\x00"
    assert tadiran_checksum_ok(payload_10) is None
    state = _decode_tadiran_ac_state(payload_10)
    assert state is not None
    assert state.power is None  # no byte-5 ON edge in this frame
    assert state.temp == 25


def test_short_payload_returns_none_everywhere():
    assert tadiran_checksum_ok(b"\x01\x41") is None
    assert _decode_tadiran_ac_state(b"\x01\x41") is None
