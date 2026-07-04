"""Tests for GET /api/admin/fleet/homes — Phase 4 of Oracle→mini-PC transition."""

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
    from relay.app.routers.fleet import router as fleet_router


@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    async with dbmod.get_db() as conn:
        rows = [
            ("home-alpha", "Alpha Family",  "hub",   "https://alpha.cfargotunnel.com", "active",         "sec1", "2026-01-01", "alpha@ex.com"),
            ("home-beta",  "Beta House",    "cloud", "https://beta.cfargotunnel.com",  "active",         "sec2", "2026-02-01", "beta@ex.com"),
            ("home-gamma", "Gamma Pending", "hub",   None,                             "awaiting_claim", "sec3", "2026-03-01", "gamma@ex.com"),
        ]
        for r in rows:
            await conn.execute(
                """INSERT INTO homes (id, name, type, tunnel_url, status, relay_secret, created_at, owner_email)
                   VALUES (?,?,?,?,?,?,?,?)""",
                r,
            )
        await conn.commit()
    return dbmod


@pytest.fixture
async def client(db):
    app = FastAPI()
    app.include_router(fleet_router, prefix="/api")
    return TestClient(app)


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-a', 'a@ex.com', 'relay_admin', None)}"}


def _user_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-u', 'u@ex.com', 'user', None)}"}


async def test_admin_lists_only_homes_with_tunnel(client):
    r = client.get("/api/admin/fleet/homes", headers=_admin_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    ids = [h["id"] for h in body["homes"]]
    # Only alpha + beta have tunnel_url; gamma is filtered out.
    assert ids == ["home-alpha", "home-beta"]
    alpha = next(h for h in body["homes"] if h["id"] == "home-alpha")
    assert alpha["type"] == "hub"
    assert alpha["tunnel_url"] == "https://alpha.cfargotunnel.com"


async def test_non_admin_rejected(client):
    r = client.get("/api/admin/fleet/homes", headers=_user_headers())
    assert r.status_code == 403


async def test_no_auth_rejected(client):
    r = client.get("/api/admin/fleet/homes")
    assert r.status_code == 401
