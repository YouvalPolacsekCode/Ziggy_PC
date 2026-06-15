"""Tests for /api/onboarding/sensors/confirm — Prompt 7 chunk 3.2.

Coverage:
  - 401 when device token missing
  - Empty body → ok=True, confirmed=0
  - Rename + assign to an existing area → confirmed += 1
  - Assign to a new room → area is auto-created then assigned
  - Two entries naming the same new room create only ONE area (dedupe)
  - Rename failure → entry in failed[], no area touch attempted
  - Assign-area failure → entry in failed[]
  - Mixed batch: some succeed, some fail, response reports both
  - HA registry fetch fails → 503
  - Idempotent: applying the same payload twice succeeds twice
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core.debug_bus import bus, BASIC, OFF
from backend.routers import onboarding_sensors_router as osr
from backend.routers import mobile_router as mr
from services import mobile_app


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
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


def _patch_snapshot(monkeypatch: pytest.MonkeyPatch, snap_or_exc):
    async def fake(*_a, **_k):
        if isinstance(snap_or_exc, Exception):
            raise snap_or_exc
        return snap_or_exc
    monkeypatch.setattr(osr.ha_areas, "get_registry_snapshot", fake)


def _stub_ha_ops(
    monkeypatch: pytest.MonkeyPatch,
    *,
    rename_results: dict[str, dict] = None,
    create_area_result: dict = None,
    assign_results: dict[tuple[str, str], dict] = None,
) -> dict:
    """Wire fakes for ha_zigbee.rename_device, ha_areas.create_area, and
    ha_areas.assign_device_to_area. Returns a `calls` dict the tests can
    inspect.
    """
    calls: dict = {"rename": [], "create_area": [], "assign": []}

    async def fake_rename(device_id: str, name: str) -> dict:
        calls["rename"].append((device_id, name))
        return (rename_results or {}).get(device_id, {"ok": True})

    async def fake_create_area(name: str) -> dict:
        calls["create_area"].append(name)
        if create_area_result is not None:
            return create_area_result
        return {"ok": True, "area": {"area_id": f"area_{name.lower().replace(' ', '_')}", "name": name}}

    async def fake_assign(device_id: str, area_id: str) -> dict:
        calls["assign"].append((device_id, area_id))
        return (assign_results or {}).get((device_id, area_id), {"ok": True})

    monkeypatch.setattr(osr.ha_zigbee, "rename_device",          fake_rename)
    monkeypatch.setattr(osr.ha_areas, "create_area",            fake_create_area)
    monkeypatch.setattr(osr.ha_areas, "assign_device_to_area",  fake_assign)
    return calls


# ── Auth ─────────────────────────────────────────────────────────────────────

def test_confirm_401_without_token(client: TestClient):
    resp = client.post("/api/onboarding/sensors/confirm", json={"sensors": []})
    assert resp.status_code == 401


# ── Empty body ───────────────────────────────────────────────────────────────

def test_confirm_empty_body_returns_zero_confirmed(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    # No HA call should happen with an empty body — don't even patch snapshot
    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": []},
    )
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "confirmed": 0, "failed": []}


# ── Happy path ───────────────────────────────────────────────────────────────

def test_rename_and_assign_existing_area(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {
        "areas": [{"area_id": "area_living", "name": "Living Room"}],
        "devices": [], "entities": [],
    })
    calls = _stub_ha_ops(monkeypatch)

    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [
            {"ha_device_id": "dev_001", "name": "Couch Motion", "room_name": "Living Room"},
        ]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"ok": True, "confirmed": 1, "failed": []}
    assert calls["rename"]      == [("dev_001", "Couch Motion")]
    assert calls["create_area"] == []                                # existing
    assert calls["assign"]      == [("dev_001", "area_living")]


def test_assign_to_new_room_creates_area(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {"areas": [], "devices": [], "entities": []})
    calls = _stub_ha_ops(monkeypatch)

    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [
            {"ha_device_id": "dev_001", "room_name": "Kitchen"},
        ]},
    )
    assert resp.status_code == 200
    assert resp.json()["confirmed"] == 1
    assert calls["create_area"] == ["Kitchen"]
    assert calls["assign"]      == [("dev_001", "area_kitchen")]


def test_two_entries_same_new_room_create_one_area(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {"areas": [], "devices": [], "entities": []})
    calls = _stub_ha_ops(monkeypatch)

    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [
            {"ha_device_id": "dev_a", "room_name": "Kitchen"},
            {"ha_device_id": "dev_b", "room_name": "KITCHEN"},  # different case
        ]},
    )
    assert resp.status_code == 200
    assert resp.json()["confirmed"] == 2
    assert calls["create_area"] == ["Kitchen"]               # one create call
    assert ("dev_a", "area_kitchen") in calls["assign"]
    assert ("dev_b", "area_kitchen") in calls["assign"]


# ── Failure paths ────────────────────────────────────────────────────────────

def test_rename_failure_adds_to_failed_and_skips_assign(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {"areas": [], "devices": [], "entities": []})
    calls = _stub_ha_ops(
        monkeypatch,
        rename_results={"dev_001": {"ok": False, "error": "unknown device"}},
    )
    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [
            {"ha_device_id": "dev_001", "name": "Try", "room_name": "Living"},
        ]},
    )
    body = resp.json()
    assert body["confirmed"] == 0
    assert body["failed"] == [
        {"ha_device_id": "dev_001", "error": "rename: unknown device"},
    ]
    # No assign attempt after rename failure
    assert calls["assign"] == []


def test_assign_failure_adds_to_failed(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {
        "areas": [{"area_id": "area_living", "name": "Living"}],
        "devices": [], "entities": [],
    })
    _stub_ha_ops(
        monkeypatch,
        assign_results={("dev_001", "area_living"): {"ok": False, "error": "HA timeout"}},
    )
    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [
            {"ha_device_id": "dev_001", "room_name": "Living"},
        ]},
    )
    body = resp.json()
    assert body["confirmed"] == 0
    assert body["failed"] == [
        {"ha_device_id": "dev_001", "error": "assign_area: HA timeout"},
    ]


def test_create_area_failure_adds_to_failed(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {"areas": [], "devices": [], "entities": []})
    _stub_ha_ops(
        monkeypatch,
        create_area_result={"ok": False, "error": "duplicate"},
    )
    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [
            {"ha_device_id": "dev_001", "room_name": "Brand New Room"},
        ]},
    )
    body = resp.json()
    assert body["failed"] == [
        {"ha_device_id": "dev_001", "error": "create_area: duplicate"},
    ]


def test_mixed_batch_reports_both(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {
        "areas": [{"area_id": "area_living", "name": "Living"}],
        "devices": [], "entities": [],
    })
    _stub_ha_ops(
        monkeypatch,
        rename_results={"dev_bad": {"ok": False, "error": "no such device"}},
    )
    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [
            {"ha_device_id": "dev_ok",  "name": "OK", "room_name": "Living"},
            {"ha_device_id": "dev_bad", "name": "Bad"},
            {"ha_device_id": "dev_ok2", "name": "OK2"},
        ]},
    )
    body = resp.json()
    assert body["confirmed"] == 2
    assert len(body["failed"]) == 1
    assert body["failed"][0]["ha_device_id"] == "dev_bad"
    assert body["ok"] is False


def test_missing_ha_device_id_entry_added_to_failed(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {"areas": [], "devices": [], "entities": []})
    _stub_ha_ops(monkeypatch)
    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [
            {"ha_device_id": "   ", "name": "X"},
        ]},
    )
    body = resp.json()
    assert body["failed"][0]["error"] == "missing ha_device_id"


# ── HA registry unreachable ──────────────────────────────────────────────────

def test_503_when_ha_unreachable(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, RuntimeError("HA WS down"))
    resp = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json={"sensors": [{"ha_device_id": "dev_001", "name": "X"}]},
    )
    assert resp.status_code == 503


# ── Idempotency ──────────────────────────────────────────────────────────────

def test_apply_twice_succeeds_twice(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _patch_snapshot(monkeypatch, {
        "areas": [{"area_id": "area_living", "name": "Living Room"}],
        "devices": [], "entities": [],
    })
    _stub_ha_ops(monkeypatch)
    payload = {"sensors": [
        {"ha_device_id": "dev_001", "name": "X", "room_name": "Living Room"},
    ]}
    a = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    b = client.post(
        "/api/onboarding/sensors/confirm",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert a.status_code == 200 and b.status_code == 200
    assert a.json()["confirmed"] == 1 and b.json()["confirmed"] == 1
