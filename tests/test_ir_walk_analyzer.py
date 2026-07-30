"""
Walk analyzer — must re-crack Tadiran blind.

The acceptance bar: given an ordered, labeled capture session (what the
walk wizard collects), the analyzer must derive a protocol card equivalent
to TADIRAN_V1 — the card a human reverse-engineered from the real
2026-07-27 walk — WITHOUT knowing the protocol family. Sessions here are
synthesized through the validated card engine, so every frame is exactly
what the real remote emits (same bytes, same pulse timings).
"""
import base64

import pytest

from services.ir_protocol_cards import TADIRAN_V1, encode_pulses, encode_state
from services.ir_walk_analyzer import analyze_walk_session


def _step(label, payload, observed=None):
    return {
        "label": label,
        "raw_b64": base64.b64encode(encode_pulses(TADIRAN_V1, payload)).decode(),
        "observed": observed or {},
    }


def _frame(mode="cool", temp=23, fan="low", swing=False, toggle=False):
    return encode_state(TADIRAN_V1, mode=mode, temp=temp, fan=fan,
                        swing=swing, power_toggle=toggle)


def _tadiran_session(drop_ladder_step=False):
    steps = [_step("baseline", _frame(temp=23),
                   {"mode": "cool", "temp": 23, "fan": "low", "swing": False})]
    # temp ladder down 23 -> 16
    for t in range(22, 15, -1):
        if drop_ladder_step and t == 19:
            continue  # simulate an RX miss
        obs = {"temp": 16} if t == 16 else {}
        steps.append(_step("temp_down", _frame(temp=t), obs))
    # ladder up 16 -> 31
    for t in range(17, 32):
        obs = {"temp": 31} if t == 31 else {}
        steps.append(_step("temp_up", _frame(temp=t), obs))
    # mode cycle at 31 (observed on the AC display per press)
    for m in ("dry", "fan", "heat", "auto"):
        steps.append(_step("mode", _frame(mode=m, temp=31), {"mode": m}))
    # fan cycle (in auto mode)
    for f in ("medium", "high", "auto", "low"):
        steps.append(_step("fan", _frame(mode="auto", temp=31, fan=f), {"fan": f}))
    # swing on, then off
    steps.append(_step("swing", _frame(mode="auto", temp=31, swing=True), {"swing": True}))
    steps.append(_step("swing", _frame(mode="auto", temp=31, swing=False), {"swing": False}))
    # power presses: marker alternates c0/30 regardless of direction
    steps.append(_step("power", _frame(mode="auto", temp=31, toggle=True), {"result": "turned_off"}))
    steps.append(_step("power", _frame(mode="auto", temp=31, toggle=False), {"result": "turned_on"}))
    steps.append(_step("power", _frame(mode="auto", temp=31, toggle=True), {"result": "turned_off"}))
    steps.append(_step("power", _frame(mode="auto", temp=31, toggle=False), {"result": "turned_on"}))
    return steps


def test_analyzer_recracks_tadiran_blind():
    result = analyze_walk_session(_tadiran_session())
    card = result["card"]

    t = card["timings"]
    assert t["encoding"] == "pulse_pair_inversion"
    assert t["frame_bytes"] == 8
    assert t["lsb_first"] is True
    assert t["halves"] == 2

    f = card["fields"]
    assert f["temp"]["byte"] == 2
    assert f["temp"]["codec"] == {"type": "scale", "mul": 2, "offset": 0}
    assert f["temp"]["min"] == 16 and f["temp"]["max"] == 31

    assert f["mode"]["byte"] == 1 and f["mode"]["mask"] == 0x0F
    assert {k: v for k, v in f["mode"]["map"].items()} == {
        "1": "cool", "2": "dry", "3": "fan", "4": "heat", "5": "auto"}

    assert f["fan"]["byte"] == 1 and f["fan"]["mask"] == 0xF0 and f["fan"]["shift"] == 4
    assert f["fan"]["map"] == {"1": "low", "2": "medium", "3": "high", "4": "auto"}

    assert f["swing"] == {"byte": 6, "kind": "value_flag", "on": 0xC0, "off": 0x00}
    assert f["power"] == {"byte": 5, "kind": "toggle_marker",
                          "marker": 0xC0, "rest": 0x30}

    assert card["checksum"] == {"type": "nibble_sum", "byte": 7}
    assert card["const_bytes"] == {"0": 0x01}
    assert card["rx_validated"] is False and card["tx_validated"] is False
    assert result["unresolved"] == []


def test_analyzer_survives_a_missed_ladder_press():
    result = analyze_walk_session(_tadiran_session(drop_ladder_step=True))
    f = result["card"]["fields"]
    assert f["temp"]["byte"] == 2
    assert f["temp"]["codec"]["mul"] == 2


def test_analyzer_reports_unresolved_when_steps_missing():
    steps = _tadiran_session()
    steps = [s for s in steps if s["label"] not in ("swing", "power")]
    result = analyze_walk_session(steps)
    assert "swing" in result["unresolved"]
    assert "power" in result["unresolved"]
    # what WAS walked still resolves
    assert result["card"]["fields"]["temp"]["byte"] == 2


def test_analyzer_card_roundtrips_through_engine():
    """The emitted card must be executable by the card engine: encode a
    state, decode it back, byte-identical to the real protocol."""
    from services.ir_protocol_cards import decode_payload
    card = analyze_walk_session(_tadiran_session())["card"]
    payload = encode_state(card, mode="cool", temp=24, fan="low", swing=False)
    real = encode_state(TADIRAN_V1, mode="cool", temp=24, fan="low", swing=False)
    assert payload == real
    decoded = decode_payload(card, payload)
    assert decoded["temp"] == 24 and decoded["mode"] == "cool"
