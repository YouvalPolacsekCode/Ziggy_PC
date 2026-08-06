"""Tests for self-service account deletion — POST /api/auth/me/delete.

Apple 5.1.1(v) requires an in-app account deletion path. `delete_user`
(admin-scoped) refuses to delete the caller; `delete_own_account` is the
self-service equivalent.

Coverage:
  - Plain 'user' account deletes itself, session cascades away.
  - Sole owner (super_admin) is REJECTED with 409 + needs_factory_reset —
    hub must not be stranded; owner is redirected to the factory-reset flow.
  - Admin (rank 2) deletes itself (below the super_admin gate).
  - Unauth call → 401.
  - Second delete of the same user after the first succeeds is idempotent.
"""
from __future__ import annotations

import secrets
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import auth_router
from services import auth_db
from services.auth_hashing import hash_password_bcrypt


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)
    # Empty legacy YAML users list so _find_user() never returns a stale hit.
    from core import settings_loader
    monkeypatch.setitem(settings_loader.settings, "users", [])
    yield


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(auth_router.router)
    return TestClient(app)


def _mint_user(username: str, role: str) -> str:
    """Create a user + live session, return the session token."""
    if role == "super_admin":
        uid = auth_db.create_first_owner(
            username=username,
            password_hash=hash_password_bcrypt("secretpw"),
            salt="",
            role="super_admin",
            hash_algo="bcrypt",
        )
    else:
        uid = auth_db.create_user(
            username=username,
            password_hash=hash_password_bcrypt("secretpw"),
            salt="",
            role=role,
            hash_algo="bcrypt",
        )
    assert uid is not None
    token = secrets.token_hex(32)
    auth_db.add_session(uid, token)
    return token


def test_plain_user_can_self_delete():
    token = _mint_user("alice", "user")
    r = _client().post("/api/auth/me/delete",
                       headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True
    assert r.json()["deleted"] == "alice"
    # User is gone; session cascaded away.
    assert auth_db.get_user_by_username("alice") is None
    assert auth_db.get_user_by_session_token(token) is None


def test_admin_can_self_delete():
    """admin (rank 2) is below the super_admin cutoff — self-delete allowed."""
    token = _mint_user("bob", "admin")
    r = _client().post("/api/auth/me/delete",
                       headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert auth_db.get_user_by_username("bob") is None


def test_super_admin_owner_is_redirected_to_factory_reset():
    """The sole owner must NOT be able to self-delete — that would strand the
    hub. They get 409 + needs_factory_reset so the client can show the
    factory-reset flow instead."""
    token = _mint_user("owner", "super_admin")
    r = _client().post("/api/auth/me/delete",
                       headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "owner_must_factory_reset"
    assert detail["needs_factory_reset"] is True
    # Owner is STILL present after the rejection.
    assert auth_db.get_user_by_username("owner") is not None


def test_unauthenticated_call_is_rejected():
    r = _client().post("/api/auth/me/delete")
    assert r.status_code == 401


def test_garbage_token_is_rejected():
    r = _client().post("/api/auth/me/delete",
                       headers={"Authorization": "Bearer not-a-real-token"})
    assert r.status_code == 401


def test_self_delete_is_idempotent_on_race():
    """If the row is removed between token lookup and DELETE (rare, but
    possible if two clients hit this simultaneously), the endpoint returns
    ok + already_gone instead of 404 — the caller's intent (make me gone)
    is satisfied either way."""
    token = _mint_user("carol", "user")
    # Simulate race: nuke the user out-of-band, then call self-delete. The
    # session token still resolves via the JOIN until the sessions row is
    # gone too, but ON DELETE CASCADE clears sessions immediately — so we
    # add the session back after removing the user to reach the race branch.
    user = auth_db.get_user_by_username("carol")
    assert user is not None
    auth_db.delete_user("carol")
    # Re-add the (now-orphaned) session token pointing at the deleted uid
    # would violate the FK; instead, we simulate via a synthetic in-memory
    # user by patching find_user_by_token for this one call.
    from backend.routers import auth_deps
    import backend.routers.auth_router as ar
    original = auth_deps.find_user_by_token
    try:
        auth_deps.find_user_by_token = lambda _t: {
            "id": user["id"], "username": "carol", "role": "user",
        }
        r = _client().post("/api/auth/me/delete",
                           headers={"Authorization": f"Bearer {token}"})
    finally:
        auth_deps.find_user_by_token = original
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body.get("already_gone") is True
