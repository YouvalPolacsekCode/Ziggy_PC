"""Tests for relay/app/routers/backup_keys.py — Chunk #7 endpoints.

Coverage:
  - POST /seal-key      first seal, re-seal, wrong master key, unknown home,
                        bad b64, non-admin (403), audit row written
  - POST /unseal        happy path returns data_key + b2_credentials,
                        wrong master → 400 (no leak), unsealed home → 400,
                        missing reason → 422, updates last_unsealed_*,
                        audit row carries reason + founder email
  - POST /backup-status hub HMAC happy + bad signature + unknown home +
                        malformed JSON, audit row carries body JSON
  - GET  /backup-status latest row returned, 404 if no rows, 403 cross-home
  - POST /restore-events restore_completed + restore_aborted, bad event,
                        bad HMAC, unknown home

PyJWT is required to exercise the founder-JWT paths (the router imports
relay.app.auth which imports jwt). When run from a venv that lacks PyJWT
the whole file is skipped with a clear reason.
"""
from __future__ import annotations

import base64
import importlib.util
import json
from datetime import datetime, timezone

import pytest

# Skip the whole module if the relay's runtime deps aren't installed in
# this venv. The hub's main requirements.txt does not include PyJWT;
# relay/requirements.txt does. CI for the relay package installs both.
_has_jwt = importlib.util.find_spec("jwt") is not None
pytestmark = pytest.mark.skipif(
    not _has_jwt,
    reason="PyJWT not installed in this venv — see relay/requirements.txt",
)

if _has_jwt:
    import os as _os
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    from relay.app import database as dbmod
    from relay.app.audit import sign as sign_hmac
    from relay.app.auth import issue_jwt
    from relay.app.routers.backup_keys import router as backup_router


# ---------- fixtures + helpers ----------

@pytest.fixture
async def db(tmp_path, monkeypatch):
    """Fresh relay SQLite at tmp_path. Returns the patched dbmod."""
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


@pytest.fixture
async def client(db):
    """TestClient mounted on a minimal app holding only the backup router."""
    app = FastAPI()
    app.include_router(backup_router, prefix="/api")
    return TestClient(app)


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-admin', 'founder@example.com', 'relay_admin', None)}"}


def _user_headers(home_id: str | None = "home-1") -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-user', 'user@example.com', 'user', home_id)}"}


def _wrap(master: bytes, plaintext: bytes) -> bytes:
    """Wire-format wrap, matching services/backup_keys.wrap()."""
    nonce = _os.urandom(12)
    ct = AESGCM(master).encrypt(nonce, plaintext, None)
    return nonce + ct


async def _provision_home(db, home_id: str = "home-1", secret: str = "hub-secret-x"):
    async with db.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes(id, name, type, relay_secret, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (home_id, "Home 1", "hub", secret, datetime.now(timezone.utc).isoformat()),
        )
        await conn.commit()


def _seal_body(master: bytes, data_key: bytes, b2_creds_json: bytes) -> dict:
    return {
        "master_key_b64": base64.b64encode(master).decode(),
        "wrapped_data_key_b64": base64.b64encode(_wrap(master, data_key)).decode(),
        "wrapped_b2_credentials_b64": base64.b64encode(_wrap(master, b2_creds_json)).decode(),
    }


# ---------- seal-key ----------

