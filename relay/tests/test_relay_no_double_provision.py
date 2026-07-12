"""Stream 3 — the home-invite → register path must NOT mint a second home_id
or provision a second Cloudflare tunnel. It binds the accepting user to a
PRE-PROVISIONED home.

Covers:
  * create_invite(type=home) binds to a pre-provisioned home by owner_email
  * register() against that invite reuses the pre-provisioned home_id and does
    NOT schedule a background tunnel provision
  * register() against a home invite with no pre-provisioned home 409s (legacy
    self-provision is off by default)
"""

from __future__ import annotations

import importlib.util
from datetime import datetime, timezone

import pytest

_has_jwt = importlib.util.find_spec("jwt") is not None
pytestmark = pytest.mark.skipif(not _has_jwt, reason="PyJWT not installed")

if _has_jwt:
    from fastapi import BackgroundTasks, FastAPI
    from fastapi.testclient import TestClient

    from relay.app import database as dbmod
    from relay.app.auth import issue_jwt
    from relay.app.routers.auth import router as auth_router
    from relay.app.routers.invites import router as invites_router


@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


@pytest.fixture
async def client(db):
    app = FastAPI()
    app.include_router(invites_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    return TestClient(app)


def _admin_headers():
    return {"Authorization": f"Bearer {issue_jwt('u-admin', 'founder@x.com', 'relay_admin', None)}"}


async def _seed_home(db, home_id, owner_email):
    async with db.get_db() as conn:
        await conn.execute(
            """INSERT INTO homes (id, name, type, tunnel_url, status, relay_secret,
                                  cf_tunnel_id, public_hostname, created_at, owner_email)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (home_id, "Pre Home", "hub", f"https://{home_id}.cfargotunnel.com",
             "awaiting_claim", "sekret", "tun-1",
             f"https://{home_id}.hubs.ziggy-home.com",
             datetime.now(timezone.utc).isoformat(), owner_email),
        )
        await conn.commit()


async def test_home_invite_binds_to_preprovisioned_home(client, db, monkeypatch):
    home_id = "device-uuid-1"
    await _seed_home(db, home_id, "buyer@x.com")

    # Home invite for that owner_email — should resolve the pre-provisioned home.
    r = client.post(
        "/api/invites/",
        json={"type": "home", "email": "buyer@x.com", "role": "super_admin"},
        headers=_admin_headers(),
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    async with db.get_db() as conn:
        rows = await conn.execute_fetchall("SELECT home_id FROM invites WHERE token=?", (token,))
    assert dict(rows[0])["home_id"] == home_id  # bound, not NULL

    # Guard: register() must not schedule a background provision.
    scheduled = []
    orig_add_task = BackgroundTasks.add_task

    def spy_add_task(self, func, *a, **k):
        scheduled.append(getattr(func, "__name__", str(func)))
        return orig_add_task(self, func, *a, **k)

    monkeypatch.setattr(BackgroundTasks, "add_task", spy_add_task)

    r2 = client.post(
        "/api/auth/register",
        json={"email": "buyer@x.com", "password": "hunter2", "invite_token": token},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["home_id"] == home_id  # reused, NOT a new home-xxxx

    # No second tunnel provision was scheduled.
    assert "_provision_hub_background" not in scheduled

    # Still exactly one home row.
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall("SELECT id FROM homes")
    assert [dict(r)["id"] for r in rows] == [home_id]


async def test_home_invite_without_preprovisioned_home_409s(client, db):
    # Home invite with no matching pre-provisioned home → home_id NULL.
    r = client.post(
        "/api/invites/",
        json={"type": "home", "email": "nobody@x.com", "role": "super_admin"},
        headers=_admin_headers(),
    )
    assert r.status_code == 200, r.text
    token = r.json()["token"]

    r2 = client.post(
        "/api/auth/register",
        json={"email": "nobody@x.com", "password": "hunter2", "invite_token": token},
    )
    # Legacy self-provision is OFF by default → clear 409, no home minted.
    assert r2.status_code == 409, r2.text

    async with db.get_db() as conn:
        rows = await conn.execute_fetchall("SELECT id FROM homes")
    assert rows == []
