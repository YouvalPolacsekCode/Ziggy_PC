"""v3 agent tools: self-knowledge, recent activity, routines, automations, confirm gate."""
import asyncio
import json
import re

import pytest

from core.agent import tools as T
from services import capability_lookup as CL

DIR = {
    "devices": [
        {"entity_id": "lock.front", "name": "Front Door", "room": "entry", "room_he": "כניסה",
         "domain": "lock", "state": "locked", "on": False, "he_noun": "המנעול"},
        {"entity_id": "light.hall", "name": "Hall Lamp", "room": "hall", "room_he": "מסדרון",
         "domain": "light", "state": "off", "on": False, "he_noun": "המנורה"},
    ],
    "presence": [], "cameras": [], "by_room": {},
}

_LEAK = re.compile(r"home assistant|zigbee|coordinator|mqtt|\bentity\b|light\.[a-z]|lock\.[a-z]", re.I)


def test_schemas_include_v3_tools():
    names = {t["function"]["name"] for t in T.TOOL_SCHEMAS}
    for n in ("what_can_ziggy_do", "recent_activity", "explain_missing_action",
              "repair_history", "run_routine", "toggle_automation", "delete_automation"):
        assert n in names
    cd = next(t for t in T.TOOL_SCHEMAS if t["function"]["name"] == "control_device")
    assert "confirmed" in cd["function"]["parameters"]["properties"]


def test_catalog_search_finds_live_capabilities_in_hebrew_and_english():
    en = CL.search("camera", limit=3)
    he = CL.search("מצלמה", limit=3)
    assert en and he
    assert all({"name", "pitch", "live", "status"} <= set(c) for c in en)
    assert CL.overview()


def test_what_can_ziggy_do_tool_shape():
    res = asyncio.run(T.execute_tool("what_can_ziggy_do", {"query": "presence"}, DIR))
    assert res["ok"] and isinstance(res["capabilities"], list)
    res2 = asyncio.run(T.execute_tool("what_can_ziggy_do", {}, DIR))
    assert res2["capabilities"]


def test_control_device_lock_asks_when_policy_says_ask(monkeypatch):
    from core.agent import authz
    monkeypatch.setattr(authz, "check", lambda action, resource=None, **kw: (bool(kw.get("explicit_confirm")), "ask"))
    calls = []
    import services.home_automation as ha
    monkeypatch.setattr(ha, "call_service", lambda d, s, data: calls.append((d, s, data)))
    import services.command_router as cr
    monkeypatch.setattr(cr, "hybrid_route_or_none", lambda eid, svc: None)

    res = asyncio.run(T.execute_tool("control_device", {"entity_id": "lock.front", "action": "unlock"},
                                     DIR, lang="he", actor="person:youval"))
    assert res.get("needs_approval") and not calls
    assert not _LEAK.search(res["message"])

    res2 = asyncio.run(T.execute_tool("control_device",
                                      {"entity_id": "lock.front", "action": "unlock", "confirmed": True},
                                      DIR, lang="he", actor="person:youval"))
    assert res2["ok"] and calls and calls[0][1] == "unlock"


def test_control_device_light_never_asks(monkeypatch):
    from core.agent import authz
    monkeypatch.setattr(authz, "check", lambda *a, **k: (False, "ask"))
    import services.home_automation as ha
    done = []
    monkeypatch.setattr(ha, "toggle_light", lambda eid, on: done.append((eid, on)))
    import services.command_router as cr
    monkeypatch.setattr(cr, "hybrid_route_or_none", lambda eid, svc: None)
    res = asyncio.run(T.execute_tool("control_device", {"entity_id": "light.hall", "action": "on"}, DIR))
    assert res["ok"] and done == [("light.hall", True)]


def test_run_routine_fuzzy_and_miss(monkeypatch):
    import services.ha_scripts as hs
    monkeypatch.setattr(hs, "list_scripts", lambda: [{"id": "s1", "name": "Good Night"}, {"id": "s2", "name": "Movie Time"}])
    ran = []
    import services.local_automation_actions as laa
    async def fake_exec(aid, label="", **kw):
        ran.append((aid, label)); return []
    monkeypatch.setattr(laa, "execute_ziggy_actions", fake_exec)
    res = asyncio.run(T.execute_tool("run_routine", {"name": "good night"}, DIR, lang="he"))
    assert res["ok"] and ran == [("s1", "Good Night")]
    miss = asyncio.run(T.execute_tool("run_routine", {"name": "breakfast"}, DIR))
    assert not miss["ok"] and "Good Night" in miss["routines"]


def test_toggle_and_delete_automation(monkeypatch):
    import services.ha_automations as HA
    monkeypatch.setattr(HA, "list_automations", lambda: [{"id": "ziggy_night", "name": "Night lights", "enabled": True}])
    toggled, deleted = [], []
    monkeypatch.setattr(HA, "toggle_automation", lambda aid, en: toggled.append((aid, en)) or True)
    monkeypatch.setattr(HA, "delete_automation", lambda aid: deleted.append(aid) or True)

    r = asyncio.run(T.execute_tool("toggle_automation", {"name": "night lights", "enabled": False}, DIR, lang="en"))
    assert r["ok"] and toggled == [("ziggy_night", False)] and "Disabled" in r["message"]

    ask = asyncio.run(T.execute_tool("delete_automation", {"name": "night lights"}, DIR, lang="he"))
    assert ask.get("needs_approval") and not deleted
    done = asyncio.run(T.execute_tool("delete_automation", {"name": "night lights", "confirmed": True}, DIR, lang="he"))
    assert done["ok"] and deleted == ["ziggy_night"]


def test_explain_missing_action_uses_why_not(monkeypatch):
    from services import why_not as W
    monkeypatch.setattr(W, "gather_facts", lambda eid, hours, directory=None: {
        "entity_id": eid, "room": "hall",
        "device": {"state": "off", "reachable": True, "last_intended": None},
        "automations": [{"id": "a", "name": "Hall on entry", "enabled": False, "runs": []}],
        "sensors": [{"entity_id": "binary_sensor.h", "state": "off", "held_s": 120, "anomalies": []}],
        "occupancy": None, "repairs": []})
    res = asyncio.run(T.execute_tool("explain_missing_action", {"entity_id": "light.hall"}, DIR, lang="he"))
    assert res["ok"] and res["data"]["verdicts"][0] == "automation_disabled"
    assert "Hall on entry" in res["message"]
    assert not _LEAK.search(json.dumps(res, ensure_ascii=False))


def test_repair_history_empty_and_filled(monkeypatch):
    import types, sys
    fake = types.SimpleNamespace(history=lambda eid, limit=10: [])
    monkeypatch.setitem(sys.modules, "services.repair_ladder", fake)
    r = asyncio.run(T.execute_tool("repair_history", {"entity_id": "light.hall"}, DIR, lang="en"))
    assert r["ok"] and r["data"]["attempts"] == []
    fake.history = lambda eid, limit=10: [{"rung": "nudge", "outcome": "failed", "ts": 1.0}]
    r2 = asyncio.run(T.execute_tool("repair_history", {"entity_id": "light.hall"}, DIR, lang="he"))
    assert "להעיר" in r2["message"] and r2["data"]["attempts"][0]["step"] == "nudge"


def test_recent_activity_empty(monkeypatch):
    import services.ha_subscriber as hs
    monkeypatch.setattr(hs, "state_cache", {}, raising=False)
    r = asyncio.run(T.execute_tool("recent_activity", {"hours": 1}, DIR))
    assert r["ok"] and r["changes"] == []
