"""First-boot pairing/claim SECURITY hardening.

Proves the fixes for the adversarial-review findings on the no-auth first-boot
ownership path (see the beta-image-readiness security prompt):

  C1  owner creation is atomic + single-owner — concurrent/duplicate claims
      yield exactly ONE owner; the loser gets 409.
  C2  the no-auth first-boot endpoints (qr.json, /pair, POST /claim, and the
      kind=="claim" branch of POST /api/mobile/pair) are LAN-only — a request
      carrying relay/tunnel markers (X-Relay-* / X-Forwarded-For) or a public
      peer IP is 403'd, while a loopback/private peer succeeds.
  H1  a stale claim code is refused (409) at the pair step once an owner exists.
  H2  /api/mobile/pair and /api/onboarding/claim are rate-limited per peer IP,
      with a tighter lockout on repeated invalid pair codes.
  M1  the first claim-pending device closes the window — a second claim-pending
      device is refused and no new claim code is minted.
  L1  qr.json is unreachable and /api/onboarding/state hides the first_boot
      flag from non-LAN callers.

All through FastAPI TestClient — no hardware, no live HA.
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
from backend.middleware.rate_limit import (
    pair_limiter, pair_fail_limiter, claim_limiter,
    PAIR_RATE_MAX, PAIR_FAIL_MAX, CLAIM_RATE_MAX,
)
from services import first_boot, mobile_app, onboarding_state, auth_db
from services.auth_hashing import hash_password_bcrypt


HOME_ID = "home-sec-001"
LAN_CLIENT = ("127.0.0.1", 50000)          # real on-LAN onboarding phone
# A genuinely public peer. NB: Python 3.12's ipaddress.is_private treats the
# TEST-NET documentation ranges (e.g. 203.0.113.0/24) as private, so we use a
# real public address to model a party reaching the box off-LAN.
REMOTE_CLIENT = ("8.8.8.8", 44100)
# A private peer that nonetheless arrives WITH forwarding markers — models the
# relay/Cloudflare-Tunnel egress into the container (private docker address)
# carrying the headers a proxy inserts.
PRIVATE_PROXIED_CLIENT = ("10.1.2.3", 5000)


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ZIGGY_DEVICE_ID_PATH",          str(tmp_path / "device_id"))
    monkeypatch.setenv("ZIGGY_FALLBACK_DEVICE_ID_PATH", str(tmp_path / "fallback_id"))
    monkeypatch.setenv("ZIGGY_FIRST_BOOT_STATE_PATH",   str(tmp_path / "first_boot.json"))
    Path(tmp_path / "device_id").write_text("edge_sec_box_001", encoding="utf-8")

    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setattr(onboarding_state, "ONBOARDING_FILE", str(tmp_path / "onboarding.json"))

    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(auth_db, "_initialized", False)

    cfg = tmp_path / "settings.yaml"
    cfg.write_text(
        yaml.safe_dump({
            "home":   {"id": HOME_ID, "name": "Sec", "type": "hub"},
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


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(first_boot_router)
    app.include_router(mobile_router)
    app.include_router(onboarding_router)
    app.include_router(onboarding_sensors_router)
    return app


@pytest.fixture
def lan() -> TestClient:
    return TestClient(_app(), client=LAN_CLIENT)


@pytest.fixture
def remote() -> TestClient:
    return TestClient(_app(), client=REMOTE_CLIENT)


def _pair(client: TestClient, code: str, headers: dict | None = None):
    resp = client.post("/api/mobile/pair", json={
        "pair_code": code,
        "device": {"platform": "android", "model": "Pixel", "app_version": "1.0"},
    }, headers=headers or {})
    return resp.status_code, (resp.json() if resp.status_code == 200 else {})


def _mint_lan(client: TestClient) -> dict:
    resp = client.get("/api/onboarding/first-boot/qr.json")
    assert resp.status_code == 200, resp.text
    return resp.json()


# ── C1 — atomic single-owner ────────────────────────────────────────────────

def test_create_first_owner_is_single_owner_atomic():
    """The SQL primitive: the first insert wins, every subsequent call returns
    None (zero rows) — never a second owner row."""
    first = auth_db.create_first_owner("alice", hash_password_bcrypt("pw1"), salt="", role="super_admin")
    assert isinstance(first, int)
    # A concurrent/duplicate call with a DIFFERENT username inserts nothing.
    second = auth_db.create_first_owner("mallory", hash_password_bcrypt("pw2"), salt="", role="super_admin")
    assert second is None
    # Exactly one user row exists, and it's alice.
    users = auth_db.list_users()
    assert len(users) == 1
    assert users[0]["username"] == "alice"
    assert users[0]["role"] == "super_admin"


def test_duplicate_claim_yields_exactly_one_owner(lan: TestClient):
    """End-to-end: two claim-pending devices, two /claim calls with different
    usernames → the first mints super_admin, the second gets 409 and no second
    owner is created."""
    # First phone pairs + claims.
    code = _mint_lan(lan)["code"]
    status, pair_resp = _pair(lan, code)
    assert status == 200
    tok1 = pair_resp["auth_token"]

    # Manufacture a SECOND claim-pending device directly (simulates the C1 race
    # where a second device already holds a claim-pending token — the M1 pair
    # gate would normally stop it, but C1 must hold even if one slips through).
    dev2 = mobile_app.register_device(
        user_id=None,
        device_info={"platform": "ios", "model": "iPhone"},
        claim_pending=True,
        claim_device_id="edge_sec_box_001",
    )
    tok2 = dev2["auth_token"]

    r1 = lan.post("/api/onboarding/claim",
                  headers={"Authorization": f"Bearer {tok1}"},
                  json={"username": "owner", "password": "hunter2"})
    r2 = lan.post("/api/onboarding/claim",
                  headers={"Authorization": f"Bearer {tok2}"},
                  json={"username": "intruder", "password": "hunter2"})
    codes = sorted([r1.status_code, r2.status_code])
    assert codes == [200, 409], (r1.status_code, r1.text, r2.status_code, r2.text)

    # Exactly ONE owner, super_admin.
    users = auth_db.list_users()
    assert len(users) == 1
    assert users[0]["role"] == "super_admin"


# ── C2 — LAN gate on the no-auth first-boot endpoints ───────────────────────

def test_qr_json_blocked_for_remote_peer(remote: TestClient):
    assert remote.get("/api/onboarding/first-boot/qr.json").status_code == 403


def test_qr_json_blocked_when_forwarding_markers_present(lan: TestClient):
    # Private peer BUT relay/tunnel forwarding markers present → not LAN.
    assert lan.get("/api/onboarding/first-boot/qr.json",
                   headers={"X-Forwarded-For": "203.0.113.7"}).status_code == 403
    assert lan.get("/api/onboarding/first-boot/qr.json",
                   headers={"X-Relay-Secret": "whatever"}).status_code == 403


def test_pair_page_blocked_for_remote_peer(remote: TestClient):
    assert remote.get("/pair").status_code == 403


def test_pair_page_succeeds_on_lan(lan: TestClient):
    page = lan.get("/pair")
    assert page.status_code == 200
    assert "<svg" in page.text  # the QR renders on a fresh LAN box


def test_pair_claim_branch_blocked_for_remote_peer(lan: TestClient, remote: TestClient):
    # Mint on the LAN (only way to get a code), then try to redeem it remotely.
    code = _mint_lan(lan)["code"]
    status, _ = _pair(remote, code)
    assert status == 403


def test_pair_claim_branch_blocked_when_proxied(lan: TestClient):
    code = _mint_lan(lan)["code"]
    # Private peer but with a forwarding header → treated as remote.
    proxied = TestClient(_app(), client=PRIVATE_PROXIED_CLIENT)
    status, _ = _pair(proxied, code, headers={"X-Forwarded-For": "203.0.113.7"})
    assert status == 403


def test_claim_endpoint_blocked_for_remote_peer(lan: TestClient, remote: TestClient):
    # Pair on the LAN to obtain a valid device token, then attempt /claim from
    # a remote peer using that token → 403 (LAN gate precedes any owner logic).
    code = _mint_lan(lan)["code"]
    _, pair_resp = _pair(lan, code)
    tok = pair_resp["auth_token"]
    r = remote.post("/api/onboarding/claim",
                    headers={"Authorization": f"Bearer {tok}"},
                    json={"username": "owner", "password": "hunter2"})
    assert r.status_code == 403
    assert auth_db.has_any_user() is False  # nothing created


def test_full_lan_flow_still_succeeds(lan: TestClient):
    code = _mint_lan(lan)["code"]
    status, pair_resp = _pair(lan, code)
    assert status == 200 and pair_resp["is_first_pair"] is True
    r = lan.post("/api/onboarding/claim",
                 headers={"Authorization": f"Bearer {pair_resp['auth_token']}"},
                 json={"username": "owner", "password": "hunter2"})
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "super_admin"


# ── H1 — stale claim code refused once owned ────────────────────────────────

def test_stale_claim_code_refused_once_owner_exists(lan: TestClient):
    # An owner already exists (e.g. created via /api/auth/setup).
    auth_db.create_first_owner("alice", hash_password_bcrypt("pw"), salt="", role="super_admin")
    # A claim code minted out-of-band is still within its 30-day TTL...
    code = mobile_app.create_claim_code("edge_sec_box_001")["code"]
    # ...but redeeming it now fails with 409 at the pair step (not 200).
    status, _ = _pair(lan, code)
    assert status == 409
    # No claim-pending device was created.
    assert mobile_app.has_claim_pending_device() is False


# ── H2 — rate limits on the ownership-gating endpoints ──────────────────────

def test_pair_endpoint_rate_limited(lan: TestClient):
    # Fire valid-shape (but unknown) codes; the tighter pair_fail_limiter trips
    # first on repeated invalid attempts.
    saw_429 = False
    for _ in range(PAIR_RATE_MAX + PAIR_FAIL_MAX + 5):
        status, _ = _pair(lan, "ZZZZZZ")
        if status == 429:
            saw_429 = True
            break
    assert saw_429, "expected a 429 from repeated pair attempts"


def test_pair_fail_lockout_is_tighter_than_generic_budget(lan: TestClient):
    # Exactly PAIR_FAIL_MAX invalid attempts are tolerated (400), the next is
    # a 429 lockout — proving the invalid-code lockout is tighter.
    for _ in range(PAIR_FAIL_MAX):
        status, _ = _pair(lan, "ZZZZZZ")
        assert status == 400
    status, _ = _pair(lan, "ZZZZZZ")
    assert status == 429


def test_claim_endpoint_rate_limited(lan: TestClient):
    # Pair once to get a real device token, then hammer /claim. First call
    # succeeds (creates owner); subsequent calls 409, but the limiter trips at
    # CLAIM_RATE_MAX regardless of body outcome.
    code = _mint_lan(lan)["code"]
    _, pair_resp = _pair(lan, code)
    tok = pair_resp["auth_token"]
    statuses = []
    for _ in range(CLAIM_RATE_MAX + 3):
        r = lan.post("/api/onboarding/claim",
                     headers={"Authorization": f"Bearer {tok}"},
                     json={"username": "owner", "password": "hunter2"})
        statuses.append(r.status_code)
    assert 429 in statuses, statuses


# ── M1 — first claim-pending device closes the window ───────────────────────

def test_first_claim_pending_device_stops_new_mint(lan: TestClient):
    code = _mint_lan(lan)["code"]
    status, _ = _pair(lan, code)
    assert status == 200
    # A claim-pending device now exists → no NEW claim code is minted and
    # qr.json 404s (window closed), even though no owner exists yet.
    assert first_boot.get_claim_qr() is None
    assert auth_db.has_any_user() is False
    assert lan.get("/api/onboarding/first-boot/qr.json").status_code == 404


def test_second_claim_pending_device_refused(lan: TestClient):
    code1 = _mint_lan(lan)["code"]
    assert _pair(lan, code1)[0] == 200
    # Force a second valid claim code and try to redeem it → 409 (a claim is
    # already in progress), so no second claim-pending device is created.
    code2 = mobile_app.create_claim_code("edge_sec_box_001")["code"]
    status, _ = _pair(lan, code2)
    assert status == 409
    pending = [d for d in mobile_app.list_all_devices() if d.get("claim_pending")]
    assert len(pending) == 1


def test_window_reopens_after_claim_pending_device_revoked(lan: TestClient):
    code = _mint_lan(lan)["code"]
    _, pair_resp = _pair(lan, code)
    assert first_boot.get_claim_qr() is None      # closed while pending
    mobile_app.delete_device(pair_resp["device_id"])
    # Self-healing: with the pending device gone (and still no owner), minting
    # resumes so an abandoned pair doesn't permanently brick onboarding.
    assert first_boot.get_claim_qr() is not None


# ── L1 — recon leak folded into the LAN gate ────────────────────────────────

def test_state_hides_first_boot_from_remote(lan: TestClient, remote: TestClient):
    # Fresh box, no owner: LAN caller sees first_boot=True...
    assert lan.get("/api/onboarding/state").json()["first_boot"] is True
    # ...remote caller is told False (no unclaimed-hub recon).
    assert remote.get("/api/onboarding/state").json()["first_boot"] is False


def test_state_first_boot_false_when_proxied(lan: TestClient):
    body = lan.get("/api/onboarding/state",
                   headers={"X-Forwarded-For": "203.0.113.7"}).json()
    assert body["first_boot"] is False
