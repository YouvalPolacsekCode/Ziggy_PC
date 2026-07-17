"""Hub-side: chat LLM must route through the relay when relay creds exist (so
customer homes carry no OpenAI key), and fall back to a direct client otherwise.
Whisper STT must ALWAYS stay on the direct client (never the relay)."""
import pytest

from integrations import openai_client as oc
from core.settings_loader import settings


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.setattr(oc, "_chat_client", None, raising=False)
    monkeypatch.setattr(oc, "_client", None, raising=False)
    yield


def _set_relay(monkeypatch, url, secret, home_id):
    monkeypatch.setitem(settings, "relay", {"url": url, "secret": secret})
    home = dict(settings.get("home") or {})
    home["id"] = home_id
    monkeypatch.setitem(settings, "home", home)


def test_relay_config_builds_proxied_base_url(monkeypatch):
    _set_relay(monkeypatch, "https://relay.example.fly.dev", "sekret", "home-abc")
    cfg = oc._relay_chat_config()
    assert cfg is not None
    base, secret, home_id = cfg
    assert base == "https://relay.example.fly.dev/api/devices/home-abc/llm/v1"
    assert secret == "sekret"


def test_no_relay_config_returns_none(monkeypatch):
    monkeypatch.setitem(settings, "relay", {})
    cfg = oc._relay_chat_config()
    assert cfg is None


def test_chat_client_points_at_relay_when_configured(monkeypatch):
    _set_relay(monkeypatch, "https://relay.example.fly.dev", "sekret", "home-abc")
    client = oc.get_chat_client()
    # OpenAI SDK stores base_url; it must be the relay proxy path.
    assert "relay.example.fly.dev/api/devices/home-abc/llm/v1" in str(client.base_url)


def test_chat_client_falls_back_to_direct_without_relay(monkeypatch):
    monkeypatch.setitem(settings, "relay", {})
    # direct client should NOT carry the relay path
    client = oc.get_chat_client()
    assert "llm/v1" not in str(client.base_url)


def test_whisper_uses_direct_client_not_relay(monkeypatch):
    _set_relay(monkeypatch, "https://relay.example.fly.dev", "sekret", "home-abc")
    from integrations.llm_gateway import _client_for
    whisper = _client_for("openai_whisper")
    chat = _client_for("openai")
    assert "llm/v1" not in str(whisper.base_url)   # STT stays local
    assert "llm/v1" in str(chat.base_url)          # chat is proxied