async def test_seal_key_first_time(db, client):
    await _provision_home(db)
    master = b"M" * 32
    data_key = b"D" * 32
    b2 = json.dumps({"b2_key_id": "K", "b2_app_key": "A"}).encode()
    r = client.post("/api/homes/home-1/seal-key",
                    json=_seal_body(master, data_key, b2),
                    headers=_admin_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["action"] == "first_seal"
    # Row persisted with key_version=1
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM home_backup_keys WHERE home_id=?", ("home-1",))
    assert len(rows) == 1
    assert rows[0]["key_version"] == 1


async def test_seal_key_re_seal_increments_version(db, client):
    await _provision_home(db)
    master = b"M" * 32
    body1 = _seal_body(master, b"D" * 32, b'{"b2_key_id":"K","b2_app_key":"A"}')
    body2 = _seal_body(master, b"E" * 32, b'{"b2_key_id":"K2","b2_app_key":"B"}')
    r1 = client.post("/api/homes/home-1/seal-key", json=body1, headers=_admin_headers())
    r2 = client.post("/api/homes/home-1/seal-key", json=body2, headers=_admin_headers())
    assert r1.json()["action"] == "first_seal"
    assert r2.json()["action"] == "re_sealed"
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT key_version FROM home_backup_keys WHERE home_id=?", ("home-1",))
    assert rows[0]["key_version"] == 2


async def test_seal_key_wrong_master_rejects(db, client):
    """master must actually unwrap the wrapped blobs (proof-of-knowledge)."""
    await _provision_home(db)
    real_master = b"M" * 32
    body = _seal_body(real_master, b"D" * 32, b'{"b2_key_id":"K","b2_app_key":"A"}')
    # Swap in a different master that won't unwrap the blobs:
    body["master_key_b64"] = base64.b64encode(b"X" * 32).decode()
    r = client.post("/api/homes/home-1/seal-key", json=body, headers=_admin_headers())
    assert r.status_code == 400
    # Audit row recorded:
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM audit_log WHERE event='backup_key_sealed' AND home_id=? AND ok=0",
            ("home-1",))
    assert len(rows) == 1
    assert "proof_of_knowledge_failed" in rows[0]["detail"]


async def test_seal_key_unknown_home_404(db, client):
    master = b"M" * 32
    body = _seal_body(master, b"D" * 32, b'{"b2_key_id":"K","b2_app_key":"A"}')
    r = client.post("/api/homes/home-nope/seal-key", json=body, headers=_admin_headers())
    assert r.status_code == 404


async def test_seal_key_bad_master_length_400(db, client):
    await _provision_home(db)
    body = {
        "master_key_b64": base64.b64encode(b"too-short").decode(),
        "wrapped_data_key_b64": base64.b64encode(b"x" * 60).decode(),
        "wrapped_b2_credentials_b64": base64.b64encode(b"x" * 80).decode(),
    }
    r = client.post("/api/homes/home-1/seal-key", json=body, headers=_admin_headers())
    assert r.status_code == 400
    assert "32 bytes" in r.text


async def test_seal_key_invalid_base64_400(db, client):
    await _provision_home(db)
    body = {
        "master_key_b64": "!!!not-base64!!!",
        "wrapped_data_key_b64": base64.b64encode(b"x" * 60).decode(),
        "wrapped_b2_credentials_b64": base64.b64encode(b"x" * 80).decode(),
    }
    r = client.post("/api/homes/home-1/seal-key", json=body, headers=_admin_headers())
    assert r.status_code == 400


async def test_seal_key_non_admin_403(db, client):
    await _provision_home(db)
    body = _seal_body(b"M" * 32, b"D" * 32, b'{"b2_key_id":"K","b2_app_key":"A"}')
    r = client.post("/api/homes/home-1/seal-key", json=body, headers=_user_headers())
    assert r.status_code == 403


async def test_seal_key_no_auth_401(db, client):
    await _provision_home(db)
    body = _seal_body(b"M" * 32, b"D" * 32, b'{"b2_key_id":"K","b2_app_key":"A"}')
    r = client.post("/api/homes/home-1/seal-key", json=body)
    assert r.status_code == 401


# ---------- unseal ----------

async def _seal_a_home(db, client, home_id="home-1", master=b"M" * 32,
                      data_key=b"D" * 32,
                      b2_creds=None):
    if b2_creds is None:
        b2_creds = {"b2_key_id": "K005abc", "b2_app_key": "secretAppKey"}
    await _provision_home(db, home_id=home_id)
    body = _seal_body(master, data_key, json.dumps(b2_creds).encode())
    r = client.post(f"/api/homes/{home_id}/seal-key", json=body, headers=_admin_headers())
    assert r.status_code == 200
    return master, data_key, b2_creds


