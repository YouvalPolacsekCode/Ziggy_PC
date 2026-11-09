"""Matter commissioning must tell the user what to do when it fails.

Field report (Aug 3 2026): back-to-back attempts showed matter-server's raw
"Commission with code failed for node 19/20/21". That text is matter-server's
generic failure (it spends a fresh node id per attempt), and it gave the user
nothing to act on. These tests pin the contract: `commission_matter` returns an
actionable `error` plus the raw text in `detail`, and never raises.
"""
from __future__ import annotations

import asyncio

import pytest

import services.ha_pairing as hp


def _fake_ws(commission_result=None, exc=None):
    calls = []

    async def fake(*commands, timeout=4.0):
        cmd = commands[0]
        calls.append(cmd["type"])
        if cmd["type"] == "thread/list_datasets":
            return [{"success": True, "result": {"datasets": [
                {"dataset_id": "ds1", "preferred": True}]}}]
        if cmd["type"] == "thread/get_dataset_tlv":
            return [{"success": True, "result": {"tlv": "0e08abcd"}}]
        if cmd["type"] == "matter/set_thread":
            return [{"success": True}]
        if cmd["type"] == "matter/commission":
            if exc is not None:
                raise exc
            return [commission_result]
        raise AssertionError(cmd)

    fake.calls = calls
    return fake


def _commission(monkeypatch, **kw):
    fake = _fake_ws(**kw)
    monkeypatch.setattr(hp, "_ws", fake)
    return asyncio.run(hp.commission_matter("MT:Y.K90SO5")), fake.calls


def test_success_pushes_thread_dataset_first(monkeypatch):
    res, calls = _commission(monkeypatch, commission_result={"success": True})
    assert res == {"ok": True}
    assert calls == ["thread/list_datasets", "thread/get_dataset_tlv",
                     "matter/set_thread", "matter/commission"]


def test_generic_node_failure_is_actionable(monkeypatch):
    raw = "Commission with code failed for node 19."
    res, _ = _commission(monkeypatch, commission_result={
        "success": False, "error": {"code": "9", "message": raw}})
    assert res["ok"] is False
    assert res["detail"] == raw
    assert "node 19" not in res["error"]
    assert "Factory-reset" in res["error"]


def test_matter_not_loaded_says_set_up_matter(monkeypatch):
    res, _ = _commission(monkeypatch, commission_result={
        "success": False,
        "error": {"code": "unknown_command", "message": "Unknown command."}})
    assert "isn't set up" in res["error"]


def test_timeout_is_reported_not_blank(monkeypatch):
    res, _ = _commission(monkeypatch, exc=asyncio.TimeoutError())
    assert res["ok"] is False
    assert res["error"] == hp._MATTER_TIMEOUT_HINT


def test_ha_unreachable(monkeypatch):
    res, _ = _commission(monkeypatch, exc=ConnectionRefusedError(111, "refused"))
    assert res["error"] == hp._MATTER_UNREACHABLE_HINT


@pytest.mark.parametrize("raw, expect", [
    ("Discovery timed out", "pairing mode"),
    ("BLE scan error: Timeout", "pairing mode"),
    ("Required network information not provided: thread (no)", "Thread"),
    ("BluezEndpoint Internal error", "Bluetooth"),
    ("le-connection-abort-by-local", "Bluetooth"),
    ("Invalid setup code", "setup code"),
    ("Device attestation failed", "authenticity"),
    ("Commission with code failed for node 21.", "Factory-reset"),
    ("something nobody has seen", "Matter pairing failed"),
])
def test_explain_matter_error(raw, expect):
    assert expect in hp.explain_matter_error(raw)


def test_unable_does_not_look_like_bluetooth():
    # "unable" must not trip a loose "ble" match.
    assert "Bluetooth" not in hp.explain_matter_error("unable to do the thing")
