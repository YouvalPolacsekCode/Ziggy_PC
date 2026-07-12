"""Tests for the is_first_pair flag in /api/mobile/pair — Prompt 7 chunk 2.5.

Coverage:
  - Claim-tier code → is_first_pair=True; device record carries
    claim_pending=True, claim_device_id=<edge box id>, user_id=None.
  - User-tier code → is_first_pair=False; device record bound to user.
  - Audit event mobile_pair_succeeded carries kind + is_first_pair fields.
  - PairResponse JSON shape: is_first_pair always present (Pydantic default).
  - Legacy code records without an explicit `kind` default to user-tier
    (forward-compat already covered in mobile_app tests, re-verified here
    at the router boundary).
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.debug_bus import bus, BASIC, OFF
from backend.routers import mobile_router as mr
from services import mobile_app


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    bus.set_level(BASIC)
    bus.set_scopes([])
    bus._buffer.clear()
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")

    class _NoopWS:
        def is_connected(self, device_id): return False
        async def send_to_device(self, *_a, **_k): return False
    monkeypatch.setattr(mr, "mobile_ws", _NoopWS())
    yield
    bus.set_level(OFF)
    bus._buffer.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(mr.router)
    # The claim-tier /pair branch is LAN-gated (require_lan); bind a loopback
    # peer so this fixture models the real on-network onboarding phone.
    return TestClient(app, client=("127.0.0.1", 50000))


def _events(step: str) -> list[dict]:
    return [e for e in list(bus._buffer) if e.get("step") == step]


# ── Claim-tier pair flow ─────────────────────────────────────────────────────

def test_claim_tier_pair_sets_is_first_pair_true(client):
    claim = mobile_app.create_claim_code("edge_box_001")
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": claim["code"], "device": {"platform": "ios"}},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_first_pair"] is True
    assert body["device_id"]
    assert body["auth_token"].startswith("zgy_mb_")


def test_claim_tier_pair_creates_claim_pending_record(client):
    claim = mobile_app.create_claim_code("edge_box_001")
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": claim["code"], "device": {"platform": "android"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    record = mobile_app.find_device_by_token(body["auth_token"])
    assert record is not None
    assert record["user_id"] is None
    assert record["claim_pending"] is True
    assert record["claim_device_id"] == "edge_box_001"


def test_claim_tier_pair_emits_audit_with_kind_and_first_pair(client):
    claim = mobile_app.create_claim_code("edge_box_001")
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": claim["code"], "device": {"platform": "ios"}},
    )
    assert resp.status_code == 200
    matched = _events("mobile_pair_succeeded")
    assert len(matched) == 1
    d = matched[0]["data"]
    assert d["kind"] == "claim"
    assert d["is_first_pair"] is True
    assert d["user_id"] is None
    assert d["device_id"]


# ── User-tier pair flow ──────────────────────────────────────────────────────

def test_user_tier_pair_sets_is_first_pair_false(client):
    code = mobile_app.create_pair_code("alice@example.com")
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": code["code"], "device": {"platform": "android"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_first_pair"] is False


def test_user_tier_pair_creates_bound_record(client):
    code = mobile_app.create_pair_code("alice@example.com")
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": code["code"], "device": {"platform": "ios"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    record = mobile_app.find_device_by_token(body["auth_token"])
    assert record is not None
    assert record["user_id"] == "alice@example.com"
    assert record["claim_pending"] is False


def test_user_tier_pair_emits_audit_with_kind_user(client):
    code = mobile_app.create_pair_code("alice@example.com")
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": code["code"], "device": {"platform": "ios"}},
    )
    assert resp.status_code == 200
    matched = _events("mobile_pair_succeeded")
    assert len(matched) == 1
    d = matched[0]["data"]
    assert d["kind"] == "user"
    assert d["is_first_pair"] is False
    assert d["user_id"] == "alice@example.com"


# ── Legacy forward-compat at the router boundary ─────────────────────────────

def test_legacy_code_record_without_kind_treated_as_user(client, tmp_path: Path):
    """A pair record persisted before the kind field was introduced still works
    and is treated as user-tier."""
    from datetime import datetime, timedelta, timezone
    legacy = {
        "code":       "LEGACY",
        "user_id":    "alice@example.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
    }
    mobile_app._save(mobile_app._PAIR_FILE, [legacy])  # type: ignore[attr-defined]
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": "LEGACY", "device": {"platform": "android"}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_first_pair"] is False


# ── Schema: is_first_pair always serialised ──────────────────────────────────

def test_pair_response_always_carries_is_first_pair_field(client):
    """Pydantic default ensures the key is in the JSON, even though older
    clients won't read it."""
    code = mobile_app.create_pair_code("alice")
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": code["code"], "device": {"platform": "ios"}},
    )
    body = resp.json()
    assert "is_first_pair" in body
