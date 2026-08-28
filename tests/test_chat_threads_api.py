"""Thread CRUD HTTP endpoints wire the durable store into the app."""
import pytest

from services import chat_threads as ct


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(ct, "_DB_PATH", tmp_path / "threads.db")
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.routers.intent_router import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def test_thread_crud_roundtrip(client):
    tid = client.post("/api/threads").json()["thread_id"]
    assert tid.startswith("th_")

    assert client.get(f"/api/threads/{tid}").json()["messages"] == []

    ct.append_message(tid, "user", "why won't my light turn on?")
    listed = client.get("/api/threads").json()["threads"]
    assert any(t["thread_id"] == tid for t in listed)

    client.patch(f"/api/threads/{tid}", json={"title": "Kitchen light"})
    assert client.get(f"/api/threads/{tid}").json()["title"] == "Kitchen light"

    client.delete(f"/api/threads/{tid}")
    assert client.get(f"/api/threads/{tid}").status_code == 404


def test_get_missing_thread_404(client):
    assert client.get("/api/threads/th_missing").status_code == 404


def test_ownership_blocks_idor_and_hijack(client, monkeypatch):
    import backend.routers.intent_router as ir

    # Actor A creates a thread.
    monkeypatch.setattr(ir, "_actor_ref", lambda req: "person:a")
    tid = client.post("/api/threads").json()["thread_id"]

    # Actor B must not be able to read / rename / delete / chat into A's thread.
    monkeypatch.setattr(ir, "_actor_ref", lambda req: "person:b")
    assert client.get(f"/api/threads/{tid}").status_code == 403
    assert client.patch(f"/api/threads/{tid}", json={"title": "x"}).status_code == 403
    assert client.delete(f"/api/threads/{tid}").status_code == 403
    assert client.post("/api/chat", json={"text": "hi", "thread_id": tid}).status_code == 403

    # B also can't SEE A's thread in the list.
    assert all(t["thread_id"] != tid for t in client.get("/api/threads").json()["threads"])

    # Owner A retains access.
    monkeypatch.setattr(ir, "_actor_ref", lambda req: "person:a")
    assert client.get(f"/api/threads/{tid}").status_code == 200
