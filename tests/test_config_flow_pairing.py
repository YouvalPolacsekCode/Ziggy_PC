"""Regression tests for native Wi-Fi / config-flow device pairing.

Root cause captured here: driving a slow HA discovery flow (e.g. an Android TV
whose confirm→pair step blocks 20–40s while the TV shows a PIN) used to:
  1. time out against a hardcoded 20s `submit_step` limit, and
  2. surface as a blanket HTTP 502 the UI rendered as "temporarily unavailable"
     ("upstream issues"), with no PIN screen and no way to recover — the device
     then vanished from the discovery list on rescan.

These tests pin the fixed contract:
  * `submit_step` accepts a caller-supplied timeout and reports a distinct
    `kind="timeout"` on read-timeout (not a generic error).
  * `config_flow_step` never raises an opaque 502 for expected conditions.
    It returns an actionable, structured envelope (HTTP 200, `ok=False`) that
    distinguishes timeout / flow-gone / other-error, so the UI can guide the
    user and offer Rescan — mirroring the switcher flow's documented pattern.
  * The happy path still reshapes a `form` (PIN entry) and `create_entry`
    (done) correctly.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.routers import pairing_router as pr
from backend.routers.pairing_router import FlowStepBody
import services.ha_flow_driver as flow_driver


def _step(monkeypatch, fake):
    """Invoke the route directly with a patched submit_step; return its envelope."""
    monkeypatch.setattr(flow_driver, "submit_step", fake)
    body = FlowStepBody(user_input={})
    return asyncio.run(pr.config_flow_step("flow-123", body, _user={"username": "t"}))


# ── Failure conditions must be actionable, never an opaque 502 ────────────────

def test_timeout_returns_actionable_envelope_not_502(monkeypatch):
    captured = {}

    async def fake(flow_id, user_input, timeout=60):
        captured["timeout"] = timeout
        return {"ok": False, "kind": "timeout", "error": "HA did not respond"}

    out = _step(monkeypatch, fake)
    assert out["ok"] is False
    assert out["status"] == "timeout"
    assert out.get("detail"), "timeout must carry a human, actionable message"
    # The whole point: the router must give the pair step a generous window,
    # well past the old 20s cap that guaranteed failure for Android TV.
    assert captured["timeout"] >= 45


def test_flow_gone_returns_gone_status(monkeypatch):
    async def fake(flow_id, user_input, timeout=60):
        # HA returns 404 {"message":"Invalid flow specified"} once a discovery
        # flow has been consumed / the device dropped off the network.
        return {"ok": False, "status_code": 404, "error": "Invalid flow specified"}

    out = _step(monkeypatch, fake)
    assert out["ok"] is False
    assert out["status"] == "gone"
    assert out.get("detail")


def test_other_ha_error_passes_through_real_reason(monkeypatch):
    async def fake(flow_id, user_input, timeout=60):
        return {"ok": False, "status_code": 500, "error": "boom from HA"}

    out = _step(monkeypatch, fake)
    assert out["ok"] is False
    assert out["status"] == "error"
    # The real upstream reason must survive, not be flattened to "upstream issues".
    assert "boom from HA" in out["detail"]


# ── Happy path still works ────────────────────────────────────────────────────

def test_form_step_reshaped_with_pin_field(monkeypatch):
    async def fake(flow_id, user_input, timeout=60):
        return {"ok": True, "step": {
            "type": "form", "step_id": "pair", "flow_id": flow_id,
            "data_schema": [{"name": "pin", "type": "string", "required": True}],
            "errors": {},
        }}

    out = _step(monkeypatch, fake)
    assert out["ok"] is True
    assert out["status"] == "form"
    assert any(f["name"] == "pin" for f in out["fields"])


def test_create_entry_reshaped_as_done(monkeypatch):
    async def fake(flow_id, user_input, timeout=60):
        return {"ok": True, "step": {
            "type": "create_entry", "flow_id": flow_id, "title": "MIBOX4",
        }}

    out = _step(monkeypatch, fake)
    assert out["ok"] is True
    assert out["status"] == "done"
    assert out["title"] == "MIBOX4"


# ── submit_step timeout semantics ─────────────────────────────────────────────

def test_submit_step_honors_timeout_and_flags_read_timeout(monkeypatch):
    import requests

    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["timeout"] = timeout
        raise requests.exceptions.ReadTimeout("read timed out")

    monkeypatch.setattr(flow_driver.requests, "post", fake_post)
    out = asyncio.run(flow_driver.submit_step("flow-x", {}, timeout=55))
    assert out["ok"] is False
    assert out["kind"] == "timeout"
    assert captured["timeout"] == 55


def test_submit_step_surfaces_status_code_and_clean_error(monkeypatch):
    class _Resp:
        status_code = 404
        text = '{"message":"Invalid flow specified"}'

        def json(self):
            return {"message": "Invalid flow specified"}

    monkeypatch.setattr(flow_driver.requests, "post", lambda *a, **k: _Resp())
    out = asyncio.run(flow_driver.submit_step("flow-x", {}))
    assert out["ok"] is False
    assert out["status_code"] == 404
    assert out["error"] == "Invalid flow specified"
