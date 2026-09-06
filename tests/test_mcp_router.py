"""MCP transport — backend/routers/mcp_router.py.

Covers the handshake, the notification 202, tools/list mirroring the action
registry, tools/call running as person:<username> from source "mcp", the
JSON-RPC error codes, bearer auth (missing / invalid / revoked → 401), the
per-token rate limit (429 + Retry-After) and batch arrays.

`run_action` is monkeypatched on the `core.actions` package (the router calls
`_actions.run_action` at call time) so no device directory or HA is needed.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import mcp_router
from core import actions as _actions
from services import auth_db, external_tokens, rehearsal


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)
    monkeypatch.setattr(external_tokens, "_initialized_for", None)
    mcp_router._hits.clear()
    yield
    mcp_router._hits.clear()
    monkeypatch.setattr(external_tokens, "_initialized_for", None)


@pytest.fixture
def calls(monkeypatch):
    """Replace the real executor; record every call; return a canned envelope."""
    seen: list[dict] = []

    async def fake_run_action(name, args=None, *, actor=None, source="app", lang=None, directory=None):
        seen.append({"name": name, "args": dict(args or {}), "actor": actor,
                     "source": source, "lang": lang})
        if name == "query_devices":
            return {"ok": True, "message": "", "data": {"kind": "device_list", "devices": []}}
        return {"ok": True, "message": f"did {name}", "data": {"entity_id": (args or {}).get("entity_id")}}

    monkeypatch.setattr(_actions, "run_action", fake_run_action)
    return seen


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(mcp_router.router)
    return TestClient(app)


@pytest.fixture
def token() -> str:
    return external_tokens.mint("alice", "Claude Code")["token"]


def _post(client, token, body, **kw):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    headers.update(kw.pop("headers", {}))
    return client.post("/mcp", json=body, headers=headers, **kw)


def _rpc(method, params=None, id=1):
    msg = {"jsonrpc": "2.0", "method": method}
    if id is not None:
        msg["id"] = id
    if params is not None:
        msg["params"] = params
    return msg


# ── handshake ───────────────────────────────────────────────────────────────
def test_initialize_handshake(client, token):
    r = _post(client, token, _rpc("initialize", {
        "protocolVersion": "2025-03-26",
        "capabilities": {},
        "clientInfo": {"name": "claude-code", "version": "1.0"},
    }))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["jsonrpc"] == "2.0" and body["id"] == 1
    res = body["result"]
    assert res["protocolVersion"] == "2025-03-26"        # echoed — one we know
    assert res["capabilities"] == {"tools": {"listChanged": False}}
    assert res["serverInfo"] == {"name": "ziggy", "version": "3.0"}
    assert "query_devices" in res["instructions"]
    assert "lock" in res["instructions"].lower()


def test_initialize_unknown_version_falls_back_to_latest(client, token):
    r = _post(client, token, _rpc("initialize", {"protocolVersion": "1999-01-01"}))
    assert r.json()["result"]["protocolVersion"] == "2025-06-18"
    r = _post(client, token, _rpc("initialize", {}))
    assert r.json()["result"]["protocolVersion"] == "2025-06-18"


def test_initialized_notification_is_202_empty(client, token):
    r = _post(client, token, _rpc("notifications/initialized", id=None))
    assert r.status_code == 202
    assert r.content == b""
    # Any notifications/* — never a response body.
    r = _post(client, token, _rpc("notifications/cancelled", {"requestId": 3}, id=None))
    assert r.status_code == 202


def test_ping(client, token):
    r = _post(client, token, _rpc("ping", id=7))
    assert r.status_code == 200
    assert r.json() == {"jsonrpc": "2.0", "id": 7, "result": {}}


def test_works_without_protocol_version_header_and_with_it(client, token):
    # No MCP-Protocol-Version header at all (default for _post) …
    assert _post(client, token, _rpc("ping")).status_code == 200
    # … and with one.
    r = _post(client, token, _rpc("ping"), headers={"MCP-Protocol-Version": "2025-06-18"})
    assert r.status_code == 200
    assert "Mcp-Session-Id" not in r.headers      # optional; we do not require sessions


# ── tools/list ──────────────────────────────────────────────────────────────
def test_tools_list_mirrors_registry(client, token):
    r = _post(client, token, _rpc("tools/list"))
    assert r.status_code == 200, r.text
    tools = r.json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert {"control_device", "query_devices"} <= names
    assert names == set(_actions.registry.names())
    by_name = {t["name"]: t for t in tools}
    cd = by_name["control_device"]
    assert cd["inputSchema"] == _actions.registry.get("control_device").params
    assert cd["inputSchema"]["type"] == "object"
    assert "entity_id" in cd["inputSchema"]["properties"]
    assert isinstance(cd["description"], str) and cd["description"]
    assert by_name["query_devices"]["inputSchema"]["type"] == "object"


# ── tools/call ──────────────────────────────────────────────────────────────
def test_tools_call_runs_as_person_from_mcp(client, token, calls, monkeypatch):
    activated = []
    monkeypatch.setattr(rehearsal, "activate_if_enabled", lambda: activated.append(True) or False)

    r = _post(client, token, _rpc("tools/call", {
        "name": "control_device",
        "arguments": {"entity_id": "light.kitchen", "action": "on"},
    }, id="abc"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == "abc"
    res = body["result"]
    assert res["isError"] is False
    assert res["content"] == [{"type": "text", "text": "did control_device"}]
    assert res["structuredContent"]["ok"] is True
    assert res["structuredContent"]["data"] == {"entity_id": "light.kitchen"}

    assert calls == [{
        "name": "control_device",
        "args": {"entity_id": "light.kitchen", "action": "on"},
        "actor": "person:alice",
        "source": "mcp",
        "lang": None,
    }]
    assert activated == [True]          # rehearsal gate consulted before running


def test_tools_call_empty_message_dumps_envelope(client, token, calls):
    r = _post(client, token, _rpc("tools/call", {"name": "query_devices", "arguments": {}}))
    res = r.json()["result"]
    assert res["isError"] is False
    text = res["content"][0]["text"]
    assert '"kind":"device_list"' in text          # compact JSON of the envelope
    assert res["structuredContent"]["data"]["kind"] == "device_list"


def test_tools_call_missing_arguments_defaults_to_empty(client, token, calls):
    r = _post(client, token, _rpc("tools/call", {"name": "query_devices"}))
    assert r.status_code == 200 and "result" in r.json()
    assert calls[0]["args"] == {}


def test_tools_call_failed_envelope_is_error_not_rpc_error(client, token, monkeypatch):
    async def failing(name, args=None, **kw):
        return {"ok": False, "message": "no such device", "needs_approval": False}
    monkeypatch.setattr(_actions, "run_action", failing)
    r = _post(client, token, _rpc("tools/call", {"name": "control_device", "arguments": {}}))
    body = r.json()
    assert "error" not in body
    assert body["result"]["isError"] is True
    assert body["result"]["content"][0]["text"] == "no such device"


def test_tools_call_stringifies_non_json_values(client, token, monkeypatch):
    from datetime import datetime

    async def weird(name, args=None, **kw):
        return {"ok": True, "message": "ok", "data": {"at": datetime(2026, 9, 6, 12, 0)}}
    monkeypatch.setattr(_actions, "run_action", weird)
    r = _post(client, token, _rpc("tools/call", {"name": "control_device", "arguments": {}}))
    assert r.status_code == 200, r.text
    assert r.json()["result"]["structuredContent"]["data"]["at"].startswith("2026-09-06")


def test_unknown_tool_is_invalid_params(client, token, calls):
    r = _post(client, token, _rpc("tools/call", {"name": "launch_rockets", "arguments": {}}))
    assert r.status_code == 200
    body = r.json()
    assert body["error"]["code"] == -32602
    assert "launch_rockets" in body["error"]["message"]
    assert calls == []                              # never reached the executor


def test_bad_call_params(client, token, calls):
    r = _post(client, token, _rpc("tools/call", {"arguments": {}}))
    assert r.json()["error"]["code"] == -32602
    r = _post(client, token, _rpc("tools/call", {"name": "control_device", "arguments": "x"}))
    assert r.json()["error"]["code"] == -32602
    assert calls == []


# ── JSON-RPC plumbing ───────────────────────────────────────────────────────
def test_unknown_method(client, token):
    r = _post(client, token, _rpc("resources/list"))
    assert r.status_code == 200
    assert r.json()["error"]["code"] == -32601


def test_malformed_json(client, token):
    r = client.post("/mcp", content=b"{not json", headers={
        "Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    assert r.status_code == 200
    body = r.json()
    assert body["error"]["code"] == -32700 and body["id"] is None


def test_invalid_request_shape(client, token):
    r = _post(client, token, {"id": 1, "method": "ping"})      # no jsonrpc
    assert r.json()["error"]["code"] == -32600
    r = _post(client, token, "just a string")
    assert r.json()["error"]["code"] == -32600


def test_batch_array(client, token, calls):
    batch = [
        _rpc("ping", id=1),
        _rpc("notifications/initialized", id=None),
        _rpc("tools/call", {"name": "control_device", "arguments": {"entity_id": "x", "action": "off"}}, id=2),
        _rpc("nope", id=3),
    ]
    r = _post(client, token, batch)
    assert r.status_code == 200, r.text
    out = r.json()
    assert isinstance(out, list) and [m["id"] for m in out] == [1, 2, 3]
    assert out[0]["result"] == {}
    assert out[1]["result"]["isError"] is False
    assert out[2]["error"]["code"] == -32601
    assert len(calls) == 1 and calls[0]["actor"] == "person:alice"


def test_batch_of_only_notifications_is_202(client, token):
    r = _post(client, token, [_rpc("notifications/initialized", id=None)])
    assert r.status_code == 202


def test_empty_batch_is_invalid_request(client, token):
    assert _post(client, token, []).json()["error"]["code"] == -32600


# ── auth ────────────────────────────────────────────────────────────────────
def test_missing_bearer_is_401(client):
    r = client.post("/mcp", json=_rpc("ping"))
    assert r.status_code == 401
    assert r.json() == {"error": "unauthorized"}


def test_invalid_bearer_is_401(client, calls):
    r = _post(client, "zgy_" + "B" * 40, _rpc("tools/call", {"name": "control_device", "arguments": {}}))
    assert r.status_code == 401
    assert calls == []
    # An app session token is a different credential class — not accepted here.
    r = client.post("/mcp", json=_rpc("ping"), headers={"Authorization": "Bearer deadbeef"})
    assert r.status_code == 401
    # Non-bearer scheme.
    r = client.post("/mcp", json=_rpc("ping"), headers={"Authorization": "Basic abc"})
    assert r.status_code == 401


def test_revoked_token_is_401(client):
    m = external_tokens.mint("alice", "cli")
    assert _post(client, m["token"], _rpc("ping")).status_code == 200
    assert external_tokens.revoke("alice", m["id"]) is True
    assert _post(client, m["token"], _rpc("ping")).status_code == 401


def test_token_binds_its_own_user(client, calls):
    bob = external_tokens.mint("bob", "cursor")["token"]
    _post(client, bob, _rpc("tools/call", {"name": "query_devices", "arguments": {}}))
    assert calls[0]["actor"] == "person:bob"


# ── rate limit ──────────────────────────────────────────────────────────────
def test_rate_limit_per_token(client, token, monkeypatch):
    monkeypatch.setattr(mcp_router, "_RATE_MAX", 3)
    for _ in range(3):
        assert _post(client, token, _rpc("ping")).status_code == 200
    r = _post(client, token, _rpc("ping"))
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1
    assert r.json()["error"] == "rate_limited"
    # A different token has its own budget.
    other = external_tokens.mint("alice", "second")["token"]
    assert _post(client, other, _rpc("ping")).status_code == 200


def test_rate_limit_is_sixty_per_minute_by_default():
    assert mcp_router._RATE_MAX == 60 and mcp_router._RATE_WINDOW_S == 60


# ── other verbs ─────────────────────────────────────────────────────────────
def test_get_is_405_with_hint(client):
    r = client.get("/mcp")
    assert r.status_code == 405
    assert "SSE" in r.json()["hint"]


def test_delete_is_204(client):
    assert client.delete("/mcp").status_code == 204
