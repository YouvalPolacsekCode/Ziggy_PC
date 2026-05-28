"""Tests for the cohort admin surface + fall-through resolution
(Prompt 4 chunk 2.H).

Coverage:
  GET  /api/admin/ota/cohorts          admin-only, lists in created-DESC,
                                       reports home_count + ha/ziggy versions
  POST /api/admin/ota/cohorts          create new cohort, upsert existing,
                                       400 on invalid name / unknown release,
                                       non-admin 403
  PUT  /api/admin/homes/{id}/cohort    assign + unassign (null), unknown
                                       home 404, unknown cohort 400, invalid
                                       name 400, non-admin 403

  GET  /api/devices/{id}/ota-manifest  resolution order:
                                         per-home pin wins over cohort,
                                         cohort wins over latest,
                                         home in cohort whose release was
                                         deleted → falls through to latest,
                                         home with no pin + no cohort →
                                         latest (existing behavior preserved).
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
    from relay.app.audit import sign as sign_hmac
    from relay.app.auth import issue_jwt
    from relay.app.routers.ota import router as ota_router


HOME_ID = "home-cohort-1"
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
        # Two releases pre-loaded — old (id=1) and new (id=2).
        await conn.execute(
            "INSERT INTO ota_releases (ha_version, ziggy_version, image_digests, "
            "notes, created_at, created_by) VALUES "
            "('2026.4.2', '1.0.0', '{}', '', '2026-01-01', 'admin@example.com')"
        )
        await conn.execute(
            "INSERT INTO ota_releases (ha_version, ziggy_version, image_digests, "
            "notes, created_at, created_by) VALUES "
            "('2026.5.1', '1.1.0', '{}', '', '2026-02-01', 'admin@example.com')"
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


def _user_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-user', 'user@example.com', 'user', HOME_ID)}"}


def _hmac_headers(body: bytes = b"") -> dict:
    return {"X-Ziggy-Signature": sign_hmac(HOME_SECRET, body)}


# ---------- GET /api/admin/ota/cohorts ----------

async def test_list_cohorts_admin_only(client):
    assert client.get("/api/admin/ota/cohorts").status_code == 401
    assert client.get("/api/admin/ota/cohorts",
                      headers=_user_headers()).status_code == 403
    r = client.get("/api/admin/ota/cohorts", headers=_admin_headers())
    assert r.status_code == 200
    assert r.json() == {"cohorts": []}


async def test_list_cohorts_shows_home_count_and_release(client):
    # Create cohort, assign home, then list
    r = client.post("/api/admin/ota/cohorts",
                    headers=_admin_headers(),
                    json={"cohort_name": "early", "release_id": 2})
    assert r.status_code == 200

    r = client.put(f"/api/admin/homes/{HOME_ID}/cohort",
                   headers=_admin_headers(),
                   json={"cohort_name": "early"})
    assert r.status_code == 200

    listed = client.get("/api/admin/ota/cohorts", headers=_admin_headers()).json()
    assert len(listed["cohorts"]) == 1
    c = listed["cohorts"][0]
    assert c["cohort_name"] == "early"
    assert c["release_id"] == 2
    assert c["ha_version"] == "2026.5.1"
    assert c["ziggy_version"] == "1.1.0"
    assert c["home_count"] == 1
    assert c["created_by"] == "founder@example.com"


# ---------- POST /api/admin/ota/cohorts ----------

async def test_create_cohort_happy_path(client):
    r = client.post("/api/admin/ota/cohorts",
                    headers=_admin_headers(),
                    json={"cohort_name": "early", "release_id": 2})
    assert r.status_code == 200
    body = r.json()
    assert body["cohort_name"] == "early"
    assert body["release_id"] == 2
    assert body["created_by"] == "founder@example.com"


async def test_create_cohort_upsert_updates_release(client):
    """POST with an existing name MUST update its release pointer — same
    endpoint serves the "bump cohort to new release" workflow."""
    client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                json={"cohort_name": "early", "release_id": 1})
    r = client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                    json={"cohort_name": "early", "release_id": 2})
    assert r.status_code == 200
    assert r.json()["release_id"] == 2

    # Single row, not two
    listed = client.get("/api/admin/ota/cohorts", headers=_admin_headers()).json()
    assert len(listed["cohorts"]) == 1


async def test_create_cohort_rejects_bad_name(client):
    for bad in ("", "spaces here", "has/slash", "x" * 65, "weird!chars"):
        r = client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                        json={"cohort_name": bad, "release_id": 1})
        assert r.status_code in (400, 422), f"bad={bad!r}"


async def test_create_cohort_rejects_unknown_release(client):
    r = client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                    json={"cohort_name": "early", "release_id": 999})
    assert r.status_code == 400
    # Relay app uses FastAPI default {"detail": "..."} envelope, NOT the
    # Ziggy backend's {"error": {...}} wrapper.
    assert "does not exist" in r.json()["detail"]


async def test_create_cohort_non_admin_forbidden(client):
    r = client.post("/api/admin/ota/cohorts", headers=_user_headers(),
                    json={"cohort_name": "early", "release_id": 1})
    assert r.status_code == 403


# ---------- PUT /api/admin/homes/{home_id}/cohort ----------

async def test_assign_home_to_cohort(client):
    client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                json={"cohort_name": "early", "release_id": 2})
    r = client.put(f"/api/admin/homes/{HOME_ID}/cohort",
                   headers=_admin_headers(),
                   json={"cohort_name": "early"})
    assert r.status_code == 200
    assert r.json() == {"home_id": HOME_ID, "cohort_name": "early"}


async def test_unassign_home_with_null(client):
    client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                json={"cohort_name": "early", "release_id": 2})
    client.put(f"/api/admin/homes/{HOME_ID}/cohort", headers=_admin_headers(),
               json={"cohort_name": "early"})
    r = client.put(f"/api/admin/homes/{HOME_ID}/cohort",
                   headers=_admin_headers(),
                   json={"cohort_name": None})
    assert r.status_code == 200
    assert r.json() == {"home_id": HOME_ID, "cohort_name": None}

    # List shows home_count back to 0
    listed = client.get("/api/admin/ota/cohorts", headers=_admin_headers()).json()
    assert listed["cohorts"][0]["home_count"] == 0


async def test_assign_unknown_home_404(client):
    r = client.put("/api/admin/homes/no-such-home/cohort",
                   headers=_admin_headers(), json={"cohort_name": "early"})
    assert r.status_code == 404


async def test_assign_unknown_cohort_400(client):
    r = client.put(f"/api/admin/homes/{HOME_ID}/cohort",
                   headers=_admin_headers(), json={"cohort_name": "ghost"})
    assert r.status_code == 400


async def test_assign_non_admin_forbidden(client):
    r = client.put(f"/api/admin/homes/{HOME_ID}/cohort",
                   headers=_user_headers(), json={"cohort_name": "early"})
    assert r.status_code == 403


# ---------- fall-through resolution in GET /api/devices/{id}/ota-manifest ----------

async def test_resolution_per_home_pin_wins_over_cohort(db, client):
    """Per-home pin to release 1 + cohort assignment to release 2 →
    edge must receive release 1 (per-home pin always wins)."""
    # Cohort pinned to release 2
    client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                json={"cohort_name": "early", "release_id": 2})
    client.put(f"/api/admin/homes/{HOME_ID}/cohort", headers=_admin_headers(),
               json={"cohort_name": "early"})

    # Per-home pin to release 1
    client.put(f"/api/admin/homes/{HOME_ID}/ota-pin", headers=_admin_headers(),
               json={"release_id": 1})

    r = client.get(f"/api/devices/{HOME_ID}/ota-manifest",
                   headers=_hmac_headers())
    assert r.status_code == 200
    assert r.json()["release_id"] == 1
    assert r.json()["ha_version"] == "2026.4.2"


async def test_resolution_cohort_wins_over_latest(db, client):
    """Home in cohort pinned to release 1, no per-home pin → release 1
    (cohort wins, even though release 2 is the latest)."""
    client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                json={"cohort_name": "lagging", "release_id": 1})
    client.put(f"/api/admin/homes/{HOME_ID}/cohort", headers=_admin_headers(),
               json={"cohort_name": "lagging"})

    r = client.get(f"/api/devices/{HOME_ID}/ota-manifest",
                   headers=_hmac_headers())
    assert r.status_code == 200
    assert r.json()["release_id"] == 1


async def test_resolution_no_pin_no_cohort_falls_to_latest(db, client):
    """Home with neither a per-home pin nor a cohort assignment → latest
    release. This is the existing Prompt 2 behavior; chunk 2.H must
    preserve it."""
    r = client.get(f"/api/devices/{HOME_ID}/ota-manifest",
                   headers=_hmac_headers())
    assert r.status_code == 200
    assert r.json()["release_id"] == 2   # newest
    assert r.json()["ha_version"] == "2026.5.1"


async def test_resolution_cohort_with_deleted_release_falls_to_latest(db, client):
    """If a cohort's release_id no longer exists in ota_releases (cleanup
    operation pulled it), the JOIN returns 0 rows and we fall through to
    latest. The hub keeps making forward progress instead of being stuck."""
    client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                json={"cohort_name": "stuck", "release_id": 1})
    client.put(f"/api/admin/homes/{HOME_ID}/cohort", headers=_admin_headers(),
               json={"cohort_name": "stuck"})
    # Delete release 1 directly via the DB — the public surface has no
    # DELETE for releases yet.
    async with db.get_db() as conn:
        await conn.execute("DELETE FROM ota_releases WHERE id=1")
        await conn.commit()

    r = client.get(f"/api/devices/{HOME_ID}/ota-manifest",
                   headers=_hmac_headers())
    assert r.status_code == 200
    assert r.json()["release_id"] == 2   # latest


async def test_resolution_upserting_cohort_release_propagates_to_hub(db, client):
    """The whole point of staged rollout: bumping a cohort's release_id
    via POST changes what the edge fetches next poll."""
    client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                json={"cohort_name": "ring0", "release_id": 1})
    client.put(f"/api/admin/homes/{HOME_ID}/cohort", headers=_admin_headers(),
               json={"cohort_name": "ring0"})

    r = client.get(f"/api/devices/{HOME_ID}/ota-manifest",
                   headers=_hmac_headers())
    assert r.json()["release_id"] == 1

    # Bump the cohort to release 2
    client.post("/api/admin/ota/cohorts", headers=_admin_headers(),
                json={"cohort_name": "ring0", "release_id": 2})

    r = client.get(f"/api/devices/{HOME_ID}/ota-manifest",
                   headers=_hmac_headers())
    assert r.json()["release_id"] == 2
