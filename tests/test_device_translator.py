"""Unit tests for services.device_translator.

Pins the Ziggy-native contract: ids are opaque/prefixed, expansion runs
on the edge from the live registry, capability inference matches what
command_router expects, and translation back to entity_id is bidirectional.
"""
from __future__ import annotations

import pytest

from services import device_registry, device_translator
from services.device_schema import (
    CAP_SET_BRIGHTNESS,
    CAP_TURN_OFF,
    CAP_TURN_ON,
    ZiggyDevice,
)


@pytest.fixture
def fake_registry(monkeypatch):
    """Stub device_registry with a tiny fixed set of rows."""
    rows = [
        {
            "room": "living_room", "device_type": "light",
            "entity_id": "light.living_room", "ir_device_id": None,
            "status": "connected", "name": "Living Room Light",
            "tags": [],
        },
        {
            "room": "bedroom", "device_type": "light",
            "entity_id": "light.bedroom", "ir_device_id": None,
            "status": "connected", "name": "Bedroom Light",
            "tags": [],
        },
        {
            "room": "living_room", "device_type": "tv",
            "entity_id": None, "ir_device_id": "ir_tv_living",
            "status": "ir_only", "name": "Living Room TV",
            "tags": [],
        },
        {
            "room": "kitchen", "device_type": "light",
            "entity_id": "light.kitchen", "ir_device_id": None,
            "status": "lost", "name": "Kitchen Light",  # Lost — selectors skip
            "tags": [],
        },
    ]
    by_eid = {r["entity_id"]: r for r in rows if r.get("entity_id")}

    monkeypatch.setattr(device_registry, "get_all", lambda: list(rows))
    monkeypatch.setattr(
        device_registry, "get_device_info",
        lambda eid: dict(by_eid[eid]) if eid in by_eid else None,
    )
    return rows


# ── ID encoding & resolution ────────────────────────────────────────────────

def test_ziggy_id_for_ha_entity(fake_registry):
    eid = "light.living_room"
    z = device_translator.ziggy_id_for({"entity_id": eid})
    assert z == f"ha:{eid}"


def test_ziggy_id_for_ir_only():
    z = device_translator.ziggy_id_for({"ir_device_id": "ir_tv_living"})
    assert z == "ir:ir_tv_living"


def test_ziggy_id_for_unconfigured():
    z = device_translator.ziggy_id_for({"room": "office", "device_type": "fan"})
    assert z == "unconfigured:office:fan"


def test_to_ha_entity_id_round_trip():
    assert device_translator.to_ha_entity_id("ha:light.kitchen") == "light.kitchen"
    assert device_translator.to_ha_entity_id("ir:foo") is None
    assert device_translator.to_ha_entity_id("unconfigured:x:y") is None


def test_lookup_entry_ha(fake_registry):
    entry = device_translator.lookup_entry("ha:light.bedroom")
    assert entry is not None
    assert entry["room"] == "bedroom"


def test_lookup_entry_ir_only(fake_registry):
    entry = device_translator.lookup_entry("ir:ir_tv_living")
    assert entry is not None
    assert entry["device_type"] == "tv"


def test_lookup_entry_unknown():
    assert device_translator.lookup_entry("ha:does.not_exist") is None


# ── Capability inference ────────────────────────────────────────────────────

def test_capabilities_for_light():
    caps = device_translator.capabilities_for({"entity_id": "light.x", "device_type": "light"})
    assert CAP_TURN_ON in caps
    assert CAP_SET_BRIGHTNESS in caps


def test_capabilities_for_unknown_falls_back_to_toggle():
    caps = device_translator.capabilities_for({"device_type": "completely_unknown"})
    assert CAP_TURN_ON in caps
    assert CAP_TURN_OFF in caps


def test_capabilities_for_sensor_is_read_only():
    caps = device_translator.capabilities_for({"entity_id": "sensor.outdoor_temp", "device_type": "sensor"})
    assert caps == ()


# ── to_ziggy wrapping ───────────────────────────────────────────────────────

def test_to_ziggy_strips_to_brain_friendly_shape(fake_registry):
    z: ZiggyDevice = device_translator.to_ziggy(fake_registry[0])
    out = z.for_brain()
    assert out["id"] == "ha:light.living_room"
    assert out["room"] == "living_room"
    assert out["device_type"] == "light"
    assert "ha_entity_id" not in out  # brain must not see transport leak
    assert "ir_device_id" not in out


# ── Enumeration ─────────────────────────────────────────────────────────────

