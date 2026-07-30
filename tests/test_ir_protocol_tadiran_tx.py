"""
Tadiran TX synthesis — compose any state frame from the cracked protocol.

The inverse of the walk-validated decoder: target state -> 8-byte payload
(incl. nibble-sum checksum) -> pulse train (two halves, real-capture
timings) -> Broadlink-wrapped raw. Round-trip through our own decoder is
the machine-checkable half of validation; the user's AC responding to a
synthesized frame is the real one.
"""
import base64

import pytest

from services.ir_protocol import (
    _try_decode_tadiran,
    encode_tadiran_state,
    parse_broadlink_raw,
    tadiran_checksum_ok,
)


@pytest.mark.parametrize("mode,temp,fan,swing", [
    ("cool", 24, "auto", False),
    ("cool", 16, "low",  False),
    ("heat", 31, "high", True),
    ("dry",  22, "medium", False),
    ("fan",  27, "low",  True),
    ("auto", 25, "auto", False),
])
def test_roundtrip_through_own_decoder(mode, temp, fan, swing):
    raw = encode_tadiran_state(mode=mode, temp=temp, fan=fan, swing=swing)
    assert raw is not None
    dec = _try_decode_tadiran(parse_broadlink_raw(raw))
    assert dec is not None and dec.ac_state is not None
    st = dec.ac_state
    assert (st.mode, st.temp, st.fan, st.swing) == (mode, temp, fan, swing)
    assert st.power is None  # settings frame carries no toggle marker
    assert tadiran_checksum_ok(bytes.fromhex(dec.payload_hex)) is True
    # both halves present and identical, like the real remote
    assert dec.payload2_hex == dec.payload_hex


def test_power_toggle_frame_carries_marker():
    raw = encode_tadiran_state(mode="cool", temp=24, fan="auto",
                               swing=False, power_toggle=True)
    dec = _try_decode_tadiran(parse_broadlink_raw(raw))
    assert dec.ac_state.power == "toggle"


def test_synthesized_frame_matches_real_capture_bytes():
    """Composing the exact state of a real walk capture must reproduce its
    payload byte-for-byte (cool 24, fan low, no swing -> 0111300000300009)."""
    raw = encode_tadiran_state(mode="cool", temp=24, fan="low", swing=False)
    dec = _try_decode_tadiran(parse_broadlink_raw(raw))
    assert dec.payload_hex == "0111300000300009"


@pytest.mark.parametrize("bad", [
    dict(mode="cool", temp=15, fan="auto", swing=False),   # below range
    dict(mode="cool", temp=32, fan="auto", swing=False),   # above range
    dict(mode="turbo", temp=24, fan="auto", swing=False),  # unknown mode
    dict(mode="cool", temp=24, fan="hurricane", swing=False),
])
def test_invalid_targets_refuse_to_encode(bad):
    assert encode_tadiran_state(**bad) is None
