"""Lessons from the 2026-09-04..07 Canary transcripts, pinned as tests.

1. "Kitchen Light" filed under the living-room area must be called האור במטבח.
2. A device already in the requested state is reported as already there.
3. Every device command records the route it took (hybrid vs direct).
4. Temperature answers come from the home's real readings.
5. "Take me to the lamp's page" opens a screen; "show me the lamp" is a card.
6. The IR twin of a linked Wi-Fi device is hidden from the directory.
7. Thread titles are never generic.
"""
import asyncio

from core.agent import directory as D
from core.agent import output as O
from core.agent import tools as T
from services import chat_runner as CR


def _dev(**over):
    base = {"entity_id": "light.kitchen", "name": "Kitchen Light", "room": "living_room",
            "room_he": "סלון", "domain": "light", "state": "off", "on": False,
            "he_noun": "האור", "place_he": D.place_he_from_name("Kitchen Light")}
    base.update(over)
    return base


# 1 ─────────────────────────────────────────────────────────────────────────
def test_place_from_name_beats_area():
    assert D.place_he_from_name("Kitchen Light") == "במטבח"
    assert D.place_he_from_name("Big Guest Bathroom Light") == "באמבטיית האורחים"
    assert D.place_he_from_name("Roni's Lamp") == "אצל Roni"
    assert D.place_he_from_name("Lamp") is None
    conf = O.render_device_confirmation([{"ok": True, "action": "on", "device": _dev()}], "he")
    assert conf == "הדלקתי את האור במטבח."
    plain = _dev(name="Lamp", place_he=None, he_noun="המנורה")
    assert O.render_device_confirmation([{"ok": True, "action": "off", "device": plain}], "he") == "כיביתי את המנורה בסלון."
    assert T._device_label(_dev(), "he") == "האור במטבח"


# 2 ─────────────────────────────────────────────────────────────────────────
def test_already_in_state_is_reported_not_repeated(monkeypatch):
    calls = []
    import services.home_automation as ha
    monkeypatch.setattr(ha, "toggle_light", lambda eid, on: calls.append((eid, on)))
    d = {"devices": [_dev(state="off", on=False)], "presence": []}
    res = asyncio.run(T.execute_tool("control_device", {"entity_id": "light.kitchen", "action": "off"}, d, lang="he"))
    assert res["ok"] and res.get("already") and calls == []
    assert O.render_device_confirmation([res], "he") == "האור במטבח כבר כבוי."
    assert O.render_device_confirmation([res], "en") == "The Kitchen Light is already off."


# 3 ─────────────────────────────────────────────────────────────────────────
def test_control_records_its_route(monkeypatch):
    import services.home_automation as ha
    import services.command_router as cr
    monkeypatch.setattr(ha, "toggle_light", lambda eid, on: None)
    monkeypatch.setattr(cr, "hybrid_route_or_none", lambda eid, svc: None)
    d = {"devices": [_dev(state="off", on=False)], "presence": []}
    res = asyncio.run(T.execute_tool("control_device", {"entity_id": "light.kitchen", "action": "on"}, d))
    assert res["ok"] and res["route"] == "direct:light"
    monkeypatch.setattr(cr, "hybrid_route_or_none", lambda eid, svc: {"ok": True, "via": "ir"})
    res2 = asyncio.run(T.execute_tool("control_device", {"entity_id": "light.kitchen", "action": "on"}, d))
    assert res2["route"] == "hybrid:ir"


# 4 ─────────────────────────────────────────────────────────────────────────
def test_temperature_from_real_readings():
    d = {"devices": [], "presence": [], "sensors": [
        {"entity_id": "sensor.roni_temp", "name": "Roni's Room Temperature", "room": "ronis_room",
         "room_he": None, "kind": "temperature", "value": "24.5", "unit": "°C", "place_he": "אצל Roni"},
        {"entity_id": "sensor.office_temp", "name": "Office Temperature", "room": "office",
         "room_he": "חדר עבודה", "kind": "temperature", "value": "26", "unit": "°C", "place_he": "בחדר העבודה"},
    ]}
    res = asyncio.run(T.execute_tool("get_temperature", {"room": "office"}, d, lang="he"))
    assert res["ok"] and "26°C" in res["message"] and res["data"]["kind"] == "reading"
    res2 = asyncio.run(T.execute_tool("get_temperature", {"room": "roni"}, d, lang="en"))
    assert "24.5" in res2["message"]
    assert T._exec_get_temperature({"room": "attic"}, d, "en") is None      # → v1 fallback


