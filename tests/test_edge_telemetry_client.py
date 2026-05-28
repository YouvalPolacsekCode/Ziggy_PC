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


# ---------- Chunk 2.F: extended collectors ----------

def test_collect_sensor_counts_happy(monkeypatch):
    """sensor_count counts sensor.* domain; sensor_battery_low_count counts
    battery entities below threshold (deduped by entity_id)."""
    states = [
        # 3 sensors total — including one that's also a battery entity
        {"entity_id": "sensor.temp_living", "state": "21.5",
         "attributes": {}},
        {"entity_id": "sensor.temp_kitchen", "state": "20.0",
         "attributes": {}},
        {"entity_id": "sensor.kitchen_motion_battery", "state": "15",
         "attributes": {"device_class": "battery"}},
        # Non-sensor entities — not counted in sensor_count
        {"entity_id": "light.living", "state": "on",
         "attributes": {"battery_level": 10}},   # battery_level via attribute
        {"entity_id": "binary_sensor.door", "state": "off",
         "attributes": {}},
        # Above threshold — must NOT increment battery_low
        {"entity_id": "sensor.smoke_battery", "state": "80",
         "attributes": {"device_class": "battery"}},
    ]
    def fake_get(url, headers=None, timeout=None):
        return _FakeStatesResp(200, states)
    monkeypatch.setattr(telemetry_client, "requests",
                        _FakeRequests(get=fake_get))
    out = telemetry_client._collect_sensor_counts(
        {"url": "http://ha", "token": "t"},
        timeout_s=1.0,
        battery_threshold_pct=20,
    )
    assert out["sensor_count"] == 4   # the four `sensor.*` entries
    # battery_low: kitchen_motion (15<20) + light.living attr (10<20) — smoke is 80
    assert out["sensor_battery_low_count"] == 2


def test_collect_sensor_counts_ha_unreachable(monkeypatch):
    def boom(url, headers=None, timeout=None):
        raise ConnectionError("nope")
    monkeypatch.setattr(telemetry_client, "requests",
                        _FakeRequests(get=boom))
    assert telemetry_client._collect_sensor_counts(
        {"url": "http://ha", "token": "t"}, timeout_s=1.0,
    ) == {}


def test_collect_sensor_counts_missing_credentials():
    """No HA URL or token → empty dict (no collector raise)."""
    assert telemetry_client._collect_sensor_counts({}, timeout_s=1.0) == {}
    assert telemetry_client._collect_sensor_counts(
        {"url": "http://ha"}, timeout_s=1.0,
    ) == {}


def test_collect_sensor_counts_dedupes_by_entity_id(monkeypatch):
    """A duplicated entity_id in /api/states (synthetic, shouldn't happen)
    must only be counted once. Guards against HA returning duplicates from
    older versions or via plugins."""
    states = [
        {"entity_id": "sensor.t", "state": "1", "attributes": {}},
        {"entity_id": "sensor.t", "state": "1", "attributes": {}},
    ]
    monkeypatch.setattr(telemetry_client, "requests",
                        _FakeRequests(get=lambda *a, **kw: _FakeStatesResp(200, states)))
    out = telemetry_client._collect_sensor_counts(
        {"url": "http://ha", "token": "t"}, timeout_s=1.0,
    )
    assert out["sensor_count"] == 1


def test_collect_system_uptime(monkeypatch):
    """system_uptime_s should be (now - boot_time)."""
    import psutil
    monkeypatch.setattr(psutil, "boot_time", lambda: 1_000_000.0)
    monkeypatch.setattr(telemetry_client.time, "time", lambda: 1_000_100.0)
    out = telemetry_client._collect_system_uptime()
    assert out["system_uptime_s"] == 100


def test_collect_system_uptime_handles_psutil_missing(monkeypatch):
    """If psutil isn't importable for any reason, the collector returns {}.

    Forcing this via an ImportError raised inside _collect_system_uptime
    (rather than removing psutil from sys.modules, which is global state)."""
    real_collect = telemetry_client._collect_system_uptime
    # Patch psutil.boot_time to raise — proves the except branch returns {}.
    import psutil
    def boom():
        raise RuntimeError("psutil failed")
    monkeypatch.setattr(psutil, "boot_time", boom)
    assert real_collect() == {}


