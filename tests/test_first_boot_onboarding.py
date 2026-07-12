"""First-boot onboarding — owner-claim, hardening, rate-limit, prefs.

Covers the LEAD BUILDER "beta-image-readiness" deliverables that make the
kit-out-of-box first-boot flow safe and complete:

  1. No-auth, device-bound, single-use, TTL-expiring first-boot claim mint
     that works pre-owner (services.first_boot + first_boot_router).
  2. The mint hard-refuses the moment an owner account exists, and the LAN
     /pair page flips to "already set up".
  3. The QR payload matches the mobile app's scanner contract
     (ziggy://pair?code=…&device_id=…&claim=true&host=…).
  4. The first phone to pair with a claim code creates the super_admin owner
     (/api/onboarding/claim) AND transitions the box out of the first-boot
     window (get_claim_qr → None afterwards); the device is bound to home_id.
  5. The no-auth mint endpoints are rate-limited (429 past the budget).
  6. Language/timezone captured during onboarding actually persist
     (onboarding_state ledger + config settings mirror) and are locked once
     an owner exists and the caller isn't an authenticated device.

All exercised through FastAPI TestClient — no hardware, no live HA.
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers.first_boot_router import router as first_boot_router, reset_rate_limits
from backend.routers.mobile_router import router as mobile_router
from backend.routers.onboarding_router import router as onboarding_router
from backend.routers.onboarding_sensors_router import router as onboarding_sensors_router
from backend.middleware.rate_limit import pair_limiter, pair_fail_limiter, claim_limiter
from services import first_boot, mobile_app, onboarding_state, auth_db


# A loopback peer models the real customer phone talking straight to the edge
# box over the LAN — this is what the first-boot LAN gate (is_lan_request)
# requires. Default TestClient uses a non-IP "testclient" host which the gate
# (correctly) treats as non-LAN, so every legitimate flow binds loopback here.
LAN_CLIENT = ("127.0.0.1", 50000)
# A public source IP models a party reaching the box through the tunnel/relay.
REMOTE_CLIENT = ("203.0.113.7", 44100)


HOME_ID = "home-test-001"


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # First-boot + device identity
    monkeypatch.setenv("ZIGGY_DEVICE_ID_PATH",          str(tmp_path / "device_id"))
    monkeypatch.setenv("ZIGGY_FALLBACK_DEVICE_ID_PATH", str(tmp_path / "fallback_id"))
    monkeypatch.setenv("ZIGGY_FIRST_BOOT_STATE_PATH",   str(tmp_path / "first_boot.json"))
    Path(tmp_path / "device_id").write_text("edge_test_box_001", encoding="utf-8")

    # Mobile pair-code + device stores
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")

    # Onboarding ledger
    monkeypatch.setattr(onboarding_state, "ONBOARDING_FILE", str(tmp_path / "onboarding.json"))

    # Isolated auth db (fresh schema per test)
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)

    # Isolated settings file (home.id + system section for mirror + home-binding)
    cfg = tmp_path / "settings.yaml"
    cfg.write_text(
        yaml.safe_dump({
            "home":   {"id": HOME_ID, "name": "Test", "type": "hub"},
            "system": {"language": "en", "timezone": "UTC"},
        }),
        encoding="utf-8",
    )
    monkeypatch.setenv("ZIGGY_CONFIG_PATH", str(cfg))

    reset_rate_limits()
    pair_limiter.reset()
    pair_fail_limiter.reset()
    claim_limiter.reset()
    yield


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(first_boot_router)
    app.include_router(mobile_router)
    app.include_router(onboarding_router)
    app.include_router(onboarding_sensors_router)
    # Bind a loopback peer so the LAN gate treats this like the real
    # on-network onboarding phone. Remote-origin behaviour is exercised
    # separately in tests/test_first_boot_security.py.
    return TestClient(app, client=LAN_CLIENT)


def _mint(client: TestClient) -> dict:
    """Fetch the first-boot claim QR JSON (no auth)."""
    resp = client.get("/api/onboarding/first-boot/qr.json")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _pair(client: TestClient, code: str) -> "tuple[int, dict]":
    resp = client.post("/api/mobile/pair", json={
        "pair_code": code,
        "device": {"platform": "android", "model": "Pixel", "app_version": "1.0"},
    })
    return resp.status_code, (resp.json() if resp.status_code == 200 else {})


# ── 1. No-auth mint pre-owner + QR contract ─────────────────────────────────

def test_mint_works_no_auth_pre_owner_and_qr_matches_parser(client: TestClient):
    body = _mint(client)                       # NO Authorization header
    assert len(body["code"]) == 6
    assert body["device_id"] == "edge_test_box_001"
    assert body["ttl_seconds"] > 0
    payload = body["qr_payload"]
    # Matches parsePairPayload / the mobile scanner contract exactly.
    assert payload.startswith("ziggy://pair?")
    assert f"code={body['code']}" in payload
    assert "device_id=edge_test_box_001" in payload
    assert "claim=true" in payload
    assert "host=" in payload


# ── 2. Single-use ───────────────────────────────────────────────────────────

def test_claim_code_is_single_use(client: TestClient):
    code = _mint(client)["code"]
    status1, resp1 = _pair(client, code)
    assert status1 == 200, resp1
    assert resp1["is_first_pair"] is True
    assert resp1["auth_token"]
    # Second redemption of the same code is rejected — it was consumed.
    status2, _ = _pair(client, code)
    assert status2 == 400


# ── 3. TTL expiry ───────────────────────────────────────────────────────────

def test_claim_code_ttl_expires(client: TestClient):
    # Mint a claim code that is already expired; consuming it must fail.
    res = mobile_app.create_claim_code("edge_test_box_001", ttl_seconds=-5)
    assert res["code"]
    assert mobile_app.consume_pair_code(res["code"]) is None
    # And the HTTP pair path 400s on the expired code too.
    status, _ = _pair(client, res["code"])
    assert status == 400


# ── 4. Hard-refuse once an owner exists ─────────────────────────────────────

def test_mint_refuses_once_owner_exists(client: TestClient):
    # Pre-owner: mint works.
    assert _mint(client)["code"]
    # An owner is created out-of-band (e.g. web /api/auth/setup).
    auth_db.create_user(username="alice", password_hash="x", salt="", role="super_admin", hash_algo="bcrypt")
    # Now the no-auth mint hard-refuses.
    assert first_boot.get_claim_qr() is None
    assert client.get("/api/onboarding/first-boot/qr.json").status_code == 404
    # LAN /pair page flips to the "already set up" state (no QR).
    page = client.get("/pair")
    assert page.status_code == 200
    assert "already set up" in page.text
    assert "<svg" not in page.text


# ── 5. First pair creates super_admin owner + closes first-boot window ───────

def test_first_pair_creates_owner_and_closes_window(client: TestClient):
    code = _mint(client)["code"]
    status, pair_resp = _pair(client, code)
    assert status == 200 and pair_resp["is_first_pair"] is True
    device_token = pair_resp["auth_token"]

    # Claim ownership with the just-issued device token.
    claim = client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {device_token}"},
        json={"username": "owner", "password": "hunter2"},
    )
    assert claim.status_code == 200, claim.text
    body = claim.json()
    assert body["role"] == "super_admin"
    assert body["device_bound"] is True
    assert body["user_token"]

    # Owner really exists with super_admin role.
    assert auth_db.has_any_user() is True
    row = auth_db.get_user_by_username("owner")
    assert row is not None and row["role"] == "super_admin"

    # First-boot window is now closed (transitioned out).
    assert first_boot.is_first_boot() is False
    assert first_boot.get_claim_qr() is None
    assert client.get("/api/onboarding/first-boot/qr.json").status_code == 404

    # The device is bound to this hub's home_id.
    dev = mobile_app.find_device_by_token(device_token)
    assert dev is not None
    assert dev["claim_pending"] is False
    assert dev["user_id"] == "owner"
    assert dev["home_id"] == HOME_ID

    # A second, later claim attempt is refused (only the first owner is minted
    # via this no-auth path). H1: even a raw, still-valid claim code is now
    # rejected at the PAIR step with 409 once an owner exists — it never gets
    # to create a second claim-pending device.
    code2 = mobile_app.create_claim_code("edge_test_box_001")["code"]
    status2, _pair2 = _pair(client, code2)
    assert status2 == 409


# ── 6. Rate limiting ────────────────────────────────────────────────────────

def test_mint_endpoints_are_rate_limited(client: TestClient):
    from backend.routers import first_boot_router as fbr
    saw_429 = False
    for _ in range(fbr._RATE_MAX_PER_WINDOW + 5):
        r = client.get("/api/onboarding/first-boot/qr.json")
        if r.status_code == 429:
            saw_429 = True
            assert r.headers.get("Retry-After")
            break
    assert saw_429, "expected a 429 after exceeding the per-window budget"


# ── 7. Language / timezone persistence ──────────────────────────────────────

def test_prefs_persist_pre_owner_and_mirror_to_settings(client: TestClient):
    # Pre-owner (first-boot window open) → no auth required.
    resp = client.post("/api/onboarding/prefs", json={"language": "he", "timezone": "Asia/Jerusalem"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["language"] == "he"
    assert body["timezone"] == "Asia/Jerusalem"
    assert body["settings_updated"] is True

    # Ledger persisted.
    state = onboarding_state.load_state()
    assert state["language"] == "he"
    assert state["timezone"] == "Asia/Jerusalem"

    # Mirrored into config settings (system.*).
    from core.settings_loader import load_settings
    s = load_settings()
    assert s["system"]["timezone"] == "Asia/Jerusalem"
    assert s["system"]["language"] == "he"

    # Exposed via GET /state.
    st = client.get("/api/onboarding/state").json()
    assert st["language"] == "he"
    assert st["timezone"] == "Asia/Jerusalem"
    assert st["first_boot"] is True


def test_prefs_partial_update_keeps_other_field(client: TestClient):
    client.post("/api/onboarding/prefs", json={"language": "he"})
    client.post("/api/onboarding/prefs", json={"timezone": "Asia/Jerusalem"})
    state = onboarding_state.load_state()
    assert state["language"] == "he"          # not clobbered by the tz-only call
    assert state["timezone"] == "Asia/Jerusalem"


def test_prefs_locked_after_owner_without_device_token(client: TestClient):
    auth_db.create_user(username="alice", password_hash="x", salt="", role="super_admin", hash_algo="bcrypt")
    # Owner exists + no device token → first-boot window closed → 403.
    resp = client.post("/api/onboarding/prefs", json={"timezone": "Asia/Jerusalem"})
    assert resp.status_code == 403


def test_prefs_allowed_for_paired_device_after_owner(client: TestClient):
    # Set up an owner + a paired (bound) device, then prove a device token
    # still unlocks the prefs write even though the first-boot window closed.
    code = _mint(client)["code"]
    _, pair_resp = _pair(client, code)
    token = pair_resp["auth_token"]
    client.post(
        "/api/onboarding/claim",
        headers={"Authorization": f"Bearer {token}"},
        json={"username": "owner", "password": "hunter2"},
    )
    assert first_boot.is_first_boot() is False
    resp = client.post(
        "/api/onboarding/prefs",
        headers={"Authorization": f"Bearer {token}"},
        json={"language": "en", "timezone": "Asia/Jerusalem"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["timezone"] == "Asia/Jerusalem"


# ── 8. Server import sanity (parent will add the include line) ───────────────

def test_backend_server_imports():
    import backend.server  # noqa: F401  — must import cleanly on this branch
    assert hasattr(backend.server, "app")
