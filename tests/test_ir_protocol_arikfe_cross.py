"""
Cross-check Tadiran decoder against the arikfe/IRTadiran public reference.

Provenance: https://github.com/arikfe/IRTadiran — Sming/Arduino implementation
based on real Israeli Tadiran captures. The arikfe protocol structure:

    code[0]: 0x01                          (fixed header)
    code[1]: (fan << 4) | mode             (fan upper nibble, mode lower)
    code[2]: temp * 2                      (e.g. 24°C → 0x30)
    code[5]: power                         (0x30 / 0xc0)
    code[6]: swing                         (0xc0 when active)
    code[7]: sum(0..6)
             - (0x0f * (3 + temp/8) + fan * 0x0f + (swing ? 0xb4 : 0))

HISTORY: the May-2026 analysis concluded from 3 captures that our unit
DIVERGED from arikfe on temp and power position. The 2026-07-27 real-
hardware walk (36 checksum-valid captures) overturned that: our unit
FOLLOWS arikfe's structural layout. The May analysis was fooled by two
captures one degree apart (temp*2 flips bit 1 per degree → read as a
power bit).

What actually diverges from arikfe on this unit:

  - mode values: ours 1=cool 2=dry 3=fan 4=heat 5=auto (arikfe: 0=auto)
  - fan values:  ours 1=low 2=medium 3=high 4=auto     (arikfe: 0=auto)
  - byte 5 semantics: arikfe reads it as power STATE; on our unit 0xc0
    appears only on the power-ON press (edge), and OFF is not in this
    half at all (identical bytes to a state frame; OFF lives in half 2)
  - checksum: arikfe's formula fails on our captures; ours is the nibble
    sum of bytes 0-6 (36/36 walk captures + 3/3 May captures)

These tests lock the divergences down with real captures so a future
"helpful" alignment to the arikfe reference fails loudly.
"""
from __future__ import annotations

from services.ir_protocol import (
    _decode_tadiran_ac_state,
    _TADIRAN_FAN_MAP,
    _TADIRAN_MODE_MAP,
    tadiran_checksum,
)


# Real captures. May 2026 + the 2026-07-27 walk (walk order).
CAP_MAY_STATE_24   = bytes.fromhex("014130000030000c")
CAP_MAY_STATE_25   = bytes.fromhex("014132000030000e")
CAP_MAY_POWER_ON   = bytes.fromhex("0141320000c00017")
CAP_WALK_COOL_16   = bytes.fromhex("0111200000300008")
CAP_WALK_AUTO_31   = bytes.fromhex("01153e000030001b")
CAP_WALK_SWING_ON  = bytes.fromhex("01153e000030c027")
CAP_WALK_POWER_ON  = bytes.fromhex("01153e0000c0c030")
CAP_WALK_FAN_AUTO  = bytes.fromhex("01453e000030c02a")


def _arikfe_expected_checksum(payload: bytes, *, temp: int, fan: int, swing: bool) -> int:
    """Replicate arikfe's checksum formula. Public reference."""
    s = sum(payload[:7])
    return (s - (0x0f * (3 + temp // 8) + fan * 0x0f + (0xb4 if swing else 0))) & 0xFF


# ---------------------------------------------------------------------------
# Structural agreement with arikfe (validated by the walk)
# ---------------------------------------------------------------------------

def test_byte2_is_temp_times_two_like_arikfe():
    assert _decode_tadiran_ac_state(CAP_WALK_COOL_16).temp == 16   # 0x20/2
    assert _decode_tadiran_ac_state(CAP_WALK_AUTO_31).temp == 31   # 0x3e/2
    assert _decode_tadiran_ac_state(CAP_MAY_STATE_24).temp == 24   # 0x30/2


def test_byte1_nibble_layout_like_arikfe():
    st = _decode_tadiran_ac_state(CAP_WALK_FAN_AUTO)  # 0x45 = fan 4 | mode 5
    assert st.fan == "auto"
    assert st.mode == "auto"


def test_byte6_swing_like_arikfe():
    assert _decode_tadiran_ac_state(CAP_WALK_SWING_ON).swing is True
    assert _decode_tadiran_ac_state(CAP_WALK_COOL_16).swing is False


# ---------------------------------------------------------------------------
# Divergences from arikfe (locked with real captures)
# ---------------------------------------------------------------------------

def test_mode_auto_is_5_not_0():
    assert _TADIRAN_MODE_MAP[0x5] == "auto"
    assert 0x0 not in _TADIRAN_MODE_MAP


def test_fan_auto_is_4_not_0():
    assert _TADIRAN_FAN_MAP[0x4] == "auto"
    assert 0x0 not in _TADIRAN_FAN_MAP


def test_byte5_is_a_power_on_edge_not_a_state_bit():
    """arikfe reads byte 5 as power state. Our walk shows 0x30 on frames
    sent while the AC was RUNNING (whole temp ladder), and a controlled
    pair showed a 0xc0 frame turning the AC OFF — the marker alternates
    per power press without encoding direction. It flags A power press,
    not which way."""
    assert _decode_tadiran_ac_state(CAP_WALK_POWER_ON).power == "toggle"
    assert _decode_tadiran_ac_state(CAP_WALK_COOL_16).power is None
    assert _decode_tadiran_ac_state(CAP_MAY_STATE_25).power is None


def test_arikfe_checksum_is_special_case_of_nibble_sum():
    """Resolution of the May checksum tripwire: arikfe's formula is an
    algebraic special case of the nibble sum. byte_sum - 15*sum(high
    nibbles) == nibble_sum, and arikfe's subtraction term equals
    15*sum(high nibbles) for the frame shapes they modeled. It agrees on
    plain state frames (walk capture) but fails on power-ON frames whose
    byte5=0xc0 high nibble their model never saw. The nibble sum is the
    general form and holds on both."""
    plain = CAP_WALK_AUTO_31
    assert _arikfe_expected_checksum(plain, temp=31, fan=1, swing=False) == plain[7]
    assert tadiran_checksum(plain) == plain[7]

    power_on = CAP_MAY_POWER_ON
    assert _arikfe_expected_checksum(power_on, temp=25, fan=4, swing=False) != power_on[7]
    assert tadiran_checksum(power_on) == power_on[7]


def test_nibble_checksum_holds_across_all_pinned_captures():
    for cap in [CAP_MAY_STATE_24, CAP_MAY_STATE_25, CAP_MAY_POWER_ON,
                CAP_WALK_COOL_16, CAP_WALK_AUTO_31, CAP_WALK_SWING_ON,
                CAP_WALK_POWER_ON, CAP_WALK_FAN_AUTO]:
        assert tadiran_checksum(cap) == cap[7]
