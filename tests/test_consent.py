"""Tests for services/consent.py + backend/routers/consent_router.py.

Covers:
  - default-deny for every known feature
  - set → get round-trip + persistence to disk
  - require() raises ConsentRequired when not granted, passes when granted
  - unknown feature handling (service + router 404)
  - history tail is recorded + bounded
  - router read/record/check endpoints
  - owner-gating: a plain user cannot record a decision (403)
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import consent
from backend.routers.consent_router import router as consent_router
from backend.routers.auth_deps import get_current_user


@pytest.fixture(autouse=True)
def _tmp_store(tmp_path: Path):
    """Point the consent store at a throwaway file for every test."""
    store = tmp_path / "consent.json"
    consent.set_store_path(store)
    yield store
    consent.set_store_path(consent._DEFAULT_STORE)


# --------------------------------------------------------------------------
# service: default-deny + round-trip
# --------------------------------------------------------------------------

def test_default_deny_all_features():
    for f in consent.FEATURES:
        assert consent.get(f) is False
        assert consent.is_allowed(f) is False


def test_set_then_get_roundtrip(_tmp_store):
    rec = consent.set(consent.VOICE_TRANSCRIPT, True, source="app", actor="owner@ziggy")
    assert rec["granted"] is True
    assert rec["source"] == "app"
    assert rec["actor"] == "owner@ziggy"
    assert consent.get(consent.VOICE_TRANSCRIPT) is True
    # Persisted to disk
    on_disk = json.loads(_tmp_store.read_text())
    assert on_disk[consent.VOICE_TRANSCRIPT]["granted"] is True


def test_persistence_survives_reload(_tmp_store):
    consent.set(consent.SUPPORT_TUNNEL, True, source="web")
    # Simulate a fresh process by re-pointing at the same file.
    consent.set_store_path(_tmp_store)
    assert consent.get(consent.SUPPORT_TUNNEL) is True


def test_toggle_off_records_previous():
    consent.set(consent.BACKGROUND_LOCATION, True, source="app")
    rec = consent.set(consent.BACKGROUND_LOCATION, False, source="app")
    assert rec["granted"] is False
    assert rec["previous_value"] is True
    assert consent.get(consent.BACKGROUND_LOCATION) is False


# --------------------------------------------------------------------------
# service: require() enforcement
# --------------------------------------------------------------------------

def test_require_raises_when_not_granted():
    with pytest.raises(consent.ConsentRequired) as ei:
        consent.require(consent.SUPPORT_TUNNEL)
    assert ei.value.feature == consent.SUPPORT_TUNNEL


def test_require_passes_when_granted():
    consent.set(consent.SUPPORT_TUNNEL, True, source="app")
    consent.require(consent.SUPPORT_TUNNEL)  # must not raise


def test_convenience_predicates():
    assert consent.is_voice_transcript_storage_allowed() is False
    consent.set(consent.VOICE_TRANSCRIPT, True, source="app")
    assert consent.is_voice_transcript_storage_allowed() is True


# --------------------------------------------------------------------------
# service: unknown feature + history
# --------------------------------------------------------------------------

def test_unknown_feature_raises():
    with pytest.raises(consent.UnknownFeature):
        consent.get("nope")
    with pytest.raises(consent.UnknownFeature):
        consent.set("nope", True)


def test_feature_id_normalization():
    # hyphen + case variants map to the canonical id
    consent.set("Support-Tunnel", True, source="app")
    assert consent.get("support_tunnel") is True


def test_history_is_bounded():
    for i in range(consent._HISTORY_TAIL + 10):
        consent.set(consent.VOICE_TRANSCRIPT, i % 2 == 0, source="app")
    rec = consent.get_record(consent.VOICE_TRANSCRIPT)
    assert len(rec["history"]) == consent._HISTORY_TAIL


def test_get_all_returns_every_feature():
    allrec = consent.get_all()
    assert set(allrec.keys()) == set(consent.FEATURES)
    for f in consent.FEATURES:
        assert allrec[f]["granted"] is False


# --------------------------------------------------------------------------
# router
# --------------------------------------------------------------------------

def _client(role: str = "admin") -> TestClient:
    app = FastAPI()
    app.include_router(consent_router)
    app.dependency_overrides[get_current_user] = lambda: {
        "username": "owner@ziggy", "email": "owner@ziggy", "role": role,
    }
    return TestClient(app)


def test_router_list_default_deny():
    c = _client()
    r = c.get("/api/consent")
    assert r.status_code == 200
    body = r.json()
    for f in consent.FEATURES:
        assert body["features"][f]["granted"] is False


def test_router_record_and_read_back():
    c = _client(role="admin")
    r = c.post("/api/consent/voice_transcript", json={"granted": True, "source": "app"})
    assert r.status_code == 200, r.text
    assert r.json()["granted"] is True

    r2 = c.get("/api/consent/voice_transcript")
    assert r2.json()["granted"] is True

    r3 = c.get("/api/consent/voice_transcript/check")
    assert r3.json() == {"feature": "voice_transcript", "allowed": True}


def test_router_check_default_deny():
    c = _client()
    r = c.get("/api/consent/support_tunnel/check")
    assert r.json()["allowed"] is False


def test_router_unknown_feature_404():
    c = _client()
    assert c.get("/api/consent/bogus").status_code == 404
    assert c.get("/api/consent/bogus/check").status_code == 404
    assert c.post("/api/consent/bogus", json={"granted": True}).status_code == 404


def test_router_record_is_owner_gated():
    # A plain user may read but not record.
    c = _client(role="user")
    assert c.get("/api/consent").status_code == 200
    r = c.post("/api/consent/support_tunnel", json={"granted": True})
    assert r.status_code == 403


def test_router_rejects_bad_source():
    c = _client(role="admin")
    r = c.post("/api/consent/voice_transcript", json={"granted": True, "source": "carrier-pigeon"})
    assert r.status_code == 422
