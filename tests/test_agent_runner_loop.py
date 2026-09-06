"""The runner's tool loop end to end with a fake model.

Regression: 2026-09-07 00:30 on Canary — a device command acted on the home and
then the turn crashed in the agent→app announce call, so the user was told
"something went wrong" about a lamp that had just turned on. Nothing here may
depend on the relay or on HA.
"""
import asyncio
from types import SimpleNamespace

import pytest

from core.agent import runner as R


class _Msg:
    def __init__(self, content=None, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls or []


def _tool_call(name, args_json, cid="call_1"):
    return SimpleNamespace(id=cid, function=SimpleNamespace(name=name, arguments=args_json))


def _resp(msg):
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


DIRECTORY = {
    "devices": [{"entity_id": "light.lamp", "name": "Living Room Lamp", "room": "living_room",
                 "room_he": "סלון", "domain": "light", "state": "off", "on": False, "he_noun": "המנורה"}],
    "presence": [], "cameras": [], "by_room": {},
}


@pytest.fixture
def wired(monkeypatch):
    async def fake_dir():
        return DIRECTORY
    monkeypatch.setattr(R._dir, "build_directory", fake_dir)
    monkeypatch.setattr(R, "require_cloud_llm_active", lambda: None)
    monkeypatch.setattr(R, "_build_system_prompt", lambda *a, **k: "SYSTEM")
    announced = []

    async def fake_announce(name, args, result, *, actor, source):
        announced.append((name, source, actor))
    monkeypatch.setattr(R, "_announce", fake_announce)
    return announced


def test_device_command_confirms_and_announces(monkeypatch, wired):
    calls = iter([_resp(_Msg(tool_calls=[_tool_call("control_device",
                                                      '{"entity_id":"light.lamp","action":"on"}')]))])
    monkeypatch.setattr(R, "chat_completion", lambda *a, **k: next(calls))

    async def fake_exec(name, args, directory, lang="en", actor=None):
        return {"ok": True, "message": "on Living Room Lamp", "action": "on", "value": None,
                "device": directory["devices"][0]}
    monkeypatch.setattr(R._tools, "execute_tool", fake_exec)

    out = asyncio.run(R.run_agent("תדליק את המנורה בסלון", None, channel="chat", actor="person:youval"))
    assert out["ok"] is True
    assert out["message"] == "הדלקתי את המנורה בסלון."
    assert out["data"]["spoken"] == "הדלקתי את המנורה בסלון."
    assert wired == [("control_device", "chat", "person:youval")]


def test_announce_failure_never_fails_the_turn(monkeypatch, wired):
    calls = iter([_resp(_Msg(tool_calls=[_tool_call("control_device",
                                                      '{"entity_id":"light.lamp","action":"on"}')]))])
    monkeypatch.setattr(R, "chat_completion", lambda *a, **k: next(calls))

    async def boom(*a, **k):
        raise RuntimeError("ws down")
    monkeypatch.setattr(R, "_announce", boom)

    async def fake_exec(name, args, directory, lang="en", actor=None):
        return {"ok": True, "message": "on", "action": "on", "value": None,
                "device": directory["devices"][0]}
    monkeypatch.setattr(R._tools, "execute_tool", fake_exec)

    out = asyncio.run(R.run_agent("turn on the lamp", None, channel="chat"))
    assert out["ok"] is True and out["message"] == "Turned on the Living Room Lamp."


def test_query_turn_yields_card_and_narration(monkeypatch, wired):
    calls = iter([
        _resp(_Msg(tool_calls=[_tool_call("query_devices", '{"only_on":true}')])),
        _resp(_Msg(content="The lamp is on.")),
    ])
    monkeypatch.setattr(R, "chat_completion", lambda *a, **k: next(calls))

    async def fake_exec(name, args, directory, lang="en", actor=None):
        return {"ok": True, "message": "1 devices", "devices": [],
                "data": {"kind": "device_list", "devices": [{"entity_id": "light.lamp", "name": "Living Room Lamp", "on": True}]}}
    monkeypatch.setattr(R._tools, "execute_tool", fake_exec)

    out = asyncio.run(R.run_agent("what's on?", None, channel="chat"))
    assert out["message"] == "The lamp is on."
    assert out["data"]["card"]["kind"] == "device_list"
    assert out["data"]["spoken"] == "The lamp is on."
    assert wired[0][0] == "query_devices"


def test_card_results_are_flagged_to_the_model_and_slimmed(monkeypatch, wired):
    seen_tool_msgs = []
    calls = iter([
        _resp(_Msg(tool_calls=[_tool_call("query_devices", '{}')])),
        _resp(_Msg(content="Six things are on; the office is dark.")),
    ])

    def fake_chat(purpose, messages, **kw):
        seen_tool_msgs.extend(m for m in messages if m.get("role") == "tool")
        return next(calls)
    monkeypatch.setattr(R, "chat_completion", fake_chat)

    async def fake_exec(name, args, directory, lang="en", actor=None):
        return {"ok": True, "message": "16 devices", "devices": [{"name": "Lamp"}] * 16,
                "data": {"kind": "device_list", "devices": [{"entity_id": f"light.{i}", "name": f"L{i}", "on": True} for i in range(16)]}}
    monkeypatch.setattr(R._tools, "execute_tool", fake_exec)

    out = asyncio.run(R.run_agent("show me my home", None, channel="chat"))
    import json as _json
    fed = _json.loads(seen_tool_msgs[-1]["content"])
    assert fed["rendered_as_card"] is True and "Do NOT repeat" in fed["card_note"]
    assert "devices" not in fed["data"]                 # per-item payload not fed twice
    assert out["data"]["card"]["lang"] == "en" and len(out["data"]["card"]["devices"]) == 16


def test_pretty_names_drop_serial_tails():
    from core.agent.directory import _pretty_name as p
    assert p("Switcher_Touch_36D8") == "Switcher Touch"
    assert p("Living Room Lamp") == "Living Room Lamp"
    assert p("outdoor_watering") == "outdoor watering"
    assert p(None) is None


def test_model_error_gives_the_soft_reply(monkeypatch, wired):
    def boom(*a, **k):
        raise RuntimeError("relay 502")
    monkeypatch.setattr(R, "chat_completion", boom)
    out = asyncio.run(R.run_agent("תדליק את המנורה", None, channel="chat"))
    assert out["ok"] is False and "השתבש" in out["message"]
