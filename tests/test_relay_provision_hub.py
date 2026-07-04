"""Tests for POST /api/provision/hub — Phase 1 of Oracle→mini-PC transition.

Covers:
  * relay_admin can create a hub home, gets bundle back with tunnel_token
  * non-admin caller is rejected (403)
  * home row lands in DB with type='hub' and status='awaiting_claim'
  * Cloudflare API failure rolls the row back to a 'failed:' status
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
    from relay.app import provisioner as provmod
    from relay.app.auth import issue_jwt
    from relay.app.routers.provision import router as provision_router


@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


@pytest.fixture
async def client(db, monkeypatch):
    # CF token/account so provision_hub() doesn't bail on the env check.
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "test-token")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "test-account")

    calls: dict[str, list] = {"set_config": []}

    async def fake_create(name):
        return ("test-tunnel-id-1234", "test-tunnel-secret")

    async def fake_get_token(tunnel_id):
        return "test-cf-token"

    async def fake_delete(tunnel_id):
        pass

    async def fake_set_config(tunnel_id, service_url):
        calls["set_config"].append((tunnel_id, service_url))

    monkeypatch.setattr(provmod, "_cf_create_tunnel", fake_create)
    monkeypatch.setattr(provmod, "_cf_get_token", fake_get_token)
    monkeypatch.setattr(provmod, "_cf_delete_tunnel", fake_delete)
    monkeypatch.setattr(provmod, "_cf_set_tunnel_config", fake_set_config)

    app = FastAPI()
    app.include_router(provision_router, prefix="/api")
    client = TestClient(app)
    client.cf_calls = calls
    return client


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-admin', 'founder@example.com', 'relay_admin', None)}"}


def _user_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-1', 'user@example.com', 'user', None)}"}


async def test_admin_can_provision_hub(client, db):
    r = client.post(
        "/api/provision/hub",
        json={"home_name": "Sarah's House", "owner_email": "sarah@example.com"},
        headers=_admin_headers(),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["home_name"] == "Sarah's House"
    assert body["home_id"].startswith("home-")
    assert body["tunnel_id"] == "test-tunnel-id-1234"
    assert body["tunnel_url"] == "https://test-tunnel-id-1234.cfargotunnel.com"
    assert body["tunnel_token"] == "test-cf-token"
    assert len(body["relay_secret"]) == 64  # 32 hex bytes

    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT type, status, tunnel_url, cf_tunnel_id, owner_email FROM homes WHERE id=?",
            (body["home_id"],),
        )
    assert len(rows) == 1
    row = dict(rows[0])
    assert row["type"] == "hub"
    assert row["status"] == "awaiting_claim"
    assert row["tunnel_url"] == body["tunnel_url"]
    assert row["cf_tunnel_id"] == "test-tunnel-id-1234"
    assert row["owner_email"] == "sarah@example.com"

    # Ingress must be set to localhost:8001 so the tunnel actually reaches Ziggy.
    assert client.cf_calls["set_config"] == [("test-tunnel-id-1234", "http://localhost:8001")]


async def test_non_admin_rejected(client):
    r = client.post(
        "/api/provision/hub",
        json={"home_name": "Sarah's House"},
        headers=_user_headers(),
    )
    assert r.status_code == 403


async def test_no_auth_rejected(client):
    r = client.post("/api/provision/hub", json={"home_name": "Sarah's House"})
    assert r.status_code == 401


async def test_home_owner_can_poll_status(client, db):
    """Phase 3: the newly-created owner can poll their own home's status."""
    r = client.post(
        "/api/provision/hub",
        json={"home_name": "Owner Poll House"},
        headers=_admin_headers(),
    )
    assert r.status_code == 200, r.text
    home_id = r.json()["home_id"]

    # Simulate the JWT the owner would get from /auth/register.
    owner_jwt = issue_jwt("u-owner", "owner@example.com", "user", home_id)
    r2 = client.get(
        f"/api/provision/home/{home_id}/status",
        headers={"Authorization": f"Bearer {owner_jwt}"},
    )
    assert r2.status_code == 200, r2.text
    data = r2.json()
    assert data["id"] == home_id
    assert data["type"] == "hub"
    assert data["status"] == "awaiting_claim"


async def test_wrong_owner_cannot_poll_status(client, db):
    r = client.post(
        "/api/provision/hub",
        json={"home_name": "Other House"},
        headers=_admin_headers(),
    )
    home_id = r.json()["home_id"]

    outsider_jwt = issue_jwt("u-x", "outsider@example.com", "user", "some-other-home")
    r2 = client.get(
        f"/api/provision/home/{home_id}/status",
        headers={"Authorization": f"Bearer {outsider_jwt}"},
    )
    assert r2.status_code == 403


async def test_cf_failure_marks_home_failed(client, db, monkeypatch):
    async def boom(name):
        raise RuntimeError("Cloudflare API is down")

    monkeypatch.setattr(provmod, "_cf_create_tunnel", boom)

    r = client.post(
        "/api/provision/hub",
        json={"home_name": "Doomed House"},
        headers=_admin_headers(),
    )
    assert r.status_code == 500

    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT id, status FROM homes WHERE name=?", ("Doomed House",)
        )
    assert len(rows) == 1
    row = dict(rows[0])
    assert row["status"].startswith("failed:"), row["status"]
