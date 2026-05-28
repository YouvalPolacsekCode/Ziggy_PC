"""Tests for the claim-tier additions to services/mobile_app.py — Prompt 7 chunk 2.3.

Coverage:
  - create_claim_code mints a 6-char code with the right TTL and persists it
  - create_claim_code is idempotent per device_id (returns the same code)
  - create_claim_code rejects empty / whitespace device_id
  - consume_pair_code distinguishes user-tier from claim-tier
  - consume_pair_code defaults a missing `kind` field to "user" (forward-compat)
  - register_device accepts claim_pending=True with user_id=None
  - register_device rejects user_id=None when claim_pending=False
  - bind_claim_pending_device flips claim_pending → False and sets user_id
  - bind_claim_pending_device returns False for unknown or already-bound records
  - existing create_pair_code path still works (no regression)
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services import mobile_app


# ── Isolation: each test gets its own _PAIR_FILE + _DEVICES_FILE ─────────────

@pytest.fixture(autouse=True)
def _isolated_storage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    yield


# ── create_claim_code ────────────────────────────────────────────────────────

def test_create_claim_code_mints_with_default_ttl():
    res = mobile_app.create_claim_code("dev_abc123")
    assert len(res["code"]) == 6
    assert res["device_id"] == "dev_abc123"
    assert res["kind"] == "claim"
    assert res["reused"] is False
    # Default TTL ~30 days; allow a small clock-tick slack
    assert res["ttl_seconds"] == 30 * 24 * 60 * 60


def test_create_claim_code_respects_custom_ttl():
    res = mobile_app.create_claim_code("dev_abc123", ttl_seconds=3600)
    assert res["ttl_seconds"] == 3600


def test_create_claim_code_is_idempotent_per_device():
    a = mobile_app.create_claim_code("dev_idem")
    b = mobile_app.create_claim_code("dev_idem")
    assert a["code"] == b["code"]
    assert b["reused"] is True


def test_create_claim_code_different_devices_get_different_codes():
    a = mobile_app.create_claim_code("dev_one")
    b = mobile_app.create_claim_code("dev_two")
    assert a["code"] != b["code"]


def test_create_claim_code_rejects_empty_device_id():
    with pytest.raises(ValueError):
        mobile_app.create_claim_code("")
    with pytest.raises(ValueError):
        mobile_app.create_claim_code("   ")


# ── consume_pair_code routing ────────────────────────────────────────────────

def test_consume_pair_code_returns_claim_tier_match():
    res = mobile_app.create_claim_code("dev_one")
    match = mobile_app.consume_pair_code(res["code"])
    assert match is not None
    assert match["kind"] == "claim"
    assert match["device_id"] == "dev_one"
    assert "user_id" not in match


def test_consume_pair_code_returns_user_tier_match():
    res = mobile_app.create_pair_code("alice@example.com")
    match = mobile_app.consume_pair_code(res["code"])
    assert match is not None
    assert match["kind"] == "user"
    assert match["user_id"] == "alice@example.com"


def test_consume_pair_code_legacy_record_without_kind_defaults_to_user(tmp_path: Path):
    # Simulate a pre-Prompt-7 record in _PAIR_FILE that has no `kind` key.
    legacy = {
        "code":       "LEGACY",
        "user_id":    "alice@example.com",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
    }
    mobile_app._save(mobile_app._PAIR_FILE, [legacy])  # type: ignore[attr-defined]
    match = mobile_app.consume_pair_code("LEGACY")
    assert match is not None
    assert match["kind"] == "user"
    assert match["user_id"] == "alice@example.com"


def test_consume_pair_code_removes_only_the_redeemed_code():
    claim = mobile_app.create_claim_code("dev_one")
    user  = mobile_app.create_pair_code("alice")
    mobile_app.consume_pair_code(claim["code"])
    # User-tier code is still consumable
    again = mobile_app.consume_pair_code(user["code"])
    assert again is not None
    # Claim code is now gone
    assert mobile_app.consume_pair_code(claim["code"]) is None


# ── register_device + bind_claim_pending_device ──────────────────────────────

def test_register_device_claim_pending_allows_no_user_id():
    rec = mobile_app.register_device(
        user_id=None,
        device_info={"platform": "ios", "model": "iPhone 15"},
        claim_pending=True,
        claim_device_id="dev_box",
    )
    assert rec["user_id"] is None
    assert rec["claim_pending"] is True
    assert rec["claim_device_id"] == "dev_box"
    assert rec["auth_token"].startswith("zgy_mb_")


def test_register_device_rejects_no_user_id_when_not_claim_pending():
    with pytest.raises(ValueError):
        mobile_app.register_device(
            user_id=None,
            device_info={"platform": "ios"},
        )


def test_register_device_normal_mode_unchanged():
    rec = mobile_app.register_device(
        user_id="alice@example.com",
        device_info={"platform": "android", "model": "Pixel 8"},
    )
    assert rec["user_id"] == "alice@example.com"
    assert rec["claim_pending"] is False
    assert rec["claim_device_id"] is None


def test_bind_claim_pending_device_binds_to_owner():
    rec = mobile_app.register_device(
        user_id=None,
        device_info={"platform": "ios"},
        claim_pending=True,
        claim_device_id="dev_box",
    )
    ok = mobile_app.bind_claim_pending_device(rec["device_id"], user_id="alice")
    assert ok is True
    # Verify the persisted record
    fetched = mobile_app.find_device_by_token(rec["auth_token"])
    assert fetched is not None
    assert fetched["user_id"] == "alice"
    assert fetched["claim_pending"] is False


def test_bind_claim_pending_device_returns_false_for_unknown_device():
    ok = mobile_app.bind_claim_pending_device("dev_does_not_exist", user_id="alice")
    assert ok is False


def test_bind_claim_pending_device_returns_false_when_already_bound():
    rec = mobile_app.register_device(
        user_id="alice",
        device_info={"platform": "ios"},
    )
    ok = mobile_app.bind_claim_pending_device(rec["device_id"], user_id="bob")
    assert ok is False
    # Original binding untouched
    fetched = mobile_app.find_device_by_token(rec["auth_token"])
    assert fetched is not None
    assert fetched["user_id"] == "alice"


def test_bind_claim_pending_device_rejects_empty_user_id():
    with pytest.raises(ValueError):
        mobile_app.bind_claim_pending_device("dev_anything", user_id="")
