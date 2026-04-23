from __future__ import annotations
from openai import OpenAI
from core.settings_loader import settings

_client: OpenAI | None = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = settings.get("openai", {}).get("api_key", "")
        _client = OpenAI(api_key=api_key)
    return _client
