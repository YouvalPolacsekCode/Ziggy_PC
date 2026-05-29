"""Coverage for the mobile_router audit-event emissions added in chunk 3.2.

The route surface is unchanged — we only added _dbus.emit calls on auth
failure and key state-transition paths so brute-force / stale-token /
revoke activity is visible in /api/debug/events.

Each test:
  1. Resets the debug bus + sets level=BASIC + clears its buffer.
  2. Stubs services.mobile_app + services.mobile_ws_manager.mobile_ws so
     the test has zero file/DB/IPC dependencies.
  3. Hits the route via TestClient.
  4. Asserts the expected event appeared in the bus buffer.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.debug_bus import bus, BASIC, OFF
from backend.routers import mobile_router as mr
from backend.routers.auth_deps import get_current_user


@pytest.fixture(autouse=True)
def _reset_bus():
    """Each test gets a clean BASIC-level bus with all scopes enabled."""
    bus.set_level(BASIC)
    bus.set_scopes([])           # empty list = all scopes
    bus._buffer.clear()
    yield
    bus.set_level(OFF)
    bus._buffer.clear()


def _events(scope: str | None = None, step: str | None = None) -> list[dict]:
    """Filtered view of the bus buffer. The kwargs passed to emit() land
    under event['data'] — tests inspect e['data']['<key>']."""
    return [
        e for e in list(bus._buffer)
        if (scope is None or e.get("scope") == scope)
        and (step is None or e.get("step") == step)
    ]


def _data(events: list[dict], i: int = 0) -> dict:
    """Shortcut: data payload of the i-th event."""
    return events[i]["data"]


@pytest.fixture
def stub_mobile_app(monkeypatch):
    """Replace mobile_app.* functions with deterministic stubs."""
    state: dict = {
        "valid_token":  "zgy_mb_VALID",
        "device":       {
            "device_id":  "dev-1",
            "webhook_id": "wh-1",
            "auth_token": "zgy_mb_VALID",
            "user_id":    "owner@example.com",
        },
        "pair_codes":   {"GOODCODE": {"user_id": "owner@example.com"}},
    }
    def find_by_token(token: str):
        return state["device"] if token == state["valid_token"] else None
    def consume_pair_code(code: str):
        return state["pair_codes"].pop(code, None)
    def register_device(user_id: str, device_info: dict):
        return {
            "device_id":  "dev-new",
            "webhook_id": "wh-new",
            "auth_token": "zgy_mb_NEW",
            "person_id":  None,
        }
    def create_pair_code(user_id: str):
        return {"code": "FRESH", "expires_in_s": 600}
    def delete_device(device_id: str, *, user_id: str = ""):
        return device_id == "dev-mine"
    def list_devices_for_user(user_id: str):
        return [{"device_id": "dev-1"}]
    def update_device(device_id: str, fields: dict):
        return None
    def handle_webhook(device: dict, payload: dict):
        return {"ok": True}

    monkeypatch.setattr(mr.mobile_app, "find_device_by_token", find_by_token)
    monkeypatch.setattr(mr.mobile_app, "consume_pair_code", consume_pair_code)
    monkeypatch.setattr(mr.mobile_app, "register_device", register_device)
    monkeypatch.setattr(mr.mobile_app, "create_pair_code", create_pair_code)
    monkeypatch.setattr(mr.mobile_app, "delete_device", delete_device)
    monkeypatch.setattr(mr.mobile_app, "list_devices_for_user", list_devices_for_user)
    monkeypatch.setattr(mr.mobile_app, "update_device", update_device)
    monkeypatch.setattr(mr.mobile_app, "handle_webhook", handle_webhook)

    class _NoopWS:
        def is_connected(self, device_id): return False
        async def send_to_device(self, *_a, **_k): return False
    monkeypatch.setattr(mr, "mobile_ws", _NoopWS())
    return state


@pytest.fixture
def client(stub_mobile_app):
    app = FastAPI()
    # Override get_current_user so the user-auth-gated routes can be
    # exercised without setting up auth.db / session tokens.
    app.dependency_overrides[get_current_user] = (
        lambda: {"username": "owner@example.com",
                  "email":    "owner@example.com",
                  "role":     "super_admin"}
    )
    app.include_router(mr.router)
    return TestClient(app)


# ─── Auth failures ──────────────────────────────────────────────────────────

def test_invalid_device_token_emits_audit_event(client):
    resp = client.post("/api/mobile/register",
                       headers={"Authorization": "Bearer not-a-real-token"},
                       json={})
    assert resp.status_code == 401
    matched = _events(scope="mobile_auth", step="mobile_device_auth_failed")
    assert len(matched) == 1
    d = _data(matched)
    assert d["path"] == "/api/mobile/register"
    assert d["provided"] is True


def test_missing_token_still_emits_audit_event(client):
    resp = client.post("/api/mobile/register", json={})
    assert resp.status_code == 401
    matched = _events(scope="mobile_auth", step="mobile_device_auth_failed")
    assert len(matched) == 1
    assert _data(matched)["provided"] is False


def test_bad_pair_code_emits_audit_event(client):
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": "WRONGCD", "device": {"platform": "ios"}},
    )
    assert resp.status_code == 400
    matched = _events(scope="mobile_auth", step="mobile_pair_failed")
    assert len(matched) == 1
    d = _data(matched)
    assert d["reason"] == "invalid_or_expired_code"
    # Last 2 chars of the attempted code — never the full string
    assert d["code_suffix"] == "CD"
    assert d["platform"] == "ios"


def test_webhook_id_mismatch_emits_audit_event(client):
    # Valid token → device.webhook_id is "wh-1"; URL says "wh-other"
    resp = client.post(
        "/api/mobile/webhook/wh-other",
        headers={"Authorization": "Bearer zgy_mb_VALID"},
        json={"some": "payload"},
    )
    assert resp.status_code == 403
    matched = _events(scope="mobile_auth", step="mobile_webhook_id_mismatch")
    assert len(matched) == 1
    d = _data(matched)
    assert d["device_id"] == "dev-1"
    assert d["url_webhook_id"] == "wh-other"


def test_ws_bad_token_emits_audit_event(client):
    # WebSocket auth-failure path. The handler now accepts the upgrade then
    # closes with code 4401 (mirrors the /ws fix in 88bd9c8 — pre-accept
    # close becomes HTTP 403 on upgrade, which surfaces as code=1006 to
    # the client). So the TestClient context enters successfully and the
    # close surfaces on the next receive.
    from starlette.websockets import WebSocketDisconnect
    with client.websocket_connect("/api/mobile/ws?token=nope") as ws:
        with pytest.raises(WebSocketDisconnect) as ei:
            ws.receive_text()
    assert ei.value.code == 4401

    # Namespace is now ws_auth (was mobile_auth) so a single grep covers
    # both /ws and /api/mobile/ws WS-auth rejections.
    matched = _events(scope="ws_auth", step="ws_auth_failed")
    assert len(matched) == 1
    d = _data(matched)
    assert d["path"] == "/api/mobile/ws"
    assert d["provided"] is True
    assert d["relay_user_attempted"] is False


# ─── Success-path audit signals ─────────────────────────────────────────────

def test_pair_code_minted_emits_audit_event(client):
    resp = client.post("/api/mobile/pair-code")
    assert resp.status_code == 200
    matched = _events(scope="mobile_auth", step="mobile_pair_code_minted")
    assert len(matched) == 1
    assert _data(matched)["user_id"] == "owner@example.com"


def test_pair_success_emits_audit_event(client):
    resp = client.post(
        "/api/mobile/pair",
        json={"pair_code": "GOODCODE", "device": {"platform": "android"}},
    )
    assert resp.status_code == 200, resp.text
    matched = _events(scope="mobile_auth", step="mobile_pair_succeeded")
    assert len(matched) == 1
    d = _data(matched)
    assert d["device_id"] == "dev-new"
    assert d["user_id"] == "owner@example.com"
    assert d["platform"] == "android"


def test_device_revoke_emits_audit_event(client):
    resp = client.delete("/api/mobile/devices/dev-mine")
    assert resp.status_code == 200
    matched = _events(scope="mobile_auth", step="mobile_device_revoked")
    assert len(matched) == 1
    d = _data(matched)
    assert d["device_id"] == "dev-mine"
    assert d["revoked_by"] == "owner@example.com"


def test_device_revoke_404_does_not_emit_revoke_event(client):
    """A 404 on revoke (someone else's device or wrong id) must NOT emit
    a revoke event — otherwise the audit trail would falsely claim the
    device was deleted."""
    resp = client.delete("/api/mobile/devices/dev-not-mine")
    assert resp.status_code == 404
    matched = _events(scope="mobile_auth", step="mobile_device_revoked")
    assert matched == []


# ─── Behavioral preservation ────────────────────────────────────────────────

def test_route_surface_unchanged():
    """The chunk added zero new routes. Confirm the count + paths match."""
    paths = sorted(r.path for r in mr.router.routes)
    assert paths == sorted([
        "/api/mobile/health",
        "/api/mobile/pair-code",
        "/api/mobile/pair",
        "/api/mobile/register",
        "/api/mobile/webhook/{webhook_id}",
        "/api/mobile/devices",
        "/api/mobile/devices/{device_id}",
        "/api/mobile/ws",
    ])


def test_health_unchanged(client):
    resp = client.get("/api/mobile/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["service"] == "mobile"


# ─── Helper unit tests ──────────────────────────────────────────────────────

def test_short_code_truncates_to_last_two():
    assert mr._short_code("ABCDEF") == "EF"
    assert mr._short_code("XY") == "XY"
    assert mr._short_code("Z") == "Z"
    assert mr._short_code("") == ""
    assert mr._short_code(None) == ""
