"""OpenAI SDK singleton + the chat-LLM subscription gate (Prompt 9 chunk 3).

Two distinct things in this module:

  get_client()                  Singleton OpenAI client (used for chat AND
                                Whisper STT in voice_interface.py). NOT
                                directly gated — see note below.

  require_cloud_llm_active()    Subscription-state gate that callers
                                invoke EXPLICITLY before initiating a
                                chat completion. Raises CloudLLMUnavailable
                                on gated state.

Why the gate is not at get_client() itself: voice_interface.py calls
get_client() for Whisper transcription as well as chat. Gating the
singleton would silently break voice STT for any cancelled hub, which
violates the local-kit-never-breaks invariant AND the "do not touch
voice" hard rule in this prompt. DECISIONS.md says STT should be
local-only (Piper + Whisper-cpp on the edge); the day voice migrates
fully off the OpenAI SDK is the day this distinction goes away.

Callers that DO touch the subscription gate (chunk 3):
  core/handlers/chat_handler.py::handle_chat_with_gpt
  core/intent_parser.py::_parse_with_tools

Each invokes require_cloud_llm_active() at the top and returns a
graceful response on CloudLLMUnavailable. Chat returns an err dict
with a clear billing message; intent parser falls through to the
unrecognized_command path (which doesn't call cloud at all).
"""

from __future__ import annotations

from openai import OpenAI

from core.settings_loader import settings
from services.subscription_state import is_cloud_llm_allowed

_client: OpenAI | None = None


class CloudLLMUnavailable(RuntimeError):
    """Raised by require_cloud_llm_active() when the subscription gate denies.

    Callers should catch this and return a user-facing message rather
    than letting it propagate as a generic error.
    """


def require_cloud_llm_active() -> None:
    """Gate the cloud chat-LLM path. Call this at the top of every
    function that initiates a chat completion via get_client().

    Reads the edge cache written by services/ota_client.py. Missing
    cache (fresh install) ALLOWS — matches the relay-side default of
    subscription_state='active'. Stale cache DENIES — conservative
    (paid feature off; local Ollama is the fallback).
    """
    if not is_cloud_llm_allowed():
        raise CloudLLMUnavailable(
            "Cloud chat is unavailable. An active subscription is required; "
            "your home continues to work locally."
        )


def get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = settings.get("openai", {}).get("api_key", "")
        _client = OpenAI(api_key=api_key)
    return _client
