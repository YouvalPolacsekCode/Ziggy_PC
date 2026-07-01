"""Unit tests for the voice-intent phrase registry + resolver (Item 3)."""
import importlib

import pytest


@pytest.fixture
def vi(tmp_path, monkeypatch):
    laa = importlib.import_module("services.local_automation_actions")
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "state.json"))
    mod = importlib.import_module("services.voice_intents")
    return mod


def test_normalize():
    from services.voice_intents import normalize
    assert normalize("  Good  Night!! ") == "good night"
    assert normalize("לילה טוב.") == "לילה טוב"
    assert normalize("") == ""


def test_register_match_unregister(vi):
    action = {"kind": "intent", "intent": "turn_off_everything", "params": {}}
    res = vi.register_voice_intent("Good night", action, bundle_id="b1")
    assert res["ok"] and res["normalized"] == "good night"

    # Exact + case/punctuation-insensitive match.
    rec = vi.match("GOOD NIGHT!")
    assert rec and rec["action"]["intent"] == "turn_off_everything"

    # Non-match falls through.
    assert vi.match("dim the lights") is None

    assert vi.unregister_voice_intent("good night") is True
    assert vi.match("good night") is None
    assert vi.unregister_voice_intent("good night") is False


def test_list(vi):
    vi.register_voice_intent("all off", {"kind": "intent", "intent": "turn_off_everything"})
    vi.register_voice_intent("movie time", {"kind": "kv_mode", "namespace": "modes", "key": "movie", "value": True})
    got = vi.list_voice_intents()
    assert {r["normalized"] for r in got} == {"all off", "movie time"}


def test_resolve_all_off(vi):
    a = vi.resolve_action_description("turn everything off in the house", [])
    assert a == {"kind": "intent", "intent": "turn_off_everything", "params": {}}
    a_he = vi.resolve_action_description("כבה הכל", [])
    assert a_he["intent"] == "turn_off_everything"


def test_resolve_kv_mode(vi):
    created = [{"kind": "kv_state", "namespace": "modes", "key": "sleep"}]
    a = vi.resolve_action_description("enable sleep mode", created)
    assert a == {"kind": "kv_mode", "namespace": "modes", "key": "sleep", "value": True}
    # "off" language flips the value.
    a_off = vi.resolve_action_description("disable sleep", created)
    assert a_off["value"] is False


def test_resolve_automation(vi):
    created = [{"kind": "automation", "id": "auto1", "name": "Movie scene"}]
    a = vi.resolve_action_description("start the movie scene", created)
    assert a == {"kind": "automation", "automation_id": "auto1", "label": "Movie scene"}


def test_resolve_unmappable_returns_none(vi):
    # Nothing in the bundle to bind to and no all-off language.
    assert vi.resolve_action_description("make the room feel cozy", []) is None


def test_bundle_mode_wins_for_goodnight(vi):
    # Flagship: "good night" with a bundle-created sleep mode activates THAT
    # mode (bundle intent) rather than blindly turning everything off.
    created = [{"kind": "kv_state", "namespace": "modes", "key": "sleep"}]
    a = vi.resolve_action_description("good night", created)
    assert a == {"kind": "kv_mode", "namespace": "modes", "key": "sleep", "value": True}


def test_goodnight_falls_back_to_all_off_when_empty(vi):
    # No bundle artifacts to bind to → generic all-off fallback.
    a = vi.resolve_action_description("good night", [])
    assert a["kind"] == "intent" and a["intent"] == "turn_off_everything"
