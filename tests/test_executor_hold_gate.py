"""respect_hold: the one place a hold is enforced — Ziggy's executor — and the
HA side defers such steps to it."""
import asyncio

import pytest

from services import local_automation_actions as laa
from services import ha_automations as HA
from services import light_hold as LH


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(laa, "STORE_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: ("k", None))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)


def test_respect_hold_turn_on_compiles_to_deferred_event():
    a = {"type": "call_service", "entity_id": "light.a", "service": "light.turn_on", "respect_hold": True}
    assert HA._action_to_ha(a) == {"event": "ziggy_deferred",
                                   "event_data": {"step": "call_service", "entity_id": "light.a"}}
    assert HA.ha_defers_action(a) is True


def test_plain_call_service_still_native():
    a = {"type": "call_service", "entity_id": "light.a", "service": "light.turn_on"}
    assert HA._action_to_ha(a)["service"] == "light.turn_on"
    assert HA.ha_defers_action(a) is False


def test_held_light_turn_on_is_skipped(monkeypatch):
    sent = []
    monkeypatch.setattr("services.home_automation.call_service",
                        lambda d, s, p: sent.append((d, s)) or {"ok": True})
    LH.on_manual_off("light.a", now=1.0)
    laa.save_ziggy_actions("auto_h", [{"type": "call_service", "entity_id": "light.a",
                                       "service": "light.turn_on", "service_value": "turn_on",
                                       "respect_hold": True}])
    res = asyncio.run(laa.execute_ziggy_actions("auto_h", "H"))
    assert sent == []
    assert res[0]["skipped"] is True and res[0]["reason"] == "held" and res[0]["ok"] is True


def test_unheld_light_turn_on_runs(monkeypatch):
    sent = []
    monkeypatch.setattr("services.home_automation.call_service",
                        lambda d, s, p: sent.append((d, s)) or {"ok": True})
    laa.save_ziggy_actions("auto_u", [{"type": "call_service", "entity_id": "light.a",
                                       "service": "light.turn_on", "service_value": "turn_on",
                                       "respect_hold": True}])
    asyncio.run(laa.execute_ziggy_actions("auto_u", "U"))
    assert sent == [("light", "turn_on")]


def test_turn_off_never_gated(monkeypatch):
    sent = []
    monkeypatch.setattr("services.home_automation.call_service",
                        lambda d, s, p: sent.append((d, s)) or {"ok": True})
    LH.on_manual_off("light.a", now=1.0)
    laa.save_ziggy_actions("auto_o", [{"type": "call_service", "entity_id": "light.a",
                                       "service": "light.turn_off", "service_value": "turn_off",
                                       "respect_hold": True}])
    asyncio.run(laa.execute_ziggy_actions("auto_o", "O"))
    assert sent == [("light", "turn_off")]
