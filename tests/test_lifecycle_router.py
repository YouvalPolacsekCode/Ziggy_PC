"""Tests for backend/routers/lifecycle_router.py (Stream 5).

Coverage:
  - dry_run returns a plan WITHOUT writing a trigger file
  - a real (confirmed) request writes an atomic intent file to the spool dir
  - destructive actions refuse to run without confirm=true (unless dry_run)
  - safe-mode (non-destructive) does not require confirm
  - the status endpoint reports installed scripts + spool state
  - all endpoints are super_admin gated (a plain user gets 403)
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import lifecycle_router as lc
from backend.routers.lifecycle_router import router as lifecycle_router
from backend.routers.auth_deps import get_current_user


@pytest.fixture
def spool(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    d = tmp_path / "lifecycle"
    scripts = tmp_path / "scripts"
    monkeypatch.setattr(
        lc, "_cfg",
        lambda: {"spool_dir": str(d), "script_dir": str(scripts), "exec_mode": "spool"},
    )
    return d


def _client(role: str = "super_admin") -> TestClient:
    app = FastAPI()
    app.include_router(lifecycle_router)
    app.dependency_overrides[get_current_user] = lambda: {"username": "owner@ziggy", "role": role}
    return TestClient(app)


def test_dry_run_does_not_write_trigger(spool: Path):
    client = _client()
    r = client.post("/api/admin/factory-reset", json={"dry_run": True})
    assert r.status_code == 200
    body = r.json()
    assert body["dry_run"] is True
    assert body["queued"] is False
    assert body["script"] == "ziggy-factory-reset.sh"
    # Nothing queued for the host watcher.
    assert not spool.exists() or list(spool.glob("*.request.json")) == []


def test_confirmed_request_writes_intent_file(spool: Path):
    client = _client()
    r = client.post("/api/admin/factory-reset", json={"confirm": True, "reason": "beta wipe"})
    assert r.status_code == 200
    body = r.json()
    assert body["queued"] is True
    files = list(spool.glob("*.request.json"))
    assert len(files) == 1
    intent = json.loads(files[0].read_text(encoding="utf-8"))
    assert intent["action"] == "factory-reset"
    assert intent["requested_by"] == "owner@ziggy"
    assert intent["reason"] == "beta wipe"
    assert intent["dry_run"] is False


def test_destructive_requires_confirm(spool: Path):
    client = _client()
    r = client.post("/api/admin/customer-reset", json={})
    assert r.status_code == 400
    assert "confirm" in r.json()["detail"].lower()
    # No file written on the rejected request.
    assert not spool.exists() or list(spool.glob("*.request.json")) == []


def test_safe_mode_does_not_require_confirm(spool: Path):
    client = _client()
    r = client.post("/api/admin/safe-mode", json={})
    assert r.status_code == 200
    assert r.json()["queued"] is True
    assert len(list(spool.glob("*.request.json"))) == 1


def test_status_reports_scripts_and_spool(spool: Path):
    client = _client()
    r = client.get("/api/admin/lifecycle/status")
    assert r.status_code == 200
    body = r.json()
    assert body["exec_mode"] == "spool"
    assert set(body["scripts"].keys()) == {"factory-reset", "safe-mode", "customer-reset"}
    # Scripts not installed in the tmp script dir → installed False.
    assert body["scripts"]["factory-reset"]["installed"] is False


def test_non_admin_forbidden(spool: Path):
    client = _client(role="user")
    r = client.post("/api/admin/safe-mode", json={})
    assert r.status_code == 403
