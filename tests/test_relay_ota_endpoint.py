"""Tests for relay/app/routers/ota.py — Prompt 2 chunk 2.1.

Coverage:
  GET  /api/devices/{device_id}/ota-manifest
                       valid HMAC + latest release, valid HMAC + pinned
                       release, signature mismatch (401), unknown home
                       (404), suspended home (403), empty catalog (404),
                       returns valid inner manifest signature
  POST /api/admin/ota/releases
                       admin creates, non-admin (403), validates input
  GET  /api/admin/ota/releases
                       admin lists in id-DESC order
  GET  /api/admin/homes/{home_id}/ota-pin
                       reads pin
  PUT  /api/admin/homes/{home_id}/ota-pin
                       sets pin, unpin (null), pin to unknown release (400),
                       unknown home (404), non-admin (403)

PyJWT is required (the auth module imports it). Skipped cleanly when absent.
"""

from __future__ import annotations

import importlib.util
import json

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
    from relay.app.audit import sign as sign_hmac, verify as verify_hmac
    from relay.app.auth import issue_jwt
    from relay.app.routers.ota import (
        _canonical_bytes_for_signing,
        router as ota_router,
    )


HOME_ID = "home-1"
HOME_SECRET = "test-secret-32-bytes-aaaaaaaaaa"


# ---------- fixtures ----------

@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (HOME_ID, "Test Home", "cloud", "active", HOME_SECRET, "2026-01-01"),
        )
        await conn.commit()
    return dbmod


@pytest.fixture
async def client(db):
    app = FastAPI()
    app.include_router(ota_router)
    return TestClient(app)


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-admin', 'founder@example.com', 'relay_admin', None)}"}


def _user_headers(home_id: str | None = HOME_ID) -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-user', 'user@example.com', 'user', home_id)}"}


def _hmac_headers(body: bytes, secret: str = HOME_SECRET) -> dict:
    return {"X-Ziggy-Signature": sign_hmac(secret, body)}


async def _make_release(ha="2026.5.1", ziggy="1.2.3", digests=None, notes=""):
    """Insert a release row directly; returns the row id."""
    async with dbmod.get_db() as conn:
        cursor = await conn.execute(
            "INSERT INTO ota_releases "
            "(ha_version, ziggy_version, image_digests, notes, created_at, created_by) "
            "VALUES (?,?,?,?,?,?)",
            (ha, ziggy,
             json.dumps(digests or {"ha-core": "sha256:abc"}),
             notes, "2026-05-27T00:00:00+00:00", "test"),
        )
        await conn.commit()
        return cursor.lastrowid


# ---------- GET /api/devices/{device_id}/ota-manifest ----------

async def test_get_manifest_latest_release(client):
    rid = await _make_release()
    resp = client.get(f"/api/devices/{HOME_ID}/ota-manifest", headers=_hmac_headers(b""))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["home_id"] == HOME_ID
    assert body["device_id"] == HOME_ID   # v1 equivalence
    assert body["release_id"] == rid
    assert body["ha_version"] == "2026.5.1"
    assert body["ziggy_version"] == "1.2.3"
    assert body["image_digests"] == {"ha-core": "sha256:abc"}
    assert "signature" in body


async def test_get_manifest_signature_verifies(client):
    await _make_release()
    resp = client.get(f"/api/devices/{HOME_ID}/ota-manifest", headers=_hmac_headers(b""))
    body = resp.json()
    sig = body.pop("signature")
    canonical = _canonical_bytes_for_signing(body)
    ok, why = verify_hmac(HOME_SECRET, canonical, sig)
    assert ok, why


async def test_get_manifest_returns_pinned_release(client):
    rid_a = await _make_release(ha="2026.5.1")
    rid_b = await _make_release(ha="2026.5.2")  # latest by id
    # No pin: returns rid_b
    resp = client.get(f"/api/devices/{HOME_ID}/ota-manifest", headers=_hmac_headers(b""))
    assert resp.json()["release_id"] == rid_b
    # Pin to rid_a:
    async with dbmod.get_db() as conn:
        await conn.execute("UPDATE homes SET ota_pinned_release_id=? WHERE id=?",
                           (rid_a, HOME_ID))
        await conn.commit()
    resp = client.get(f"/api/devices/{HOME_ID}/ota-manifest", headers=_hmac_headers(b""))
    assert resp.json()["release_id"] == rid_a


