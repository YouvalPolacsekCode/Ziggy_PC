"""Relay LLM proxy — verifies per-home HMAC auth, subscription gate, and that a
valid request is forwarded to OpenAI with the relay-held key (never the hub's).
No real OpenAI call — the upstream httpx client is stubbed.
"""
from __future__ import annotations

import importlib.util
import json as _json
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


# --- accounting (2026-09-28): the relay is the one place a home's LLM spend can be counted ----

def _rows():
    import asyncio
    async def _q():
        async with dbmod.get_db() as d:
            return [dict(r) for r in await d.execute_fetchall("SELECT * FROM llm_usage")]
    return asyncio.get_event_loop().run_until_complete(_q())


def test_a_forwarded_completion_is_counted_and_priced(db, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    async def fake_post(path, content=None, headers=None):
        return httpx.Response(200, json={"model": "gpt-4o-mini-2024-07-18", "choices": [{"message": {"content": "hi"}}],
                                         "usage": {"prompt_tokens": 1000, "completion_tokens": 100,
                                                   "prompt_tokens_details": {"cached_tokens": 400}}},
                              headers={"content-type": "application/json"})
    monkeypatch.setattr(llmmod._openai_client, "post", fake_post)
    app = FastAPI(); app.include_router(llmmod.router); c = TestClient(app)
    body = b'{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
    assert c.post(f"/api/devices/{HOME_ID}/llm/v1/chat/completions", content=body, headers=_sig(body)).status_code == 200
    rows = _rows()
    assert len(rows) == 1 and rows[0]["home_id"] == HOME_ID and rows[0]["streamed"] == 0
    assert (rows[0]["input_tokens"], rows[0]["cached_tokens"], rows[0]["output_tokens"]) == (1000, 400, 100)
    # 600 uncached × $0.15 + 400 cached × $0.075 + 100 out × $0.60, per million — priced as its family, not a guess
    assert abs(rows[0]["cost_usd"] - (600 * 0.15 + 400 * 0.075 + 100 * 0.6) / 1e6) < 1e-9 and rows[0]["estimated"] == 0


def test_an_unknown_model_is_priced_at_the_default_and_says_so():
    usd, est = llmmod.cost_usd("gpt-9-mystery", {"input_tokens": 1_000_000, "cached_tokens": 0, "output_tokens": 0})
    assert est is True and usd == llmmod.DEFAULT_PRICE[0]


def test_a_stream_asks_for_usage_and_counts_its_final_chunk(db, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    captured = {}

    class FakeStream:
        def __init__(self, method, path, content=None, headers=None):
            captured["body"] = _json.loads(content)
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def aiter_raw(self):
            yield b'data: {"id":"c1","model":"gpt-5.5","choices":[{"delta":{"content":"hi"}}]}\n\n'
            yield b'data: {"id":"c1","model":"gpt-5.5","choices":[],"usage":{"prompt_tokens":50,"completion_tokens":7}}\n\n'
            yield b'data: [DONE]\n\n'
    monkeypatch.setattr(llmmod._openai_client, "stream", FakeStream)
    app = FastAPI(); app.include_router(llmmod.router); c = TestClient(app)
    body = b'{"model":"gpt-5.5","stream":true,"messages":[{"role":"user","content":"hi"}]}'
    r = c.post(f"/api/devices/{HOME_ID}/llm/v1/chat/completions", content=body, headers=_sig(body))
    assert r.status_code == 200 and b"[DONE]" in r.content                 # the stream reached the hub intact
    assert captured["body"]["stream_options"] == {"include_usage": True}     # and OpenAI was asked for the usage
    rows = _rows()
    assert len(rows) == 1 and rows[0]["streamed"] == 1 and rows[0]["model"] == "gpt-5.5"
    assert (rows[0]["input_tokens"], rows[0]["output_tokens"]) == (50, 7)


def test_fleet_health_carries_each_homes_30_day_llm_spend(db, monkeypatch):
    import asyncio
    from datetime import datetime, timezone
    from relay.app.routers import fleet as fleetmod
    async def _seed():
        async with dbmod.get_db() as d:
            for i in range(3):
                await d.execute("INSERT INTO llm_usage (home_id, ts, model, input_tokens, cached_tokens, output_tokens, cost_usd, streamed, estimated) VALUES (?,?,?,?,?,?,?,?,?)",
                                (HOME_ID, datetime.now(timezone.utc).isoformat(timespec="seconds"), "gpt-5.5", 1000, 0, 100, 0.006, 0, 0))
            await d.execute("INSERT INTO llm_usage (home_id, ts, model, input_tokens, cached_tokens, output_tokens, cost_usd, streamed, estimated) VALUES (?,?,?,?,?,?,?,?,?)",
                            (HOME_ID, "2020-01-01T00:00:00+00:00", "gpt-5.5", 9999, 0, 9999, 9.0, 0, 0))   # too old to count
            await d.commit()
    asyncio.get_event_loop().run_until_complete(_seed())
    monkeypatch.setattr(fleetmod, "require_role", lambda role: (lambda request: None))
    app = FastAPI(); app.include_router(fleetmod.router, prefix="/api"); c = TestClient(app)
    r = c.get("/api/admin/fleet/health")
    assert r.status_code == 200, r.text
    rep = r.json()
    home = next(h for h in rep["homes"] if h["home_id"] == HOME_ID)
    assert home["llm_30d"] == {"calls": 3, "input_tokens": 3000, "cached_tokens": 0, "output_tokens": 300, "usd": 0.018, "estimated": 0}
    assert rep["summary"]["llm_30d_usd"] == 0.018
    day = c.get("/api/admin/fleet/llm?days=7").json()
    assert day["rows"][0]["home_id"] == HOME_ID and day["rows"][0]["calls"] == 3
