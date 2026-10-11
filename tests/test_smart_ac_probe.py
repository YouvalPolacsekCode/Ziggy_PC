"""Steering a user away from infrared when their AC is on Wi-Fi.

The failure this prevents, observed in a real home: the customer's four air
conditioners were all on Wi-Fi, but Wi-Fi pairing couldn't surface them, so he
built an infrared remote instead. Infrared cannot work in his house at all —
one handset drives every unit by proximity, so it carries no per-unit identity.
He ended up with a card called "ac 1" showing a null temperature that sprays
commands at whatever is in range.

Infrared is not merely "the fallback" in a multi-split home; it cannot address
a specific unit. So before Ziggy lets anyone teach an AC remote, it asks
whether a smart AC is actually reachable.

The probe is a real scan, not a guess: it starts the vendor's own config flow,
which performs a UDP broadcast, reads the answer, and then always aborts so no
config entry is created as a side effect of merely looking.
"""
from __future__ import annotations

import asyncio

import services.ha_flow_driver as flow_driver
from backend.routers import pairing_router as pr


def _wire(monkeypatch, step, *, fail_init=False):
    aborted = []

    async def fake_init(handler, *, source="user", show_advanced_options=False):
        if fail_init:
            return {"ok": False, "error": "boom"}
        fake_init.handler = handler
        return {"ok": True, "step": step}

    async def fake_abort(flow_id):
        aborted.append(flow_id)
        return {"ok": True}

    monkeypatch.setattr(flow_driver, "init_flow", fake_init)
    monkeypatch.setattr(flow_driver, "abort_flow", fake_abort)
    return aborted


def test_units_on_the_network_are_reported_available(monkeypatch):
    """A confirm form means the vendor's scan actually found hardware."""
    _wire(monkeypatch, {"type": "form", "flow_id": "f1", "step_id": "confirm"})
    out = asyncio.run(pr.smart_ac_probe())
    assert out["available"] is True
    assert out["brand"] == "tadiran"


def test_no_devices_found_is_reported_unavailable(monkeypatch):
    _wire(monkeypatch, {"type": "abort", "flow_id": "f1", "reason": "no_devices_found"})
    out = asyncio.run(pr.smart_ac_probe())
    assert out["available"] is False


def test_already_configured_is_reported_distinctly(monkeypatch):
    """A home that already HAS the integration set up is still a reason not to
    send the user to infrared — but it is NOT the same fact as "hardware
    answered a scan", and conflating them cost us a real debugging session.

    A customer's four ACs were deleted; the config entry survived; the probe
    reported `available: true` and was read as "the slate is clean", when what
    it actually meant was "there is still an entry here". The caller must be
    able to tell the two apart.
    """
    _wire(monkeypatch, {"type": "abort", "flow_id": "f1",
                        "reason": "single_instance_allowed"})
    out = asyncio.run(pr.smart_ac_probe())
    assert out["available"] is True
    assert out["state"] == "already_configured"
    assert out["found_hardware"] is False, (
        "an aborted flow proves nothing about what is on the network")


def test_hardware_found_is_its_own_state(monkeypatch):
    _wire(monkeypatch, {"type": "form", "flow_id": "f1", "step_id": "confirm"})
    out = asyncio.run(pr.smart_ac_probe())
    assert out["state"] == "found"
    assert out["found_hardware"] is True


def test_nothing_found_is_its_own_state(monkeypatch):
    _wire(monkeypatch, {"type": "abort", "flow_id": "f1", "reason": "no_devices_found"})
    out = asyncio.run(pr.smart_ac_probe())
    assert out["state"] == "none"
    assert out["found_hardware"] is False


def test_probe_never_leaves_a_flow_behind(monkeypatch):
    """Looking must not create anything. A live flow left dangling would be
    consumed later and produce the 'device vanished' dead end."""
    aborted = _wire(monkeypatch, {"type": "form", "flow_id": "f1", "step_id": "confirm"})
    asyncio.run(pr.smart_ac_probe())
    assert aborted == ["f1"], "the probe must abort the flow it opened"


def test_probe_failure_is_not_reported_as_available(monkeypatch):
    """If we cannot tell, we must not claim a smart AC exists — that would
    block the infrared path the user may genuinely need."""
    _wire(monkeypatch, {}, fail_init=True)
    out = asyncio.run(pr.smart_ac_probe())
    assert out["available"] is False
