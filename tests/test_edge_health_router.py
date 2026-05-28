"""Tests for backend/routers/edge_health_router.py — Prompt 4 chunk 2.G.

Coverage:
  - GET /health returns 200 always, even when the hub is "down"
  - status rubric: ok / degraded / down across the four input combos
  - ha_reachable reads services.ha_subscriber.ha_connected
  - ha_version reads services.ha_subscriber.ha_version when set
  - ziggy_version comes from services.telemetry_client._get_ziggy_version
  - last_telemetry_post_at mirrors services.telemetry_client.LAST_POST_AT_UTC
  - freshness window: posts within 15 min are fresh, older ones aren't
  - no Authorization header required — works during onboarding
  - misbehaving collector (raises inside snapshot) → "down" not 500
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers.edge_health_router import (
    router as edge_health_router,
    _last_post_is_fresh,
    _build_health_snapshot,
)


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(edge_health_router)
    return TestClient(app)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


# ---------- freshness window helper ----------

def test_freshness_fresh_post():
    now = datetime(2026, 5, 28, 12, 0, tzinfo=timezone.utc)
    just_now = _iso(now - timedelta(minutes=2))
    assert _last_post_is_fresh(just_now, now=now) is True


def test_freshness_stale_post():
    now = datetime(2026, 5, 28, 12, 0, tzinfo=timezone.utc)
    old = _iso(now - timedelta(minutes=30))
    assert _last_post_is_fresh(old, now=now) is False


def test_freshness_window_boundary():
    """Inside the 15-min window is fresh; outside is stale (inclusive at 15)."""
    now = datetime(2026, 5, 28, 12, 0, tzinfo=timezone.utc)
    assert _last_post_is_fresh(_iso(now - timedelta(minutes=15)), now=now) is True
    assert _last_post_is_fresh(_iso(now - timedelta(seconds=15 * 60 + 1)), now=now) is False


def test_freshness_none_or_garbage():
    assert _last_post_is_fresh(None) is False
    assert _last_post_is_fresh("") is False
    assert _last_post_is_fresh("not-a-date") is False
    assert _last_post_is_fresh(12345) is False  # type: ignore[arg-type]


def test_freshness_handles_z_suffix():
    """ISO-8601 with trailing Z (HA emits these) must parse."""
    now = datetime(2026, 5, 28, 12, 0, tzinfo=timezone.utc)
    fresh = (now - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert _last_post_is_fresh(fresh, now=now) is True


# ---------- status rubric ----------

def _stub_state(monkeypatch, *, connected: bool, last_post: str | None,
                ha_version: str | None = "2026.5.1",
                ziggy_version: str = "1.2.3") -> None:
    """Patch every external read the snapshot helper does."""
    import services.ha_subscriber
    import services.telemetry_client
    import core.settings_loader
    monkeypatch.setattr(services.ha_subscriber, "ha_connected", connected)
    monkeypatch.setattr(services.ha_subscriber, "ha_version", ha_version,
                        raising=False)
    monkeypatch.setattr(services.telemetry_client, "LAST_POST_AT_UTC", last_post)
    monkeypatch.setattr(services.telemetry_client, "_get_ziggy_version",
                        lambda _settings: ziggy_version)
    monkeypatch.setattr(core.settings_loader, "settings", {})


def test_status_ok_when_ha_connected_and_fresh(monkeypatch):
    now = datetime.now(timezone.utc).isoformat()
    _stub_state(monkeypatch, connected=True, last_post=now)
    resp = _client().get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["ha_reachable"] is True
    assert body["ziggy_version"] == "1.2.3"
    assert body["ha_version"] == "2026.5.1"
    assert body["last_telemetry_post_at"] == now


def test_status_degraded_when_connected_but_stale(monkeypatch):
    """HA up but no recent telemetry post → degraded."""
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    _stub_state(monkeypatch, connected=True, last_post=old)
    resp = _client().get("/health")
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["ha_reachable"] is True


def test_status_degraded_when_disconnected_but_fresh_post(monkeypatch):
    """HA briefly disconnected but telemetry posted recently → degraded
    (partial visibility, not fully down)."""
    now = datetime.now(timezone.utc).isoformat()
    _stub_state(monkeypatch, connected=False, last_post=now)
    body = _client().get("/health").json()
    assert body["status"] == "degraded"
    assert body["ha_reachable"] is False


def test_status_down_when_neither(monkeypatch):
    _stub_state(monkeypatch, connected=False, last_post=None)
    body = _client().get("/health").json()
    assert body["status"] == "down"
    assert body["ha_reachable"] is False
    assert body["last_telemetry_post_at"] is None


def test_status_down_first_boot_no_post_ever(monkeypatch):
    """Fresh hub before the first telemetry tick — HA may already be up
    but LAST_POST_AT_UTC is still None. That's `degraded` if HA is
    connected, since we can talk to it but haven't reported out yet."""
    _stub_state(monkeypatch, connected=True, last_post=None)
    body = _client().get("/health").json()
    assert body["status"] == "degraded"


