"""Tests for /api/onboarding/claim — Prompt 7 chunk 3.1.

Coverage:
  - 401 when device token missing or invalid
  - 409 when the device record is not claim_pending
  - 409 when an owner account already exists (second-claim race)
  - 400 for empty username, < 4-char password
  - Happy path: owner created, device bound, session token returned
  - Audit emits claim_succeeded with device_bound=True
  - Audit emits claim_rejected with reason=device_not_claim_pending
  - Audit emits claim_rejected with reason=owner_already_exists
  - Returned user_token logs in via the existing auth_db session table
  - Race: device delete between auth and bind → user created, device_bound=False
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.debug_bus import bus, BASIC, OFF
from backend.routers import onboarding_sensors_router as osr
from backend.routers import mobile_router as mr
from services import auth_db, mobile_app


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Mobile_app storage isolation
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    # Auth DB isolation — point at a temp SQLite file and reset the
    # _initialized memo so init() re-creates the schema in the new file.
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)
    # Audit bus
    bus.set_level(BASIC)
    bus.set_scopes([])
    bus._buffer.clear()

    class _NoopWS:
        def is_connected(self, device_id): return False
        async def send_to_device(self, *_a, **_k): return False
    monkeypatch.setattr(mr, "mobile_ws", _NoopWS())
    yield
    bus.set_level(OFF)
    bus._buffer.clear()


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(osr.router)
    return TestClient(app)


def _register_claim_pending(claim_device_id: str = "edge_box_001") -> dict:
    """Register a fresh claim-pending mobile device record, mirroring what
    /api/mobile/pair does after a claim-tier code redemption."""
    return mobile_app.register_device(
        user_id=None,
        device_info={"platform": "ios"},
        claim_pending=True,
        claim_device_id=claim_device_id,
    )


def _events(step: str) -> list[dict]:
    return [e for e in list(bus._buffer) if e.get("step") == step]


# ── Auth dep ─────────────────────────────────────────────────────────────────

def test_claim_401_without_token(client: TestClient):
    resp = client.post(
        "/api/onboarding/claim",
        json={"username": "alice", "password": "secret123"},
    )
    assert resp.status_code == 401


def test_claim_401_with_invalid_token(client: TestClient):
    resp = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": "Bearer zgy_mb_NOPE"},
        json={"username": "alice", "password": "secret123"},
    )
    assert resp.status_code == 401


# ── State guards ─────────────────────────────────────────────────────────────

def test_claim_409_when_device_not_claim_pending(client: TestClient):
    # User-tier pair → not claim-pending.
    rec = mobile_app.register_device(user_id="alice", device_info={"platform": "ios"})
    resp = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {rec['auth_token']}"},
        json={"username": "bob", "password": "secret123"},
    )
    assert resp.status_code == 409
    assert "already claimed" in resp.json()["detail"]
    matched = _events("claim_rejected")
    assert len(matched) == 1
    assert matched[0]["data"]["reason"] == "device_not_claim_pending"


def test_claim_409_when_owner_already_exists(client: TestClient):
    # Pre-existing owner account.
    auth_db.create_user(
        username="existing@example.com",
        password_hash="x",
        salt="",
        role="super_admin",
        hash_algo="bcrypt",
    )
    rec = _register_claim_pending()
    resp = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {rec['auth_token']}"},
        json={"username": "alice", "password": "secret123"},
    )
    assert resp.status_code == 409
    matched = _events("claim_rejected")
    assert len(matched) == 1
    assert matched[0]["data"]["reason"] == "owner_already_exists"


# ── Validation ───────────────────────────────────────────────────────────────

def test_claim_400_empty_username(client: TestClient):
    rec = _register_claim_pending()
    resp = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {rec['auth_token']}"},
        json={"username": "  ", "password": "secret123"},
    )
    assert resp.status_code == 400


def test_claim_400_short_password(client: TestClient):
    rec = _register_claim_pending()
    resp = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {rec['auth_token']}"},
        json={"username": "alice", "password": "abc"},
    )
    assert resp.status_code == 400


# ── Happy path ───────────────────────────────────────────────────────────────

def test_claim_happy_path_creates_user_binds_device_emits_audit(client: TestClient):
    rec = _register_claim_pending(claim_device_id="edge_box_xyz")
    resp = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {rec['auth_token']}"},
        json={"username": "alice@example.com", "password": "secret123"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    assert body["role"] == "super_admin"
    assert body["username"] == "alice@example.com"
    assert body["device_bound"] is True
    assert len(body["user_token"]) >= 32

    # User row exists
    assert auth_db.has_any_user() is True
    user = auth_db.get_user_by_username("alice@example.com")
    assert user is not None
    assert user["role"] == "super_admin"

    # Session token resolves to that user
    found = auth_db.get_user_by_session_token(body["user_token"])
    assert found is not None
    assert found["username"] == "alice@example.com"

    # Device is bound: claim_pending=False, user_id=username
    bound = mobile_app.find_device_by_token(rec["auth_token"])
    assert bound is not None
    assert bound["claim_pending"] is False
    assert bound["user_id"] == "alice@example.com"

    # Audit event
    matched = _events("claim_succeeded")
    assert len(matched) == 1
    d = matched[0]["data"]
    assert d["device_id"] == rec["device_id"]
    assert d["user_id"] == "alice@example.com"
    assert d["device_bound"] is True


def test_claim_strips_whitespace_in_username(client: TestClient):
    rec = _register_claim_pending()
    resp = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {rec['auth_token']}"},
        json={"username": "  alice@example.com  ", "password": "secret123"},
    )
    assert resp.status_code == 200
    assert resp.json()["username"] == "alice@example.com"


# ── Race: device disappears between auth and bind ────────────────────────────

def test_claim_user_created_but_device_bind_fails_returns_device_bound_false(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """If the device record is deleted between the auth dep and the bind call
    (or some other race), the owner account is created and we return
    device_bound=False rather than rolling back the user."""
    rec = _register_claim_pending()
    # Stub bind to simulate the race
    monkeypatch.setattr(
        mobile_app, "bind_claim_pending_device",
        lambda device_id, user_id: False,
    )
    resp = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {rec['auth_token']}"},
        json={"username": "alice", "password": "secret123"},
    )
    assert resp.status_code == 200
    assert resp.json()["device_bound"] is False
    # Owner still exists
    assert auth_db.has_any_user() is True
    # Audit captured device_bound=False
    matched = _events("claim_succeeded")
    assert matched[0]["data"]["device_bound"] is False
