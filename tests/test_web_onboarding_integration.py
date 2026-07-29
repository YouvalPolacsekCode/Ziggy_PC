"""End-to-end web-onboarding chain on a fresh (owner-less) hub.

Drives the real HTTP endpoints the browser wizard calls, in order, against an
empty auth.db — no mocks on the auth seam itself:

  status(configured=False) → /api/auth/setup → sensors → sensors/confirm
  → starter-pack → complete → status(configured=True)

This is the fresh-DB validation the design calls for (real-hardware E2E rides
on the next hub build). HA and telemetry are stubbed since they're not part of
the seam under test.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import auth_router
from backend.routers import onboarding_sensors_router as osr
from services import auth_db, mobile_app


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setenv("ZIGGY_KIT_MANIFEST_PATH", str(tmp_path / "kit.yaml"))
    monkeypatch.setenv("ZIGGY_FIRST_BOOT_STATE_PATH", str(tmp_path / "first_boot.json"))
    # Legacy settings.yaml users[] must be empty so /status reports unconfigured.
    from core.settings_loader import settings
    monkeypatch.setitem(settings, "users", [])
    # HA registry → reachable but empty (no sensors/starters to resolve).
    async def _fake_snap(*_a, **_k):
        return {"devices": [], "areas": [], "entities": []}
    monkeypatch.setattr(osr.ha_areas, "get_registry_snapshot", _fake_snap)
    # Telemetry post is fire-and-forget; keep it off the network.
    monkeypatch.setattr(osr.telemetry_client, "post_once",
                        lambda *a, **k: {"ok": False, "reason": "test"})
    yield


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(auth_router.router)
    app.include_router(osr.router)
    # Loopback peer — harmless here (none of these routes are LAN-gated).
    return TestClient(app, client=("127.0.0.1", 50000))


def test_fresh_home_web_onboarding_chain(client: TestClient):
    # 1. Fresh home reports no owner.
    r = client.get("/api/auth/status")
    assert r.status_code == 200 and r.json()["configured"] is False

    # 2. Create the owner (what WebSetupStep does).
    r = client.post("/api/auth/setup", json={"username": "owner", "password": "secret123"})
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    assert token and r.json()["role"] == "super_admin"
    auth = {"Authorization": f"Bearer {token}"}

    # 3. Sensor-naming step reads the list with the SESSION token.
    r = client.get("/api/onboarding/sensors", headers=auth)
    assert r.status_code == 200 and r.json()["ha_reachable"] is True

    # 4. Confirm sensors (empty batch is a valid no-op) — proves the owner
    #    session passes the "Device not claimed" gate.
    r = client.post("/api/onboarding/sensors/confirm", headers=auth, json={"sensors": []})
    assert r.status_code == 200 and r.json()["confirmed"] == 0

    # 5. Starter pack resolves (empty against an empty kit).
    r = client.get("/api/onboarding/starter-pack", headers=auth)
    assert r.status_code == 200 and r.json()["starters"] == []

    # 6. Complete the wizard.
    r = client.post("/api/onboarding/complete", headers=auth,
                    json={"time_elapsed_seconds": 12, "sensors_confirmed_count": 0,
                          "automations_accepted_count": 0, "errors": []})
    assert r.status_code == 200 and r.json()["first_boot_done"] is True

    # 7. Home is now configured — the gate would show LoginPage from here.
    r = client.get("/api/auth/status")
    assert r.status_code == 200 and r.json()["configured"] is True


def test_onboarding_endpoints_reject_no_token_on_fresh_home(client: TestClient):
    # Before any owner exists, the onboarding steps still require auth — a
    # random browser hitting the tunnel URL can't read/write onboarding state.
    assert client.get("/api/onboarding/sensors").status_code == 401
    assert client.get("/api/onboarding/starter-pack").status_code == 401
    assert client.post("/api/onboarding/sensors/confirm", json={"sensors": []}).status_code == 401
