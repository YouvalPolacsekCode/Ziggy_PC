"""Tests for services/telemetry_client.py — Prompt 2 chunk 2.4.

Coverage:
  post_once happy path           builds payload, signs, POSTs to right URL
  missing config                 → reason=missing_config, no POST
  network error                  → reason=network_error
  non-2xx response               → reason=http_<status>
  signature roundtrips           edge sign verifies on relay
  partial payload tolerance      collectors return None → key absent from payload
  version source precedence      ZIGGY_VERSION env > settings.version > fallback
"""

from __future__ import annotations

import json
import os

import pytest

from services import telemetry_client


HOME_ID = "home-1"
SECRET = "edge-test-secret-32-bytes-padding"


def _good_settings() -> dict:
    return {
        "home":  {"id": HOME_ID},
        "relay": {"url": "http://relay.local", "secret": SECRET},
    }


class _FakeResp:
    def __init__(self, status: int, text: str = ""):
        self.status_code = status
        self.text = text


def _capture_post(resp):
    captured: dict = {}
    def fake(url, *, headers, content, timeout):
        captured["url"]     = url
        captured["headers"] = dict(headers)
        captured["body"]    = content
        captured["timeout"] = timeout
        return resp
    return captured, fake


def _fixed_payload(*_args, **_kwargs):
    return {
        "ziggy_version": "1.2.3",
        "ha_version":    "2026.5.1",
        "uptime_s":      60,
        "cpu_pct":       10.0,
        "mem_pct":       30.0,
    }


# ---------- happy path ----------

def test_post_happy_path_signs_and_calls_right_url():
    captured, fake = _capture_post(_FakeResp(200, "ok"))
    result = telemetry_client.post_once(
        settings=_good_settings(),
        _http_post=fake,
        _build_payload_fn=_fixed_payload,
    )
    assert result["ok"] is True
    assert result["reason"] == "posted"
    assert result["status"] == 200
    assert captured["url"] == f"http://relay.local/api/devices/{HOME_ID}/telemetry"
    assert captured["headers"]["Content-Type"] == "application/json"
    assert "X-Ziggy-Signature" in captured["headers"]
    body = json.loads(captured["body"])
    assert body["ha_version"] == "2026.5.1"


def test_signature_verifies_against_relay():
    from relay.app.audit import verify
    captured, fake = _capture_post(_FakeResp(200))
    telemetry_client.post_once(
        settings=_good_settings(),
        _http_post=fake,
        _build_payload_fn=_fixed_payload,
    )
    sig = captured["headers"]["X-Ziggy-Signature"]
    ok, why = verify(SECRET, captured["body"], sig)
    assert ok, why


# ---------- failure paths ----------

def test_missing_config_returns_skip_reason():
    captured, fake = _capture_post(_FakeResp(200))
    result = telemetry_client.post_once(
        settings={"home": {}, "relay": {}},
        _http_post=fake,
    )
    assert result["ok"] is False
    assert result["reason"] == "missing_config"
    assert "url" not in captured  # never called


def test_network_error():
    def boom(*_a, **_k):
        raise ConnectionError("relay unreachable")
    result = telemetry_client.post_once(
        settings=_good_settings(),
        _http_post=boom,
        _build_payload_fn=_fixed_payload,
    )
    assert result["ok"] is False
    assert result["reason"] == "network_error"


def test_non_2xx_response():
    _, fake = _capture_post(_FakeResp(401, "Invalid signature."))
    result = telemetry_client.post_once(
        settings=_good_settings(),
        _http_post=fake,
        _build_payload_fn=_fixed_payload,
    )
    assert result["ok"] is False
    assert result["reason"] == "http_401"
    assert result["status"] == 401


def test_post_400_malformed_response():
    _, fake = _capture_post(_FakeResp(400, "Malformed body."))
    result = telemetry_client.post_once(
        settings=_good_settings(),
        _http_post=fake,
        _build_payload_fn=_fixed_payload,
    )
    assert result["reason"] == "http_400"


# ---------- version source precedence ----------

def test_get_ziggy_version_env_wins(monkeypatch):
    monkeypatch.setenv("ZIGGY_VERSION", "9.9.9-env")
    assert telemetry_client._get_ziggy_version({"version": "1.2.3"}) == "9.9.9-env"


def test_get_ziggy_version_settings_fallback(monkeypatch):
    monkeypatch.delenv("ZIGGY_VERSION", raising=False)
    assert telemetry_client._get_ziggy_version({"version": "1.2.3"}) == "1.2.3"


def test_get_ziggy_version_default(monkeypatch):
    monkeypatch.delenv("ZIGGY_VERSION", raising=False)
    assert telemetry_client._get_ziggy_version({}) == "0.0.0+local"
    assert telemetry_client._get_ziggy_version(None) == "0.0.0+local"


# ---------- payload assembly tolerance ----------

def test_payload_omits_keys_when_collectors_return_none(monkeypatch):
    """When all HA + docker collectors fail, the payload still has the
    mandatory ziggy_version / uptime_s / collected_at — but optional
    keys are absent rather than emitted as null."""
    monkeypatch.setattr(telemetry_client, "_get_ha_version",
                        lambda *_a, **_k: None)
    monkeypatch.setattr(telemetry_client, "_collect_sensors",
                        lambda *_a, **_k: None)
    monkeypatch.setattr(telemetry_client, "_collect_system_metrics",
                        lambda: {})
    monkeypatch.setattr(telemetry_client, "_collect_containers",
                        lambda: None)
    monkeypatch.setattr(telemetry_client, "_collect_last_automation_trigger",
                        lambda: None)
    body = telemetry_client._build_payload(_good_settings(), timeout_s=1.0)
    # Mandatory keys present
    assert "ziggy_version" in body
    assert "uptime_s" in body
    assert "collected_at" in body
    # Optional keys absent — distinguishes "unknown" from "explicitly null"
    assert "ha_version" not in body
    assert "sensors" not in body
    assert "containers" not in body
    assert "disk" not in body
    assert "cpu_pct" not in body
    assert "mem_pct" not in body
    assert "last_automation_trigger" not in body


def test_payload_includes_partial_system_metrics(monkeypatch):
    """A psutil failure on one metric must not lose the others."""
    monkeypatch.setattr(telemetry_client, "_get_ha_version",
                        lambda *_a, **_k: None)
    monkeypatch.setattr(telemetry_client, "_collect_sensors",
                        lambda *_a, **_k: None)
    monkeypatch.setattr(telemetry_client, "_collect_system_metrics",
                        lambda: {"cpu_pct": 25.0})
    monkeypatch.setattr(telemetry_client, "_collect_containers",
                        lambda: None)
    monkeypatch.setattr(telemetry_client, "_collect_last_automation_trigger",
                        lambda: None)
    body = telemetry_client._build_payload(_good_settings(), timeout_s=1.0)
    assert body["cpu_pct"] == 25.0
    assert "mem_pct" not in body
    assert "disk" not in body


# ---------- defense in depth ----------

def test_unexpected_exception_never_raises():
    """A misbehaving payload builder must still be caught — the scheduler
    relies on post_once never propagating."""
    def boom(*_a, **_k):
        raise RuntimeError("payload exploded")
    result = telemetry_client.post_once(
        settings=_good_settings(),
        _build_payload_fn=boom,
    )
    assert result["ok"] is False
    assert result["reason"] == "unexpected_error"
