"""External-assistant bearer tokens — services/external_tokens.py and the
Settings router backend/routers/external_tokens_router.py.

The token store lives in the same SQLite file as auth_db; tests re-point
`auth_db._DB_PATH` at a temp file BEFORE any connect (same pattern as
tests/test_auth_self_delete.py and the autouse fixture in conftest.py).
"""
from __future__ import annotations

import hashlib
import secrets
import sqlite3
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import external_tokens_router
from services import auth_db, external_tokens
from services.auth_hashing import hash_password_bcrypt


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)
    monkeypatch.setattr(external_tokens, "_initialized_for", None)
    from core import settings_loader
    monkeypatch.setitem(settings_loader.settings, "users", [])
    yield
    monkeypatch.setattr(external_tokens, "_initialized_for", None)


def _mint_user(username: str, role: str = "user") -> str:
    uid = auth_db.create_user(username=username, password_hash=hash_password_bcrypt("pw"),
                              salt="", role=role, hash_algo="bcrypt")
    token = secrets.token_hex(32)
    auth_db.add_session(uid, token)
    return token


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(external_tokens_router.router)
    return TestClient(app)


# ── service ─────────────────────────────────────────────────────────────────
def test_mint_verify_list_revoke_round_trip():
    _mint_user("alice")
    minted = external_tokens.mint("alice", "Claude Code")
    assert minted["name"] == "Claude Code"
    tok = minted["token"]
    assert tok.startswith("zgy_") and len(tok) == 4 + 40

    ident = external_tokens.verify(tok)
    assert ident == {"id": minted["id"], "username": "alice", "name": "Claude Code"}

    listed = external_tokens.list_for("alice")
    assert len(listed) == 1
    row = listed[0]
    assert row["id"] == minted["id"] and row["name"] == "Claude Code"
    assert row["revoked"] is False
    assert row["last_used_at"] is not None          # verify() stamped it
    assert "token" not in row and "token_hash" not in row

    assert external_tokens.revoke("alice", minted["id"]) is True
    assert external_tokens.verify(tok) is None
    assert external_tokens.list_for("alice")[0]["revoked"] is True
    # Revoking twice is a no-op.
    assert external_tokens.revoke("alice", minted["id"]) is False


def test_token_is_stored_hashed_not_raw(tmp_path):
    _mint_user("alice")
    tok = external_tokens.mint("alice", "x")["token"]
    db = sqlite3.connect(auth_db._DB_PATH)
    rows = db.execute("SELECT token_hash, user_id FROM external_tokens").fetchall()
    db.close()
    assert len(rows) == 1
    assert rows[0][0] == hashlib.sha256(tok.encode()).hexdigest()
    assert rows[0][0] != tok
    assert rows[0][1] == auth_db.get_user_by_username("alice")["id"]


def test_verify_rejects_unknown_and_garbage():
    assert external_tokens.verify("") is None
    assert external_tokens.verify("zgy_" + "A" * 40) is None
    assert external_tokens.verify("not-a-zgy-token") is None
    assert external_tokens.verify(None) is None  # type: ignore[arg-type]


def test_revoke_only_own_tokens():
    _mint_user("alice")
    _mint_user("bob")
    a = external_tokens.mint("alice", "a")
    assert external_tokens.revoke("bob", a["id"]) is False
    assert external_tokens.verify(a["token"]) is not None
    assert external_tokens.list_for("bob") == []


def test_mint_without_user_row_still_works():
    """Legacy yaml users have no auth_db row; the token still binds to the username."""
    m = external_tokens.mint("legacy", "cli")
    assert external_tokens.verify(m["token"])["username"] == "legacy"


def test_two_tokens_are_distinct():
    _mint_user("alice")
    a = external_tokens.mint("alice", "one")
    b = external_tokens.mint("alice", "two")
    assert a["token"] != b["token"]
    assert [t["name"] for t in external_tokens.list_for("alice")] == ["one", "two"]


# ── router ──────────────────────────────────────────────────────────────────
def test_router_requires_auth():
    c = _client()
    assert c.get("/api/external-tokens").status_code == 401
    assert c.post("/api/external-tokens", json={"name": "x"}).status_code == 401
    assert c.delete("/api/external-tokens/1").status_code == 401


def test_router_mint_list_revoke(monkeypatch):
    from core import settings_loader
    monkeypatch.setitem(settings_loader.settings, "relay", {"tunnel_url": "https://home.example.com/"})
    sess = _mint_user("alice")
    h = {"Authorization": f"Bearer {sess}"}
    c = _client()

    r = c.post("/api/external-tokens", json={"name": "Cursor"}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"].startswith("zgy_")
    assert body["name"] == "Cursor"
    assert body["mcp_url"] == "https://home.example.com/mcp"
    tid = body["id"]

    r = c.get("/api/external-tokens", headers=h)
    assert r.status_code == 200
    got = r.json()
    assert got["mcp_url"] == "https://home.example.com/mcp"
    assert [t["id"] for t in got["tokens"]] == [tid]
    assert "token" not in got["tokens"][0]        # never listed after mint

    r = c.delete(f"/api/external-tokens/{tid}", headers=h)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert external_tokens.verify(body["token"]) is None
    assert c.get("/api/external-tokens", headers=h).json()["tokens"][0]["revoked"] is True


def test_router_mcp_url_null_without_tunnel(monkeypatch):
    from core import settings_loader
    monkeypatch.setitem(settings_loader.settings, "relay", {})
    sess = _mint_user("alice")
    h = {"Authorization": f"Bearer {sess}"}
    c = _client()
    assert c.get("/api/external-tokens", headers=h).json()["mcp_url"] is None
    assert c.post("/api/external-tokens", json={"name": "x"}, headers=h).json()["mcp_url"] is None


def test_router_cannot_revoke_someone_elses_token():
    a_sess = _mint_user("alice")
    b_sess = _mint_user("bob")
    c = _client()
    tid = c.post("/api/external-tokens", json={"name": "a"},
                 headers={"Authorization": f"Bearer {a_sess}"}).json()["id"]
    r = c.delete(f"/api/external-tokens/{tid}", headers={"Authorization": f"Bearer {b_sess}"})
    assert r.status_code == 404
    assert external_tokens.list_for("alice")[0]["revoked"] is False


def test_router_default_name_when_blank():
    sess = _mint_user("alice")
    c = _client()
    r = c.post("/api/external-tokens", json={}, headers={"Authorization": f"Bearer {sess}"})
    assert r.status_code == 200
    assert r.json()["name"]
