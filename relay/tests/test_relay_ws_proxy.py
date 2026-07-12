"""WebSocket proxy — /api/proxy/{home_id}/ws forwards realtime upgrades to the
home hub's /ws endpoint (the HTTP proxy strips `upgrade` and can't).

Covers:
  * The websocket route exists on the proxy router.
  * Auth is enforced with the SAME rules as the HTTP path:
      - missing token            → accept-then-close 4401
      - invalid/garbage token    → accept-then-close 4401
      - valid token, wrong home  → accept-then-close 4403
      - unknown home_id          → accept-then-close 4404
  * Target resolution: wss://{public_hostname}/ws with tunnel_url fallback,
    original ?token= query preserved, X-Relay-* headers injected.
  * Frame round-trip through a mocked upstream (both directions), proving the
    bidirectional pump wiring without needing a live tunnel.

The upstream hub is stubbed by monkeypatching proxy.ws_connect, so no real
network / Cloudflare tunnel is required.
"""

from __future__ import annotations

import asyncio
import importlib.util
from datetime import datetime, timezone

import pytest

_has_jwt = importlib.util.find_spec("jwt") is not None
_has_ws = importlib.util.find_spec("websockets") is not None
pytestmark = pytest.mark.skipif(
    not (_has_jwt and _has_ws), reason="PyJWT / websockets not installed"
)

if _has_jwt and _has_ws:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from starlette.websockets import WebSocketDisconnect

    from relay.app import database as dbmod
    from relay.app.auth import issue_jwt
    from relay.app.routers import proxy as proxymod


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


@pytest.fixture
def app_client(db):
    app = FastAPI()
    # Mirror main.py mounting: proxy router (prefix="/proxy") under /api.
    app.include_router(proxymod.router, prefix="/api")
    return TestClient(app)


