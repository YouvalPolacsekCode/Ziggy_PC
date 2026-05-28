"""Tests for GET /api/onboarding/starter-pack — Prompt 7 chunk 3.3.

The endpoint thin-wraps services/starter_pack.list_available; these tests
verify the auth + HA-failure paths and the response wire shape.
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
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    monkeypatch.setenv("ZIGGY_KIT_MANIFEST_PATH", str(tmp_path / "kit_manifest.yaml"))
    monkeypatch.setenv("ZIGGY_STARTER_PACK_PATH", str(tmp_path / "starters.yaml"))

    class _NoopWS:
        def is_connected(self, device_id): return False
        async def send_to_device(self, *_a, **_k): return False
    monkeypatch.setattr(mr, "mobile_ws", _NoopWS())
    yield


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


def _write_manifest(body: str) -> None:
    p = Path(__import__("os").environ["ZIGGY_KIT_MANIFEST_PATH"])
    p.write_text(textwrap.dedent(body).lstrip(), encoding="utf-8")


def _write_starters(body: str) -> None:
    p = Path(__import__("os").environ["ZIGGY_STARTER_PACK_PATH"])
    p.write_text(textwrap.dedent(body).lstrip(), encoding="utf-8")


def _patch_snapshot(monkeypatch: pytest.MonkeyPatch, snap_or_exc):
    async def fake(*_a, **_k):
        if isinstance(snap_or_exc, Exception):
            raise snap_or_exc
        return snap_or_exc
    monkeypatch.setattr(osr.ha_areas, "get_registry_snapshot", fake)


# ── Auth ─────────────────────────────────────────────────────────────────────

def test_starter_pack_401_without_token(client: TestClient):
    resp = client.get("/api/onboarding/starter-pack")
    assert resp.status_code == 401


# ── Happy path ───────────────────────────────────────────────────────────────

def test_returns_only_resolvable_starters_with_substituted_payload(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _write_manifest("""
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: AA:BB:CC:DD:EE:FF
            intended_room_label_en: Living
            intended_room_label_he: סלון
    """)
    _write_starters("""
        - id: motion_notify
          label_en: Motion alert
          label_he: התראת תנועה
          description_en: Notify on motion.
          description_he: התראה בעת תנועה.
          slots:
            - name: motion_entity
              device_type: motion
              ha_domain: binary_sensor
          ha_payload:
            name: Motion alert
            trigger: {type: state, entity_id: "{{motion_entity}}", state: "on"}
            actions: [{type: notify, message: motion!}]
            rooms: []
        - id: needs_bulb
          label_en: Light on
          label_he: אור דולק
          description_en: Needs a bulb.
          description_he: צריך נורה.
          slots:
            - name: light_entity
              device_type: bulb
              ha_domain: light
          ha_payload:
            name: Light on
            trigger: {type: state, entity_id: "{{light_entity}}", state: "off"}
            actions: []
            rooms: []
    """)
    _patch_snapshot(monkeypatch, {
        "devices":  [{"id": "dev_motion", "connections": [["zigbee", "aa:bb:cc:dd:ee:ff"]]}],
        "entities": [{"entity_id": "binary_sensor.living_motion", "device_id": "dev_motion"}],
        "areas":    [],
    })

    resp = client.get(
        "/api/onboarding/starter-pack",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ha_reachable"] is True
    assert len(body["starters"]) == 1
    s = body["starters"][0]
    assert s["id"] == "motion_notify"
    assert s["label_he"] == "התראת תנועה"
    assert s["ha_payload"]["trigger"]["entity_id"] == "binary_sensor.living_motion"


def test_empty_starters_when_manifest_empty(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _write_starters("""
        - id: needs_motion
          label_en: M
          label_he: מ
          slots: [{name: e, device_type: motion, ha_domain: binary_sensor}]
          ha_payload: {name: M}
    """)
    _patch_snapshot(monkeypatch, {"devices": [], "entities": [], "areas": []})
    resp = client.get(
        "/api/onboarding/starter-pack",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["starters"] == []
    assert body["ha_reachable"] is True


# ── HA failure ───────────────────────────────────────────────────────────────

def test_ha_unreachable_returns_ha_reachable_false_and_empty_list(
    client: TestClient, token: str, monkeypatch: pytest.MonkeyPatch
):
    _write_manifest("""
        sensors:
          - device_type: motion
            vendor_model: aqara_p1
            zigbee_mac: aa:bb
            intended_room_label_en: Living
            intended_room_label_he: סלון
    """)
    _write_starters("""
        - id: notify
          label_en: M
          label_he: מ
          slots: [{name: e, device_type: motion, ha_domain: binary_sensor}]
          ha_payload: {name: M}
    """)
    _patch_snapshot(monkeypatch, RuntimeError("HA WS down"))
    resp = client.get(
        "/api/onboarding/starter-pack",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ha_reachable"] is False
    # No starters resolvable without HA — confirms graceful degradation
    assert body["starters"] == []
