"""Brand-initiated Wi-Fi pairing — the path that lets an AC be paired at all.

Root cause captured here: Ziggy's Wi-Fi pairing listed ONLY flows HA had
already created from passive discovery (`config_entries/flow/progress`). Every
Israeli AC integration is user-initiated-only — none of them ever advertises
itself, so none ever lands in that list:

  * `gree` (Tadiran) — manifest has no zeroconf/dhcp/ssdp key at all; its
    config_flow is `config_entry_flow.register_discovery_flow`, so the UDP
    broadcast scan runs INSIDE `async_step_user`, i.e. only once somebody
    starts the flow.
  * `electrasmart` (Electra) — cloud_polling, no discovery, needs an OTP.

Result: a customer could rescan forever and never see their air conditioner.
Confirmed live on a customer hub (HA 2026.6.1) whose pending-flow list held
exactly one entry, `cast`, and whose registry had no climate device at all.

These tests pin the fix: a brand-keyed start route that drives HA's
user-sourced flow through the SAME envelope the discovery path already
returns, so the existing ConfigFlowRunner drives it unchanged.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.routers import pairing_router as pr
import services.ha_flow_driver as flow_driver


def _start(monkeypatch, fake, brand="tadiran"):
    """Invoke the start route directly with a patched init_flow."""
    monkeypatch.setattr(flow_driver, "init_flow", fake)
    body = pr.FlowStartBody(brand=brand)
    return asyncio.run(pr.config_flow_start(body, _user={"username": "t"}))


def _ok(step):
    async def fake(handler, *, source="user", show_advanced_options=False):
        fake.seen = {"handler": handler, "source": source}
        return {"ok": True, "step": step}
    fake.seen = {}
    return fake


# ── Brand → handler translation ──────────────────────────────────────────────

def test_tadiran_starts_the_gree_flow_as_user_source(monkeypatch):
    """Tadiran is a Gree unit. The flow MUST be user-sourced — a discovery
    source is exactly what never happens for this integration."""
    fake = _ok({"type": "form", "flow_id": "f1", "step_id": "confirm"})
    out = _start(monkeypatch, fake, brand="tadiran")

    assert fake.seen["handler"] == "gree"
    assert fake.seen["source"] == "user"
    assert out["ok"] is True


def test_electra_starts_the_electrasmart_flow(monkeypatch):
    fake = _ok({"type": "form", "flow_id": "f1", "step_id": "user"})
    _start(monkeypatch, fake, brand="electra")
    assert fake.seen["handler"] == "electrasmart"


def test_unknown_brand_is_rejected_without_touching_ha(monkeypatch):
    """The allowlist is a security boundary: this route must not be usable to
    start an arbitrary HA config flow."""
    called = False

    async def fake(handler, *, source="user", show_advanced_options=False):
        nonlocal called
        called = True
        return {"ok": True, "step": {}}

    monkeypatch.setattr(flow_driver, "init_flow", fake)
    with pytest.raises(Exception) as exc:
        asyncio.run(pr.config_flow_start(pr.FlowStartBody(brand="../../etc/passwd"),
                                         _user={"username": "t"}))
    assert getattr(exc.value, "status_code", None) == 400
    assert called is False, "unknown brand must never reach HA"


# ── The envelope must be the one ConfigFlowRunner already drives ─────────────

def test_form_step_returns_runner_drivable_envelope(monkeypatch):
    fake = _ok({"type": "form", "flow_id": "f1", "step_id": "confirm",
                "data_schema": []})
    out = _start(monkeypatch, fake)
    assert out["status"] == "form"
    assert out["flow_id"] == "f1", "runner needs the flow_id to submit the next step"


def test_create_entry_reports_done(monkeypatch):
    fake = _ok({"type": "create_entry", "flow_id": "f1", "title": "Gree Climate"})
    out = _start(monkeypatch, fake)
    assert out["status"] == "done"


# ── Aborts are the common case and must be actionable, not a dead end ───────

def test_no_devices_found_explains_what_to_check(monkeypatch):
    """`no_devices_found` is what a user gets when the AC's Wi-Fi module is off,
    on another SSID, or still in AP mode. A bare reason code strands them."""
    fake = _ok({"type": "abort", "flow_id": "f1", "reason": "no_devices_found"})
    out = _start(monkeypatch, fake)

    assert out["ok"] is False
    assert out["status"] == "aborted"
    detail = (out.get("detail") or "").lower()
    assert detail, "an abort must carry human guidance"
    assert "wi-fi" in detail or "wifi" in detail
    assert "tadiran" in detail, "guidance should name the brand the user picked"


def test_already_configured_is_not_reported_as_a_failure_to_find(monkeypatch):
    fake = _ok({"type": "abort", "flow_id": "f1", "reason": "single_instance_allowed"})
    out = _start(monkeypatch, fake)
    detail = (out.get("detail") or "").lower()
    assert "already" in detail


def test_ha_error_surfaces_real_reason(monkeypatch):
    async def fake(handler, *, source="user", show_advanced_options=False):
        return {"ok": False, "status_code": 500, "error": "Integration not found"}

    monkeypatch.setattr(flow_driver, "init_flow", fake)
    out = asyncio.run(pr.config_flow_start(pr.FlowStartBody(brand="tadiran"),
                                           _user={"username": "t"}))
    assert out["ok"] is False
    assert "Integration not found" in (out.get("detail") or out.get("error") or "")


# ── The no-leak contract: HA vocabulary never reaches the customer ──────────

def test_brand_list_never_leaks_ha_handler_names():
    """Ziggy is the only product surface — the user never sees `gree`,
    `electrasmart`, or the word "integration"."""
    out = asyncio.run(pr.wifi_brands())
    brands = out["brands"]
    assert brands, "the picker needs at least one brand"

    blob = str(brands).lower()
    for leak in ("gree", "electrasmart", "midea", "handler", "config_flow",
                 "integration", "home assistant", "homeassistant"):
        assert leak not in blob, f"HA vocabulary leaked to the UI: {leak}"

    for b in brands:
        assert b.get("brand") and b.get("label")
        assert "handler" not in b
