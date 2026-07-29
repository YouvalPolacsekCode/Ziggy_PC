"""
Protocol cards — the data-driven engine must reproduce the hand decoders
exactly on every pinned real capture, and its encoders must round-trip
through the existing pulse decoders. Cards are the substrate for the
walk-wizard analyzer and the cloud registry; drift here is drift
everywhere.
"""
import pytest

from services.ir_protocol import (
    _decode_tadiran_ac_state,
    _decode_toshiba_ac_state,
    _decode_midea_ac_state,
    _try_decode_tadiran,
    _try_decode_toshiba_ac,
    _try_decode_midea_ac,
    encode_tadiran_state,
    parse_broadlink_raw,
)
from services.ir_protocol_cards import (
    CARDS, TADIRAN_V1, TOSHIBA_ELECTRA_V0, MIDEA_TORNADO_V0,
    card_checksum_ok, card_for_family, decode_payload, encode_pulses,
    encode_state,
)

# Every pinned real Tadiran capture from the walk + May (the ground truth).
TADIRAN_REAL = [
    "01112e0000300016", "01112a0000300012", "0111280000300010",
    "011126000030000e", "011124000030000c", "011122000030000a",
    "0111200000300008", "01113c0000300015", "01113e0000300017",
    "01133e0000300019", "01233e000030001a", "01223e0000300019",
    "01143e000030001a", "01153e000030001b", "01153e000030c027",
    "01153e0000c0c030", "01253e000030c028", "01353e000030c029",
    "01453e000030c02a", "01353e000030001d",
    "014130000030000c", "014132000030000e", "0141320000c00017",
    "01112c0000c0001d", "01112c0000300014", "01112e0000c0001f",
    "0111300000300009",
]


@pytest.mark.parametrize("hex_payload", TADIRAN_REAL)
def test_tadiran_card_matches_hand_decoder_on_every_real_capture(hex_payload):
    payload = bytes.fromhex(hex_payload)
    hand = _decode_tadiran_ac_state(payload)
    card = decode_payload(TADIRAN_V1, payload)
    assert hand is not None and card is not None
    assert card["power"] == hand.power
    assert card["mode"] == hand.mode
    assert card["temp"] == hand.temp
    assert card["fan"] == hand.fan
    assert card["swing"] == hand.swing


@pytest.mark.parametrize("hex_payload", TADIRAN_REAL)
def test_tadiran_card_checksum_on_every_real_capture(hex_payload):
    assert card_checksum_ok(TADIRAN_V1, bytes.fromhex(hex_payload)) is True


def test_tadiran_card_encode_matches_hand_encoder():
    for mode in ("cool", "dry", "fan", "heat", "auto"):
        for temp in (16, 24, 31):
            for fan in ("low", "medium", "high", "auto"):
                hand_raw = encode_tadiran_state(mode=mode, temp=temp, fan=fan,
                                                swing=False)
                card_payload = encode_state(TADIRAN_V1, mode=mode, temp=temp,
                                            fan=fan, swing=False)
                card_raw = encode_pulses(TADIRAN_V1, card_payload)
                hand_dec = _try_decode_tadiran(parse_broadlink_raw(hand_raw))
                card_dec = _try_decode_tadiran(parse_broadlink_raw(card_raw))
                assert card_dec.payload_hex == hand_dec.payload_hex


def test_tadiran_card_toggle_frame():
    p = encode_state(TADIRAN_V1, mode="cool", temp=24, fan="auto",
                     swing=False, power_toggle=True)
    assert decode_payload(TADIRAN_V1, p)["power"] == "toggle"


def test_tadiran_card_rejects_out_of_envelope():
    assert encode_state(TADIRAN_V1, mode="cool", temp=35, fan="auto") is None
    assert encode_state(TADIRAN_V1, mode="turbo", temp=24, fan="auto") is None


def test_tadiran_card_rejects_corrupt_checksum():
    bad = bytearray(bytes.fromhex("0111300000300009"))
    bad[2] ^= 0x02  # stale checksum
    assert decode_payload(TADIRAN_V1, bytes(bad)) is None


# ---------------------------------------------------------------------------
# Toshiba/Electra + Midea/Tornado — EXPERIMENTAL cards. Cross-checked
# against the branch's hand decoders (themselves pinned to IRremoteESP8266
# synthetic vectors). Real Electra/Tornado walks flip rx/tx_validated.
# ---------------------------------------------------------------------------

def test_toshiba_card_encode_roundtrips_through_hand_decoder():
    payload = encode_state(TOSHIBA_ELECTRA_V0, mode="cool", temp=24, fan="auto")
    assert payload is not None
    raw = encode_pulses(TOSHIBA_ELECTRA_V0, payload)
    dec = _try_decode_toshiba_ac(parse_broadlink_raw(raw))
    assert dec is not None and dec.ac_state is not None
    assert dec.ac_state.temp == 24
    assert dec.ac_state.mode == "cool"
    assert dec.ac_state.fan == "auto"


def test_toshiba_card_decode_matches_hand_decoder():
    payload = encode_state(TOSHIBA_ELECTRA_V0, mode="heat", temp=21, fan="high")
    hand = _decode_toshiba_ac_state(payload)
    card = decode_payload(TOSHIBA_ELECTRA_V0, payload)
    assert hand is not None and card is not None
    assert card["mode"] == hand.mode == "heat"
    assert card["temp"] == hand.temp == 21
    assert card["fan"] == hand.fan == "high"


def test_midea_card_roundtrip_and_hand_agreement():
    payload = encode_state(MIDEA_TORNADO_V0, mode="cool", temp=24, power="on")
    assert payload is not None
    # complete the a^b == 0xFF integrity pairs the way real Midea frames do
    fixed = bytearray(payload)
    for a, b in ((0, 1), (2, 3), (4, 5)):
        fixed[b] = fixed[a] ^ 0xFF
    fixed = bytes(fixed)
    hand = _decode_midea_ac_state(fixed)
    card = decode_payload(MIDEA_TORNADO_V0, fixed)
    assert hand is not None and card is not None
    assert card["mode"] == hand.mode == "cool"
    assert card["temp"] == hand.temp == 24
    assert card["power"] == hand.power == "on"


# ---------------------------------------------------------------------------
# Registry semantics
# ---------------------------------------------------------------------------

def test_only_validated_cards_offered_for_tx():
    assert card_for_family("tadiran_ac", tx_only=True) is TADIRAN_V1
    assert card_for_family("toshiba_ac", tx_only=True) is None
    assert card_for_family("midea_ac", tx_only=True) is None
    assert card_for_family("toshiba_ac") is TOSHIBA_ELECTRA_V0


def test_cards_are_json_serializable():
    import json
    for card in CARDS.values():
        assert json.loads(json.dumps(card)) == card
