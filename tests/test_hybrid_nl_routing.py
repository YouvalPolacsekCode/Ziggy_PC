"""Natural-language device control shares the tile path's Wi-Fi↔IR fallback.

The hybrid command router (services/command_router.py) — smart-vs-IR ranking,
wifi_dies_when_off learning, per-command overrides — was only reachable from
the UI tile path (/api/ha/control), routines, and the edge translator. Saying
"turn on the TV" (v1 handler) or asking the v2 agent went straight to
call_service: HA returned ok, the powered-off TV never saw the packet.

Fix: `hybrid_route_or_none(entity_id, command)` — route through the hybrid
engine iff the entity has a linked IR codeset, return None otherwise so every
caller keeps its existing single-source path for the 99% of devices with no
IR link.
"""
import asyncio

import pytest

from services import command_router as cr


# ── the seam itself ──────────────────────────────────────────────────────────

def test_returns_none_for_non_hybrid(monkeypatch):
    import services.device_registry as dreg
    import services.ir_manager as irm
    monkeypatch.setattr(dreg, "get_device_info", lambda eid: {"entity_id": eid})
    monkeypatch.setattr(irm, "list_ir_devices", lambda **k: [])
    assert cr.hybrid_route_or_none("switch.plain_plug", "turn_on") is None


def test_routes_for_hybrid(monkeypatch):
    import services.device_registry as dreg
    monkeypatch.setattr(
        dreg, "get_device_info",
        lambda eid: {"entity_id": eid, "ir_device_id": "ir_tv_1"})
    seen = {}
    monkeypatch.setattr(
        cr, "route_command",
        lambda entry, command, params=None: seen.update(entry=entry, command=command)
        or {"ok": True, "_routed_via": "ir"})
    res = cr.hybrid_route_or_none("media_player.salon_tv", "turn_on")
    assert res == {"ok": True, "_routed_via": "ir"}
    assert seen["command"] == "turn_on"
    assert seen["entry"]["ir_device_id"] == "ir_tv_1"


def test_ignores_non_power_commands(monkeypatch):
    """Brightness / color / temperature stay on their direct paths — the tile
    path never hybrid-routes those either."""
    import services.device_registry as dreg
    monkeypatch.setattr(
        dreg, "get_device_info",
        lambda eid: {"entity_id": eid, "ir_device_id": "ir_tv_1"})
    assert cr.hybrid_route_or_none("light.strip", "set_brightness") is None


def test_registry_failure_degrades_to_none(monkeypatch):
    import services.device_registry as dreg
    def boom(eid):
        raise RuntimeError("registry unavailable")
    monkeypatch.setattr(dreg, "get_device_info", boom)
    monkeypatch.setattr(cr, "resolve_hybrid_entry", boom)
    assert cr.hybrid_route_or_none("switch.x", "turn_on") is None


# ── v1 generic device handler ────────────────────────────────────────────────

def test_device_handler_uses_hybrid_router(monkeypatch):
    from core.handlers import device_handler as dh
    seen = {}
    monkeypatch.setattr(
        cr, "hybrid_route_or_none",
        lambda eid, command, params=None: seen.update(eid=eid, command=command)
        or {"ok": True, "_routed_via": "ir"},
        raising=False)
    monkeypatch.setattr(
        dh, "call_service",
        lambda *a, **k: pytest.fail("hybrid device must not fall through to call_service"))
    res = asyncio.run(dh.handle_control_device(
        {"domain": "switch", "action": "on", "entity_id": "switch.tv_plug"}))
    assert res["ok"] is True
    assert seen == {"eid": "switch.tv_plug", "command": "turn_on"}


def test_device_handler_falls_back_to_call_service(monkeypatch):
    from core.handlers import device_handler as dh
    monkeypatch.setattr(
        cr, "hybrid_route_or_none", lambda *a, **k: None, raising=False)
    seen = {}
    monkeypatch.setattr(
        dh, "call_service",
        lambda domain, service, data: seen.update(domain=domain, service=service, data=data)
        or {"ok": True})
    res = asyncio.run(dh.handle_control_device(
        {"domain": "switch", "action": "on", "entity_id": "switch.plain_plug"}))
    assert res["ok"] is True
    assert seen["service"] == "turn_on"


# ── v1 climate handler ───────────────────────────────────────────────────────

def test_climate_handler_uses_hybrid_router(monkeypatch):
    from core.handlers import climate_handler as ch
    monkeypatch.setattr(ch, "resolve_entity", lambda room, t: "climate.bedroom_ac")
    seen = {}
    monkeypatch.setattr(
        cr, "hybrid_route_or_none",
        lambda eid, command, params=None: seen.update(eid=eid, command=command)
        or {"ok": True, "_routed_via": "ir"},
        raising=False)
    nudges = []
    monkeypatch.setattr(
        ch, "call_service",
        lambda domain, service, data: nudges.append(service) or {"ok": True})
    res = asyncio.run(ch.handle_control_ac({"room": "bedroom", "action": "turn on"}))
    assert res["ok"] is True
    assert seen == {"eid": "climate.bedroom_ac", "command": "turn_on"}


# ── v1 light handler ─────────────────────────────────────────────────────────

