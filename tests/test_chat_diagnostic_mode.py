"""Diagnostic-mode trigger + per-thread mode + entitlement gate (intent_router, chat_threads)."""
import asyncio
from pathlib import Path

import pytest

from backend.routers import intent_router as R
from services import chat_threads as ct
from services import entitlements as E


@pytest.fixture(autouse=True)
def _tmp_thread_db(tmp_path, monkeypatch):
    monkeypatch.setattr(ct, "_DB_PATH", tmp_path / "threads.db")
    monkeypatch.setattr(ct, "_memo", None, raising=False)
    yield


@pytest.fixture(autouse=True)
def _no_broadcast(monkeypatch):
    async def _noop(payload):
        return None
    monkeypatch.setattr(R.manager, "broadcast", _noop)


def test_trigger_detection_is_exact_and_bilingual():
    assert R._is_mode_trigger("claude ziggy")
    assert R._is_mode_trigger("  Claude, Ziggy!  ")
    assert R._is_mode_trigger("קלוד זיגי")
    assert not R._is_mode_trigger("claude ziggy turn on the light")
    assert not R._is_mode_trigger("")


def test_thread_mode_round_trip_and_migration():
    tid = ct.create_thread(owner="person:a")
    assert ct.get_thread(tid)["mode"] is None
    ct.set_mode(tid, "diagnostic")
    assert ct.get_thread(tid)["mode"] == "diagnostic"
    ct.set_mode(tid, None)
    assert ct.get_thread(tid)["mode"] is None


def test_toggle_on_then_off_on_a_thread(monkeypatch):
    monkeypatch.setattr(E, "has", lambda f, path=None: True)
    tid = ct.create_thread(owner="person:a")
    r1 = asyncio.run(R._handle_mode_trigger("קלוד זיגי", "web", "req1", tid, None, "person:a"))
    assert r1["data"]["kind"] == "mode_changed" and r1["data"]["mode"] == "diagnostic"
    assert "אבחון" in r1["reply"] and r1["data"]["spoken"]
    assert ct.get_thread(tid)["mode"] == "diagnostic"
    r2 = asyncio.run(R._handle_mode_trigger("claude ziggy", "web", "req2", tid, "diagnostic", "person:a"))
    assert r2["data"]["mode"] is None
    assert ct.get_thread(tid)["mode"] is None
    # both turns landed on the thread as user+assistant messages
    roles = [m["role"] for m in ct.get_thread(tid)["messages"]]
    assert roles == ["user", "assistant", "user", "assistant"]


def test_threadless_toggle_echoes_mode_for_the_app(monkeypatch):
    monkeypatch.setattr(E, "has", lambda f, path=None: True)
    r = asyncio.run(R._handle_mode_trigger("claude ziggy", "web", "req", None, None, None))
    assert r["data"]["mode"] == "diagnostic" and "thread_id" not in r
    assert R._effective_mode("diagnostic", None) == "diagnostic"
    assert R._effective_mode("bogus", None) is None


def test_entitlement_gate_blocks_and_explains(monkeypatch):
    monkeypatch.setattr(E, "has", lambda f, path=None: False)
    tid = ct.create_thread(owner="person:a")
    r = asyncio.run(R._handle_mode_trigger("claude ziggy", "web", "req", tid, None, "person:a"))
    assert r["data"]["mode"] is None
    assert "plan" in r["reply"].lower()
    assert ct.get_thread(tid)["mode"] is None


def test_effective_mode_prefers_thread_over_request(monkeypatch):
    tid = ct.create_thread(owner="person:a")
    ct.set_mode(tid, "diagnostic")
    assert R._effective_mode(None, tid) == "diagnostic"
    ct.set_mode(tid, None)
    assert R._effective_mode("diagnostic", tid) is None


def test_entitlements_cache_fail_open_and_manifest(tmp_path):
    p = tmp_path / "ent.json"
    assert E.has("diagnostics", path=p) is True          # no cache → allowed
    E.update_from_manifest({"plan_id": "standard_monthly_2026",
                            "entitlements": ["auto_repair"]}, path=p)
    assert E.has("auto_repair", path=p) is True
    assert E.has("diagnostics", path=p) is False
    E.update_from_manifest({"no_fields": 1}, path=p)      # older relay → untouched
    assert E.has("diagnostics", path=p) is False
    snap = E.snapshot(path=p)
    assert snap["plan_id"] == "standard_monthly_2026" and snap["source"] == "manifest"
    assert E.public_url(path=p) is None
    E.update_from_manifest({"plan_id": None, "entitlements": ["diagnostics"],
                            "public_url": "https://app.ziggy-home.com/"}, path=p)
    assert E.public_url(path=p) == "https://app.ziggy-home.com"


def test_mcp_url_prefers_public_address(monkeypatch):
    from backend.routers import external_tokens_router as X
    monkeypatch.setattr(X, "settings", {"relay": {"tunnel_url": "https://x.cfargotunnel.com"}})
    monkeypatch.setattr(E, "public_url", lambda path=None: "https://app.ziggy-home.com")
    assert X.mcp_url() == "https://app.ziggy-home.com/mcp"
    monkeypatch.setattr(E, "public_url", lambda path=None: None)
    assert X.mcp_url() == "https://x.cfargotunnel.com/mcp"
    monkeypatch.setattr(X, "settings", {"relay": {"public_url": "https://mine.example/",
                                                  "tunnel_url": "https://x.cfargotunnel.com"}})
    assert X.mcp_url() == "https://mine.example/mcp"
    monkeypatch.setattr(X, "settings", {})
    assert X.mcp_url() is None
