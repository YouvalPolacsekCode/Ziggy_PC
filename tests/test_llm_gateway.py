"""Unit tests for integrations.llm_gateway.

Verifies the resolver against the defaults that previously lived as hardcoded
model names at call sites. No external network calls; we patch the underlying
clients to assert the gateway forwards the right kwargs.
"""
from __future__ import annotations

import pytest

from integrations import llm_gateway


def test_resolve_defaults_match_previously_hardcoded_models():
    """The baked-in defaults must reproduce the pre-gateway choices exactly."""
    assert llm_gateway._resolve("intent_parse") == ("openai", "gpt-4o-mini")
    assert llm_gateway._resolve("chat") == ("openai", "gpt-4o")
    assert llm_gateway._resolve("translate") == ("openai", "gpt-4o-mini")
    assert llm_gateway._resolve("map_render") == ("openai", "gpt-4o")
    assert llm_gateway._resolve("stt") == ("openai_whisper", "whisper-1")


def test_resolve_suggestion_quality_gate_uses_ollama_model_when_unset(monkeypatch):
    """suggestion_quality_gate defaults to backend=ollama, model defers to
    settings.ollama.model — preserving the previous direct lookup."""
    from core.settings_loader import settings as live_settings
    monkeypatch.setitem(live_settings, "models", {})
    monkeypatch.setitem(live_settings, "ollama", {"model": "qwen2.5:3b"})
    backend, model = llm_gateway._resolve("suggestion_quality_gate")
    assert backend == "ollama"
    assert model == "qwen2.5:3b"


def test_resolve_unknown_purpose_raises():
    with pytest.raises(ValueError):
        llm_gateway._resolve("not_a_purpose")


def test_resolve_operator_override(monkeypatch):
    """Operator can override (backend, model) via settings.models.<purpose>."""
    from core.settings_loader import settings as live_settings
    monkeypatch.setitem(
        live_settings,
        "models",
        {"chat": {"backend": "ollama", "model": "llama3.2:3b"}},
    )
    assert llm_gateway._resolve("chat") == ("ollama", "llama3.2:3b")


def test_chat_completion_forwards_kwargs(monkeypatch):
    """Gateway must pass through model, messages, tools, etc. to the SDK call."""
    captured: dict = {}

    class _FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return "ok"

    class _FakeChat:
        completions = _FakeCompletions()

    class _FakeClient:
        chat = _FakeChat()

    monkeypatch.setattr(llm_gateway, "_client_for", lambda backend: _FakeClient())

    result = llm_gateway.chat_completion(
        "intent_parse",
        [{"role": "user", "content": "hello"}],
        tools=[{"type": "function", "function": {"name": "x"}}],
        tool_choice="auto",
        parallel_tool_calls=True,
        temperature=0.2,
        max_tokens=400,
    )

    assert result == "ok"
    assert captured["model"] == "gpt-4o-mini"
    assert captured["messages"] == [{"role": "user", "content": "hello"}]
    assert captured["tool_choice"] == "auto"
    assert captured["parallel_tool_calls"] is True
    assert captured["temperature"] == 0.2
    assert captured["max_tokens"] == 400
    # None-valued kwargs must be omitted, not passed as None.
    assert "timeout" not in captured


def test_chat_completion_rejects_whisper_purpose():
    with pytest.raises(ValueError):
        llm_gateway.chat_completion("stt", [{"role": "user", "content": "x"}])


def test_transcribe_rejects_chat_purpose():
    with pytest.raises(ValueError):
        llm_gateway.transcribe("intent_parse", b"audio")


def test_transcribe_forwards_kwargs(monkeypatch):
    captured: dict = {}

    class _FakeTranscriptions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return "ok"

    class _FakeAudio:
        transcriptions = _FakeTranscriptions()

    class _FakeClient:
        audio = _FakeAudio()

    monkeypatch.setattr(llm_gateway, "_client_for", lambda backend: _FakeClient())

    sentinel = object()
    result = llm_gateway.transcribe("stt", sentinel, language="he", prompt="hint")
    assert result == "ok"
    assert captured["model"] == "whisper-1"
    assert captured["file"] is sentinel
    assert captured["language"] == "he"
    assert captured["prompt"] == "hint"