async def _seed_home(
    db,
    home_id,
    owner_email,
    *,
    status="active",
    subscription_state="active",
    public_hostname=None,
    tunnel_url=None,
):
    if public_hostname is None:
        public_hostname = f"https://{home_id}.hubs.ziggy-home.com"
    if tunnel_url is None:
        tunnel_url = f"https://{home_id}.cfargotunnel.com"
    async with db.get_db() as conn:
        await conn.execute(
            """INSERT INTO homes (id, name, type, tunnel_url, status, relay_secret,
                                  cf_tunnel_id, public_hostname, created_at, owner_email,
                                  subscription_state)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (home_id, "WS Home", "hub", tunnel_url, status, "sekret-abc",
             "tun-1", public_hostname,
             datetime.now(timezone.utc).isoformat(), owner_email, subscription_state),
        )
        await conn.commit()


def _user_token(home_id, email="owner@x.com", role="user"):
    return issue_jwt("u-1", email, role, home_id)


# ---------------------------------------------------------------------------
# Upstream hub stub
# ---------------------------------------------------------------------------

class _EchoUpstream:
    """Stub of a `websockets` client connection.

    * `send()` records the frame AND echoes it back through an internal queue,
      so a frame the relay forwards hub-ward reappears client-ward — exercising
      both pump directions with one round-trip.
    * async-iteration yields queued frames and blocks otherwise, so the
      hub→client pump stays alive until the client disconnects.
    """

    def __init__(self):
        self.sent: list = []
        self.close_code = None
        self._q: asyncio.Queue = asyncio.Queue()

    async def send(self, data):
        self.sent.append(data)
        await self._q.put(data)  # echo back

    def __aiter__(self):
        return self

    async def __anext__(self):
        return await self._q.get()

    async def close(self, code=1000, reason=""):
        self.close_code = code


class _FakeConnect:
    """Async-context-manager replacement for websockets.asyncio.client.connect.
    Captures the dialed URI + headers for assertions."""

    def __init__(self, capture, upstream, uri, **kwargs):
        self._capture = capture
        self._upstream = upstream
        capture["uri"] = uri
        capture["headers"] = dict(kwargs.get("additional_headers") or {})

    async def __aenter__(self):
        return self._upstream

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def stub_upstream(monkeypatch):
    """Install an echoing upstream and capture how the hub was dialed."""
    capture: dict = {}
    upstream = _EchoUpstream()

    def _fake_connect(uri, **kwargs):
        return _FakeConnect(capture, upstream, uri, **kwargs)

    monkeypatch.setattr(proxymod, "ws_connect", _fake_connect)
    return capture, upstream


# ---------------------------------------------------------------------------
# Route existence
# ---------------------------------------------------------------------------

def test_ws_route_registered(app_client):
    paths = {getattr(r, "path", None) for r in app_client.app.routes}
    assert "/api/proxy/{home_id}/ws" in paths
    assert "/api/proxy/{home_id}/ws/{path:path}" in paths


# ---------------------------------------------------------------------------
# Auth enforcement (same rules as the HTTP path)
# ---------------------------------------------------------------------------

async def test_missing_token_rejected_4401(app_client, db):
    await _seed_home(db, "home-a", "owner@x.com")
    with app_client.websocket_connect("/api/proxy/home-a/ws") as ws:
        with pytest.raises(WebSocketDisconnect) as ei:
            ws.receive_text()
    assert ei.value.code == 4401


async def test_invalid_token_rejected_4401(app_client, db):
    await _seed_home(db, "home-a", "owner@x.com")
    with app_client.websocket_connect("/api/proxy/home-a/ws?token=not-a-jwt") as ws:
        with pytest.raises(WebSocketDisconnect) as ei:
            ws.receive_text()
    assert ei.value.code == 4401


async def test_wrong_home_rejected_4403(app_client, db):
    await _seed_home(db, "home-a", "owner@x.com")
    # Valid token, but scoped to a DIFFERENT home → ownership check fails.
    token = _user_token("home-OTHER", email="owner@x.com")
    with app_client.websocket_connect(f"/api/proxy/home-a/ws?token={token}") as ws:
        with pytest.raises(WebSocketDisconnect) as ei:
            ws.receive_text()
    assert ei.value.code == 4403


async def test_unknown_home_rejected_4404(app_client, db):
    # relay_admin passes ownership but the home row doesn't exist → 404 → 4404.
    token = issue_jwt("u-admin", "founder@x.com", "relay_admin", None)
    with app_client.websocket_connect(f"/api/proxy/ghost/ws?token={token}") as ws:
        with pytest.raises(WebSocketDisconnect) as ei:
            ws.receive_text()
    assert ei.value.code == 4404


async def test_subscription_gate_rejects_non_founder_4403(app_client, db):
    await _seed_home(
        db, "home-lapsed", "owner@x.com",
        status="active", subscription_state="cancelled",
    )
    token = _user_token("home-lapsed", email="owner@x.com")
    with app_client.websocket_connect(f"/api/proxy/home-lapsed/ws?token={token}") as ws:
        with pytest.raises(WebSocketDisconnect) as ei:
            ws.receive_text()
    assert ei.value.code == 4403


# ---------------------------------------------------------------------------
# Target resolution + frame round-trip through the mocked upstream
# ---------------------------------------------------------------------------

async def test_frame_roundtrip_and_target_resolution(app_client, db, stub_upstream):
    capture, upstream = stub_upstream
    await _seed_home(db, "home-a", "owner@x.com")
    token = _user_token("home-a", email="owner@x.com")

    url = f"/api/proxy/home-a/ws?token={token}"
    with app_client.websocket_connect(url) as ws:
        ws.send_text("ping")
        echoed = ws.receive_text()
        assert echoed == "ping"

    # Frame reached the hub-ward pump.
    assert "ping" in upstream.sent

    # Dialed wss:// derived from public_hostname, hub path /ws, token preserved.
    assert capture["uri"].startswith("wss://home-a.hubs.ziggy-home.com/ws")
    assert f"token={token}" in capture["uri"]

    # X-Relay-* context injected exactly like the HTTP path.
    hdrs = capture["headers"]
    assert hdrs["X-Relay-Secret"] == "sekret-abc"
    assert hdrs["X-Relay-User"] == "owner@x.com"
    assert hdrs["X-Relay-Role"] == "user"
    assert hdrs["X-Relay-Home"] == "home-a"


async def test_binary_frame_roundtrip(app_client, db, stub_upstream):
    capture, upstream = stub_upstream
    await _seed_home(db, "home-b", "owner@x.com")
    token = _user_token("home-b", email="owner@x.com")

    with app_client.websocket_connect(f"/api/proxy/home-b/ws?token={token}") as ws:
        ws.send_bytes(b"\x00\x01\x02")
        echoed = ws.receive_bytes()
        assert echoed == b"\x00\x01\x02"
    assert b"\x00\x01\x02" in upstream.sent


async def test_tunnel_url_fallback_when_no_public_hostname(app_client, db, stub_upstream):
    capture, upstream = stub_upstream
    # Pre-Stream-3 row: no public_hostname → falls back to tunnel_url.
    await _seed_home(
        db, "home-c", "owner@x.com",
        public_hostname="",  # empty → fallback
        tunnel_url="https://home-c.cfargotunnel.com",
    )
    token = _user_token("home-c", email="owner@x.com")

    with app_client.websocket_connect(f"/api/proxy/home-c/ws?token={token}") as ws:
        ws.send_text("x")
        assert ws.receive_text() == "x"

    assert capture["uri"].startswith("wss://home-c.cfargotunnel.com/ws")


async def test_founder_admin_bypasses_subscription_gate(app_client, db, stub_upstream):
    capture, upstream = stub_upstream
    # Cancelled home — a normal user is blocked (see gate test above), but the
    # founder (relay_admin) must still connect for support.
    await _seed_home(
        db, "home-lapsed", "owner@x.com",
        status="suspended", subscription_state="cancelled",
    )
    token = issue_jwt("u-admin", "founder@x.com", "relay_admin", None)

    with app_client.websocket_connect(f"/api/proxy/home-lapsed/ws?token={token}") as ws:
        ws.send_text("hi")
        assert ws.receive_text() == "hi"
    assert capture["headers"]["X-Relay-Role"] == "relay_admin"
