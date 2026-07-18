"""Tests for backend.routers.self_heal_router (refresh + snooze)."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import services.self_heal as sh
from backend.routers.self_heal_router import router


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_refresh_calls_engine(client, monkeypatch):
    async def _fake(entity_id):
        return {"ok": True, "outcome": "recovered", "state": "on"}
    monkeypatch.setattr(sh, "manual_refresh_heal", _fake)
    r = client.post("/api/self-heal/refresh", json={"entity_id": "light.k"})
    assert r.status_code == 200
    assert r.json()["outcome"] == "recovered"


def test_snooze_calls_engine(client, monkeypatch):
    seen = {}
    monkeypatch.setattr(sh, "snooze", lambda eid, minutes=720: seen.update(eid=eid, m=minutes))
    r = client.post("/api/self-heal/snooze", json={"entity_id": "light.k", "minutes": 30})
    assert r.status_code == 200
    assert seen == {"eid": "light.k", "m": 30}


def test_refresh_requires_entity_id(client):
    r = client.post("/api/self-heal/refresh", json={})
    assert r.status_code == 422
