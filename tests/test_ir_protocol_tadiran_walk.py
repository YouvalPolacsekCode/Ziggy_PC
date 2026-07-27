"""
Tadiran decoder — pinned against the 2026-07-27 real-hardware remote walk.

36 checksum-valid captures from the user's Tadiran inverter (Broadlink RM4
RX) established the TRUE byte layout, overturning the May-2026 hypothesis:

    byte 0  : 0x01 fixed header
    byte 1  : fan (upper nibble) | mode (lower nibble)
              mode: 1=cool 2=dry 3=fan 4=heat 5=auto   (all 5 walked live)
              fan:  1=low  2=medium 3=high 4=auto      (full cycle walked)
    byte 2  : temperature * 2   (16..31°C walked press-by-press)
    byte 5  : 0xc0 on the power-ON press; 0x30 otherwise. NOT a power-state
              bit: frames sent while the AC is running still carry 0x30, and
              the power-OFF press emits a payload byte-identical to a plain
              state frame (see HALF-2 note below). Treat 0xc0 as an ON edge;
              0x30 says nothing.
    byte 6  : 0xc0 = swing on, 0x00 = swing off (both edges walked live)
    byte 7  : checksum = sum of nibbles of bytes 0-6 (mod 256) — 36/36

The May-2026 "power = byte 2 bit 1" reading was an artifact: its two
captures differed by one degree, and temp*2 flips bit 1 per degree. That
artifact caused the walk's on/off/on/off display flapping.

HALF-2: the frame transmits 64 bits twice; the halves are NOT identical —
the power-OFF press is distinguishable only in half 2 (half 1 of OFF ==
half 1 of a swing refresh). Decoding half 2 is the remaining work; until
then power-off is undetectable from IR (state keeps last known).
"""
import pytest

from services.ir_protocol import _decode_tadiran_ac_state, tadiran_checksum_ok

# (payload_hex, expected power, mode, temp, fan) — real captures, walk order.
# power=None means "frame carries no power information".
WALK = [
    # temp ladder down 23→16 (cool, fan low)
    ("01112e0000300016", None, "cool", 23, "low"),
    ("01112a0000300012", None, "cool", 21, "low"),
    ("0111280000300010", None, "cool", 20, "low"),
    ("011126000030000e", None, "cool", 19, "low"),
    ("011124000030000c", None, "cool", 18, "low"),
    ("011122000030000a", None, "cool", 17, "low"),
    ("0111200000300008", None, "cool", 16, "low"),
    # ladder up ends 31
    ("01113c0000300015", None, "cool", 30, "low"),
    ("01113e0000300017", None, "cool", 31, "low"),
    # mode cycle
    ("01133e0000300019", None, "fan",  31, "low"),
    ("01233e000030001a", None, "fan",  31, "medium"),
    ("01223e0000300019", None, "dry",  31, "medium"),
    ("01143e000030001a", None, "heat", 31, "low"),
    ("01153e000030001b", None, "auto", 31, "low"),
    # swing on (state otherwise unchanged)
    ("01153e000030c027", None, "auto", 31, "low"),
    # finale: power-ON press → byte5 = 0xc0
    ("01153e0000c0c030", "on", "auto", 31, "low"),
    # fan cycle 1→2→3→4→1
    ("01253e000030c028", None, "auto", 31, "medium"),
    ("01353e000030c029", None, "auto", 31, "high"),
    ("01453e000030c02a", None, "auto", 31, "auto"),
    # swing back off
    ("01353e000030001d", None, "auto", 31, "high"),
]

MAY_CAPTURES = [
    # Reinterpreted under the true map. "May-2 was ON at 24" was a mislabel:
    # byte 2 says 25°C and byte 5 says no power edge.
    ("014130000030000c", None, "cool", 24, "auto"),
    ("014132000030000e", None, "cool", 25, "auto"),
    ("0141320000c00017", "on", "cool", 25, "auto"),  # the May power-ON press
]


@pytest.mark.parametrize("hex_payload,power,mode,temp,fan", WALK + MAY_CAPTURES)
def test_walk_capture_decodes(hex_payload, power, mode, temp, fan):
    st = _decode_tadiran_ac_state(bytes.fromhex(hex_payload))
    assert st is not None
    assert st.power == power
    assert st.mode == mode
    assert st.temp == temp
    assert st.fan == fan


@pytest.mark.parametrize("hex_payload,_p,_m,_t,_f", WALK + MAY_CAPTURES)
def test_all_real_captures_pass_checksum(hex_payload, _p, _m, _t, _f):
    assert tadiran_checksum_ok(bytes.fromhex(hex_payload)) is True


def test_swing_decodes_on_and_off():
    on = _decode_tadiran_ac_state(bytes.fromhex("01153e000030c027"))
    off = _decode_tadiran_ac_state(bytes.fromhex("01353e000030001d"))
    assert on.swing is True
    assert off.swing is False


def test_power_off_frame_is_indistinguishable_from_state_frame():
    """The 12:05:40 power-OFF press == the 11:59:02 swing press, byte for
    byte. Pin this so nobody reintroduces a half-1 'off' bit: OFF must come
    from half 2, never from these bytes."""
    off_press = "01153e000030c027"
    swing_press = "01153e000030c027"
    assert off_press == swing_press
    st = _decode_tadiran_ac_state(bytes.fromhex(off_press))
    assert st.power is None  # never guess "off" from a half-1 frame


def test_temp_out_of_range_rejected():
    # byte2 = 0x60 → 48°C — nonsense, must not decode a temp.
    bad = bytearray(bytes.fromhex("0111300000300009"))
    bad[2] = 0x60
    bad[7] = (sum((b >> 4) + (b & 15) for b in bad[:7])) & 0xFF
    st = _decode_tadiran_ac_state(bytes(bad))
    assert st is None or st.temp is None


# ---------------------------------------------------------------------------
# Frame half 2 — the carrier of the power-OFF distinction
# ---------------------------------------------------------------------------

def _tadiran_pulses_from_bytes(data: bytes) -> list[int]:
    """Synthesize one half's pulse-pairs (bit1 = long mark/short space)."""
    pulses = []
    for byte in data:
        for bit_i in range(8):  # LSB first, matching _bits_to_bytes
            if (byte >> bit_i) & 1:
                pulses += [1870, 690]
            else:
                pulses += [620, 1938]
    return pulses


def test_two_half_frame_decodes_both_halves():
    from services.ir_protocol import _try_decode_tadiran
    half1 = bytes.fromhex("01153e000030c027")
    half2 = bytes.fromhex("01153e000030c0aa")  # deliberately different
    pulses = ([8500, 4630] + _tadiran_pulses_from_bytes(half1)
              + [620, 33000]                    # inter-half gap
              + [8500, 4630] + _tadiran_pulses_from_bytes(half2)
              + [620, 13000])                   # trailer
    dec = _try_decode_tadiran(pulses)
    assert dec is not None
    assert dec.payload_hex == half1.hex()
    assert dec.payload2_hex == half2.hex()


def test_single_half_frame_still_decodes_with_empty_half2():
    from services.ir_protocol import _try_decode_tadiran
    half1 = bytes.fromhex("0111300000300009")
    pulses = [8500, 4630] + _tadiran_pulses_from_bytes(half1) + [620, 13000]
    dec = _try_decode_tadiran(pulses)
    assert dec is not None
    assert dec.payload_hex == half1.hex()
    assert dec.payload2_hex == ""
