import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routers import auth_deps
from backend.routers import light_hold_router as R
from services import local_automation_actions as laa
from services import light_hold as LH


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: ("kitchen", None))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)
    app = FastAPI()
    app.include_router(R.router)
    app.dependency_overrides[auth_deps.get_current_user] = lambda: {"username": "y"}
    return TestClient(app)


def test_list_and_release(client):
    LH.on_manual_off("light.a", now=1.0)
    holds = client.get("/api/light-holds").json()["holds"]
    assert holds[0]["entity_id"] == "light.a" and holds[0]["state"] == "held" and holds[0]["room"] == "kitchen"
    assert client.post("/api/light-holds/light.a/release").json()["released"] is True
    assert client.get("/api/light-holds").json()["holds"] == []
    assert client.post("/api/light-holds/light.a/release").json()["released"] is False