async def test_get_manifest_bad_signature(client):
    await _make_release()
    resp = client.get(
        f"/api/devices/{HOME_ID}/ota-manifest",
        headers={"X-Ziggy-Signature": "t=1,v1=deadbeef"},
    )
    assert resp.status_code == 401


async def test_get_manifest_unknown_home(client):
    await _make_release()
    resp = client.get("/api/devices/home-unknown/ota-manifest", headers=_hmac_headers(b""))
    assert resp.status_code == 404


async def test_get_manifest_suspended_home(client):
    await _make_release()
    async with dbmod.get_db() as conn:
        await conn.execute("UPDATE homes SET status='suspended' WHERE id=?", (HOME_ID,))
        await conn.commit()
    resp = client.get(f"/api/devices/{HOME_ID}/ota-manifest", headers=_hmac_headers(b""))
    assert resp.status_code == 403


async def test_get_manifest_no_release_published(client):
    # No releases inserted at all.
    resp = client.get(f"/api/devices/{HOME_ID}/ota-manifest", headers=_hmac_headers(b""))
    assert resp.status_code == 404


# ---------- Admin: release catalog ----------

async def test_admin_create_release(client):
    resp = client.post(
        "/api/admin/ota/releases",
        headers=_admin_headers(),
        json={
            "ha_version": "2026.5.1",
            "ziggy_version": "1.2.3",
            "image_digests": {"ha-core": "sha256:beef"},
            "notes": "first release",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ha_version"] == "2026.5.1"
    assert body["image_digests"] == {"ha-core": "sha256:beef"}
    assert isinstance(body["id"], int)


async def test_admin_create_release_non_admin_403(client):
    resp = client.post(
        "/api/admin/ota/releases",
        headers=_user_headers(),
        json={"ha_version": "x", "ziggy_version": "y"},
    )
    assert resp.status_code == 403


async def test_admin_list_releases_desc(client):
    rid_a = await _make_release(ha="2026.5.1")
    rid_b = await _make_release(ha="2026.5.2")
    resp = client.get("/api/admin/ota/releases", headers=_admin_headers())
    assert resp.status_code == 200
    ids = [r["id"] for r in resp.json()["releases"]]
    assert ids == [rid_b, rid_a]


# ---------- Admin: pin ----------

async def test_admin_pin_unpin(client):
    rid = await _make_release()

    # Default pin is null
    resp = client.get(f"/api/admin/homes/{HOME_ID}/ota-pin", headers=_admin_headers())
    assert resp.json() == {"home_id": HOME_ID, "release_id": None}

    # Set
    resp = client.put(
        f"/api/admin/homes/{HOME_ID}/ota-pin",
        headers=_admin_headers(),
        json={"release_id": rid},
    )
    assert resp.status_code == 200
    assert resp.json() == {"home_id": HOME_ID, "release_id": rid}

    # Read back
    resp = client.get(f"/api/admin/homes/{HOME_ID}/ota-pin", headers=_admin_headers())
    assert resp.json()["release_id"] == rid

    # Unpin
    resp = client.put(
        f"/api/admin/homes/{HOME_ID}/ota-pin",
        headers=_admin_headers(),
        json={"release_id": None},
    )
    assert resp.status_code == 200
    assert resp.json()["release_id"] is None


async def test_admin_pin_unknown_release_400(client):
    resp = client.put(
        f"/api/admin/homes/{HOME_ID}/ota-pin",
        headers=_admin_headers(),
        json={"release_id": 99999},
    )
    assert resp.status_code == 400


async def test_admin_pin_unknown_home_404(client):
    resp = client.put(
        "/api/admin/homes/home-unknown/ota-pin",
        headers=_admin_headers(),
        json={"release_id": None},
    )
    assert resp.status_code == 404


async def test_admin_pin_non_admin_403(client):
    resp = client.put(
        f"/api/admin/homes/{HOME_ID}/ota-pin",
        headers=_user_headers(),
        json={"release_id": None},
    )
    assert resp.status_code == 403
