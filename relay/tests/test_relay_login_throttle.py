"""/api/auth/login failed-attempt throttle (2026-11-14 audit + review).

Covers: per-network cap, check-then-act race (attempts are reserved before the
first await), IPv6 /64 keying, eviction never freeing a blocked network, and
the per-account slowdown that must not lock the real owner out.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from relay.app import database as dbmod
from relay.app.auth import hash_password_bcrypt
from relay.app.routers import auth as authmod

OWNER = "owner@x.com"
OWNER_PW = "correct horse battery"


@pytest.fixture(autouse=True)
def _reset():
    for t in (authmod._login_failures, authmod._login_email_failures, authmod._login_known_good):
        t.clear()
    yield
    for t in (authmod._login_failures, authmod._login_email_failures, authmod._login_known_good):
        t.clear()


@pytest.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(tmp_path / "relay.db"))
    await dbmod.init_db()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO users (id, email, password_hash, salt, hash_algo, role, home_id, created_at)"
            " VALUES ('u1', ?, ?, '', 'bcrypt', 'super_admin', 'h1', ?)",
            (OWNER, hash_password_bcrypt(OWNER_PW), datetime.now(timezone.utc).isoformat()),
        )
        await conn.commit()
    app = FastAPI()
    app.include_router(authmod.router, prefix="/api")
    return TestClient(app)


def _post(tc, email, pw="wrong", ip="198.51.100.1"):
    return tc.post("/api/auth/login", json={"email": email, "password": pw},
                   headers={"Fly-Client-IP": ip})


def test_per_network_cap(client):
    for i in range(authmod.LOGIN_MAX_FAILURES):
        assert _post(client, f"n{i}@x.com").status_code == 401
    assert _post(client, "another@x.com").status_code == 429
    assert _post(client, "another@x.com", ip="203.0.113.9").status_code == 401


def test_success_does_not_consume_budget(client):
    for _ in range(authmod.LOGIN_MAX_FAILURES * 2):
        assert _post(client, OWNER, OWNER_PW).status_code == 200
    assert authmod._login_failures == {} and authmod._login_email_failures == {}


def test_ipv6_keyed_by_slash_64(client):
    for i in range(authmod.LOGIN_MAX_FAILURES):
        assert _post(client, f"n{i}@x.com", ip=f"2001:db8:1:2::{i + 1:x}").status_code == 401
    assert _post(client, "z@x.com", ip="2001:db8:1:2:ffff::1").status_code == 429
    assert _post(client, "z@x.com", ip="2001:db8:1:3::1").status_code == 401


def _req(ip: str) -> Request:
    return Request({"type": "http", "method": "POST", "path": "/", "query_string": b"",
                    "headers": [(b"fly-client-ip", ip.encode())], "client": ("10.0.0.1", 1)})


async def _attempt(email, ip):
    try:
        await authmod.login(authmod.LoginBody(email=email, password="wrong"), _req(ip))
    except HTTPException as e:
        return e.status_code
    return 200


async def test_parallel_requests_cannot_race_past_the_network_cap(client):
    codes = await asyncio.gather(*[_attempt(f"p{i}@x.com", "198.51.100.7") for i in range(40)])
    assert codes.count(401) == authmod.LOGIN_MAX_FAILURES
    assert codes.count(429) == 40 - authmod.LOGIN_MAX_FAILURES


async def test_parallel_guesses_from_many_ips_are_limited_per_account(client):
    codes = await asyncio.gather(*[_attempt(OWNER, f"198.51.100.{i + 1}") for i in range(40)])
    assert codes.count(401) == authmod.LOGIN_EMAIL_FREE_FAILURES
    assert codes.count(429) == 40 - authmod.LOGIN_EMAIL_FREE_FAILURES


def test_account_slowdown_is_not_a_lockout(client, monkeypatch):
    clock = [1_000_000.0]
    monkeypatch.setattr(authmod.time, "time", lambda: clock[0])
    # Owner has logged in from home before the attack.
    assert _post(client, OWNER, OWNER_PW, ip="192.0.2.10").status_code == 200
    # Distributed guessing: one attempt per IP, each a second apart.
    codes = []
    for i in range(60):
        clock[0] += 1
        codes.append(_post(client, OWNER, ip=f"203.0.113.{i + 1}").status_code)
    assert 429 in codes
    assert codes.count(401) < 20  # 60 without the per-account slowdown
    # Known-good network: never slowed down, even mid-attack.
    assert _post(client, OWNER, OWNER_PW, ip="192.0.2.10").status_code == 200
    # Brand-new network: at most LOGIN_EMAIL_MAX_COOLDOWN_S away from getting in.
    r = _post(client, OWNER, OWNER_PW, ip="192.0.2.77")
    assert r.status_code == 429 and int(r.headers["retry-after"]) <= authmod.LOGIN_EMAIL_MAX_COOLDOWN_S + 1
    clock[0] += authmod.LOGIN_EMAIL_MAX_COOLDOWN_S + 1
    assert _post(client, OWNER, OWNER_PW, ip="192.0.2.77").status_code == 200


def test_eviction_never_frees_a_blocked_network(client, monkeypatch):
    monkeypatch.setattr(authmod, "_LOGIN_BUCKETS_MAX", 3)
    for i in range(authmod.LOGIN_MAX_FAILURES):
        _post(client, f"b{i}@x.com", ip="198.51.100.66")
    assert _post(client, "q@x.com", ip="198.51.100.66").status_code == 429
    for i in range(20):  # churn far past the cap
        assert _post(client, f"c{i}@x.com", ip=f"203.0.113.{i + 1}").status_code == 401
    assert _post(client, "q2@x.com", ip="198.51.100.66").status_code == 429
    assert len(authmod._login_failures) <= 3


def test_expired_buckets_are_evicted_first(client, monkeypatch):
    clock = [2_000_000.0]
    monkeypatch.setattr(authmod.time, "time", lambda: clock[0])
    monkeypatch.setattr(authmod, "_LOGIN_BUCKETS_MAX", 3)
    for i in range(3):
        _post(client, f"e{i}@x.com", ip=f"203.0.113.{i + 1}")
    clock[0] += authmod.LOGIN_WINDOW_S + 1
    _post(client, "fresh@x.com", ip="198.51.100.5")
    assert list(authmod._login_failures) == ["198.51.100.5"]