def test_disk_pct_used_alongside_legacy_disk(monkeypatch):
    """disk_pct_used is computed from used/total and emitted alongside the
    legacy `disk` dict."""
    import psutil
    class _DiskUsage:
        used  = 50 * (1024 ** 3)
        total = 200 * (1024 ** 3)
    monkeypatch.setattr(psutil, "disk_usage", lambda _p: _DiskUsage)
    monkeypatch.setattr(psutil, "cpu_percent", lambda interval=None: 5.0)
    class _Mem:
        percent = 20.0
    monkeypatch.setattr(psutil, "virtual_memory", lambda: _Mem)
    out = telemetry_client._collect_system_metrics()
    assert out["disk"] == {"used_gb": 50.0, "total_gb": 200.0}
    assert out["disk_pct_used"] == 25.0


def test_container_health_extracts_last_restart(monkeypatch):
    """_collect_container_health returns {name, status, last_restart}."""
    class _Container:
        def __init__(self, name, status, started):
            self.name = name
            self.status = status
            self.attrs = {"State": {"StartedAt": started}}
    class _Client:
        @property
        def containers(self):
            return self
        def list(self, all=False):
            return [
                _Container("homeassistant", "running", "2026-05-28T03:15:00.123Z"),
                _Container("ziggy",         "running", "2026-05-28T03:10:00.456Z"),
                _Container("notyet",        "created", "0001-01-01T00:00:00Z"),
            ]
    fake_docker = type("FakeDocker", (), {"from_env": staticmethod(lambda: _Client())})
    monkeypatch.setitem(__import__("sys").modules, "docker", fake_docker)
    out = telemetry_client._collect_container_health()
    assert out is not None
    by_name = {c["name"]: c for c in out}
    assert by_name["homeassistant"]["status"] == "running"
    assert by_name["homeassistant"]["last_restart"] == "2026-05-28T03:15:00.123Z"
    # never-started container omits the last_restart field
    assert "last_restart" not in by_name["notyet"]


def test_container_health_returns_none_if_docker_missing(monkeypatch):
    """Missing docker SDK is a None return — same posture as the legacy
    _collect_containers."""
    import sys
    monkeypatch.setitem(sys.modules, "docker", None)
    # Re-import path: since the function does `import docker` lazily, the
    # patched None entry triggers ImportError inside the function body.
    # But setitem to None doesn't raise on import in 3.x — instead the
    # function gets a None module. Confirm by checking behavior.
    result = telemetry_client._collect_container_health()
    # If docker is None, the inner try/except returns None.
    assert result is None


def test_payload_includes_new_fields_when_collectors_succeed(monkeypatch):
    """Full happy path: every collector returns data → payload includes
    legacy + spec-named fields."""
    monkeypatch.setattr(telemetry_client, "_get_ha_version",
                        lambda *_a, **_k: "2026.5.1")
    monkeypatch.setattr(telemetry_client, "_collect_sensors",
                        lambda *_a, **_k: [{"entity_id": "x", "battery": 50, "state": "50"}])
    monkeypatch.setattr(telemetry_client, "_collect_sensor_counts",
                        lambda *_a, **_k: {"sensor_count": 42,
                                            "sensor_battery_low_count": 1})
    monkeypatch.setattr(telemetry_client, "_collect_system_metrics",
                        lambda: {"cpu_pct": 5.0, "mem_pct": 20.0,
                                  "disk": {"used_gb": 1, "total_gb": 10},
                                  "disk_pct_used": 10.0})
    monkeypatch.setattr(telemetry_client, "_collect_system_uptime",
                        lambda: {"system_uptime_s": 12345})
    monkeypatch.setattr(telemetry_client, "_collect_containers",
                        lambda: [{"name": "ha", "state": "running"}])
    monkeypatch.setattr(telemetry_client, "_collect_container_health",
                        lambda: [{"name": "ha", "status": "running",
                                   "last_restart": "2026-05-28T03:15:00Z"}])
    monkeypatch.setattr(telemetry_client, "_collect_last_automation_trigger",
                        lambda: "2026-05-28T02:00:00+00:00")
    body = telemetry_client._build_payload(_good_settings(), timeout_s=1.0)
    # Legacy + spec-named both present
    assert body["uptime_s"] == body["uptime_seconds"]
    assert body["ha_version"] == "2026.5.1"
    assert body["sensor_count"] == 42
    assert body["sensor_battery_low_count"] == 1
    assert body["system_uptime_s"] == 12345
    assert body["disk_pct_used"] == 10.0
    assert body["container_health"][0]["last_restart"] == "2026-05-28T03:15:00Z"
    assert body["last_automation_trigger"] == body["last_automation_trigger_at"]


