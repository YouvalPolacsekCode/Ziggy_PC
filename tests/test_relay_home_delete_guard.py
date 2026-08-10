"""Deleting a home is irreversible, so the guard matters more than the delete.

The fleet list only earns attention if it contains real homes — dead smoke-test
rows dilute it until nobody reads it. But the same endpoint that removes those
could remove a customer, so it refuses anything that looks alive.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def client(tmp_path, monkeypatch):
    monkeypatch.setenv("RELAY_DB", str(tmp_path / "relay.db"))
    monkeypatch.setenv("RELAY_JWT_SECRET", "test-secret-not-a-default-value")
    monkeypatch.setenv("RELAY_ADMIN_PASSWORD", "test-admin-password-not-default")
    monkeypatch.setenv("ZIGGY_AUTO_REMEDIATE", "0")

    from relay.app import database
    monkeypatch.setattr(database, "DATABASE_URL", str(tmp_path / "relay.db"))

    from relay.app.main import app
    await database.init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def _admin_token(client):
    # Mint directly, like relay/tests/test_relay_support_session.py does — the
    # admin-bootstrap path is not what these tests are about.
    from relay.app.auth import issue_jwt
    return issue_jwt("u-admin", "founder@ziggy.app", "relay_admin", None)


async def _seed_home(home_id, name, *, telemetry_age_s=None):
    from relay.app.database import get_db
    async with get_db() as db:
        await db.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (home_id, name, "hub", "active", "s3cret",
             datetime.now(timezone.utc).isoformat()),
        )
        if telemetry_age_s is not None:
            ts = (datetime.now(timezone.utc) - timedelta(seconds=telemetry_age_s)).isoformat()
            await db.execute(
                "INSERT INTO telemetry_raw (home_id, ts, payload) VALUES (?,?,?)",
                (home_id, ts, json.dumps({"ha_version": "2026.6.1"})),
            )
        await db.commit()


@pytest.mark.asyncio
async def test_refuses_to_delete_a_home_that_is_still_reporting(client):
    """A live customer home must survive a fat-fingered delete."""
    token = await _admin_token(client)
    await _seed_home("home-live", "David's Home", telemetry_age_s=300)

    r = await client.delete("/api/admin/fleet/homes/home-live",
                            headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409
    assert "looks" in r.text and "alive" in r.text

    still = await client.get("/api/homes/", headers={"Authorization": f"Bearer {token}"})
    assert any(h["id"] == "home-live" for h in still.json())


@pytest.mark.asyncio
async def test_deletes_a_long_dead_home_and_its_telemetry(client):
    token = await _admin_token(client)
    await _seed_home("home-dead", "Smoke-test", telemetry_age_s=40 * 24 * 3600)

    r = await client.delete("/api/admin/fleet/homes/home-dead",
                            headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    from relay.app.database import get_db
    async with get_db() as db:
        homes = await db.execute_fetchall("SELECT id FROM homes WHERE id=?", ("home-dead",))
        tel = await db.execute_fetchall(
            "SELECT id FROM telemetry_raw WHERE home_id=?", ("home-dead",))
    assert homes == [] and tel == [], "row and its telemetry must both be gone"


@pytest.mark.asyncio
async def test_never_reported_home_deletes_cleanly(client):
    token = await _admin_token(client)
    await _seed_home("home-never", "probe-test")
    r = await client.delete("/api/admin/fleet/homes/home-never",
                            headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_force_overrides_the_liveness_guard(client):
    token = await _admin_token(client)
    await _seed_home("home-live2", "Live", telemetry_age_s=60)
    r = await client.delete("/api/admin/fleet/homes/home-live2?force=true",
                            headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_deletion_is_recorded_before_the_row_disappears(client):
    """Irreversible actions must leave evidence, or 'where did that home go?'
    has no answer."""
    token = await _admin_token(client)
    await _seed_home("home-audit", "Smoke", telemetry_age_s=40 * 24 * 3600)
    await client.delete("/api/admin/fleet/homes/home-audit",
                        headers={"Authorization": f"Bearer {token}"})

    from relay.app.database import get_db
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT detail FROM audit_log WHERE event='fleet_home_deleted' AND home_id=?",
            ("home-audit",))
    assert rows, "no audit row written"
    assert "Smoke" in dict(rows[0])["detail"]


@pytest.mark.asyncio
async def test_unknown_home_is_404(client):
    token = await _admin_token(client)
    r = await client.delete("/api/admin/fleet/homes/nope",
                            headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_non_admin_cannot_delete(client):
    await _seed_home("home-x", "X")
    r = await client.delete("/api/admin/fleet/homes/home-x")
    assert r.status_code in (401, 403)
