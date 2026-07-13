"""Tests for backend/routers/first_boot_router.py — Prompt 7 chunk 2.6.

Coverage:
  - GET /pair returns 200 HTML in first-boot state with the QR + code
  - GET /pair returns 200 HTML in completed state with "already set up"
  - QR payload encodes claim=true, the right code/device_id, and host
  - GET /api/onboarding/first-boot/qr.json returns the QR JSON
  - GET /api/onboarding/first-boot/qr.json 404s after completion
  - Routes are unauthenticated (no Authorization header required)
"""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers.first_boot_router import (
    router as first_boot_router,
    _build_qr_url,
    _host_from_request,
)
from services import first_boot, mobile_app


@pytest.fixture(autouse=True)
def _isolated(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ZIGGY_DEVICE_ID_PATH",          str(tmp_path / "device_id"))
    monkeypatch.setenv("ZIGGY_FALLBACK_DEVICE_ID_PATH", str(tmp_path / "fallback_id"))
    monkeypatch.setenv("ZIGGY_FIRST_BOOT_STATE_PATH",   str(tmp_path / "first_boot.json"))
    monkeypatch.setattr(mobile_app, "_PAIR_FILE",    tmp_path / "pair.json")
    monkeypatch.setattr(mobile_app, "_DEVICES_FILE", tmp_path / "devices.json")
    # Pin a stable factory-set device_id for stable assertions.
    Path(tmp_path / "device_id").write_text("edge_test_box_001", encoding="utf-8")
    yield


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.include_router(first_boot_router)
    # First-boot endpoints are LAN-gated (is_lan_request); bind a loopback peer
    # so this fixture models the real on-network onboarding phone.
    return TestClient(app, client=("127.0.0.1", 50000))


# ── /pair HTML ───────────────────────────────────────────────────────────────

def test_pair_page_renders_qr_in_first_boot(client: TestClient):
    resp = client.get("/pair")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    html = resp.text
    # The 6-char code should appear in the page
    qr = first_boot.snapshot()
    assert qr["claim_code"] in html
    # Hebrew + English copy both present (nativized copy)
    assert "בואו נחבר את זיגי" in html
    assert "Open the Ziggy Home app" in html
    # device_id shows in the diagnostic footer
    assert "edge_test_box_001" in html
    # An SVG QR is embedded inline (segno's svg_inline output)
    assert "<svg" in html


def test_pair_page_renders_done_state_after_completion(client: TestClient):
    first_boot.mark_onboarding_complete()
    resp = client.get("/pair")
    assert resp.status_code == 200
    html = resp.text
    assert "already set up" in html
    assert "<svg" not in html
    # The "done" Hebrew copy (nativized)
    assert "זיגי שלכם כבר מוכן" in html


def test_pair_page_does_not_require_auth(client: TestClient):
    # Explicit "no Authorization header" case + a junk header case — both
    # should succeed.
    assert client.get("/pair").status_code == 200
    assert client.get("/pair", headers={"Authorization": "Bearer junk"}).status_code == 200


# ── /api/onboarding/first-boot/qr.json ───────────────────────────────────────

def test_qr_json_returns_payload_in_first_boot(client: TestClient):
    resp = client.get("/api/onboarding/first-boot/qr.json")
    assert resp.status_code == 200
    body = resp.json()
    assert body["device_id"] == "edge_test_box_001"
    assert len(body["code"]) == 6
    assert body["ttl_seconds"] > 0
    assert body["expires_at"]
    # QR payload contract: ziggy://pair?code=...&device_id=...&claim=true&host=...
    payload = body["qr_payload"]
    assert payload.startswith("ziggy://pair?")
    assert f"code={body['code']}" in payload
    assert "device_id=edge_test_box_001" in payload
    assert "claim=true" in payload
    assert "host=" in payload
    assert body["lan_host"]


def test_qr_json_404s_after_completion(client: TestClient):
    first_boot.mark_onboarding_complete()
    resp = client.get("/api/onboarding/first-boot/qr.json")
    assert resp.status_code == 404


# ── helpers ──────────────────────────────────────────────────────────────────

def test_build_qr_url_encodes_special_chars():
    """Defensive: device_ids are UUIDs (URL-safe) and codes are A-Z 2-9,
    but the helper should still url-encode if anything else slips in."""
    url = _build_qr_url("ABC=DEF", "id with space", "192.168.1.10:5050")
    assert "code=ABC%3DDEF" in url
    assert "device_id=id%20with%20space" in url
    assert "host=192.168.1.10%3A5050" in url
    assert "claim=true" in url
