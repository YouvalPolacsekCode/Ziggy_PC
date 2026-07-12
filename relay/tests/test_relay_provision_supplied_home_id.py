"""Stream 3 — identity reconciliation on POST /api/provision/hub.

Covers:
  * a supplied home_id (imaging's DEVICE_ID==HOME_ID==uuidv4) is used verbatim
    instead of minting `home-{id}`
  * the reachable_url in the bundle is the per-home public hostname
  * re-provisioning the SAME home_id is idempotent: it reuses the existing
    Cloudflare tunnel + relay_secret (no second tunnel is minted)
"""

from __future__ import annotations

import importlib.util

import pytest

_has_jwt = importlib.util.find_spec("jwt") is not None
pytestmark = pytest.mark.skipif(not _has_jwt, reason="PyJWT not installed")

if _has_jwt:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from relay.app import database as dbmod
    from relay.app import provisioner as provmod
    from relay.app.auth import issue_jwt
    from relay.app.routers.provision import router as provision_router


@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


@pytest.fixture
async def client(db, monkeypatch):
    monkeypatch.setattr(provmod, "CF_API_TOKEN", "test-token")
    monkeypatch.setattr(provmod, "CF_ACCOUNT_ID", "test-account")

    counters = {"create": 0, "dns": []}

    async def fake_create(name):
        counters["create"] += 1
        return (f"tunnel-{counters['create']}", "sekret")

    async def fake_get_token(tunnel_id):
        return f"token-{tunnel_id}"

    async def fake_set_config(tunnel_id, service_url):
        pass

    async def fake_dns(home_id, tunnel_id):
        counters["dns"].append((home_id, tunnel_id))
        return f"{home_id}.hubs.ziggy-home.com"

    monkeypatch.setattr(provmod, "_cf_create_tunnel", fake_create)
    monkeypatch.setattr(provmod, "_cf_get_token", fake_get_token)
    monkeypatch.setattr(provmod, "_cf_set_tunnel_config", fake_set_config)
    monkeypatch.setattr(provmod, "_cf_upsert_dns_route", fake_dns)

    app = FastAPI()
    app.include_router(provision_router, prefix="/api")
    c = TestClient(app)
    c.counters = counters
    return c


def _admin_headers():
    return {"Authorization": f"Bearer {issue_jwt('u-admin', 'founder@x.com', 'relay_admin', None)}"}


async def test_supplied_home_id_used_verbatim(client, db):
    supplied = "11111111-2222-3333-4444-555555555555"
    r = client.post(
        "/api/provision/hub",
        json={"home_name": "Imaged Home", "home_id": supplied, "owner_email": "a@b.com"},
        headers=_admin_headers(),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["home_id"] == supplied  # NOT home-xxxx
    assert body["reachable_url"] == f"https://{supplied}.hubs.ziggy-home.com"

    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT id, public_hostname, status, cf_tunnel_id FROM homes WHERE id=?",
            (supplied,),
        )
    row = dict(rows[0])
    assert row["id"] == supplied
    assert row["public_hostname"] == f"https://{supplied}.hubs.ziggy-home.com"
    assert row["status"] == "awaiting_claim"


async def test_reprovision_same_home_id_is_idempotent(client, db):
    supplied = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    r1 = client.post(
        "/api/provision/hub",
        json={"home_name": "Home", "home_id": supplied},
        headers=_admin_headers(),
    )
    assert r1.status_code == 200, r1.text
    b1 = r1.json()

    r2 = client.post(
        "/api/provision/hub",
        json={"home_name": "Home Renamed", "home_id": supplied},
        headers=_admin_headers(),
    )
    assert r2.status_code == 200, r2.text
    b2 = r2.json()

    # Only ONE tunnel ever created despite two provision calls.
    assert client.counters["create"] == 1
    # Same tunnel + secret reused across the re-provision.
    assert b1["tunnel_id"] == b2["tunnel_id"]
    assert b1["relay_secret"] == b2["relay_secret"]
    assert b2["home_id"] == supplied

    # Exactly one home row exists for this id.
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall("SELECT id FROM homes WHERE id=?", (supplied,))
    assert len(rows) == 1


async def test_no_home_id_mints_home_prefix(client, db):
    r = client.post(
        "/api/provision/hub",
        json={"home_name": "Legacy Bench"},
        headers=_admin_headers(),
    )
    assert r.status_code == 200, r.text
    assert r.json()["home_id"].startswith("home-")
