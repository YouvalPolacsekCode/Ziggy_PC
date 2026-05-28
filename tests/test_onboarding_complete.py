"""Tests for /api/onboarding/complete + telemetry_client `extra` param —
Prompt 7 chunk 3.4.

Covers both the new endpoint and the telemetry-pipeline extension that
backs it.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.debug_bus import bus, BASIC, OFF
from backend.routers import onboarding_sensors_router as osr
from backend.routers import mobile_router as mr
from services import first_boot, mobile_app, telemetry_client


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setenv("ZIGGY_DEVICE_ID_PATH",          str(tmp_path / "etc_device_id"))
    monkeypatch.setenv("ZIGGY_FALLBACK_DEVICE_ID_PATH", str(tmp_path / "fb_device_id"))
    monkeypatch.setenv("ZIGGY_FIRST_BOOT_STATE_PATH",   str(tmp_path / "first_boot.json"))
    # Pin a known device_id
    Path(tmp_path / "etc_device_id").write_text("edge_box_xyz", encoding="utf-8")
    bus.set_level(BASIC); bus.set_scopes([]); bus._buffer.clear()

    class _NoopWS:
        def is_connected(self, device_id): return False
        async def send_to_device(self, *_a, **_k): return False
    monkeypatch.setattr(mr, "mobile_ws", _NoopWS())
    yield
    bus.set_level(OFF); bus._buffer.clear()


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(osr.router)
    return TestClient(app)


@pytest.fixture
def token() -> str:
    rec = mobile_app.register_device(
        user_id="alice@example.com",
        device_info={"platform": "ios"},
    )
    return rec["auth_token"]


def _events(step: str) -> list[dict]:
    return [e for e in list(bus._buffer) if e.get("step") == step]


# ── /api/onboarding/complete endpoint ────────────────────────────────────────

def test_complete_401_without_token(client: TestClient):
    resp = client.post("/api/onboarding/complete", json={})
    assert resp.status_code == 401


def test_complete_marks_first_boot_done(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    # Stub telemetry so the test doesn't hit network
    monkeypatch.setattr(
        osr.telemetry_client, "post_once",
        lambda **kwargs: {"ok": True, "reason": "posted", "status": 200, "payload_bytes": 64},
    )
    assert first_boot.is_first_boot() is True
    resp = client.post(
        "/api/onboarding/complete",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "time_elapsed_seconds":       1234,
            "sensors_confirmed_count":    5,
            "automations_accepted_count": 3,
            "errors":                     [],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["first_boot_done"] is True
    assert body["telemetry_posted"] is True
    assert first_boot.is_first_boot() is False


def test_complete_forwards_extras_to_telemetry(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    captured: dict = {}

    def fake_post(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "reason": "posted"}

    monkeypatch.setattr(osr.telemetry_client, "post_once", fake_post)

    resp = client.post(
        "/api/onboarding/complete",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "time_elapsed_seconds":       2400,
            "sensors_confirmed_count":    7,
            "automations_accepted_count": 4,
            "errors":                     ["sensor_3_skipped"],
        },
    )
    assert resp.status_code == 200
    extras = captured["extra"]
    assert extras["event"] == "onboarding_complete"
    assert extras["time_elapsed_seconds"]       == 2400
    assert extras["sensors_confirmed_count"]    == 7
    assert extras["automations_accepted_count"] == 4
    assert extras["errors"] == ["sensor_3_skipped"]
    assert extras["device_id"] == "edge_box_xyz"


def test_complete_succeeds_even_if_telemetry_fails(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(
        osr.telemetry_client, "post_once",
        lambda **kwargs: {"ok": False, "reason": "missing_config"},
    )
    resp = client.post(
        "/api/onboarding/complete",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["first_boot_done"] is True
    assert body["telemetry_posted"] is False
    assert body["telemetry_reason"] == "missing_config"
    # first_boot still stamped even though telemetry didn't make it
    assert first_boot.is_first_boot() is False


def test_complete_handles_telemetry_exception(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    def boom(**kwargs):
        raise RuntimeError("relay unreachable")
    monkeypatch.setattr(osr.telemetry_client, "post_once", boom)
    resp = client.post(
        "/api/onboarding/complete",
        headers={"Authorization": f"Bearer {token}"},
        json={},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["telemetry_posted"] is False
    assert body["telemetry_reason"] == "exception"


def test_complete_emits_audit_event(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(
        osr.telemetry_client, "post_once",
        lambda **kwargs: {"ok": True, "reason": "posted"},
    )
    client.post(
        "/api/onboarding/complete",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "time_elapsed_seconds":       100,
            "sensors_confirmed_count":    2,
            "automations_accepted_count": 1,
            "errors":                     [],
        },
    )
    matched = _events("onboarding_complete")
    assert len(matched) == 1
    d = matched[0]["data"]
    assert d["time_elapsed_seconds"]       == 100
    assert d["sensors_confirmed_count"]    == 2
    assert d["automations_accepted_count"] == 1
    assert d["telemetry_posted"] is True


def test_complete_is_idempotent_for_first_boot_state(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(
        osr.telemetry_client, "post_once",
        lambda **kwargs: {"ok": True, "reason": "posted"},
    )
    h = {"Authorization": f"Bearer {token}"}
    client.post("/api/onboarding/complete", headers=h, json={})
    snap1 = first_boot.snapshot()
    ts1 = snap1["completed_at"]
    client.post("/api/onboarding/complete", headers=h, json={})
    snap2 = first_boot.snapshot()
    # Timestamp doesn't move on a second call (first_boot.mark_onboarding_complete
    # is itself idempotent — Chunk 2.4 behaviour, re-verified at the
    # endpoint boundary).
    assert snap2["completed_at"] == ts1


# ── telemetry_client.post_once `extra` param ─────────────────────────────────

def test_telemetry_extra_merges_into_payload(monkeypatch: pytest.MonkeyPatch):
    captured: dict = {}

    def fake_post(url, *, headers, content, timeout):
        captured["body"] = content
        class _R:
            status_code = 200
            text = "ok"
        return _R()

    def fake_builder(settings, *, timeout_s):
        return {"ziggy_version": "1.2.3", "uptime_s": 60}

    settings_stub = {
        "home":  {"id": "home_abc"},
        "relay": {"url": "http://relay.example.com", "secret": "shh"},
    }
    res = telemetry_client.post_once(
        settings=settings_stub,
        extra={"event": "onboarding_complete", "sensors_confirmed_count": 3},
        _http_post=fake_post,
        _build_payload_fn=fake_builder,
    )
    assert res["ok"] is True
    import json as _json
    payload = _json.loads(captured["body"].decode("utf-8"))
    # Standard fields preserved
    assert payload["ziggy_version"] == "1.2.3"
    assert payload["uptime_s"] == 60
    # Extras merged at top-level
    assert payload["event"] == "onboarding_complete"
    assert payload["sensors_confirmed_count"] == 3


def test_telemetry_extra_wins_on_collision(monkeypatch: pytest.MonkeyPatch):
    """If extras override a standard field, the extra wins (caller is
    explicit — same-tier behaviour as a dict spread)."""
    captured: dict = {}

    def fake_post(url, *, headers, content, timeout):
        captured["body"] = content
        class _R:
            status_code = 200; text = "ok"
        return _R()

    def fake_builder(settings, *, timeout_s):
        return {"ziggy_version": "1.2.3"}

    res = telemetry_client.post_once(
        settings={"home": {"id": "h"}, "relay": {"url": "x", "secret": "s"}},
        extra={"ziggy_version": "OVERRIDE"},
        _http_post=fake_post,
        _build_payload_fn=fake_builder,
    )
    import json as _json
    payload = _json.loads(captured["body"].decode("utf-8"))
    assert payload["ziggy_version"] == "OVERRIDE"


def test_telemetry_extra_none_keeps_payload_unchanged(monkeypatch: pytest.MonkeyPatch):
    captured: dict = {}

    def fake_post(url, *, headers, content, timeout):
        captured["body"] = content
        class _R:
            status_code = 200; text = "ok"
        return _R()

    def fake_builder(settings, *, timeout_s):
        return {"ziggy_version": "1.2.3"}

    telemetry_client.post_once(
        settings={"home": {"id": "h"}, "relay": {"url": "x", "secret": "s"}},
        extra=None,
        _http_post=fake_post,
        _build_payload_fn=fake_builder,
    )
    import json as _json
    payload = _json.loads(captured["body"].decode("utf-8"))
    assert "event" not in payload
    assert payload["ziggy_version"] == "1.2.3"