# 5 ─────────────────────────────────────────────────────────────────────────
def test_open_screen_and_show_device():
    d = {"devices": [_dev()], "presence": []}
    nav = asyncio.run(T.execute_tool("open_screen", {"screen": "device", "id": "light.kitchen"}, d, lang="he"))
    assert nav["data"] == {"kind": "navigate", "path": "/devices/light.kitchen", "screen": "device", "label": "האור במטבח"}
    assert "פותח" in nav["message"]
    assert asyncio.run(T.execute_tool("open_screen", {"screen": "automations"}, d))["data"]["path"] == "/actions"
    assert asyncio.run(T.execute_tool("open_screen", {"screen": "room", "id": "office"}, d))["data"]["path"] == "/rooms/office"
    card = asyncio.run(T.execute_tool("show_device", {"entity_id": "light.kitchen"}, d, lang="he"))
    assert card["data"]["kind"] == "device" and card["data"]["path"] == "/devices/light.kitchen"
    assert card["data"]["device"]["place_he"] == "במטבח"
    assert not asyncio.run(T.execute_tool("show_device", {"entity_id": "light.nope"}, d))["ok"]
    names = {t["function"]["name"] for t in T.TOOL_SCHEMAS}
    assert {"open_screen", "show_device"} <= names
    # The runner only attaches card kinds it knows — a navigate the app never
    # sees is a "took you there" that took you nowhere (Canary probe 07/09).
    from core.actions.registry import CARD_KINDS
    assert {"navigate", "device", "reading"} <= CARD_KINDS


def test_navigate_lands_as_the_turns_card(monkeypatch, ):
    from types import SimpleNamespace
    from core.agent import runner as R
    async def fake_dir():
        return {"devices": [_dev()], "presence": []}
    monkeypatch.setattr(R._dir, "build_directory", fake_dir)
    monkeypatch.setattr(R, "require_cloud_llm_active", lambda: None)
    monkeypatch.setattr(R, "_build_system_prompt", lambda *a, **k: "SYSTEM")
    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(R, "_announce", _noop)
    tc = SimpleNamespace(id="c1", function=SimpleNamespace(name="open_screen",
                         arguments='{"screen":"device","id":"light.kitchen"}'))
    calls = iter([SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[tc]))]),
                  SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="פתחתי.", tool_calls=[]))])])
    monkeypatch.setattr(R, "chat_completion", lambda *a, **k: next(calls))
    out = asyncio.run(R.run_agent("קח אותי לעמוד של האור במטבח", None, channel="chat"))
    assert out["data"]["card"]["kind"] == "navigate"
    assert out["data"]["card"]["path"] == "/devices/light.kitchen"


# 6 ─────────────────────────────────────────────────────────────────────────
def test_ir_twin_hidden_and_sensors_listed(monkeypatch):
    import services.home_automation as ha
    monkeypatch.setattr(ha, "get_all_states", lambda: [
        {"entity_id": "media_player.tv", "state": "playing", "attributes": {"friendly_name": "Living Room TV"}},
        {"entity_id": "sensor.office_temp", "state": "26", "attributes": {"friendly_name": "Office Temperature",
                                                                             "device_class": "temperature", "unit_of_measurement": "°C"}},
    ])
    async def fake_areas():
        return {}
    monkeypatch.setattr(D, "_entity_area_map", fake_areas)
    monkeypatch.setattr(D, "_ir_devices", lambda: [
        {"entity_id": "ir:tv1", "name": "TV", "room": "living_room", "room_he": "סלון", "domain": "tv",
         "state": "on", "on": True, "he_noun": "הטלוויזיה", "ir": True, "ir_id": "tv1", "ir_type": "tv"},
        {"entity_id": "ir:ac1", "name": "AC", "room": "bedroom", "room_he": "חדר שינה", "domain": "ac",
         "state": "off", "on": False, "he_noun": "המזגן", "ir": True, "ir_id": "ac1", "ir_type": "ac"},
    ])
    import services.device_registry as reg
    monkeypatch.setattr(reg, "get_all", lambda: [{"entity_id": "media_player.tv", "ir_device_id": "tv1"}])
    monkeypatch.setattr(reg, "get_device_info", lambda eid: None)
    d = asyncio.run(D.build_directory())
    ids = [x["entity_id"] for x in d["devices"]]
    assert "ir:tv1" not in ids and "ir:ac1" in ids and "media_player.tv" in ids
    assert d["sensors"][0]["kind"] == "temperature" and d["sensors"][0]["value"] == "26"
    text = D.format_directory_for_prompt(d)
    assert "[readings]" in text and "temperature=26°C" in text


# 7 ─────────────────────────────────────────────────────────────────────────
def test_generic_titles_are_rejected():
    assert CR._is_generic_title("שיחה בין משתמש למערכת")
    assert CR._is_generic_title("Conversation with assistant")
    assert not CR._is_generic_title("המנורה בסלון")
    assert not CR._is_generic_title("Office AC not turning off")
