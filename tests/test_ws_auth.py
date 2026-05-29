"""Coverage for the /ws auth gate added in the WS-auth security pass.

Before this change, /ws accepted any connection on :8001 and streamed the
full backend pub/sub feed (device state, automation results, anomaly fires,
debug events) to whoever asked. This file proves the new contract:

  - missing or bad ?token=     → ws_auth/ws_auth_failed event + close(4401)
  - valid ?token=               → accepts, registers with the manager
  - relay-injected synthetic user (RelayAuthMiddleware sets state.relay_user
    on a matching X-Relay-Secret) → accepts without ?token=
  - bad token AND bogus relay headers (no secret match → no injection) →
    close(4401) with relay_user_attempted=False

The tests import the actual /ws handler from backend.server and mount it on
a fresh test app, so the production codepath is what's exercised. The
ConnectionManager singleton in backend.server.manager is stubbed so a test
WS connect doesn't bleed state into the live manager.
"""
from __future__ import annotations

import os
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from core.debug_bus import bus, BASIC, OFF
from backend import server as srv
from backend.middleware.relay_auth import RelayAuthMiddleware


VALID_TOKEN = "zgy_ws_VALID"
VALID_USER = {"username": "owner@example.com", "role": "user"}
RELAY_SECRET = "test-relay-secret-xyz"


@pytest.fixture(autouse=True)
def _reset_bus():
    """Clean BASIC-level bus per test so audit events from earlier tests
    don't bleed into the current assertion."""
    bus.set_level(BASIC)
    bus.set_scopes([])
    bus._buffer.clear()
    yield
    bus.set_level(OFF)
    bus._buffer.clear()


@pytest.fixture
def stub_user_lookup(monkeypatch):
    """Replace find_user_by_token on the module the /ws handler imported it
    into. server.py does `from auth_deps import ... find_user_by_token`, so
    the attribute we need to patch is `srv.find_user_by_token`."""
    def fake_lookup(token: str):
        return VALID_USER if token == VALID_TOKEN else None
    monkeypatch.setattr(srv, "find_user_by_token", fake_lookup)


@pytest.fixture
def stub_manager(monkeypatch):
    """Replace the imported `manager` in backend.server with a no-op stub so
    a successful test connect doesn't register with (or leak into) the
    production ConnectionManager singleton."""
    class _StubManager:
        count = 0
        async def connect(self, ws):
            await ws.accept()
            return "test-client-id"
        def disconnect(self, ws):
            pass
    monkeypatch.setattr(srv, "manager", _StubManager())


@pytest.fixture
def client(stub_user_lookup, stub_manager, monkeypatch):
    """Test app wired with the SAME /ws handler the production app uses,
    behind the REAL RelayAuthMiddleware so the relay-injected path is
    exercised end-to-end. Mounting the real middleware (not a shim) makes
    this file catch a regression of the dict-attribute bug fixed in the
    Post-WS cleanup batch."""
    monkeypatch.setenv("RELAY_SECRET", RELAY_SECRET)

    app = FastAPI()
    app.add_middleware(RelayAuthMiddleware)
    app.add_api_websocket_route("/ws", srv.websocket_endpoint)
    return TestClient(app)


def _events(step: str) -> list[dict]:
    return [e for e in list(bus._buffer) if e.get("step") == step]


# ─── Auth failure paths ─────────────────────────────────────────────────────

def _assert_closed_4401(client, url, headers=None):
    """The handler accepts the upgrade then closes with code 4401 — so the
    TestClient context enters successfully, and the close surfaces on the
    next receive. (Accept-then-close is intentional: closing pre-accept
    causes uvicorn to reply HTTP 403 on the upgrade and the browser then
    reports code=1006, which the frontend can't distinguish from a network
    drop.)"""
    kwargs = {"headers": headers} if headers else {}
    with client.websocket_connect(url, **kwargs) as ws:
        with pytest.raises(WebSocketDisconnect) as ei:
            ws.receive_text()
    assert ei.value.code == 4401


def test_missing_token_closes_4401_and_emits_audit(client):
    _assert_closed_4401(client, "/ws")

    failed = _events("ws_auth_failed")
    assert len(failed) == 1
    d = failed[0]["data"]
    assert d["path"] == "/ws"
    assert d["provided"] is False
    assert d["relay_user_attempted"] is False
    # source_ip is best-effort; assert key exists rather than value
    assert "source_ip" in d


def test_bad_token_closes_4401_and_emits_audit(client):
    _assert_closed_4401(client, "/ws?token=not-a-real-token")

    failed = _events("ws_auth_failed")
    assert len(failed) == 1
    d = failed[0]["data"]
    assert d["provided"] is True
    assert d["relay_user_attempted"] is False


def test_bogus_relay_headers_without_secret_still_4401(client):
    """If an attacker sends X-Relay-* headers WITHOUT a matching X-Relay-Secret,
    the middleware does NOT inject state.relay_user. The audit event must
    record relay_user_attempted=False because no synthetic user landed in
    scope.state — proving the middleware didn't fall for the spoof."""
    _assert_closed_4401(client, "/ws", headers={
        "x-relay-user":   "attacker@example.com",
        "x-relay-role":   "super_admin",
        "x-relay-home":   "home-victim",
        # NOTE: no matching x-relay-secret
        "x-relay-secret": "wrong-secret",
    })

    failed = _events("ws_auth_failed")
    assert len(failed) == 1
    assert failed[0]["data"]["relay_user_attempted"] is False


# ─── Auth success paths ─────────────────────────────────────────────────────

def test_valid_token_accepts_connection(client):
    """A valid ?token= results in an accepted connection. We immediately
    exit the context, which fires WebSocketDisconnect inside the handler's
    receive_text loop — but the connect itself succeeded, which is the
    contract under test."""
    with client.websocket_connect(f"/ws?token={VALID_TOKEN}"):
        pass  # connect succeeded; clean exit

    # No auth failure recorded on the bus
    assert _events("ws_auth_failed") == []
    # And the success event the handler emits after manager.connect() is here
    assert len(_events("ws_client_connected")) == 1


def test_valid_relay_headers_accept_connection_without_token(client):
    """The relay-injected synthetic user path: matching X-Relay-Secret tells
    RelayAuthMiddleware to populate scope.state.relay_user, and the /ws
    handler honors it without requiring ?token=. This path is unused today
    but architecturally supported per DECISIONS.md (operator live-feed
    future work)."""
    with client.websocket_connect(
        "/ws",
        headers={
            "x-relay-secret": RELAY_SECRET,
            "x-relay-user":   "founder@example.com",
            "x-relay-role":   "relay_admin",
            "x-relay-home":   "home-customer-1",
        },
    ):
        pass

    assert _events("ws_auth_failed") == []
    assert len(_events("ws_client_connected")) == 1
