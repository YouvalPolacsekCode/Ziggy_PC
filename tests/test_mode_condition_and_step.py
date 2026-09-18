"""`mode` condition in both evaluators + `set_mode` step (Ziggy-run, HA-deferred)."""
import asyncio

import pytest

from services import local_automation_actions as laa
from services import ha_automations as HA
from services import modes as M


@pytest.fixture(autouse=True)
def _kv(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(laa, "STORE_FILE", str(tmp_path / "a.json"))
    for h in ("_publish_hook", "_broadcast_hook", "_side_effect_hook"):
        monkeypatch.setattr(M, h, lambda *a, **k: None)


def test_mode_condition_local_eval():
    ok, why = laa._eval_single_condition({"type": "mode", "mode": "sleep", "is": False})
    assert ok and "sleep" in why
    asyncio.run(M.set_mode("sleep", True, by="t"))
    ok, _ = laa._eval_single_condition({"type": "mode", "mode": "sleep", "is": False})
    assert not ok
    ok, _ = laa._eval_single_condition({"type": "mode", "mode": "sleep", "is": True})
    assert ok


def test_unknown_mode_condition_is_skipped_not_fatal():
    ok, why = laa._eval_single_condition({"type": "mode", "mode": "party", "is": False})
    assert ok and "skipped" in why


def test_mode_condition_compiles_to_state_when_discovered(monkeypatch):
    monkeypatch.setattr("services.modes_mqtt.entity_id", lambda m: "binary_sensor.ziggy_mode_sleep")
    c = HA._condition_to_ha({"type": "mode", "mode": "sleep", "is": False})
    assert c == {"condition": "state", "entity_id": "binary_sensor.ziggy_mode_sleep", "state": "off"}
    c = HA._condition_to_ha({"type": "mode", "mode": "sleep", "is": True})
    assert c["state"] == "on"


def test_mode_condition_compiles_to_none_when_undiscovered(monkeypatch):
    monkeypatch.setattr("services.modes_mqtt.entity_id", lambda m: None)
    assert HA._condition_to_ha({"type": "mode", "mode": "sleep", "is": False}) is None


def test_set_mode_step_is_deferred_placeholder():
    a = {"type": "set_mode", "mode": "movie", "on": True, "hours": 2}
    assert HA._action_to_ha(a) == {"event": "ziggy_deferred", "event_data": {"step": "set_mode", "mode": "movie"}}
    assert HA.ha_defers_action(a) is True
    assert "set_mode" in laa._LOCAL_TYPES


def test_set_mode_step_executes(monkeypatch):
    calls = []

    async def fake_set(mode, on, *, by, hours=None, now=None):
        calls.append((mode, on, by, hours))
        return {"on": on}

    monkeypatch.setattr(M, "set_mode", fake_set)
    laa.save_ziggy_actions("auto_x", [{"type": "set_mode", "mode": "movie", "on": True, "hours": 2}])
    res = asyncio.run(laa.execute_ziggy_actions("auto_x", "X"))
    assert calls == [("movie", True, "automation:auto_x", 2)]
    assert res and res[0]["ok"]