# ---------- no-auth posture ----------

def test_health_endpoint_requires_no_auth(monkeypatch):
    """No Authorization header — must NOT 401. Onboarding hits this BEFORE
    the user has logged in."""
    _stub_state(monkeypatch, connected=False, last_post=None)
    resp = _client().get("/health")   # no headers
    assert resp.status_code == 200


def test_health_endpoint_not_under_api_prefix(monkeypatch):
    """Sanity: the endpoint is at /health, NOT /api/health, so it can't
    collide with the existing auth-gated route at /api/health."""
    _stub_state(monkeypatch, connected=False, last_post=None)
    assert _client().get("/api/health").status_code == 404


# ---------- defense in depth ----------

def test_endpoint_returns_down_on_collector_explosion(monkeypatch):
    """If _build_health_snapshot itself raises, the route returns a
    structured 'down' body — not a 500."""
    import backend.routers.edge_health_router as ehr
    def boom():
        raise RuntimeError("collector died")
    monkeypatch.setattr(ehr, "_build_health_snapshot", boom)
    resp = _client().get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "down"
    assert body["ha_reachable"] is False
    assert body["ziggy_version"] == "unknown"
    assert body["ha_version"] is None
    assert body["last_telemetry_post_at"] is None


def test_snapshot_tolerates_ha_subscriber_import_error(monkeypatch):
    """If services.ha_subscriber can't be imported (e.g. dev environment
    missing websockets), the snapshot falls back to ha_reachable=False —
    not a 500."""
    # Force the lazy import inside _build_health_snapshot to fail by
    # injecting a broken sentinel.
    import sys
    sentinel = object()
    monkeypatch.setitem(sys.modules, "services.ha_subscriber", sentinel)
    snap = _build_health_snapshot()
    assert snap["ha_reachable"] is False
    assert snap["status"] in ("down", "degraded")


def test_snapshot_returns_unknown_ziggy_version_if_telemetry_missing(monkeypatch):
    """If services.telemetry_client can't be imported, ziggy_version is
    'unknown' rather than a crash."""
    import sys
    monkeypatch.setitem(sys.modules, "services.telemetry_client",
                        type("X", (), {})())   # missing attrs
    snap = _build_health_snapshot()
    assert snap["ziggy_version"] == "unknown"
    assert snap["last_telemetry_post_at"] is None


def test_health_endpoint_always_200_even_when_down(monkeypatch):
    """Quote from the module docstring: 'a network-level reachability probe
    can distinguish hub-not-reachable-on-LAN from hub-running-but-HA-down.'
    That requires the endpoint to always 200 — never 503 / 500."""
    _stub_state(monkeypatch, connected=False, last_post=None)
    resp = _client().get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "down"
