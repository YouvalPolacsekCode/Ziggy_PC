"""Tests for the web/PWA onboarding auth seam — get_onboarding_principal.

The kit-out-of-box (native) flow authenticates post-claim wizard steps with the
paired phone's DEVICE token. The web/PWA path (Spine B, see
docs/superpowers/specs/2026-07-29-web-onboarding-path-design.md) has no device
token: it creates the owner via /api/auth/setup and drives the SAME steps with
the owner's SUPER_ADMIN SESSION token.

Coverage:
  - /api/onboarding/sensors accepts a super_admin session token (web flow)
  - ...still accepts a paired device token (native flow, unchanged)
  - ...rejects a plain 'user' session token (only the owner may onboard)
  - ...401 with no token / garbage token
  - /api/onboarding/sensors/confirm treats a super_admin session as claimed
    (does NOT 409 "Device not claimed")
  - The device-claim path (/api/onboarding/claim) is UNCHANGED — still LAN-gated
    and still rejects a session token (it requires a real device token)
"""
from __future__ import annotations

import secrets
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import onboarding_sensors_router as osr
from services import auth_db, mobile_app
from services.auth_hashing import hash_password_bcrypt


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setenv("ZIGGY_KIT_MANIFEST_PATH", str(tmp_path / "kit_manifest.yaml"))
    # Auth DB isolation — temp SQLite + reset the init memo.
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)
    yield


def _app_client() -> TestClient:
    app = FastAPI()
    app.include_router(osr.router)
    # Loopback peer so any require_lan-gated route (only /claim) sees a LAN peer.
    return TestClient(app, client=("127.0.0.1", 50000))


def _patch_ha_empty(monkeypatch: pytest.MonkeyPatch):
    async def fake(*_a, **_k):
        return {"devices": [], "areas": [], "entities": []}
    monkeypatch.setattr(osr.ha_areas, "get_registry_snapshot", fake)


def _mint_owner_session(username: str = "owner") -> str:
    """Create the first super_admin owner (as /api/auth/setup does) and return
    a live session token."""
    uid = auth_db.create_first_owner(
        username=username,
        password_hash=hash_password_bcrypt("secretpw"),
        salt="",
        role="super_admin",
        hash_algo="bcrypt",
    )
    assert uid is not None
    token = secrets.token_hex(32)
    auth_db.add_session(uid, token)
    return token


def _mint_plain_user_session(username: str = "guest") -> str:
    uid = auth_db.create_user(
        username=username,
        password_hash=hash_password_bcrypt("secretpw"),
        salt="",
        role="user",
        hash_algo="bcrypt",
    )
    token = secrets.token_hex(32)
    auth_db.add_session(uid, token)
    return token


def _register_device() -> str:
    rec = mobile_app.register_device(user_id="owner", device_info={"platform": "ios"})
    return rec["auth_token"]


# ── /sensors auth matrix ──────────────────────────────────────────────────────

def test_sensors_accepts_owner_session_token(monkeypatch: pytest.MonkeyPatch):
    _patch_ha_empty(monkeypatch)
    client = _app_client()
    token = _mint_owner_session()
    resp = client.get("/api/onboarding/sensors",
                      headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["ha_reachable"] is True


def test_sensors_accepts_device_token(monkeypatch: pytest.MonkeyPatch):
    _patch_ha_empty(monkeypatch)
    client = _app_client()
    token = _register_device()
    resp = client.get("/api/onboarding/sensors",
                      headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


def test_sensors_rejects_plain_user_session(monkeypatch: pytest.MonkeyPatch):
    _patch_ha_empty(monkeypatch)
    client = _app_client()
    # First owner must exist so create_user's row isn't the first-owner slot,
    # but we specifically mint a role='user' session and expect rejection.
    _mint_owner_session("theowner")
    token = _mint_plain_user_session("bob")
    resp = client.get("/api/onboarding/sensors",
                      headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_sensors_401_without_token(monkeypatch: pytest.MonkeyPatch):
    _patch_ha_empty(monkeypatch)
    client = _app_client()
    assert client.get("/api/onboarding/sensors").status_code == 401


def test_sensors_401_with_garbage_token(monkeypatch: pytest.MonkeyPatch):
    _patch_ha_empty(monkeypatch)
    client = _app_client()
    resp = client.get("/api/onboarding/sensors",
                      headers={"Authorization": "Bearer nope_not_real"})
    assert resp.status_code == 401


# ── /sensors/confirm: owner session counts as claimed ─────────────────────────

def test_confirm_owner_session_not_rejected_as_unclaimed(monkeypatch: pytest.MonkeyPatch):
    # Empty sensors payload short-circuits before any HA call, so a 200 here
    # proves the principal (owner session) passed the "Device not claimed" gate.
    client = _app_client()
    token = _mint_owner_session()
    resp = client.post("/api/onboarding/sensors/confirm",
                       headers={"Authorization": f"Bearer {token}"},
                       json={"sensors": []})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "confirmed": 0, "failed": []}


# ── The device-claim path stays unchanged ─────────────────────────────────────

def test_claim_still_rejects_a_session_token(monkeypatch: pytest.MonkeyPatch):
    """/api/onboarding/claim must NOT accept the web owner session token — it is
    the LAN-only, device-token ownership-grant path and is deliberately untouched
    by the web onboarding work."""
    client = _app_client()
    token = _mint_owner_session()
    resp = client.post("/api/onboarding/claim",
                       headers={"Authorization": f"Bearer {token}"},
                       json={"username": "x", "password": "abcd"})
    # get_current_device rejects the session token as an invalid device token.
    assert resp.status_code == 401
