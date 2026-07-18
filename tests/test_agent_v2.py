"""Unit tests for the v2 agent's deterministic pieces.

The full tool-calling loop needs the relay LLM + real devices and is validated
on the Canary hub. Here we lock the pure logic: directory shaping, device
resolution helpers, the Hebrew output contract (F4), and the engine flag.
"""
import asyncio
import os

import pytest

from core.agent import directory as d
from core.agent import output as o
from core.agent import tools as t


# ── A fake HA-truth directory mirroring the Canary living room ───────────────
FAKE_DIR = {
    "devices": [
        {"entity_id": "light.0xa4c13852e1286e50", "name": "Living Room Lamp",
         "room": "living_room", "room_he": "סלון", "domain": "light",
         "state": "on", "on": True, "he_noun": "המנורה"},
        {"entity_id": "light.0xa4c138bf729fb1aa", "name": "Entry Light",
         "room": "entry", "room_he": "כניסה", "domain": "light",
         "state": "on", "on": True, "he_noun": "האור"},
        {"entity_id": "climate.bedroom_ac", "name": "Bedroom AC",
         "room": "bedroom", "room_he": "חדר שינה", "domain": "climate",
         "state": "off", "on": False, "he_noun": "המזגן"},
    ],
    "presence": [
        {"entity_id": "binary_sensor.bedroom_motion", "room": "bedroom", "state": "off", "on": False},
        {"entity_id": "binary_sensor.living_room_occupancy", "room": "living_room", "state": "on", "on": True},
    ],
    "by_room": {},
}


# ── directory helpers ────────────────────────────────────────────────────────
def test_room_he_and_prep():
    assert d.room_he("living_room") == "סלון"
    assert d.room_prep_he("living_room") == "בסלון"
    assert d.room_he("bedroom") == "חדר שינה"


def test_he_noun_lamp_vs_light():
    assert d.he_noun("light.x", "Living Room Lamp") == "המנורה"
    assert d.he_noun("light.x", "Entry Light") == "האור"
    assert d.he_noun("climate.x", "Bedroom AC") == "המזגן"
    assert d.he_noun("cover.x", "Blind") == "התריס"


def test_get_device_and_occupancy():
    assert d.get_device(FAKE_DIR, "light.0xa4c13852e1286e50")["name"] == "Living Room Lamp"
    assert d.get_device(FAKE_DIR, "nope") is None
    assert d.room_occupancy(FAKE_DIR, "living_room")["status"] == "occupied"
    assert d.room_occupancy(FAKE_DIR, "bedroom")["status"] == "clear"
    assert d.room_occupancy(FAKE_DIR, "kitchen")["status"] == "unknown"


def test_format_lists_real_names():
    text = d.format_directory_for_prompt(FAKE_DIR)
    assert "Living Room Lamp" in text
    assert "light.0xa4c13852e1286e50" in text  # id present for tool calls


# ── output contract (F4: Hebrew, no leak) ────────────────────────────────────
def test_he_confirmation_uses_native_noun_not_english():
    res = {"ok": True, "action": "off", "value": None,
           "device": {"name": "Living Room Lamp", "he_noun": "המנורה", "room": "living_room"}}
    conf = o.render_device_confirmation([res], "he")
    assert conf == "כיביתי את המנורה בסלון."
    assert "living room" not in conf.lower()
    assert "Living Room Lamp" not in conf


def test_he_confirmation_ac_temperature():
    res = {"ok": True, "action": "set_temperature", "value": "24",
           "device": {"name": "Bedroom AC", "he_noun": "המזגן", "room": "bedroom"}}
    assert o.render_device_confirmation([res], "he") == "כיוונתי את המזגן בחדר שינה ל-24 מעלות."


def test_en_confirmation():
    res = {"ok": True, "action": "on", "value": None,
           "device": {"name": "Office Light", "he_noun": "האור", "room": "office"}}
    assert o.render_device_confirmation([res], "en") == "Turned on the Office Light."


def test_confirmation_none_when_not_clean_action():
    assert o.render_device_confirmation([{"ok": False}], "he") is None
    assert o.render_device_confirmation([{"ok": True, "no_such_device": True}], "he") is None


def test_sanitize_strips_entity_ids_and_markdown():
    assert "light." not in o.sanitize_reply("done light.0xabc now", channel="chat")
    voice = o.sanitize_reply("**bold** and `code`", channel="voice")
    assert "*" not in voice and "`" not in voice


# ── tools ────────────────────────────────────────────────────────────────────
def test_norm_action_aliases():
    assert t._norm_action("turn off") == "off"
    assert t._norm_action("TURN_ON") == "on"
    assert t._norm_action("dim") == "set_brightness"


def test_query_devices_filters():
    r = t._exec_query_devices({"room": "living_room", "only_on": True}, FAKE_DIR)
    names = [x["name"] for x in r["devices"]]
    assert names == ["Living Room Lamp"]


def test_room_occupancy_tool():
    r = t._exec_room_occupancy({"room": "bedroom"}, FAKE_DIR)
    assert r["status"] == "clear"


def test_control_device_light_dispatch(monkeypatch):
    calls = {}
    import services.home_automation as ha
    monkeypatch.setattr(ha, "toggle_light", lambda eid, on: calls.update(eid=eid, on=on) or (200, "ok"))
    res = asyncio.run(t._exec_control_device(
        {"entity_id": "light.0xa4c13852e1286e50", "action": "off"}, FAKE_DIR))
    assert res["ok"] and res["action"] == "off"
    assert calls == {"eid": "light.0xa4c13852e1286e50", "on": False}
    assert res["device"]["name"] == "Living Room Lamp"


def test_control_device_unknown_entity():
    res = asyncio.run(t._exec_control_device({"entity_id": "light.ghost", "action": "on"}, FAKE_DIR))
    assert not res["ok"] and res.get("no_such_device")


def test_control_device_climate_temperature(monkeypatch):
    calls = {}
    import services.home_automation as ha
    monkeypatch.setattr(ha, "set_ac_temperature", lambda eid, temp: calls.update(eid=eid, temp=temp) or (200, "ok"))
    res = asyncio.run(t._exec_control_device(
        {"entity_id": "climate.bedroom_ac", "action": "set_temperature", "value": "24"}, FAKE_DIR))
    assert res["ok"] and calls == {"eid": "climate.bedroom_ac", "temp": 24}


# ── engine flag ──────────────────────────────────────────────────────────────
def test_resolve_engine_priority(monkeypatch):
    from backend.routers.intent_router import _resolve_engine
    monkeypatch.delenv("ZIGGY_ASSISTANT_ENGINE", raising=False)
    assert _resolve_engine("v2") == "v2"          # explicit override wins
    assert _resolve_engine("bogus") in ("v1", "v2")
    monkeypatch.setenv("ZIGGY_ASSISTANT_ENGINE", "v2")
    assert _resolve_engine(None) == "v2"
    monkeypatch.setenv("ZIGGY_ASSISTANT_ENGINE", "v1")
    assert _resolve_engine(None) == "v1"