def test_list_devices_all(fake_registry):
    devs = device_translator.list_devices()
    assert len(devs) == 4


def test_list_devices_by_type(fake_registry):
    devs = device_translator.list_devices(device_type="light")
    assert {d.id for d in devs} == {
        "ha:light.living_room", "ha:light.bedroom", "ha:light.kitchen",
    }


def test_list_devices_by_room(fake_registry):
    devs = device_translator.list_devices(room="living_room")
    assert {d.id for d in devs} == {"ha:light.living_room", "ir:ir_tv_living"}


# ── Selector expansion ──────────────────────────────────────────────────────

def test_expand_all(fake_registry):
    devs = device_translator.expand_selector("all")
    # Lost devices are excluded — selector resolves to *currently usable* set.
    assert {d.id for d in devs} == {
        "ha:light.living_room", "ha:light.bedroom", "ir:ir_tv_living",
    }


def test_expand_all_lights_plural(fake_registry):
    devs = device_translator.expand_selector("all_lights")
    assert {d.id for d in devs} == {"ha:light.living_room", "ha:light.bedroom"}


def test_expand_dict_room_and_type(fake_registry):
    devs = device_translator.expand_selector({"room": "bedroom", "type": "light"})
    assert [d.id for d in devs] == ["ha:light.bedroom"]


def test_expand_dict_room_only(fake_registry):
    devs = device_translator.expand_selector({"room": "living_room"})
    assert {d.id for d in devs} == {"ha:light.living_room", "ir:ir_tv_living"}


def test_expand_single_id(fake_registry):
    devs = device_translator.expand_selector({"id": "ha:light.bedroom"})
    assert len(devs) == 1
    assert devs[0].id == "ha:light.bedroom"


def test_expand_unknown_returns_empty(fake_registry):
    assert device_translator.expand_selector({"id": "ha:nope.nada"}) == []


# ── Verb translation ────────────────────────────────────────────────────────

def test_capability_to_command_router_passthrough():
    f = device_translator._capability_to_command_router_command
    assert f("turn_on") == "turn_on"
    assert f("toggle") == "toggle"


def test_capability_to_command_router_set_brightness_aliases_to_turn_on():
    """set_brightness rides HA's turn_on with a brightness_pct payload —
    command_router speaks HA service names, so the seam must translate."""
    assert device_translator._capability_to_command_router_command("set_brightness") == "turn_on"
    assert device_translator._capability_to_command_router_command("set_color") == "turn_on"


# ── route_command delegates to command_router ───────────────────────────────

def test_route_command_unknown_device(fake_registry):
    out = device_translator.route_command("ha:nope.nada", "turn_on")
    assert out["ok"] is False
    assert "Unknown" in out["message"]


def test_route_command_delegates(fake_registry, monkeypatch):
    captured = {}

    def fake_route(entry, command, params):
        captured["entry"] = entry
        captured["command"] = command
        captured["params"] = params
        return {"ok": True, "message": "fake ok", "_routed_via": "wifi", "_attempts": []}

    monkeypatch.setattr("services.command_router.route_command", fake_route)
    monkeypatch.setattr(
        "services.command_router.resolve_hybrid_entry",
        lambda eid, entry: dict(entry),
    )

    result = device_translator.route_command(
        "ha:light.living_room", "set_brightness", {"brightness_pct": 50}
    )
    assert result["ok"] is True
    # Verb was translated for command_router's HA-shaped vocabulary.
    assert captured["command"] == "turn_on"
    # Underlying entry preserved so command_router can do its hybrid dance.
    assert captured["entry"]["entity_id"] == "light.living_room"


# ── query_state ─────────────────────────────────────────────────────────────

def test_query_state_uses_cache_when_present(fake_registry, monkeypatch):
    import services.ha_subscriber as ha_sub
    monkeypatch.setitem(ha_sub.state_cache, "light.bedroom",
                        {"state": "on", "attributes": {"brightness": 200}})
    try:
        out = device_translator.query_state("ha:light.bedroom")
        assert out["ok"] is True
        assert out["state"] == "on"
        assert out["source"] == "cache"
    finally:
        ha_sub.state_cache.pop("light.bedroom", None)


def test_query_state_ir_only_returns_assumed(fake_registry, monkeypatch):
    monkeypatch.setattr(
        "services.ir_manager.get_ir_device",
        lambda ir_id: {"id": ir_id, "assumed_state": "off"},
    )
    out = device_translator.query_state("ir:ir_tv_living")
    assert out["ok"] is True
    assert out["state"] == "off"
    assert out["source"] == "ir_assumed"
