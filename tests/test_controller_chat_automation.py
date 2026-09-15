"""Building a button automation from chat.

"When I press the left button, turn on the office light" is the whole point of
owning a wireless remote, so the assistant must be able to see the controller
and refuse cleanly rather than inventing one.
"""
from __future__ import annotations

import pytest

from services import controllers as C
from core.handlers import automation_handler as H


IEEE = "0x54ef441001782d71"
TOPIC = f"zigbee2mqtt/{IEEE}/action"


@pytest.fixture(autouse=True)
def _known(monkeypatch):
    monkeypatch.setattr(C, "cached", lambda: [{
        "ieee": IEEE,
        "name": "Hallway Switch",
        "model_id": "WXKG22LM",
        "actions": [
            {"subtype": s, "label": C.action_label(s), "type": "action",
             "topic": TOPIC, "payload": s}
            for s in ("single_left", "single_right", "hold_both")
        ],
    }])


def test_resolves_a_button_by_controller_id():
    out = H._resolve_controller_trigger(IEEE, "single_left")
    assert out["trigger"]["topic"] == TOPIC
    assert out["trigger"]["payload"] == "single_left"
    assert out["trigger"]["label"] == "Left button — single press"


def test_resolves_by_the_name_a_user_would_say():
    out = H._resolve_controller_trigger("hallway switch", "hold_both")
    assert out["trigger"]["controller_id"] == IEEE


def test_invented_controller_is_refused_and_lists_the_real_ones():
    out = H._resolve_controller_trigger("0xmadeup", "single_left")
    assert "error" in out
    assert "Hallway Switch" in out["error"]


def test_invented_button_is_refused_and_lists_the_real_ones():
    out = H._resolve_controller_trigger(IEEE, "quadruple_left")
    assert "error" in out
    assert "Left button — single press" in out["error"]


def test_house_with_no_controllers_says_so_plainly(monkeypatch):
    monkeypatch.setattr(C, "cached", list)
    out = H._resolve_controller_trigger(IEEE, "single_left")
    assert "error" in out
    assert "Pair one first" in out["error"]


def test_errors_are_bilingual():
    """Hebrew is a first-class surface, not a translation afterthought."""
    for out in (H._resolve_controller_trigger("0xmadeup", "single_left"),
                H._resolve_controller_trigger(IEEE, "nope")):
        assert out.get("error_he")
        assert any("֐" <= ch <= "ת" for ch in out["error_he"])


def test_home_context_exposes_controllers_to_the_assistant():
    from services import home_context
    got = home_context._controllers_compact()
    assert got and got[0]["controller_id"] == IEEE
    assert {"action": "single_left", "label": "Left button — single press"} in got[0]["actions"]


def test_home_context_survives_a_broken_controller_cache(monkeypatch):
    """The assistant must still answer about lights if MQTT is down."""
    from services import home_context

    def _boom():
        raise RuntimeError("broker down")

    monkeypatch.setattr(C, "cached", _boom)
    assert home_context._controllers_compact() == []
