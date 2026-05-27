"""Tests for services/ota_client.py — Prompt 2 chunk 2.2.

Coverage:
  poll_once happy path           valid manifest → state.staged populated
  installed equals fetched       → no staging, reason=no_delta
  installed differs from fetched → staged, reason=delta_staged
  signature mismatch             → state.last_error set, no staging
  missing config                 → silent skip
  HTTP 404 / 403                 → recorded as no_release_or_unknown_home / suspended
  network exception              → recorded as network_error
  state file atomic write        → resilient to malformed prior state
  mark_installed clears staged
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

from relay.app.audit import sign as relay_sign
from relay.app.routers.ota import _canonical_bytes_for_signing as relay_canon
from services import ota_client


HOME_ID = "home-1"
SECRET = "edge-test-secret-32-bytes-padding"


def _good_settings() -> dict:
    return {
        "home":  {"id": HOME_ID},
        "relay": {"url": "http://relay.local", "secret": SECRET},
    }


def _make_signed_manifest(*, release_id=1, ha="2026.5.1", ziggy="1.2.3",
                          digests=None, secret=SECRET) -> dict:
    body = {
        "schema_version": 1,
        "home_id":        HOME_ID,
        "device_id":      HOME_ID,
        "release_id":     release_id,
        "ha_version":     ha,
        "ziggy_version":  ziggy,
        "image_digests":  digests or {"ha-core": "sha256:abc"},
        "notes":          "",
        "released_at":    "2026-05-27T00:00:00+00:00",
    }
    sig = relay_sign(secret, relay_canon(body))
    body["signature"] = sig
    return body


class _FakeResp:
    def __init__(self, status: int, payload: dict | str = ""):
        self.status_code = status
        self._payload = payload
        self.text = json.dumps(payload) if isinstance(payload, dict) else str(payload)

    def json(self):
        if isinstance(self._payload, dict):
            return self._payload
        raise ValueError("not json")


def _capture_http(resp):
    """Return a (capture_dict, fake_get_callable) pair."""
    captured: dict = {}
    def fake(url, *, headers, timeout):
        captured["url"] = url
        captured["headers"] = dict(headers)
        captured["timeout"] = timeout
        return resp
    return captured, fake


# ---------- poll_once happy paths ----------

def test_poll_happy_path_first_delta(tmp_path):
    path = tmp_path / "ota_state.json"
    manifest = _make_signed_manifest()
    _, fake = _capture_http(_FakeResp(200, manifest))
    result = ota_client.poll_once(
        settings=_good_settings(), state_path=path, _http_get=fake,
    )
    assert result["ok"] is True
    assert result["reason"] == "delta_staged"
    assert result["staged"] is True

    state = ota_client.load_state(path)
    assert state["staged"]["release_id"] == 1
    assert state["installed"] is None
    assert state["last_error"] is None
    assert state["last_poll_ts"] is not None


def test_poll_no_delta_when_versions_match(tmp_path):
    path = tmp_path / "ota_state.json"
    manifest = _make_signed_manifest()
    # Simulate "this version already installed"
    ota_client.save_state({
        "installed": {k: v for k, v in manifest.items() if k != "signature"},
        "staged": None, "last_poll_ts": None, "last_error": None,
    }, path)
    _, fake = _capture_http(_FakeResp(200, manifest))
    result = ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=fake)
    assert result["ok"] is True
    assert result["reason"] == "no_delta"
    assert result["staged"] is False
    state = ota_client.load_state(path)
    assert state["staged"] is None


def test_poll_delta_when_ha_version_changes(tmp_path):
    path = tmp_path / "ota_state.json"
    old = _make_signed_manifest(release_id=1, ha="2026.5.1")
    new = _make_signed_manifest(release_id=2, ha="2026.5.2")
    ota_client.save_state({
        "installed": {k: v for k, v in old.items() if k != "signature"},
        "staged": None, "last_poll_ts": None, "last_error": None,
    }, path)
    _, fake = _capture_http(_FakeResp(200, new))
    result = ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=fake)
    assert result["reason"] == "delta_staged"
    state = ota_client.load_state(path)
    assert state["staged"]["release_id"] == 2


# ---------- failure paths ----------

def test_poll_missing_config(tmp_path):
    path = tmp_path / "ota_state.json"
    _, fake = _capture_http(_FakeResp(200, {}))
    result = ota_client.poll_once(
        settings={"home": {}, "relay": {}}, state_path=path, _http_get=fake,
    )
    assert not result["ok"]
    assert result["reason"] == "missing_config"


def test_poll_bad_signature(tmp_path):
    path = tmp_path / "ota_state.json"
    manifest = _make_signed_manifest()
    manifest["ha_version"] = "tampered"  # break the signature
    _, fake = _capture_http(_FakeResp(200, manifest))
    result = ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=fake)
    assert not result["ok"]
    assert result["reason"] == "bad_signature"
    state = ota_client.load_state(path)
    assert state["last_error"].startswith("bad_signature:")
    assert state["staged"] is None


def test_poll_signature_with_wrong_secret(tmp_path):
    path = tmp_path / "ota_state.json"
    manifest = _make_signed_manifest(secret="not-the-real-secret")
    _, fake = _capture_http(_FakeResp(200, manifest))
    result = ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=fake)
    assert result["reason"] == "bad_signature"


def test_poll_404(tmp_path):
    path = tmp_path / "ota_state.json"
    _, fake = _capture_http(_FakeResp(404, "Home not provisioned."))
    result = ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=fake)
    assert result["reason"] == "no_release_or_unknown_home"


def test_poll_403_suspended(tmp_path):
    path = tmp_path / "ota_state.json"
    _, fake = _capture_http(_FakeResp(403, "Home suspended."))
    result = ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=fake)
    assert result["reason"] == "suspended"


def test_poll_network_error(tmp_path):
    path = tmp_path / "ota_state.json"
    def boom(url, *, headers, timeout):
        raise ConnectionError("dns failed")
    result = ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=boom)
    assert result["reason"] == "network_error"
    assert "ConnectionError" in ota_client.load_state(path)["last_error"]


def test_poll_url_uses_home_id_as_device_id(tmp_path):
    path = tmp_path / "ota_state.json"
    captured, fake = _capture_http(_FakeResp(200, _make_signed_manifest()))
    ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=fake)
    # v1 equivalence: URL device_id == settings.home.id
    assert captured["url"].endswith(f"/api/devices/{HOME_ID}/ota-manifest")


def test_poll_sends_hmac_header_over_empty_body(tmp_path):
    path = tmp_path / "ota_state.json"
    captured, fake = _capture_http(_FakeResp(200, _make_signed_manifest()))
    ota_client.poll_once(settings=_good_settings(), state_path=path, _http_get=fake)
    sig = captured["headers"]["X-Ziggy-Signature"]
    # Verify signature roundtrips through the relay verifier with empty body
    from relay.app.audit import verify
    ok, why = verify(SECRET, b"", sig)
    assert ok, why


# ---------- state file robustness ----------

def test_load_state_handles_missing(tmp_path):
    s = ota_client.load_state(tmp_path / "absent.json")
    assert s == {"installed": None, "staged": None, "last_poll_ts": None, "last_error": None}


def test_load_state_handles_malformed(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not-json")
    s = ota_client.load_state(p)
    assert s["staged"] is None
    assert s["installed"] is None


def test_mark_installed_promotes_and_clears(tmp_path):
    p = tmp_path / "s.json"
    m = {"release_id": 5, "ha_version": "x", "ziggy_version": "y"}
    ota_client.save_state({"installed": None, "staged": m, "last_poll_ts": None,
                            "last_error": None}, p)
    ota_client.mark_installed(m, p)
    s = ota_client.load_state(p)
    assert s["installed"]["release_id"] == 5
    assert s["staged"] is None


def test_mark_installed_ignores_invalid(tmp_path):
    p = tmp_path / "s.json"
    ota_client.save_state({"installed": None, "staged": None, "last_poll_ts": None,
                            "last_error": None}, p)
    ota_client.mark_installed({"not_a_manifest": True}, p)
    s = ota_client.load_state(p)
    assert s["installed"] is None
