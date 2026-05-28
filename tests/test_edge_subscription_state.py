"""Tests for services/subscription_state.py — the edge cache + gate helpers.

Covers:
  update_from_manifest()
    happy path → cache file written with the fields from the manifest
    missing fields in manifest → no-op (no file written)
    cache write error → no raise (best-effort)

  cached_state()
    returns dict on present file
    returns None on missing file

  is_cloud_llm_allowed() truth table
  is_backup_allowed()    truth table
  (the asymmetry on stale-cache is load-bearing per audit §2.5)
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from services import subscription_state as ss


def _make_manifest(state: str, expires_in_hours: float = 24) -> dict:
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=expires_in_hours)).isoformat()
    return {
        "schema_version": 2,
        "subscription_state": state,
        "subscription_state_expires_at": expires_at,
    }


# ---------- update_from_manifest ----------

def test_update_writes_cache_file(tmp_path):
    cache = tmp_path / "subscription_state.json"
    ss.update_from_manifest(_make_manifest("active"), path=cache)
    data = json.loads(cache.read_text())
    assert data["subscription_state"] == "active"
    assert data["expires_at"]
    assert data["fetched_at"]


def test_update_skips_when_fields_missing(tmp_path):
    cache = tmp_path / "subscription_state.json"
    # schema-1 manifest from a not-yet-upgraded relay
    ss.update_from_manifest({"schema_version": 1, "release_id": 1}, path=cache)
    assert not cache.exists()


def test_update_skips_when_partial_fields(tmp_path):
    cache = tmp_path / "subscription_state.json"
    # state but no expires_at
    ss.update_from_manifest(
        {"subscription_state": "active"}, path=cache,
    )
    assert not cache.exists()


# ---------- cached_state ----------

def test_cached_state_present(tmp_path):
    cache = tmp_path / "subscription_state.json"
    ss.update_from_manifest(_make_manifest("trialing"), path=cache)
    got = ss.cached_state(path=cache)
    assert got["subscription_state"] == "trialing"


def test_cached_state_missing(tmp_path):
    cache = tmp_path / "subscription_state.json"
    assert ss.cached_state(path=cache) is None


def test_cached_state_malformed(tmp_path):
    cache = tmp_path / "subscription_state.json"
    cache.write_text("not-json")
    assert ss.cached_state(path=cache) is None


# ---------- gate matrix ----------

@pytest.mark.parametrize("state, expected_cloud, expected_backup", [
    # Fresh cache, allowed states
    ("active",        True,  True),
    ("trialing",      True,  True),
    # Fresh cache, denied states
    ("past_due",      False, False),
    ("cancelled",     False, False),
    ("refunded",      False, False),
    ("pending_setup", False, False),
])
def test_gate_matrix_fresh_cache(tmp_path, state, expected_cloud, expected_backup):
    cache = tmp_path / "subscription_state.json"
    ss.update_from_manifest(_make_manifest(state), path=cache)
    assert ss.is_cloud_llm_allowed(path=cache) is expected_cloud
    assert ss.is_backup_allowed(path=cache) is expected_backup


def test_gate_missing_cache_allows_both(tmp_path):
    cache = tmp_path / "subscription_state.json"
    # backward-compat with relay-side DEFAULT 'active'
    assert ss.is_cloud_llm_allowed(path=cache) is True
    assert ss.is_backup_allowed(path=cache) is True


def test_gate_stale_cache_denies_cloud_allows_backup(tmp_path):
    """The load-bearing asymmetry per audit §2.5."""
    cache = tmp_path / "subscription_state.json"
    # Cache fetched but expires_at is in the past
    ss.update_from_manifest(_make_manifest("active", expires_in_hours=-1), path=cache)
    assert ss.is_cloud_llm_allowed(path=cache) is False  # conservative
    assert ss.is_backup_allowed(path=cache) is True       # permissive


def test_gate_stale_cache_with_inactive_state(tmp_path):
    """Stale cache permissive for backup overrides the otherwise-denied state.

    Rationale: if the relay is unreachable for >24h AND the last value we
    saw was already 'cancelled', the backup gate's permissive-on-stale
    rule still applies. The data must survive even when state freshness
    is uncertain.
    """
    cache = tmp_path / "subscription_state.json"
    ss.update_from_manifest(_make_manifest("cancelled", expires_in_hours=-1), path=cache)
    assert ss.is_cloud_llm_allowed(path=cache) is False
    assert ss.is_backup_allowed(path=cache) is True


def test_gate_active_states_constant_consistency():
    """The edge mirror of relay's ACTIVE_SUBSCRIPTION_STATES must hold the
    same set or the kill-switch will diverge silently."""
    assert ss.ACTIVE_STATES == frozenset({"trialing", "active"})