async def test_unseal_happy_returns_keys_and_creds(db, client):
    master, data_key, b2_creds = await _seal_a_home(db, client)
    r = client.post("/api/homes/home-1/unseal",
                    json={"master_key_b64": base64.b64encode(master).decode(),
                          "reason": "DR test 2026-05-27"},
                    headers=_admin_headers())
    assert r.status_code == 200, r.text
    body = r.json()
    assert base64.b64decode(body["data_key_b64"]) == data_key
    assert body["b2_credentials"] == b2_creds
    assert body["ttl_seconds"] == 300
    assert body["home_id"] == "home-1"


async def test_unseal_updates_last_unsealed_columns(db, client):
    master, _, _ = await _seal_a_home(db, client)
    client.post("/api/homes/home-1/unseal",
                json={"master_key_b64": base64.b64encode(master).decode(),
                      "reason": "test reason"},
                headers=_admin_headers())
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT last_unsealed_at, last_unsealed_by FROM home_backup_keys WHERE home_id=?",
            ("home-1",))
    assert rows[0]["last_unsealed_at"] is not None
    assert rows[0]["last_unsealed_by"] == "founder@example.com"


async def test_unseal_audit_row_carries_reason(db, client):
    master, _, _ = await _seal_a_home(db, client)
    client.post("/api/homes/home-1/unseal",
                json={"master_key_b64": base64.b64encode(master).decode(),
                      "reason": "customer ABC hub failure"},
                headers=_admin_headers())
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM audit_log WHERE event='backup_key_unsealed' AND ok=1")
    assert len(rows) == 1
    assert "customer ABC hub failure" in rows[0]["detail"]
    assert "founder=founder@example.com" in rows[0]["detail"]


async def test_unseal_wrong_master_400_no_leak(db, client):
    """Wrong master key gets the same 400 as an unsealed home."""
    await _seal_a_home(db, client)
    r = client.post("/api/homes/home-1/unseal",
                    json={"master_key_b64": base64.b64encode(b"X" * 32).decode(),
                          "reason": "trying wrong key"},
                    headers=_admin_headers())
    assert r.status_code == 400
    assert "Unable to unseal" in r.text
    # Audit row records the wrong-key attempt
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM audit_log WHERE event='backup_key_unsealed' AND ok=0")
    assert len(rows) == 1
    assert "wrong_master_key" in rows[0]["detail"]


async def test_unseal_no_sealed_key_400_no_leak(db, client):
    """A home with no sealed key gets the SAME 400 as wrong-key — doesn't leak existence."""
    await _provision_home(db, home_id="home-unsealed")
    r = client.post("/api/homes/home-unsealed/unseal",
                    json={"master_key_b64": base64.b64encode(b"M" * 32).decode(),
                          "reason": "fishing"},
                    headers=_admin_headers())
    assert r.status_code == 400
    assert r.text == client.post(
        "/api/homes/home-unsealed/unseal",
        json={"master_key_b64": base64.b64encode(b"X" * 32).decode(), "reason": "x"},
        headers=_admin_headers(),
    ).text
    # Audit row recorded the no_sealed_key attempt
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT detail FROM audit_log WHERE event='backup_key_unsealed' AND ok=0")
    details = " ".join(r["detail"] for r in rows)
    assert "no_sealed_key" in details


async def test_unseal_missing_reason_422(db, client):
    master, _, _ = await _seal_a_home(db, client)
    r = client.post("/api/homes/home-1/unseal",
                    json={"master_key_b64": base64.b64encode(master).decode()},
                    headers=_admin_headers())
    assert r.status_code == 422  # Pydantic validation


