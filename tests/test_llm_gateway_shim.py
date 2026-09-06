"""The gateway's reasoning-model shim: gpt-5.x parameter translation + rescue.

Facts these lock were measured through the relay on 2026-09-06 (see the
module docstring in integrations/llm_gateway.py).
"""
import pytest

from integrations import llm_gateway as G


class _Rec:
    def __init__(self, fail_first_with: Exception | None = None):
        self.calls: list[dict] = []
        self._fail = fail_first_with

    class _Chat:
        def __init__(self, outer):
            self.completions = self
            self._o = outer

        def create(self, **kw):
            self._o.calls.append(kw)
            if self._o._fail is not None and len(self._o.calls) == 1:
                raise self._o._fail
            return {"ok": True, "model": kw["model"]}

    @property
    def chat(self):
        return _Rec._Chat(self)


def _patch(monkeypatch, backend="openai", model="gpt-5.5", rec=None):
    rec = rec or _Rec()
    monkeypatch.setattr(G, "_resolve", lambda purpose: (backend, model))
    monkeypatch.setattr(G, "_client_for", lambda b: rec)
    return rec


def test_defaults_point_chat_at_gpt_55():
    assert G._DEFAULTS["chat"]["model"] == "gpt-5.5"
    assert G._DEFAULTS["automation_design"]["model"] == "gpt-5.5"


def test_reasoning_model_detection():
    assert G._is_reasoning_model("gpt-5.5")
    assert G._is_reasoning_model("gpt-5-mini")
    assert G._is_reasoning_model("o3-mini")
    assert not G._is_reasoning_model("gpt-4o")
    assert not G._is_reasoning_model("gpt-4.1")


def test_max_tokens_translated_and_effort_none_with_tools(monkeypatch):
    rec = _patch(monkeypatch)
    G.chat_completion("chat", [{"role": "user", "content": "hi"}],
                      tools=[{"type": "function"}], temperature=0.3, max_tokens=500)
    kw = rec.calls[0]
    assert "max_tokens" not in kw
    assert kw["max_completion_tokens"] == 500
    assert kw["reasoning_effort"] == "none"
    assert kw["temperature"] == 0.3          # kept because effort is none


def test_minimal_default_for_gpt5_mini_drops_temperature(monkeypatch):
    rec = _patch(monkeypatch, model="gpt-5-mini")
    G.chat_completion("translate", [{"role": "user", "content": "x"}],
                      temperature=0.2, max_tokens=40)
    kw = rec.calls[0]
    assert kw["reasoning_effort"] == "minimal"
    assert "temperature" not in kw
    assert kw["max_completion_tokens"] == 40


def test_legacy_model_untouched(monkeypatch):
    rec = _patch(monkeypatch, model="gpt-4o")
    G.chat_completion("chat", [{"role": "user", "content": "hi"}],
                      temperature=0.3, max_tokens=500)
    kw = rec.calls[0]
    assert kw["max_tokens"] == 500
    assert "reasoning_effort" not in kw
    assert "max_completion_tokens" not in kw


def test_operator_override_of_effort(monkeypatch):
    rec = _patch(monkeypatch, model="gpt-5.5")
    monkeypatch.setattr(G, "settings", {"models": {"chat": {"reasoning_effort": "low"}}})
    # No tools → the operator's choice is honoured and temperature is dropped.
    G.chat_completion("chat", [{"role": "user", "content": "hi"}], temperature=0.3)
    assert rec.calls[0]["reasoning_effort"] == "low"
    assert "temperature" not in rec.calls[0]


def test_retired_model_falls_back_to_gpt4o(monkeypatch):
    err = Exception("Error code: 404 - The model `gpt-5.5` does not exist or you do not have access")
    rec = _patch(monkeypatch, model="gpt-5.5", rec=_Rec(fail_first_with=err))
    out = G.chat_completion("chat", [{"role": "user", "content": "hi"}],
                            tools=[{"type": "function"}], max_tokens=300)
    assert out["model"] == "gpt-4o"
    assert len(rec.calls) == 2
    assert rec.calls[1]["max_tokens"] == 300
    assert "reasoning_effort" not in rec.calls[1]


def test_other_errors_are_not_swallowed(monkeypatch):
    _patch(monkeypatch, model="gpt-5.5", rec=_Rec(fail_first_with=RuntimeError("timeout")))
    with pytest.raises(RuntimeError):
        G.chat_completion("chat", [{"role": "user", "content": "hi"}])
