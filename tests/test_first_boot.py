"""Tests for services/first_boot.py — Prompt 7 chunk 2.4.

Coverage:
  - get_device_id reads /etc/ziggy/device_id when present (via env override)
  - get_device_id falls back to user_files/device_id.txt
  - get_device_id mints + persists a UUIDv4 when neither file exists
  - is_first_boot is True before completion, False after
  - get_claim_qr lazy-mints + returns the {device_id, code, ...} dict
  - get_claim_qr is idempotent across calls (returns the same code)
  - get_claim_qr returns None after onboarding completion
  - mark_onboarding_complete is idempotent (timestamp doesn't move)
  - reset_first_boot wipes completion + claim metadata
  - snapshot returns the persisted state without mutation
  - state file healing: missing keys filled in, bad JSON reinitialises
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services import first_boot, mobile_app


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Each test sees a clean filesystem state for first_boot + mobile_app."""
    device_id_path  = tmp_path / "etc_ziggy_device_id"
    fallback_path   = tmp_path / "user_files" / "device_id.txt"
    state_path      = tmp_path / "user_files" / "first_boot.json"
    monkeypatch.setenv("ZIGGY_DEVICE_ID_PATH",          str(device_id_path))
    monkeypatch.setenv("ZIGGY_FALLBACK_DEVICE_ID_PATH", str(fallback_path))
    monkeypatch.setenv("ZIGGY_FIRST_BOOT_STATE_PATH",   str(state_path))
    # Isolate mobile_app's pair-code store too, since first_boot calls into it.
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    yield


# ── get_device_id ────────────────────────────────────────────────────────────

def test_get_device_id_reads_primary_path(tmp_path: Path):
    primary = Path(pytest.MonkeyPatch.__module__)  # noqa: F841 — unused, just to silence import linter
    p = Path(__import__("os").environ["ZIGGY_DEVICE_ID_PATH"])
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("factory-12345678", encoding="utf-8")
    assert first_boot.get_device_id() == "factory-12345678"


def test_get_device_id_reads_fallback_when_primary_missing():
    fb = Path(__import__("os").environ["ZIGGY_FALLBACK_DEVICE_ID_PATH"])
    fb.parent.mkdir(parents=True, exist_ok=True)
    fb.write_text("fallback-abcd", encoding="utf-8")
    assert first_boot.get_device_id() == "fallback-abcd"


def test_get_device_id_mints_uuid_when_neither_exists():
    val = first_boot.get_device_id()
    # UUID4 string form length is 36 ("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx")
    assert len(val) == 36
    # And the same value persists for the next call
    assert first_boot.get_device_id() == val


# ── is_first_boot lifecycle ──────────────────────────────────────────────────

def test_is_first_boot_true_initially():
    assert first_boot.is_first_boot() is True


def test_is_first_boot_false_after_mark_complete():
    first_boot.mark_onboarding_complete()
    assert first_boot.is_first_boot() is False


# ── get_claim_qr ─────────────────────────────────────────────────────────────

def test_get_claim_qr_mints_and_returns_dict():
    qr = first_boot.get_claim_qr()
    assert qr is not None
    assert qr["device_id"]
    assert len(qr["code"]) == 6
    assert qr["expires_at"]
    assert qr["ttl_seconds"] > 0


def test_get_claim_qr_is_idempotent_across_calls():
    a = first_boot.get_claim_qr()
    b = first_boot.get_claim_qr()
    assert a is not None and b is not None
    assert a["code"] == b["code"]
    assert a["device_id"] == b["device_id"]


def test_get_claim_qr_returns_none_after_completion():
    first_boot.get_claim_qr()                # mint once
    first_boot.mark_onboarding_complete()
    assert first_boot.get_claim_qr() is None


def test_get_claim_qr_records_mint_timestamp_only_on_first_mint():
    first_boot.get_claim_qr()
    s1 = first_boot.snapshot()
    minted_first = s1["claim_code_minted_at"]
    assert minted_first is not None

    first_boot.get_claim_qr()                # idempotent re-read
    s2 = first_boot.snapshot()
    assert s2["claim_code_minted_at"] == minted_first


# ── mark_onboarding_complete ─────────────────────────────────────────────────

def test_mark_onboarding_complete_is_idempotent():
    s1 = first_boot.mark_onboarding_complete()
    ts1 = s1["completed_at"]
    s2 = first_boot.mark_onboarding_complete()
    assert s2["completed_at"] == ts1


def test_mark_onboarding_complete_records_timestamp():
    s = first_boot.mark_onboarding_complete()
    assert s["completed_at"] is not None and s["completed_at"].endswith("+00:00")


# ── reset_first_boot ─────────────────────────────────────────────────────────

def test_reset_first_boot_wipes_completion_and_claim_metadata():
    first_boot.get_claim_qr()
    first_boot.mark_onboarding_complete()
    fresh = first_boot.reset_first_boot()
    assert fresh["completed_at"] is None
    assert fresh["claim_code"] is None
    assert fresh["claim_code_minted_at"] is None
    assert first_boot.is_first_boot() is True


def test_reset_first_boot_preserves_device_id():
    qr_before = first_boot.get_claim_qr()
    assert qr_before is not None
    fresh = first_boot.reset_first_boot()
    assert fresh["device_id"] == qr_before["device_id"]


# ── state-file healing ───────────────────────────────────────────────────────

def test_corrupt_state_file_is_reinitialised(tmp_path: Path):
    p = Path(__import__("os").environ["ZIGGY_FIRST_BOOT_STATE_PATH"])
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("{not valid json", encoding="utf-8")
    # is_first_boot should not raise; it returns True from a fresh skeleton.
    assert first_boot.is_first_boot() is True
    snap = first_boot.snapshot()
    assert snap["completed_at"] is None
    assert snap["device_id"]  # filled in by get_device_id during reinit


def test_partial_state_file_heals_missing_keys(tmp_path: Path):
    p = Path(__import__("os").environ["ZIGGY_FIRST_BOOT_STATE_PATH"])
    p.parent.mkdir(parents=True, exist_ok=True)
    # Pre-Prompt-7 schema — only device_id and first_boot_at.
    p.write_text(json.dumps({
        "device_id":     "legacy-123",
        "first_boot_at": "2026-01-01T00:00:00+00:00",
    }), encoding="utf-8")
    snap = first_boot.snapshot()
    assert snap["device_id"] == "legacy-123"
    assert snap["completed_at"] is None        # healed
    assert snap["claim_code"]   is None        # healed


# ── snapshot ─────────────────────────────────────────────────────────────────

def test_snapshot_has_no_side_effects():
    s1 = first_boot.snapshot()
    s2 = first_boot.snapshot()
    assert s1 == s2