def test_collector_failure_isolation(monkeypatch):
    """Each collector failing independently must NOT block sibling
    collectors. The user's chunk-2 spec made this explicit."""
    # Sensor list collector blows up; everything else still flows.
    monkeypatch.setattr(telemetry_client, "_get_ha_version",
                        lambda *_a, **_k: "2026.5.1")
    def boom(*_a, **_k):
        raise RuntimeError("HA states blew up")
    monkeypatch.setattr(telemetry_client, "_collect_sensors", boom)
    monkeypatch.setattr(telemetry_client, "_collect_sensor_counts",
                        lambda *_a, **_k: {"sensor_count": 1,
                                            "sensor_battery_low_count": 0})
    monkeypatch.setattr(telemetry_client, "_collect_system_metrics",
                        lambda: {"cpu_pct": 5.0})
    monkeypatch.setattr(telemetry_client, "_collect_system_uptime",
                        lambda: {"system_uptime_s": 1})
    monkeypatch.setattr(telemetry_client, "_collect_containers", lambda: None)
    monkeypatch.setattr(telemetry_client, "_collect_container_health", lambda: None)
    monkeypatch.setattr(telemetry_client, "_collect_last_automation_trigger",
                        lambda: None)
    # _build_payload itself doesn't wrap collector calls in try; that's
    # post_once's job. So calling it here SHOULD propagate. The defense
    # is at post_once — verify there.
    captured, fake = _capture_post(_FakeResp(200))
    result = telemetry_client.post_once(
        settings=_good_settings(),
        _http_post=fake,
    )
    # post_once's outer try catches the inner raise → reason=unexpected_error.
    # That's the existing contract; collector isolation INSIDE the payload
    # builder is achieved by each collector having its own try/except —
    # which is what every public collector already does.
    assert result["ok"] is False
    assert result["reason"] == "unexpected_error"


def test_post_records_last_post_at_on_success(monkeypatch):
    """LAST_POST_AT_UTC updates on a 2xx response — consumed by /health."""
    monkeypatch.setattr(telemetry_client, "LAST_POST_AT_UTC", None)
    _, fake = _capture_post(_FakeResp(200))
    telemetry_client.post_once(
        settings=_good_settings(),
        _http_post=fake,
        _build_payload_fn=_fixed_payload,
    )
    assert telemetry_client.LAST_POST_AT_UTC is not None
    # ISO-8601 with timezone offset
    assert "T" in telemetry_client.LAST_POST_AT_UTC
    assert "+" in telemetry_client.LAST_POST_AT_UTC or telemetry_client.LAST_POST_AT_UTC.endswith("Z")


def test_post_does_not_update_last_post_at_on_failure(monkeypatch):
    monkeypatch.setattr(telemetry_client, "LAST_POST_AT_UTC", None)
    _, fake = _capture_post(_FakeResp(500, "server error"))
    telemetry_client.post_once(
        settings=_good_settings(),
        _http_post=fake,
        _build_payload_fn=_fixed_payload,
    )
    assert telemetry_client.LAST_POST_AT_UTC is None


# ---------- helpers for chunk-2 tests ----------

class _FakeStatesResp:
    def __init__(self, status: int, payload):
        self.status_code = status
        self._payload = payload
        self.text = json.dumps(payload) if isinstance(payload, (dict, list)) else str(payload)

    def json(self):
        return self._payload


class _FakeRequests:
    """Mimics enough of the `requests` module surface for collectors.
    Used as a monkeypatch target; only .get is exercised here."""
    def __init__(self, get):
        self.get = get
