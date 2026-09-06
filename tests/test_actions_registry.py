"""Agent-first: the action registry, its execution path, the app API, the journal,
and the runner's card selection."""
import asyncio
import time

import pytest

import importlib

from core.actions import registry as R              # the Registry instance
_reg_mod = importlib.import_module("core.actions.registry")   # the module
from core import actions as A
from services import ui_journal as J
from core.agent import context as C
from core.agent import persona as P


@pytest.fixture(autouse=True)
def _clean_journal():
    J.clear()
    yield
    J.clear()


def test_registry_is_built_from_tool_schemas():
    names = R.names()
    for n in ("control_device", "query_devices", "explain_missing_action", "what_can_ziggy_do"):
        assert n in names
    cd = R.get("control_device")
    assert cd.params["properties"]["entity_id"]
    assert cd.risk == "act"
    assert R.get("query_devices").risk == "read" and R.get("query_devices").kind == "device_list"
    assert R.get("create_automation").risk == "config"
    listing = cd.listing()
    assert set(listing) == {"name", "description", "params", "risk", "kind"}


def test_run_action_executes_journals_and_announces(monkeypatch):
    seen = {}

    async def fake_exec(name, args, directory, lang="en", actor=None):
        seen.update(name=name, args=args, lang=lang, actor=actor)
        return {"ok": True, "message": "did it", "data": {"kind": "device_list", "devices": []}}
    import core.agent.tools as T
    monkeypatch.setattr(T, "execute_tool", fake_exec)
    events = []

    async def fake_announce(name, args, result, *, actor, source):
        events.append((name, source, actor, result.get("ok")))
    monkeypatch.setattr(_reg_mod, "announce", fake_announce)

    res = asyncio.run(A.run_action("control_device", {"entity_id": "light.x", "action": "on"},
                                   actor="person:youval", source="app",
                                   directory={"devices": []}))
    assert res["ok"] and seen["actor"] == "person:youval" and seen["lang"] == "en"
    assert events == [("control_device", "app", "person:youval", True)]
    rows = J.recent()
    assert rows and rows[0]["action"] == "control_device" and rows[0]["source"] == "app"


def test_read_actions_are_not_journaled(monkeypatch):
    async def fake_exec(name, args, directory, lang="en", actor=None):
        return {"ok": True, "message": "3 devices"}
    import core.agent.tools as T
    monkeypatch.setattr(T, "execute_tool", fake_exec)

    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(_reg_mod, "announce", _noop)
    asyncio.run(A.run_action("query_devices", {}, actor="person:a", directory={"devices": []}))
    assert J.recent() == []


def test_unknown_action_and_hebrew_lang_detection(monkeypatch):
    res = asyncio.run(A.run_action("nope", {}, directory={}))
    assert not res["ok"] and res.get("unknown_action")
    seen = {}

    async def fake_exec(name, args, directory, lang="en", actor=None):
        seen["lang"] = lang
        return {"ok": True, "message": ""}
    import core.agent.tools as T
    monkeypatch.setattr(T, "execute_tool", fake_exec)

    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(_reg_mod, "announce", _noop)
    asyncio.run(A.run_action("run_routine", {"name": "לילה טוב"}, directory={}))
    assert seen["lang"] == "he"


def test_journal_window_and_prompt_format():
    J.record("control_device", {"entity_id": "light.k", "action": "off"}, actor="person:youval", source="app")
    J.record("toggle_automation", {"name": "Night", "enabled": False}, actor="person:tslil", source="mcp", ok=False)
    text = J.format_for_prompt(J.recent(), names={"light.k": "Kitchen Light"})
    assert "youval via app: control_device off Kitchen Light" in text
    assert "tslil via mcp: toggle_automation False Night (failed)" in text
    assert "light.k" not in text
    # window: an old entry is excluded
    with J._lock:
        J._entries[0]["ts"] = time.time() - 30 * 3600
    assert len(J.recent(hours=24)) == 1


def test_context_and_persona_carry_app_actions():
    J.record("control_device", {"entity_id": "light.k", "action": "on"}, actor="person:youval")
    d = {"devices": [{"entity_id": "light.k", "name": "Kitchen Light", "room": "kitchen"}]}
    txt = C.app_actions_text(d)
    assert "Kitchen Light" in txt
    prompt = P.build_system_prompt({"lang": "en", "app_actions_text": txt, "directory_text": "x"})
    assert "WHAT PEOPLE DID IN THE APP RECENTLY" in prompt


def test_actions_api_list_and_run(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routers import actions_router as AR
    from backend.routers import auth_deps

    app = FastAPI()
    app.include_router(AR.router)

    async def fake_user():
        return {"username": "youval", "role": "owner"}
    app.dependency_overrides[auth_deps.get_current_user] = fake_user

    async def fake_run(name, args=None, *, actor=None, source="app", lang=None, directory=None):
        return {"ok": True, "message": f"ran {name} as {actor} via {source}", "data": {"kind": "device_list"}}
    monkeypatch.setattr(AR, "run_action", fake_run)

    c = TestClient(app)
    lst = c.get("/api/actions").json()["actions"]
    assert any(a["name"] == "control_device" for a in lst)
    r = c.post("/api/actions/control_device", json={"args": {"entity_id": "light.x", "action": "on"}}).json()
    assert r["ok"] and "person:youval" in r["message"] and "via app" in r["message"]
    assert r["data"]["kind"] == "device_list"
    assert c.post("/api/actions/does_not_exist", json={"args": {}}).status_code == 404


def test_tool_results_carry_card_kinds():
    from core.agent import tools as T
    d = {"devices": [{"entity_id": "light.a", "name": "Lamp", "room": "hall", "room_he": "מסדרון",
                      "domain": "light", "state": "on", "on": True, "he_noun": "המנורה"},
                     {"entity_id": "ir:1", "name": "TV", "room": "hall", "room_he": "מסדרון",
                      "domain": "tv", "state": "on", "on": True, "he_noun": "הטלוויזיה", "ir": True}],
         "presence": []}
    r = T._exec_query_devices({"only_on": True}, d)
    assert r["data"]["kind"] == "device_list"
    assert [x["entity_id"] for x in r["data"]["devices"]] == ["light.a"]   # IR has no toggle
    assert "entity_id" not in r["devices"][0]                              # model view stays id-free
    r2 = T._exec_what_can_ziggy_do({"query": ""})
    assert r2["data"]["kind"] == "capabilities"
