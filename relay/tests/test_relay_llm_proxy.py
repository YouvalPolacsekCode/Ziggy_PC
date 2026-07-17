"""Relay LLM proxy — verifies per-home HMAC auth, subscription gate, and that a
valid request is forwarded to OpenAI with the relay-held key (never the hub's).
No real OpenAI call — the upstream httpx client is stubbed.
"""
from __future__ import annotations

import importlib.util
from datetime import datetime, timezone

import pytest

_has_httpx = importlib.util.find_spec("httpx") is not None
pytestmark = pytest.mark.skipif(not _has_httpx, reason="httpx not installed")

if _has_httpx:
    import httpx
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from relay.app import database as dbmod
    from relay.app.routers import llm as llmmod
    from relay.app.main import lifespan  # noqa: F401 (import sanity)
    from core.relay_signing import sign

HOME_ID = "home-test-llm"
SECRET = "s3cr3t-relay-key"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    now = datetime.now(timezone.utc).isoformat()
    async with dbmod.get_db() as d:
        await d.execute(
            "INSERT INTO homes (id, name, type, status, subscription_state, relay_secret, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (HOME_ID, "Test", "hub", "active", "active", SECRET, now),
        )
        await d.commit()
    return dbmod


@pytest.fixture
def app_client(db, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-relay-held-key")

    captured = {}

    async def fake_post(path, content=None, headers=None):
        captured["path"] = path
        captured["auth"] = (headers or {}).get("Authorization")
        captured["body"] = content
        return httpx.Response(200, json={"choices": [{"message": {"content": "hi"}}]},
                              headers={"content-type": "application/json"})

    monkeypatch.setattr(llmmod._openai_client, "post", fake_post)

    app = FastAPI()
    app.include_router(llmmod.router)
    c = TestClient(app)
    c.captured = captured
    return c


def _sig(body: bytes) -> dict:
    return {"X-Ziggy-Signature": sign(SECRET, body), "Content-Type": "application/json"}


def test_valid_request_forwards_with_relay_key(app_client):
    body = b'{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
    r = app_client.post(f"/api/devices/{HOME_ID}/llm/v1/chat/completions",
                        content=body, headers=_sig(body))
    assert r.status_code == 200
    assert r.json()["choices"][0]["message"]["content"] == "hi"
    # forwarded to OpenAI with the RELAY's key, and the exact hub body
    assert app_client.captured["path"] == "/v1/chat/completions"
    assert app_client.captured["auth"] == "Bearer sk-relay-held-key"
    assert app_client.captured["body"] == body


def test_bad_signature_rejected(app_client):
    body = b'{"model":"gpt-4o"}'
    r = app_client.post(f"/api/devices/{HOME_ID}/llm/v1/chat/completions",
                        content=body, headers={"X-Ziggy-Signature": "t=1,v1=deadbeef"})
    assert r.status_code == 401
    assert "path" not in app_client.captured  # never forwarded


def test_unknown_home_rejected(app_client):
    body = b'{}'
    r = app_client.post("/api/devices/home-does-not-exist/llm/v1/chat/completions",
                        content=body, headers=_sig(body))
    assert r.status_code == 404


def test_inactive_subscription_rejected(db, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")

    async def _flip():
        async with dbmod.get_db() as d:
            await d.execute("UPDATE homes SET subscription_state='canceled' WHERE id=?", (HOME_ID,))
            await d.commit()

    import asyncio
    asyncio.get_event_loop().run_until_complete(_flip())

    app = FastAPI()
    app.include_router(llmmod.router)
    c = TestClient(app)
    body = b'{}'
    r = c.post(f"/api/devices/{HOME_ID}/llm/v1/chat/completions", content=body, headers=_sig(body))
    assert r.status_code == 402


def test_missing_relay_key_is_503(db, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    app = FastAPI()
    app.include_router(llmmod.router)
    c = TestClient(app)
    body = b'{}'
    r = c.post(f"/api/devices/{HOME_ID}/llm/v1/chat/completions", content=body, headers=_sig(body))
    assert r.status_code == 503
