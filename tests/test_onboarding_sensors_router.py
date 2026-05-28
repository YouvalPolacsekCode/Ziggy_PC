"""Tests for backend/routers/onboarding_sensors_router.py — Prompt 7 chunk 2.7.

Coverage:
  - 401 when no device token is provided
  - Manifest sensors joined with HA registry: matched device returns
    paired=True with ha_device_id + current_name + current_area_name
  - Manifest sensor that doesn't match any HA device returns paired=False
  - HA returns devices that aren't in the manifest → NOT included in the
    response (manifest is source of truth)
  - HA registry call fails → ha_reachable=False, sensors all paired=False
  - Empty manifest → empty sensors list + manifest_loaded=False
  - MAC matching is case-insensitive AND separator-insensitive
  - Area name lookup via area_id → area_name resolution
  - mac/zigbee variants in HA connections both match
"""
from __future__ import annotations

from pathlib import Path
import textwrap

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import onboarding_sensors_router as osr
from backend.routers import mobile_router as mr
from services import mobile_app


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    # Isolate mobile_app storage so the device-token auth dep can see our
    # test device record without hitting real disk.
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    # Isolate the kit manifest behind the env override.
    monkeypatch.setenv("ZIGGY_KIT_MANIFEST_PATH", str(tmp_path / "kit_manifest.yaml"))
    yield


def _write_manifest(path: Path, body: str) -> None:
    Path(__import__("os").environ["ZIGGY_KIT_MANIFEST_PATH"]).write_text(
        textwrap.dedent(body).lstrip(), encoding="utf-8"
    )


def _client_with_device() -> tuple[TestClient, str]:
    """Build a TestClient and register a real device record so the auth
    dep returns it. Returns (client, auth_token)."""
    rec = mobile_app.register_device(
        user_id="alice@example.com",
        device_info={"platform": "ios"},
    )
    app = FastAPI()
    app.include_router(osr.router)
    return TestClient(app), rec["auth_token"]


def _patch_ha_snapshot(monkeypatch: pytest.MonkeyPatch, snap_or_exc):
    """Patch services.ha_areas.get_registry_snapshot in the router's
    imported module namespace. Accepts a dict (returned) or an Exception
    (raised)."""
    async def fake(*_a, **_k):
        if isinstance(snap_or_exc, Exception):
            raise snap_or_exc
        return snap_or_exc
    monkeypatch.setattr(osr.ha_areas, "get_registry_snapshot", fake)


# ── auth ─────────────────────────────────────────────────────────────────────

def test_401_without_device_token(monkeypatch: pytest.MonkeyPatch):
    app = FastAPI()
    app.include_router(osr.router)
    client = TestClient(app)
    resp = client.get("/api/onboarding/sensors")
    assert resp.status_code == 401


def test_401_with_invalid_device_token(monkeypatch: pytest.MonkeyPatch):
    app = FastAPI()
    app.include_router(osr.router)
    client = TestClient(app)
    resp = client.get(
        "/api/onboarding/sensors",
        headers={"Authorization": "Bearer zgy_mb_NOT_A_REAL_TOKEN"},
    )
    assert resp.status_code == 401


# ── manifest × HA join ───────────────────────────────────────────────────────

