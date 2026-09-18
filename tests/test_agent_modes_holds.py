"""v2 agent: set_mode / release_light_hold tools, modes + holds in context and persona."""
import asyncio

import pytest

from core.agent import tools as t
from core.agent import context as C
from core.agent import persona as P

FAKE_DIR = {
    "devices": [
        {"entity_id": "light.0xa4c13852e1286e50", "name": "Living Room Lamp",
         "room": "living_room", "room_he": "סלון", "domain": "light",
         "state": "off", "on": False, "he_noun": "המנורה"},
    ],
    "presence": [], "by_room": {},
}


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    from services import local_automation_actions as laa, modes as M, light_hold as LH
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    for h in ("_publish_hook", "_broadcast_hook", "_side_effect_hook"):
        monkeypatch.setattr(M, h, lambda *a, **k: None)
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda e: ("living_room", None))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)


def test_new_tools_registered():
    names = {s["function"]["name"] for s in t.TOOL_SCHEMAS}
    assert {"set_mode", "release_light_hold"} <= names
    schema = next(s for s in t.TOOL_SCHEMAS if s["function"]["name"] == "set_mode")
    assert schema["function"]["parameters"]["properties"]["mode"]["enum"] == \
        ["sleep", "movie", "cleaning", "guest", "vacation"]


def test_set_mode_tool_executes_he_and_en():
    from services import modes as M
    res = asyncio.run(t.execute_tool("set_mode", {"mode": "movie", "on": True, "hours": 2}, FAKE_DIR, lang="he"))
    assert res["ok"] and M.is_on("movie") and "סרט" in res["message"] and "עד" in res["message"]
    res = asyncio.run(t.execute_tool("set_mode", {"mode": "movie", "on": False}, FAKE_DIR, lang="en"))
    assert res["ok"] and not M.is_on("movie") and res["message"] == "Movie mode off."
    res = asyncio.run(t.execute_tool("set_mode", {"mode": "party", "on": True}, FAKE_DIR, lang="en"))
    assert not res["ok"] and "Modes:" in res["message"]


def test_release_hold_tool():
    from services import light_hold as LH
    eid = "light.0xa4c13852e1286e50"
    res = asyncio.run(t.execute_tool("release_light_hold", {"entity_id": eid}, FAKE_DIR, lang="en"))
    assert res["ok"] and res["released"] is False
    LH.on_manual_off(eid, now=1.0)
    res = asyncio.run(t.execute_tool("release_light_hold", {"entity_id": eid}, FAKE_DIR, lang="he"))
    assert res["ok"] and res["released"] is True and not LH.is_held(eid)
    assert "המנורה" in res["message"] and eid not in res["message"]
    res = asyncio.run(t.execute_tool("release_light_hold", {"entity_id": "light.nope"}, FAKE_DIR, lang="en"))
    assert not res["ok"]


def test_context_carries_modes_and_holds():
    from services import modes as M, light_hold as LH
    asyncio.run(M.set_mode("guest", True, by="t"))
    LH.on_manual_off("light.0xa4c13852e1286e50", now=1.0)
    assert "guest ON" in C.modes_text("en")
    ht = C.holds_text(FAKE_DIR, "en")
    assert "Living Room Lamp" in ht and "held off" in ht and "light.0xa4c13852e1286e50" in ht
    ctx = C.build_context(FAKE_DIR, lang="en", channel="chat")
    assert ctx["modes_text"] and ctx["holds_text"]


def test_prompt_carries_modes_and_holds_sections_and_rules():
    p = P.build_system_prompt({"lang": "en", "channel": "chat",
                               "modes_text": "movie ON until 23:40", "holds_text": "  Kitchen Light held off"})
    assert "MODES" in p and "movie ON until 23:40" in p and "HELD LIGHTS" in p
    assert "set_mode" in p and "release_light_hold" in p and "design_automation" in p
    assert "sleep, movie, cleaning, guest, vacation" in p
    # the SECTIONS only appear when there is something to show; the rules always do
    p2 = P.build_system_prompt({"lang": "he", "channel": "chat"})
    assert "MODES (the fixed home modes" not in p2 and "HELD LIGHTS (switched off" not in p2
    assert "set_mode" in p2
