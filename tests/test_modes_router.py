"""/api/modes and the legacy /api/mode facade."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import auth_deps
from backend.routers import modes_router as MR
from backend.routers import mode_router as LegacyMR
from services import local_automation_actions as laa
from services import modes as M


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    for h in ("_publish_hook", "_broadcast_hook", "_side_effect_hook"):
        monkeypatch.setattr(M, h, lambda *a, **k: None)
    app = FastAPI()
    app.include_router(MR.router)
    app.include_router(LegacyMR.router)
    app.dependency_overrides[auth_deps.get_current_user] = lambda: {"username": "youval", "role": "owner"}
    return TestClient(app)


def test_list_and_set(client):
    assert [m["id"] for m in client.get("/api/modes").json()["modes"]] == list(M.MODES)
    r = client.post("/api/modes/movie", json={"on": True, "hours": 1})
    assert r.status_code == 200 and r.json()["on"] and r.json()["by"] == "youval"
    assert r.json()["until"] is not None
    assert client.post("/api/modes/party", json={"on": True}).status_code == 400
    r = client.post("/api/modes/movie", json={"on": False})
    assert r.status_code == 200 and not r.json()["on"]


def test_legacy_facade(client):
    assert client.get("/api/mode").json()["mode"] == "home"
    assert set(client.get("/api/mode/options").json()["modes"]) == {"home", "away", "night", "vacation"}
    client.post("/api/mode", json={"mode": "night"})
    assert M.is_on("sleep") and client.get("/api/mode").json()["mode"] == "night"
    client.post("/api/mode", json={"mode": "vacation"})
    assert M.is_on("vacation") and not M.is_on("sleep")
    client.post("/api/mode", json={"mode": "home"})
    assert not M.is_on("sleep") and not M.is_on("vacation")
    assert client.post("/api/mode", json={"mode": "party"}).status_code == 400