def test_matched_sensor_returns_paired_true_with_ha_metadata(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _write_manifest(tmp_path, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: 00:15:8d:00:01:23:45:67
            intended_room_label_he: סלון
            intended_room_label_en: Living Room
    """)
    _patch_ha_snapshot(monkeypatch, {
        "devices": [
            {
                "id":          "ha_dev_001",
                "name":        "Aqara Motion Sensor",
                "name_by_user": "Living Room Motion",
                "area_id":     "area_living",
                "connections": [["zigbee", "00:15:8D:00:01:23:45:67"]],
            }
        ],
        "areas": [{"area_id": "area_living", "name": "סלון"}],
        "entities": [],
    })

    client, token = _client_with_device()
    resp = client.get(
        "/api/onboarding/sensors",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["manifest_loaded"] is True
    assert body["ha_reachable"] is True
    assert len(body["sensors"]) == 1
    s = body["sensors"][0]
    assert s["paired"] is True
    assert s["ha_device_id"] == "ha_dev_001"
    assert s["current_name"] == "Living Room Motion"   # name_by_user wins
    assert s["current_area_name"] == "סלון"
    assert s["intended_label_he"] == "סלון"
    assert s["intended_label_en"] == "Living Room"
    assert s["device_type"] == "motion"


def test_unmatched_manifest_sensor_returns_paired_false(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _write_manifest(tmp_path, """
        sensors:
          - device_type: door
            vendor_model: aqara_t1
            zigbee_mac: AA:BB:CC:DD:EE:FF
            intended_room_label_he: כניסה
            intended_room_label_en: Front Door
    """)
    _patch_ha_snapshot(monkeypatch, {
        "devices": [{"id": "x", "connections": [["zigbee", "11:22:33:44:55:66"]]}],
        "areas": [],
        "entities": [],
    })

    client, token = _client_with_device()
    resp = client.get(
        "/api/onboarding/sensors",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["sensors"]) == 1
    s = body["sensors"][0]
    assert s["paired"] is False
    assert s["ha_device_id"] is None
    assert s["current_name"] is None


def test_ha_devices_not_in_manifest_are_not_returned(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _write_manifest(tmp_path, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: AA:BB
            intended_room_label_he: סלון
            intended_room_label_en: Living
    """)
    _patch_ha_snapshot(monkeypatch, {
        "devices": [
            {"id": "manifest_match", "connections": [["zigbee", "aa:bb"]]},
            {"id": "stray_device",   "connections": [["zigbee", "ff:ee"]]},
            {"id": "no_zigbee",      "connections": [["mqtt", "foo"]]},
        ],
        "areas": [],
        "entities": [],
    })

    client, token = _client_with_device()
    resp = client.get(
        "/api/onboarding/sensors",
        headers={"Authorization": f"Bearer {token}"},
    )
    body = resp.json()
    assert len(body["sensors"]) == 1                     # only the manifest one
    assert body["sensors"][0]["ha_device_id"] == "manifest_match"


# ── HA failure modes ─────────────────────────────────────────────────────────

def test_ha_unreachable_returns_paired_false_and_ha_reachable_false(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _write_manifest(tmp_path, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: AA:BB
            intended_room_label_he: סלון
            intended_room_label_en: Living
    """)
    _patch_ha_snapshot(monkeypatch, RuntimeError("HA WebSocket timeout"))

    client, token = _client_with_device()
    resp = client.get(
        "/api/onboarding/sensors",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ha_reachable"] is False
    assert body["manifest_loaded"] is True
    assert len(body["sensors"]) == 1
    assert body["sensors"][0]["paired"] is False


# ── Manifest absence ─────────────────────────────────────────────────────────

def test_empty_manifest_returns_empty_sensors_and_manifest_loaded_false(
    monkeypatch: pytest.MonkeyPatch
):
    # No manifest file written — env override points at a non-existent path.
    _patch_ha_snapshot(monkeypatch, {"devices": [], "areas": [], "entities": []})

    client, token = _client_with_device()
    resp = client.get(
        "/api/onboarding/sensors",
        headers={"Authorization": f"Bearer {token}"},
    )
    body = resp.json()
    assert body["manifest_loaded"] is False
    assert body["sensors"] == []


# ── MAC matching ─────────────────────────────────────────────────────────────

def test_mac_match_is_case_and_separator_insensitive(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    _write_manifest(tmp_path, """
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: "00:15:8d:00:aa:bb"
            intended_room_label_en: Hall
            intended_room_label_he: מסדרון
    """)
    _patch_ha_snapshot(monkeypatch, {
        # HA reports it with no colons + uppercase + a different connection kind
        "devices": [{"id": "ha_dev", "connections": [["mac", "00158D00AABB"]]}],
        "areas": [],
        "entities": [],
    })

    client, token = _client_with_device()
    resp = client.get(
        "/api/onboarding/sensors",
        headers={"Authorization": f"Bearer {token}"},
    )
    body = resp.json()
    assert body["sensors"][0]["paired"] is True


# ── _ha_device_by_mac helper directly ────────────────────────────────────────

def test_helper_returns_none_for_empty_mac():
    assert osr._ha_device_by_mac(
        [{"id": "x", "connections": [["zigbee", "AA:BB"]]}], ""
    ) is None


def test_helper_skips_malformed_connection_entries():
    """Defence against a corrupt connections entry; should still find the
    valid match further down the list."""
    devices = [
        {"id": "skip_me", "connections": [None, ["zigbee"], "not-a-pair"]},
        {"id": "real",    "connections": [["zigbee", "AA:BB"]]},
    ]
    found = osr._ha_device_by_mac(devices, "aa:bb")
    assert found is not None and found["id"] == "real"
