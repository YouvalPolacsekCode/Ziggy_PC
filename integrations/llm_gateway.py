"""Single LLM gateway. Every chat-completion / transcription call goes through here.

Why this exists
---------------
Before the gateway, model choices (gpt-4o-mini, gpt-4o, whisper-1, the Ollama
model) were hardcoded at ~9 call sites and one call site (map_renderer.py)
bypassed the shared openai_client entirely. This module is the single seam
where (a) the backend choice (OpenAI vs local Ollama vs OpenAI Whisper) and
(b) the concrete model name live. When the brain eventually runs remote, the
gateway is also the single point that has to be aware of the new model
routing — call sites do not.

Gating
------
The subscription gate (require_cloud_llm_active / CloudLLMUnavailable) stays
EXPLICIT at the call sites that have it today:
  - core/intent_parser.py::_parse_with_tools
  - core/handlers/chat_handler.py::handle_chat_with_gpt
Whisper STT and map_render remain ungated (matches today). The gateway is
gate-agnostic; it does not call require_cloud_llm_active itself.

Fallbacks
---------
The gateway does NOT implement fallback policy. Existing fallback chains stay
where they are:
  - voice_interface._transcribe_api: local Hebrew Whisper -> OpenAI Whisper API
  - suggestion_engine: ollama_client.is_available() check -> heuristic if down
The gateway just executes the resolved (backend, model) call.

Configuration
-------------
Add a `models:` block to settings.yaml to override; otherwise the baked-in
defaults below (which match the previous hardcoded choices) are used.

  models:
    intent_parse:            {backend: openai,         model: gpt-4o-mini}
    chat:                    {backend: openai,         model: gpt-4o}
    translate:               {backend: openai,         model: gpt-4o-mini}
    suggestion_quality_gate: {backend: ollama,         model: qwen2.5:3b}
    map_render:              {backend: openai,         model: gpt-4o}
    stt:                     {backend: openai_whisper, model: whisper-1}
"""
from __future__ import annotations

from typing import Any

from core.settings_loader import settings


# Backends understood by the gateway.
_BACKEND_OPENAI = "openai"
_BACKEND_OLLAMA = "ollama"
_BACKEND_OPENAI_WHISPER = "openai_whisper"

# Baked-in defaults — match the call-site hardcoded values that existed
# before the gateway was introduced. Keep these in sync with the docstring.
_DEFAULTS: dict[str, dict[str, str | None]] = {
    "intent_parse":            {"backend": _BACKEND_OPENAI,         "model": "gpt-4o-mini"},
    "chat":                    {"backend": _BACKEND_OPENAI,         "model": "gpt-4o"},
    "translate":               {"backend": _BACKEND_OPENAI,         "model": "gpt-4o-mini"},
    # Ziggy Pro designer (Session D3) — reasons over the full capability
    # catalog + home context to produce a structured automation bundle.
    # Higher-quality model justified by the complex reasoning and JSON
    # output requirement; low temperature for schema consistency.
    "automation_design":       {"backend": _BACKEND_OPENAI,         "model": "gpt-4o"},
    # suggestion_quality_gate's model defaults to settings.ollama.model
    # (preserving the previous behavior where the caller read that key
    # directly). The None below triggers that lookup in _resolve().
    "suggestion_quality_gate": {"backend": _BACKEND_OLLAMA,         "model": None},
    "map_render":              {"backend": _BACKEND_OPENAI,         "model": "gpt-4o"},
    "stt":                     {"backend": _BACKEND_OPENAI_WHISPER, "model": "whisper-1"},
}


def _resolve(purpose: str) -> tuple[str, str]:
    """Resolve (backend, model) for a purpose.

    Precedence:
      1. settings.models.<purpose>.{backend,model} (operator override)
      2. _DEFAULTS[purpose]
    For ollama backends with no explicit model, fall back to
    settings.ollama.model, then to ollama_client.default_model().
    """
    default = _DEFAULTS.get(purpose)
    if default is None:
        raise ValueError(f"llm_gateway: unknown purpose {purpose!r}")

    cfg = (settings.get("models") or {}).get(purpose) or {}
    backend = cfg.get("backend") or default["backend"]
    model = cfg.get("model") or default.get("model")

    if backend == _BACKEND_OLLAMA and not model:
        ollama_cfg = settings.get("ollama") or {}
        model = ollama_cfg.get("model")
        if not model:
            from integrations.ollama_client import default_model
            model = default_model()

    if not model:
        raise ValueError(
            f"llm_gateway: no model resolved for purpose={purpose!r} backend={backend!r}"
        )
    return backend, model


def _client_for(backend: str):
    """Return the SDK client for a backend. Both OpenAI and Ollama use the OpenAI SDK
    (Ollama exposes an OpenAI-compatible API), so callers see a uniform shape."""
    if backend == _BACKEND_OPENAI or backend == _BACKEND_OPENAI_WHISPER:
        from integrations.openai_client import get_client
        return get_client()
    if backend == _BACKEND_OLLAMA:
        from integrations.ollama_client import get_client
        return get_client()
    raise ValueError(f"llm_gateway: unsupported backend {backend!r}")


def chat_completion(
    purpose: str,
    messages: list[dict],
    *,
    tools: list[dict] | None = None,
    tool_choice: str | None = None,
    parallel_tool_calls: bool | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
    timeout: float | None = None,
) -> Any:
    """Run a chat completion for `purpose`. Returns the raw SDK response object.

    Callers should access .choices[0].message.{content,tool_calls} as they
    would on a direct OpenAI client — Ollama exposes the same shape.
    """
    backend, model = _resolve(purpose)
    if backend == _BACKEND_OPENAI_WHISPER:
        raise ValueError(
            f"llm_gateway.chat_completion: purpose={purpose!r} resolves to "
            f"the whisper backend; use transcribe() instead."
        )
    client = _client_for(backend)
    kwargs: dict[str, Any] = {"model": model, "messages": messages}
    if tools is not None:
        kwargs["tools"] = tools
    if tool_choice is not None:
        kwargs["tool_choice"] = tool_choice
    if parallel_tool_calls is not None:
        kwargs["parallel_tool_calls"] = parallel_tool_calls
    if temperature is not None:
        kwargs["temperature"] = temperature
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    if timeout is not None:
        kwargs["timeout"] = timeout
    return client.chat.completions.create(**kwargs)


def transcribe(
    purpose: str,
    audio_file,
    *,
    language: str | None = None,
    prompt: str | None = None,
) -> Any:
    """Run speech-to-text. Returns the raw SDK transcription object (`.text`)."""
    backend, model = _resolve(purpose)
    if backend != _BACKEND_OPENAI_WHISPER:
        raise ValueError(
            f"llm_gateway.transcribe: purpose={purpose!r} resolves to "
            f"backend={backend!r}; only {_BACKEND_OPENAI_WHISPER!r} is supported."
        )
    client = _client_for(backend)
    kwargs: dict[str, Any] = {"model": model, "file": audio_file}
    if language is not None:
        kwargs["language"] = language
    if prompt is not None:
        kwargs["prompt"] = prompt
    return client.audio.transcriptions.create(**kwargs)