async def test_unseal_empty_reason_422(db, client):
    master, _, _ = await _seal_a_home(db, client)
    r = client.post("/api/homes/home-1/unseal",
                    json={"master_key_b64": base64.b64encode(master).decode(),
                          "reason": ""},
                    headers=_admin_headers())
    assert r.status_code == 422


async def test_unseal_non_admin_403(db, client):
    master, _, _ = await _seal_a_home(db, client)
    r = client.post("/api/homes/home-1/unseal",
                    json={"master_key_b64": base64.b64encode(master).decode(),
                          "reason": "x"},
                    headers=_user_headers("home-1"))
    assert r.status_code == 403


# ---------- backup-status POST (hub HMAC) ----------

async def test_backup_status_post_happy(db, client):
    await _provision_home(db, secret="hub-secret-x")
    body = {"uploaded_bytes": 12345, "files": ["a", "b"],
            "ha_version": "2026.5", "ziggy_version": "0.1.0"}
    raw = json.dumps(body).encode()
    sig = sign_hmac("hub-secret-x", raw)
    r = client.post("/api/homes/home-1/backup-status",
                    content=raw,
                    headers={"X-Ziggy-Signature": sig,
                             "Content-Type": "application/json"})
    assert r.status_code == 200, r.text
    # Audit row carries the body JSON
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM audit_log WHERE event='backup_status_updated' AND ok=1")
    assert len(rows) == 1
    detail = json.loads(rows[0]["detail"])
    assert detail["uploaded_bytes"] == 12345


async def test_backup_status_post_bad_signature_401(db, client):
    await _provision_home(db, secret="hub-secret-x")
    raw = b'{"uploaded_bytes": 1}'
    sig = sign_hmac("WRONG-SECRET", raw)
    r = client.post("/api/homes/home-1/backup-status",
                    content=raw,
                    headers={"X-Ziggy-Signature": sig,
                             "Content-Type": "application/json"})
    assert r.status_code == 401


