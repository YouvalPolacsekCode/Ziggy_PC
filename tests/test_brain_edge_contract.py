"""Unit tests for core.brain_edge_contract.

Pins the contract so the cloud phase can replace InProcessEdge/InProcessBrain
with remote clients without breaking any consumer.
"""
from __future__ import annotations

import pytest

from core import brain_edge_contract
from core.brain_edge_contract import (
    BrainContract,
    EdgeContract,
    InProcessBrain,
    InProcessEdge,
    install_brain,
    install_edge,
)


# ── EDGE: execute_intent delegates to the dispatcher ────────────────────────

@pytest.mark.asyncio
async def test_in_process_edge_execute_intent_calls_dispatcher(monkeypatch):
    captured: dict = {}

    async def fake_handle_intent(intent_dict):
        captured.update(intent_dict)
        return {"ok": True, "message": "fake"}

    monkeypatch.setattr("core.action_parser.handle_intent", fake_handle_intent)

    edge = InProcessEdge()
    result = await edge.execute_intent("toggle_light", {"room": "bedroom"}, source="test")

    assert result == {"ok": True, "message": "fake"}
    assert captured["intent"] == "toggle_light"
    assert captured["params"] == {"room": "bedroom"}
    assert captured["source"] == "test"


# ── EDGE: query_state expands selectors via device_translator ───────────────

def test_in_process_edge_query_state_single(monkeypatch):
    from services.device_schema import ZiggyDevice
    fake_dev = ZiggyDevice(
        id="ha:light.x",
        room="r",
        device_type="light",
        name="X",
        capabilities=("turn_on",),
        status="connected",
        ha_entity_id="light.x",
    )
    monkeypatch.setattr(
        "services.device_translator.expand_selector",
        lambda s: [fake_dev],
    )
    monkeypatch.setattr(
        "services.device_translator.query_state",
        lambda zid: {"ok": True, "state": "on", "attributes": {}, "source": "cache"},
    )

    edge = InProcessEdge()
    out = edge.query_state({"id": "ha:light.x"})
    assert out["ok"] is True
    assert out["state"] == "on"
    # The brain gets the device shape, never the underlying entity_id.
    assert "ha_entity_id" not in out["device"]


def test_in_process_edge_query_state_empty(monkeypatch):
    monkeypatch.setattr(
        "services.device_translator.expand_selector", lambda s: []
    )
    edge = InProcessEdge()
    out = edge.query_state("all_unicorns")
    assert out["ok"] is False


# ── EDGE: list_devices strips transport fields ──────────────────────────────

def test_in_process_edge_list_devices_strips_transport(monkeypatch):
    from services.device_schema import ZiggyDevice
    fake = [
        ZiggyDevice(
            id="ha:light.kitchen",
            room="kitchen",
            device_type="light",
            name="Kitchen",
            capabilities=("turn_on",),
            status="connected",
            ha_entity_id="light.kitchen",
            ir_device_id=None,
        )
    ]
    monkeypatch.setattr(
        "services.device_translator.list_devices",
        lambda **kw: fake,
    )
    edge = InProcessEdge()
    devices = edge.list_devices({"type": "light"})
    assert devices[0]["id"] == "ha:light.kitchen"
    # No transport leaks across the boundary.
    assert "ha_entity_id" not in devices[0]
    assert "ir_device_id" not in devices[0]


# ── BRAIN: ask() success ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_in_process_brain_ask_uses_llm_gateway(monkeypatch):
    captured: dict = {}

    class _FakeMessage:
        content = "the answer"

    class _FakeChoice:
        message = _FakeMessage()

    class _FakeResp:
        choices = [_FakeChoice()]

    def fake_chat_completion(purpose, messages, **kw):
        captured["purpose"] = purpose
        captured["messages"] = messages
        return _FakeResp()

    monkeypatch.setattr(
        "integrations.llm_gateway.chat_completion",
        fake_chat_completion,
    )
    brain = InProcessBrain()
    out = await brain.ask("hello?", {"context_key": "x"})
    assert out["ok"] is True
    assert out["answer"] == "the answer"
    assert out["from_fallback"] is False
    assert captured["purpose"] == "chat"


# ── BRAIN: fallback when LLM call fails ────────────────────────────────────

@pytest.mark.asyncio
async def test_in_process_brain_ask_falls_back_on_failure(monkeypatch):
    def boom(purpose, messages, **kw):
        raise RuntimeError("network down")

    monkeypatch.setattr("integrations.llm_gateway.chat_completion", boom)
    brain = InProcessBrain()

    def local_fb(prompt, context):
        return "(offline default reply)"

    out = await brain.ask("anything?", fallback=local_fb)
    assert out["ok"] is True
    assert out["answer"] == "(offline default reply)"
    assert out["from_fallback"] is True


@pytest.mark.asyncio
async def test_in_process_brain_ask_total_failure_no_fallback(monkeypatch):
    def boom(purpose, messages, **kw):
        raise RuntimeError("network down")

    monkeypatch.setattr("integrations.llm_gateway.chat_completion", boom)
    brain = InProcessBrain()
    out = await brain.ask("anything?")
    assert out["ok"] is False
    assert "network down" in out["error"]


# ── Swappability ────────────────────────────────────────────────────────────

class _RecordingEdge:
    def __init__(self):
        self.calls = []

    async def execute_intent(self, intent, params, *, source="brain"):
        self.calls.append(("execute_intent", intent, params, source))
        return {"ok": True, "message": "recorded"}

    def query_state(self, selector):
        self.calls.append(("query_state", selector))
        return {"ok": True}

    def list_devices(self, filter=None):
        self.calls.append(("list_devices", filter))
        return []


def test_install_edge_replaces_singleton():
    original = brain_edge_contract.edge
    try:
        replacement = _RecordingEdge()
        install_edge(replacement)
        assert brain_edge_contract.edge is replacement
    finally:
        install_edge(original)


def test_install_brain_replaces_singleton():
    original = brain_edge_contract.brain
    try:
        class _Stub:
            async def ask(self, p, c=None, *, purpose="chat", fallback=None):
                return {"ok": True, "answer": "stub"}
        replacement = _Stub()
        install_brain(replacement)
        assert brain_edge_contract.brain is replacement
    finally:
        install_brain(original)


# ── Protocol structural typing — both impls satisfy their contract ─────────

def test_in_process_edge_is_an_edge_contract():
    edge: EdgeContract = InProcessEdge()  # purely a typecheck-style assertion
    assert hasattr(edge, "execute_intent")
    assert hasattr(edge, "query_state")
    assert hasattr(edge, "list_devices")


def test_in_process_brain_is_a_brain_contract():
    brain: BrainContract = InProcessBrain()
    assert hasattr(brain, "ask")
