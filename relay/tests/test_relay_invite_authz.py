"""Invite authorization — tenant isolation + no role escalation.

Regression for the 2026-11-14 audit finding: a home owner (super_admin of
their own home) could POST /api/invites/ with an arbitrary `home_id` (another
customer's home) and an arbitrary `role` (including `relay_admin`), then
redeem it via /api/auth/register to obtain a relay_admin JWT — i.e. full
control of every home on the relay.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from relay.app import database as dbmod
from relay.app.auth import decode_jwt, issue_jwt
from relay.app.routers import auth as authmod
from relay.app.routers import invites as invmod


@pytest.fixture
async def db(tmp_path, monkeypatch):
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(tmp_path / "relay.db"))
    await dbmod.init_db()
    now = datetime.now(timezone.utc).isoformat()
    async with dbmod.get_db() as conn:
        for hid in ("home-a", "home-b"):
            await conn.execute(
                "INSERT INTO homes (id, name, type, status, relay_secret, created_at, owner_email)"
                " VALUES (?,?,?,?,?,?,?)",
                (hid, hid, "hub", "active", "s", now, f"owner@{hid}"),
            )
        await conn.commit()
    return dbmod


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(invmod.router, prefix="/api")
    app.include_router(authmod.router, prefix="/api")
    return TestClient(app)


def _h(role, home_id, email="u@x.com"):
    return {"Authorization": f"Bearer {issue_jwt('uid-' + email, email, role, home_id)}"}


OWNER_A = ("super_admin", "home-a", "owner@home-a")


def test_owner_cannot_invite_into_another_home(client):
    r = client.post("/api/invites/", json={"type": "user", "role": "user", "home_id": "home-b"},
                    headers=_h(*OWNER_A))
    assert r.status_code == 403


@pytest.mark.parametrize("role", ["relay_admin", "god", ""])
def test_owner_cannot_mint_relay_admin_or_unknown_role(client, role):
    r = client.post("/api/invites/", json={"type": "user", "role": role}, headers=_h(*OWNER_A))
    assert r.status_code in (400, 403)


def test_unknown_invite_type_rejected(client):
    r = client.post("/api/invites/", json={"type": "weird", "role": "user"}, headers=_h(*OWNER_A))
    assert r.status_code == 400


def test_owner_can_still_invite_member_into_own_home(client):
    r = client.post("/api/invites/", json={"type": "user", "role": "admin"}, headers=_h(*OWNER_A))
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    reg = client.post("/api/auth/register",
                      json={"email": "new@x.com", "password": "pw123456", "invite_token": tok})
    assert reg.status_code == 200, reg.text
    claims = decode_jwt(reg.json()["token"])
    assert claims["role"] == "admin" and claims["home_id"] == "home-a"


def test_admin_cannot_invite_above_own_role(client):
    # `admin` is below the super_admin gate entirely.
    r = client.post("/api/invites/", json={"type": "user", "role": "super_admin"},
                    headers=_h("admin", "home-a"))
    assert r.status_code == 403


def test_relay_admin_can_still_invite_into_any_home(client):
    r = client.post("/api/invites/", json={"type": "user", "role": "super_admin", "home_id": "home-b"},
                    headers=_h("relay_admin", None, "founder@x.com"))
    assert r.status_code == 200, r.text


async def test_register_refuses_preexisting_relay_admin_invite(client, db):
    """Defense in depth: an escalation invite minted before the fix (already in
    the prod DB) must not be redeemable."""
    now = datetime.now(timezone.utc)
    async with db.get_db() as conn:
        await conn.execute(
            "INSERT INTO invites (token, type, role, home_id, created_at, expires_at)"
            " VALUES (?,?,?,?,?,?)",
            ("evil", "user", "relay_admin", "home-b", now.isoformat(),
             (now + timedelta(hours=1)).isoformat()),
        )
        await conn.commit()
    reg = client.post("/api/auth/register",
                      json={"email": "evil@x.com", "password": "pw123456", "invite_token": "evil"})
    assert reg.status_code == 403


def test_member_cannot_list_invite_tokens(client):
    # A low-privilege member must not read pending (e.g. owner-level) invite tokens.
    client.post("/api/invites/", json={"type": "user", "role": "super_admin"}, headers=_h(*OWNER_A))
    r = client.get("/api/invites/", headers=_h("user", "home-a", "kid@x.com"))
    assert r.status_code == 403
    r = client.get("/api/invites/", headers=_h(*OWNER_A))
    assert r.status_code == 200 and len(r.json()) == 1


# ---------------------------------------------------------------------------
# /api/auth/login failed-attempt throttle (same audit, 2026-11-14)
# ---------------------------------------------------------------------------

def test_login_throttles_after_repeated_failures(client, monkeypatch):
    monkeypatch.setattr(authmod, "_login_failures", {})
    bad = {"email": "nobody@x.com", "password": "wrong"}
    for _ in range(authmod.LOGIN_MAX_FAILURES):
        assert client.post("/api/auth/login", json=bad).status_code == 401
    assert client.post("/api/auth/login", json=bad).status_code == 429
    # A different client IP is unaffected (no global lockout of the founder).
    r = client.post("/api/auth/login", json=bad, headers={"Fly-Client-IP": "203.0.113.9"})
    assert r.status_code == 401
