"""Rehearsal mode: a chat turn that must not touch the home.

The guarded hop is the transport (HA service posts, IR sends), so any
caller — v1 handler, v2 agent tool, routine — is covered without knowing
about the flag. Each test runs in a fresh contextvars context so the flag
never leaks between tests.
"""
from __future__ import annotations

import asyncio
import contextvars

import pytest

from services import home_automation as ha
from services import rehearsal


def _in_rehearsal(fn, *a, **kw):
    ctx = contextvars.copy_context()

    def _run():
        rehearsal.activate()
        return fn(*a, **kw)
    return ctx.run(_run)


class _Boom:
    """A transport that must never be reached."""
    def post(self, *a, **kw):
        raise AssertionError("HA write reached the network during rehearsal")


class _Fake200:
    status_code = 200
    text = "ok"

    def json(self):
        return []


class _Session200:
    def __init__(self):
        self.calls = []

    def post(self, endpoint, **kw):
        self.calls.append(endpoint)
        return _Fake200()


# ---- HA service hop -----------------------------------------------------------
def test_call_service_is_skipped_when_rehearsing(monkeypatch):
    monkeypatch.setattr(ha, "_session", _Boom())
    r = _in_rehearsal(ha.call_service, "light", "turn_on", {"entity_id": "light.x"})
    assert r["ok"] is True and r["rehearsal"] is True


def test_call_service_posts_when_not_rehearsing(monkeypatch):
    s = _Session200()
    monkeypatch.setattr(ha, "_session", s)
    monkeypatch.setattr(ha, "_headers", lambda: {})
    r = ha.call_service("light", "turn_on", {"entity_id": "light.x"})
    assert r["ok"] is True and "rehearsal" not in r
    assert s.calls and s.calls[0].endswith("/api/services/light/turn_on")


@pytest.mark.parametrize("fn,args", [
    (ha.toggle_light, ("light.x", True)),
    (ha.set_light_color, ("light.x", (255, 0, 0))),
    (ha.set_light_brightness, ("light.x", 40)),
    (ha.set_ac_temperature, ("climate.x", 22)),
    (ha.set_tv_source, ("media_player.x", "HDMI1")),
])
def test_direct_helpers_are_skipped_when_rehearsing(monkeypatch, fn, args):
    monkeypatch.setattr(ha, "_session", _Boom())
    code, text = _in_rehearsal(fn, *args)
    assert code == 200 and text == "rehearsal"


# ---- IR hop ---------------------------------------------------------------------
def test_ir_send_is_skipped_when_rehearsing(monkeypatch):
    from services import ir_manager
    monkeypatch.setattr(ir_manager, "get_ir_device",
                        lambda d: {"name": "TV", "blaster_host": "10.0.0.9", "ir_codes": {"power": "AAAA"}})
    monkeypatch.setattr(ir_manager, "_direct_send",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("IR reached the blaster")))
    r = _in_rehearsal(ir_manager.send_ir_command, "tv", "power")
    assert r["ok"] is True and r["rehearsal"] is True


# ---- agent tool hop -----------------------------------------------------------
def test_config_tools_are_acknowledged_not_run(monkeypatch):
    from core.agent import tools

    async def _never(*a, **k):
        raise AssertionError("create_automation ran during rehearsal")
    monkeypatch.setattr(tools, "_exec_passthrough", _never)

    def _run():
        rehearsal.activate()
        return asyncio.run(tools.execute_tool("create_automation", {"x": 1}, {}, "he"))
    r = contextvars.copy_context().run(_run)
    assert r["ok"] is True and r["rehearsal"] is True


def test_read_tools_still_run_during_rehearsal(monkeypatch):
    from core.agent import tools
    monkeypatch.setattr(tools, "_exec_query_devices", lambda a, d: {"ok": True, "devices": ["real"]})

    def _run():
        rehearsal.activate()
        return asyncio.run(tools.execute_tool("query_devices", {}, {}, "he"))
    r = contextvars.copy_context().run(_run)
    assert r == {"ok": True, "devices": ["real"]}


# ---- flag plumbing ---------------------------------------------------------------
def test_flag_is_request_scoped_not_global():
    assert rehearsal.active() is False
    assert _in_rehearsal(rehearsal.active) is True
    assert rehearsal.active() is False          # did not leak out of the context


def test_activate_if_enabled_reads_setting(monkeypatch):
    monkeypatch.setattr(rehearsal, "is_enabled", lambda: False)
    assert contextvars.copy_context().run(rehearsal.activate_if_enabled) is False
    monkeypatch.setattr(rehearsal, "is_enabled", lambda: True)

    def _run():
        assert rehearsal.activate_if_enabled() is True
        return rehearsal.active()
    assert contextvars.copy_context().run(_run) is True