def test_light_handler_uses_hybrid_router(monkeypatch):
    from core.handlers import light_handler as lh
    seen = {}
    monkeypatch.setattr(
        cr, "hybrid_route_or_none",
        lambda eid, command, params=None: seen.update(eid=eid, command=command)
        or {"ok": True, "_routed_via": "ir"},
        raising=False)
    monkeypatch.setattr(
        lh, "toggle_light",
        lambda *a, **k: pytest.fail("hybrid light must not fall through to toggle_light"))
    res = asyncio.run(lh.handle_toggle_light(
        {"room": "living_room", "entity_id": "light.ir_strip", "turn_on": True}))
    assert res["ok"] is True
    assert seen == {"eid": "light.ir_strip", "command": "turn_on"}


def test_light_handler_falls_back_to_toggle_light(monkeypatch):
    from core.handlers import light_handler as lh
    monkeypatch.setattr(
        cr, "hybrid_route_or_none", lambda *a, **k: None, raising=False)
    seen = {}
    monkeypatch.setattr(
        lh, "toggle_light", lambda eid, on: seen.update(eid=eid, on=on) or (200, "ok"))
    res = asyncio.run(lh.handle_toggle_light(
        {"room": "living_room", "entity_id": "light.plain", "turn_on": False}))
    assert res["ok"] is True
    assert seen == {"eid": "light.plain", "on": False}


# ── v2 agent control_device ──────────────────────────────────────────────────

AGENT_DIR = {
    "devices": [
        {"entity_id": "media_player.salon_tv", "name": "Salon TV",
         "room": "living_room", "room_he": "סלון", "domain": "media_player",
         "state": "off", "on": False, "he_noun": "הטלוויזיה"},
        {"entity_id": "light.ir_strip", "name": "IR Strip",
         "room": "living_room", "room_he": "סלון", "domain": "light",
         "state": "off", "on": False, "he_noun": "האור"},
        {"entity_id": "climate.bedroom_ac", "name": "Bedroom AC",
         "room": "bedroom", "room_he": "חדר שינה", "domain": "climate",
         "state": "off", "on": False, "he_noun": "המזגן"},
    ],
    "presence": [],
    "by_room": {},
}


def test_agent_tv_on_routes_hybrid(monkeypatch):
    from core.agent import tools as t
    seen = {}
    monkeypatch.setattr(
        cr, "hybrid_route_or_none",
        lambda eid, command, params=None: seen.update(eid=eid, command=command)
        or {"ok": True, "_routed_via": "ir"},
        raising=False)
    import services.home_automation as ha
    monkeypatch.setattr(
        ha, "call_service",
        lambda *a, **k: pytest.fail("hybrid TV must not fall through to call_service"))
    res = asyncio.run(t._exec_control_device(
        {"entity_id": "media_player.salon_tv", "action": "on"}, AGENT_DIR))
    assert res["ok"]
    assert seen == {"eid": "media_player.salon_tv", "command": "turn_on"}


def test_agent_light_on_routes_hybrid(monkeypatch):
    from core.agent import tools as t
    seen = {}
    monkeypatch.setattr(
        cr, "hybrid_route_or_none",
        lambda eid, command, params=None: seen.update(eid=eid, command=command)
        or {"ok": True, "_routed_via": "ir"},
        raising=False)
    import services.home_automation as ha
    monkeypatch.setattr(
        ha, "toggle_light",
        lambda *a, **k: pytest.fail("hybrid light must not fall through to toggle_light"))
    res = asyncio.run(t._exec_control_device(
        {"entity_id": "light.ir_strip", "action": "on"}, AGENT_DIR))
    assert res["ok"]
    assert seen == {"eid": "light.ir_strip", "command": "turn_on"}


def test_agent_ac_on_prefers_smart_when_reachable(monkeypatch):
    """AC keeps the cool-first smart path when its Wi-Fi entity is live —
    IR is a rescue, not a replacement (smart carries true state)."""
    from core.agent import tools as t
    monkeypatch.setattr(cr, "wifi_reachable", lambda eid: True, raising=False)
    monkeypatch.setattr(
        cr, "hybrid_route_or_none",
        lambda *a, **k: pytest.fail("reachable AC must use the smart path"),
        raising=False)
    import services.home_automation as ha
    seen = {}
    monkeypatch.setattr(
        ha, "call_service",
        lambda domain, service, data: seen.update(service=service, data=data)
        or {"ok": True})
    res = asyncio.run(t._exec_control_device(
        {"entity_id": "climate.bedroom_ac", "action": "on"}, AGENT_DIR))
    assert res["ok"]
    assert seen["service"] == "set_hvac_mode"
    assert seen["data"]["hvac_mode"] == "cool"


def test_agent_ac_on_falls_to_hybrid_when_unreachable(monkeypatch):
    from core.agent import tools as t
    monkeypatch.setattr(cr, "wifi_reachable", lambda eid: False, raising=False)
    seen = {}
    monkeypatch.setattr(
        cr, "hybrid_route_or_none",
        lambda eid, command, params=None: seen.update(eid=eid, command=command)
        or {"ok": True, "_routed_via": "ir"},
        raising=False)
    res = asyncio.run(t._exec_control_device(
        {"entity_id": "climate.bedroom_ac", "action": "on"}, AGENT_DIR))
    assert res["ok"]
    assert seen == {"eid": "climate.bedroom_ac", "command": "turn_on"}
