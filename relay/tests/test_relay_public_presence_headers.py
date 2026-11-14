"""Public presence passthrough must not let an anonymous caller choose the
relay identity the hub sees.

Regression (2026-11-14 audit): /presence/join, /presence/manifest.json and
/api/presence/ping are UNAUTHENTICATED on the relay, yet _forward() attached
the home's real X-Relay-Secret while passing through client-supplied
X-Relay-User / X-Relay-Role / X-Relay-Home. The hub's RelayAuthMiddleware
trusts those headers whenever the secret matches, so the caller picked its
own role (e.g. super_admin) on the hub.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from relay.app import database as dbmod
from relay.app.routers import public_presence as ppmod


class _Resp:
    status_code = 200
    content = b"{}"
    headers = {"content-type": "application/json"}


@pytest.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(tmp_path / "relay.db"))
    await dbmod.init_db()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, tunnel_url, status, relay_secret, created_at)"
            " VALUES ('h1','H','hub','https://h1.example','active','realsecret',?)",
            (datetime.now(timezone.utc).isoformat(),),
        )
        await conn.commit()

    captured: dict = {}

    class _FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def request(self, method, url, headers=None, content=None):
            captured["headers"] = {k.lower(): v for k, v in (headers or {}).items()}
            return _Resp()

    monkeypatch.setattr(ppmod.httpx, "AsyncClient", _FakeClient)
    app = FastAPI()
    app.include_router(ppmod.router)
    return TestClient(app), captured


@pytest.mark.parametrize("method,path", [
    ("GET", "/presence/join/tok"),
    ("GET", "/presence/manifest.json"),
    ("POST", "/api/presence/ping"),
])
def test_client_relay_identity_headers_are_dropped(client, method, path):
    tc, captured = client
    tc.request(method, path, headers={
        "X-Relay-Role": "super_admin",
        "X-Relay-User": "attacker@evil",
        "X-Relay-Home": "h1",
        "X-Relay-Secret": "guess",
    }, content=b"{}")
    h = captured["headers"]
    assert h["x-relay-secret"] == "realsecret"
    assert h["x-relay-role"] == "guest"
    assert h["x-relay-user"] == "presence-anonymous"
    assert h["x-relay-home"] == "h1"