async def test_backup_status_post_missing_signature_401(db, client):
    await _provision_home(db)
    r = client.post("/api/homes/home-1/backup-status",
                    content=b'{"uploaded_bytes": 1}',
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 401


async def test_backup_status_post_unknown_home_404(db, client):
    raw = b'{"x": 1}'
    sig = sign_hmac("any", raw)
    r = client.post("/api/homes/home-nope/backup-status",
                    content=raw,
                    headers={"X-Ziggy-Signature": sig})
    assert r.status_code == 404


async def test_backup_status_post_malformed_json_400(db, client):
    await _provision_home(db, secret="hub-secret-x")
    raw = b"not-json{{{"
    sig = sign_hmac("hub-secret-x", raw)
    r = client.post("/api/homes/home-1/backup-status",
                    content=raw,
                    headers={"X-Ziggy-Signature": sig})
    assert r.status_code == 400


# ---------- backup-status GET (founder JWT or home owner) ----------

async def test_backup_status_get_returns_latest(db, client):
    await _provision_home(db, secret="hub-secret-x")
    body = {"uploaded_bytes": 999, "files": ["x.enc"], "ziggy_version": "0.1.0"}
    raw = json.dumps(body).encode()
    sig = sign_hmac("hub-secret-x", raw)
    client.post("/api/homes/home-1/backup-status",
                content=raw, headers={"X-Ziggy-Signature": sig})
    r = client.get("/api/homes/home-1/backup-status", headers=_admin_headers())
    assert r.status_code == 200, r.text
    assert r.json()["uploaded_bytes"] == 999
    assert r.json()["files"] == ["x.enc"]
    assert "ts" in r.json()


async def test_backup_status_get_no_rows_404(db, client):
    await _provision_home(db)
    r = client.get("/api/homes/home-1/backup-status", headers=_admin_headers())
    assert r.status_code == 404


async def test_backup_status_get_home_owner_allowed(db, client):
    """A user with home_id=home-1 can read their own home's status."""
    await _provision_home(db, secret="hub-secret-x")
    raw = json.dumps({"uploaded_bytes": 1}).encode()
    sig = sign_hmac("hub-secret-x", raw)
    client.post("/api/homes/home-1/backup-status",
                content=raw, headers={"X-Ziggy-Signature": sig})
    r = client.get("/api/homes/home-1/backup-status", headers=_user_headers("home-1"))
    assert r.status_code == 200


async def test_backup_status_get_cross_home_user_403(db, client):
    """A user belonging to a different home cannot read this home's status."""
    await _provision_home(db, secret="hub-secret-x")
    raw = json.dumps({"uploaded_bytes": 1}).encode()
    sig = sign_hmac("hub-secret-x", raw)
    client.post("/api/homes/home-1/backup-status",
                content=raw, headers={"X-Ziggy-Signature": sig})
    r = client.get("/api/homes/home-1/backup-status",
                   headers=_user_headers("home-other"))
    assert r.status_code == 403


async def test_backup_status_get_returns_most_recent_only(db, client):
    """Two POSTs in sequence → GET returns the latest."""
    await _provision_home(db, secret="hub-secret-x")
    for i, n in enumerate([100, 200, 300]):
        body = json.dumps({"uploaded_bytes": n}).encode()
        sig = sign_hmac("hub-secret-x", body)
        client.post("/api/homes/home-1/backup-status",
                    content=body, headers={"X-Ziggy-Signature": sig})
    r = client.get("/api/homes/home-1/backup-status", headers=_admin_headers())
    assert r.status_code == 200
    assert r.json()["uploaded_bytes"] == 300


# ---------- restore-events ----------

async def test_restore_event_completed_audits_ok(db, client):
    await _provision_home(db, secret="hub-secret-x")
    body = {"event": "restore_completed", "old_device_id": "dev-old",
            "new_device_id": "dev-new"}
    raw = json.dumps(body).encode()
    sig = sign_hmac("hub-secret-x", raw)
    r = client.post("/api/homes/home-1/restore-events",
                    content=raw, headers={"X-Ziggy-Signature": sig})
    assert r.status_code == 200
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM audit_log WHERE event='restore_completed' AND ok=1")
    assert len(rows) == 1
    detail = json.loads(rows[0]["detail"])
    assert detail["old_device_id"] == "dev-old"
    # 'event' should NOT be inside detail (it's in the event column already)
    assert "event" not in detail


async def test_restore_event_aborted_audits_not_ok(db, client):
    await _provision_home(db, secret="hub-secret-x")
    body = {"event": "restore_aborted", "stage": "upload", "reason": "B2 down"}
    raw = json.dumps(body).encode()
    sig = sign_hmac("hub-secret-x", raw)
    r = client.post("/api/homes/home-1/restore-events",
                    content=raw, headers={"X-Ziggy-Signature": sig})
    assert r.status_code == 200
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT * FROM audit_log WHERE event='restore_aborted' AND ok=0")
    assert len(rows) == 1


async def test_restore_event_unknown_event_400(db, client):
    await _provision_home(db, secret="hub-secret-x")
    raw = json.dumps({"event": "totally_made_up"}).encode()
    sig = sign_hmac("hub-secret-x", raw)
    r = client.post("/api/homes/home-1/restore-events",
                    content=raw, headers={"X-Ziggy-Signature": sig})
    assert r.status_code == 400


async def test_restore_event_bad_signature_401(db, client):
    await _provision_home(db, secret="hub-secret-x")
    raw = json.dumps({"event": "restore_completed"}).encode()
    sig = sign_hmac("WRONG", raw)
    r = client.post("/api/homes/home-1/restore-events",
                    content=raw, headers={"X-Ziggy-Signature": sig})
    assert r.status_code == 401


async def test_restore_event_unknown_home_404(db, client):
    raw = json.dumps({"event": "restore_completed"}).encode()
    sig = sign_hmac("any", raw)
    r = client.post("/api/homes/home-nope/restore-events",
                    content=raw, headers={"X-Ziggy-Signature": sig})
    assert r.status_code == 404
