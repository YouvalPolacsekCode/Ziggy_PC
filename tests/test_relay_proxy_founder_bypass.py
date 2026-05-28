"""Tests for the founder-support bypass added to relay/app/routers/proxy.py.

Prompt 9 chunk 2 decision 8. Founder must always reach a customer's hub
regardless of operational suspension or subscription state. relay_admin
bypasses the suspended-home 403; everyone else gets it.
"""

from __future__ import annotations

import importlib.util

import pytest

_has_jwt = importlib.util.find_spec("jwt") is not None
pytestmark = pytest.mark.skipif(
    not _has_jwt,
    reason="PyJWT not installed in this venv — see relay/requirements.txt",
)

if _has_jwt:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from relay.app import database as dbmod
    from relay.app.auth import issue_jwt
    from relay.app.routers.proxy import router as proxy_router


HOME_ID = "home-prox"


@pytest.fixture
async def db_suspended(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, "
            "tunnel_url, created_at) VALUES (?,?,?,?,?,?,?)",
            (HOME_ID, "Suspended Home", "cloud", "suspended", "s",
             "https://invalid.example/", "2026-01-01"),
        )
        await conn.commit()
    return dbmod


@pytest.fixture
async def client(db_suspended):
    app = FastAPI()
    app.include_router(proxy_router, prefix="/api")
    return TestClient(app)


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-admin', 'founder@example.com', 'relay_admin', None)}"}


def _user_headers(home_id: str = HOME_ID) -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-user', 'user@example.com', 'user', home_id)}"}


async def test_regular_user_gets_403_on_suspended(client):
    r = client.get(
        f"/api/proxy/{HOME_ID}/api/health", headers=_user_headers(),
    )
    # Either 403 (the gate) or a downstream error from the bogus tunnel
    # URL — we only care that 403 fires when it should.
    assert r.status_code == 403
    assert "suspended" in r.text.lower()


async def test_founder_bypasses_suspended_gate(client):
    # The gate must NOT 403. The downstream request to the bogus tunnel
    # URL will fail (timeout / connection error → some 5xx or
    # ConnectError), which proves the gate was bypassed and forwarding
    # was attempted.
    r = client.get(
        f"/api/proxy/{HOME_ID}/api/health", headers=_admin_headers(),
    )
    assert r.status_code != 403, (
        f"founder must bypass the suspended gate; got 403: {r.text}"
    )
