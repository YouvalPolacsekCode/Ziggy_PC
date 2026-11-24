"""Regression: device ids must never leak into habit-suggestion text.

Field bug: Actions → Automatic → Suggested showed
  "Most mornings around 07:17, you turn on the switch.0xa4c138dd4d2e1b8c_1."
with a "DO toggle device" line under it.

Root cause: pattern_detector._device_phrase trusted the registry `name`, which
for an unclaimed Zigbee device IS the entity_id; the drafted string was then
persisted verbatim, and the card printed the raw intent name.

These tests pin the fix: names resolve at render time from the entity_id
(Ziggy rename → HA friendly name → registry name → slug → generic label), old
persisted suggestions render clean, toggle stays toggle, and nothing that
executes (actions[].params, the wizard's entity target) changes.
"""
from __future__ import annotations

import json
import re

import pytest

from services import entity_display
from services import pattern_detector as pd
from services import suggestion_manager as sm
from services.wizard_prefill import habit_to_wizard_prefill

ZIGBEE_EID = "switch.0xa4c138dd4d2e1b8c_1"

_LEAK = re.compile(
    r"\b(?:switch|light|sensor|binary_sensor|climate)\.[a-z0-9_]+"
    r"|0x[0-9a-f]{6,}"
    r"|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"|time_based\||sequence\|",
    re.IGNORECASE,
)


def _assert_no_leak(*texts):
    for t in texts:
        assert not _LEAK.search(t or ""), f"internal id leaked into user text: {t!r}"


# ---------------------------------------------------------------------------
# Fake home: registry + HA state cache + Ziggy renames
# ---------------------------------------------------------------------------

class FakeHome:
    def __init__(self):
        self.registry: dict[str, dict] = {}
        self.friendly: dict[str, str] = {}
        self.renames: dict[str, str] = {}

    def add(self, eid, *, room=None, device_type=None, name=None, friendly=None):
        self.registry[eid] = {
            "entity_id": eid, "room": room,
            "device_type": device_type or eid.split(".")[0],
            "name": name if name is not None else eid,
        }
        if friendly is not None:
            self.friendly[eid] = friendly


@pytest.fixture
def home(monkeypatch, tmp_path):
    h = FakeHome()
    import services.device_registry as dr
    import services.home_automation as ha
    from core.settings_loader import settings

    monkeypatch.setattr(dr, "get_device_info",
                        lambda eid: dict(h.registry[eid]) if eid in h.registry else None)
    monkeypatch.setattr(dr, "get_all", lambda: [dict(v) for v in h.registry.values()])
    monkeypatch.setattr(
        ha, "_state_from_cache",
        lambda eid: ({"state": "on", "attributes": {"friendly_name": h.friendly[eid]}}
                     if eid in h.friendly else None),
    )
    monkeypatch.setitem(settings, "entity_names", h.renames)

    # Isolated suggestion + candidate stores.
    monkeypatch.setattr(sm, "SUGGESTIONS_FILE", tmp_path / "suggestions.json")
    monkeypatch.setattr(sm, "REJECTED_PATTERNS_FILE", tmp_path / "rejected.json")
    monkeypatch.setattr(sm, "_suggestions_cache", None)
    monkeypatch.setattr(sm, "_rejected_cache", None)
    monkeypatch.setattr(pd, "CANDIDATES_FILE", tmp_path / "candidates.json")
    monkeypatch.setattr(pd, "_candidates_cache", None)
    return h


def _time_cand(eid, action="on", intent="toggle_device", room="kitchen"):
    return {
        "intent": intent, "room": room, "action": action,
        "day_class": "all", "pattern_type": "time_based",
    }, {"avg_hour": 7, "avg_minute": 17, "dominant_entity_id": eid}


def _persist(raw: dict):
    sm.SUGGESTIONS_FILE.write_text(json.dumps([raw]), encoding="utf-8")
    sm._suggestions_cache = None


def _legacy_suggestion(eid=ZIGBEE_EID, action="on", turn_on=True, **extra):
    """Shape written by the pre-fix code: raw id baked into the prose, no entity_refs."""
    s = {
        "id": "sug_legacy1",
        "canonical_key": f"time_based|toggle_device|kitchen|{action}|all",
        "pattern_type": "time_based",
        "pattern_summary": f"Most mornings around 07:17, you turn on the {eid}. Want me to schedule it?",
        "user_message": f"Most mornings around 07:17, you turn on the {eid}. Want me to schedule it?",
        "trigger": {"type": "time", "value": "07:17"},
        "actions": [{"intent": "toggle_device",
                     "params": {"room": "kitchen", "turn_on": turn_on, "entity_id": eid}}],
        "confidence": 0.8, "reasoning": "", "status": "pending",
        "created_at": "2026-11-01T07:20:00", "seen_at": None,
    }
    s.update(extra)
    return s


# ---------------------------------------------------------------------------
# Identifier detection
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text", [
    ZIGBEE_EID, "0xa4c138dd4d2e1b8c", "a4:c1:38:dd:4d:2e:1b:8c",
    "3f2a1b0c-1111-2222-3333-444455556666", "9b1c3e0f4a5d6e7f8a9b0c1d2e3f4a5b",
    "light.living_room",
])
def test_identifiers_are_recognised(text):
    assert entity_display.looks_like_internal_id(text)


@pytest.mark.parametrize("text", ["Kitchen Plug", "Bedroom Lamp 2", "Noa's lamp", "TV", "Coffee"])
def test_real_names_are_not_identifiers(text):
    assert not entity_display.looks_like_internal_id(text)


# ---------------------------------------------------------------------------
# Name resolution precedence
# ---------------------------------------------------------------------------

def test_zigbee_hex_device_gets_generic_label_not_id(home):
    # Unclaimed Z2M device: registry name == entity_id, HA friendly name == IEEE.
    home.add(ZIGBEE_EID, device_type="switch", friendly="0xa4c138dd4d2e1b8c")
    phrase, _ = entity_display.device_phrase(ZIGBEE_EID)
    assert phrase == "the switch"

    cand, details = _time_cand(ZIGBEE_EID)
    msg = pd._draft_message(cand, details)
    _assert_no_leak(msg)
    assert msg == "Most mornings around 07:17, you turn on the switch. Want me to schedule it?"


def test_zigbee_hex_device_in_a_room_names_the_room(home):
    home.add(ZIGBEE_EID, room="kitchen", device_type="switch", friendly="0xa4c138dd4d2e1b8c")
    assert entity_display.device_phrase(ZIGBEE_EID)[0] == "the kitchen switch"


def test_ziggy_rename_beats_ha_friendly_name(home):
    home.add(ZIGBEE_EID, friendly="Sonoff Switch")
    home.renames[ZIGBEE_EID] = "Coffee Machine"
    assert entity_display.device_phrase(ZIGBEE_EID)[0] == "the Coffee Machine"


def test_ha_friendly_name_beats_registry_name(home):
    home.add("switch.plug_1", name="Kitchen Switch", friendly="Kettle")
    assert entity_display.device_phrase("switch.plug_1")[0] == "the Kettle"


def test_registry_name_used_when_no_friendly_name(home):
    home.add(ZIGBEE_EID, name="Hallway Plug")
    assert entity_display.device_phrase(ZIGBEE_EID)[0] == "the Hallway Plug"


def test_missing_friendly_name_falls_back_without_inventing(home):
    # Nothing but the id: no rename, no state, registry name is the id.
    home.add(ZIGBEE_EID, room="office", device_type="outlet")
    assert entity_display.device_phrase(ZIGBEE_EID)[0] == "the office plug"
    # Entirely unknown to the registry and HA → plain generic label.
    assert entity_display.device_phrase("switch.0xdeadbeef00112233")[0] == "the switch"


def test_user_casing_preserved(home):
    home.add("light.x1", friendly="TV Backlight")
    assert entity_display.device_phrase("light.x1")[0] == "the TV Backlight"


# ---------------------------------------------------------------------------
# Ambiguity
# ---------------------------------------------------------------------------

def test_shared_names_are_disambiguated_by_room(home):
    home.add("light.lamp_a", room="bedroom", friendly="Lamp")
    home.add("light.lamp_b", room="office", friendly="Lamp")
    assert entity_display.device_phrase("light.lamp_a")[0] == "the Lamp in the bedroom"
    assert entity_display.device_phrase("light.lamp_b")[0] == "the Lamp in the office"


def test_unique_name_gets_no_room_suffix(home):
    home.add("light.lamp_a", room="bedroom", friendly="Lamp")
    home.add("light.desk", room="office", friendly="Desk Light")
    assert entity_display.device_phrase("light.lamp_a")[0] == "the Lamp"


# ---------------------------------------------------------------------------
# Persisted suggestions (drafted before the fix / before a rename)
# ---------------------------------------------------------------------------

def test_legacy_persisted_suggestion_renders_resolved_name(home):
    home.add(ZIGBEE_EID, room="kitchen", device_type="switch")
    home.renames[ZIGBEE_EID] = "Kettle"
    _persist(_legacy_suggestion())

    for s in (sm.get_pending()[0], sm.get_all()[0], sm.get_by_id("sug_legacy1")):
        _assert_no_leak(s["user_message"], s["pattern_summary"])
        assert "you turn on the Kettle." in s["user_message"]

    # The stored record is untouched — presentation only.
    stored = json.loads(sm.SUGGESTIONS_FILE.read_text())[0]
    assert ZIGBEE_EID in stored["user_message"]


def test_legacy_suggestion_with_unresolvable_device_reads_generically(home):
    _persist(_legacy_suggestion())  # device not in registry, no state, no rename
    msg = sm.get_pending()[0]["user_message"]
    _assert_no_leak(msg)
    assert msg == "Most mornings around 07:17, you turn on the switch. Want me to schedule it?"


def test_llm_text_echoing_an_unreferenced_id_is_scrubbed(home):
    _persist(_legacy_suggestion(
        user_message="Every morning you use sensor.0x00158d0001a2b3c4_occupancy then the plug.",
    ))
    _assert_no_leak(sm.get_pending()[0]["user_message"])


def test_rename_after_drafting_shows_new_name(home):
    home.add("switch.kettle", friendly="Kettle")
    cand, details = _time_cand("switch.kettle")
    msg = pd._draft_message(cand, details)
    refs = pd._entity_refs(cand, details)
    assert refs == {"switch.kettle": "the Kettle"}

    sm.add_suggestion(
        canonical_key="time_based|toggle_device|kitchen|on|all",
        pattern_type="time_based", pattern_summary=msg, user_message=msg,
        trigger={"type": "time", "value": "07:17"},
        actions=[{"intent": "toggle_device",
                  "params": {"room": "kitchen", "turn_on": True, "entity_id": "switch.kettle"}}],
        confidence=0.8, reasoning="", entity_refs=refs,
    )
    home.renames["switch.kettle"] = "Coffee Machine"
    shown = sm.get_pending()[0]
    assert "you turn on the Coffee Machine." in shown["user_message"]
    assert "Kettle" not in shown["user_message"]
    # Renaming never re-targets the action.
    assert shown["actions"][0]["params"]["entity_id"] == "switch.kettle"


# ---------------------------------------------------------------------------
# on / off / toggle semantics
# ---------------------------------------------------------------------------

def _qc(action, eid="switch.kettle"):
    return pd.QualifiedCandidate(
        key=f"time_based|toggle_device|kitchen|{action}|all", pattern_type="time_based",
        intent="toggle_device", room="kitchen", action=action, day_class="all",
        occurrences=8, confidence=0.8, scores={},
        details={"avg_hour": 7, "avg_minute": 17, "dominant_entity_id": eid},
        user_message="", evidence_summary={},
    )


@pytest.mark.parametrize("action,expected", [
    ("on", {"turn_on": True}), ("off", {"turn_on": False}), ("toggle", {"action": "toggle"}),
])
def test_default_actions_preserve_observed_behaviour(action, expected):
    from services.suggestion_engine import _default_actions
    params = _default_actions(_qc(action))[0]["params"]
    for k, v in expected.items():
        assert params[k] == v
    if action == "toggle":
        assert "turn_on" not in params  # a toggle must not turn into "off"
    assert params["entity_id"] == "switch.kettle"


@pytest.mark.parametrize("action,verb", [("on", "turn on"), ("off", "turn off"), ("toggle", "toggle")])
def test_message_uses_observed_verb(home, action, verb):
    home.add("switch.kettle", friendly="Kettle")
    cand, details = _time_cand("switch.kettle", action=action)
    assert f"you {verb} the Kettle." in pd._draft_message(cand, details)


def test_card_do_line_is_the_action_not_the_intent_name(home):
    home.add(ZIGBEE_EID, friendly="Kettle")
    _persist(_legacy_suggestion())
    a = sm.get_pending()[0]["actions"][0]
    assert a["label"] == "Turn on the Kettle"
    assert "toggle" not in a["label"].lower()


def test_legacy_toggle_stored_as_off_is_shown_and_prefilled_as_toggle(home):
    home.add("switch.kettle", friendly="Kettle")
    _persist(_legacy_suggestion(eid="switch.kettle", action="toggle", turn_on=False))
    s = sm.get_pending()[0]
    assert s["actions"][0]["label"] == "Toggle the Kettle"
    prefill = habit_to_wizard_prefill(s)
    assert prefill["actions"][0]["service"] == "homeassistant.toggle"


# ---------------------------------------------------------------------------
# Execution targets unchanged
# ---------------------------------------------------------------------------

def test_presentation_never_changes_action_params(home):
    home.add(ZIGBEE_EID, friendly="Kettle")
    raw = _legacy_suggestion()
    _persist(raw)
    shown = sm.get_pending()[0]
    assert shown["actions"][0]["params"] == raw["actions"][0]["params"]
    assert shown["actions"][0]["intent"] == raw["actions"][0]["intent"]
    assert shown["trigger"]["value"] == raw["trigger"]["value"]


@pytest.mark.parametrize("turn_on,service", [(True, "homeassistant.turn_on"), (False, "homeassistant.turn_off")])
def test_wizard_prefill_targets_the_entity_id_not_a_name(home, turn_on, service):
    home.add(ZIGBEE_EID, friendly="Kettle")
    _persist(_legacy_suggestion(action="on" if turn_on else "off", turn_on=turn_on))
    prefill = habit_to_wizard_prefill(sm.get_pending()[0])
    step = prefill["actions"][0]
    assert step == {"type": "call_service", "entity_id": ZIGBEE_EID,
                    "service": service, "service_value": service.split(".")[1]}
    _assert_no_leak(prefill["name"], prefill["description"])

    # Rename: same target, new display.
    home.renames[ZIGBEE_EID] = "Coffee Machine"
    again = habit_to_wizard_prefill(sm.get_pending()[0])
    assert again["actions"][0]["entity_id"] == ZIGBEE_EID
    assert "Coffee Machine" in again["name"]


def test_wizard_name_never_falls_back_to_canonical_key(home):
    s = _legacy_suggestion(pattern_summary="", user_message="")
    assert habit_to_wizard_prefill(s)["name"] == "Suggested automation"


# ---------------------------------------------------------------------------
# Every surface: API payloads, chat listing, push notification
# ---------------------------------------------------------------------------

def test_api_payloads_contain_no_ids_in_text(home):
    from backend.routers.suggestion_router import _enrich_with_prefill, _habit_to_feed_item
    home.add(ZIGBEE_EID, room="kitchen", device_type="switch")
    _persist(_legacy_suggestion())
    for s in _enrich_with_prefill(sm.get_all()):
        _assert_no_leak(s["user_message"], s["pattern_summary"], s["actions"][0]["label"],
                        s["wizard_prefill"]["name"], s["wizard_prefill"]["description"])
        item = _habit_to_feed_item(s)
        _assert_no_leak(item["title"], item["description"])


def test_push_notification_and_chat_list_are_clean(home):
    import asyncio
    from services.suggestion_engine import _notify_pending
    from core.handlers.pattern_handler import handle_list_suggestions

    _persist(_legacy_suggestion())
    sent = []
    _notify_pending(lambda title, body, url: sent.append(body))
    assert sent
    _assert_no_leak(sent[0])

    res = asyncio.run(handle_list_suggestions({}))
    _assert_no_leak(res.get("message", ""))


def test_sequence_trigger_label_is_human(home):
    home.add("light.hall", friendly="Hall Light")
    home.add("switch.kettle", friendly="Kettle")
    key = "sequence|toggle_device|hall|on|toggle_device|kitchen|on|all"
    pd._save_candidates({key: {"details": {"dominant_entity_id": "light.hall",
                                            "b_dominant_entity_id": "switch.kettle"}}})
    _persist({
        "id": "sug_seq", "canonical_key": key, "pattern_type": "sequence",
        "pattern_summary": "When you turn on the light.hall, you usually turn on the switch.kettle shortly after.",
        "user_message": "When you turn on the light.hall, you usually turn on the switch.kettle shortly after.",
        "trigger": {"type": "sequence", "value": "toggle_device in hall"},
        "actions": [{"intent": "toggle_device",
                     "params": {"room": "kitchen", "turn_on": True, "entity_id": "switch.kettle"}}],
        "confidence": 0.8, "reasoning": "", "status": "pending", "seen_at": None,
    })
    s = sm.get_pending()[0]
    assert s["user_message"] == ("When you turn on the Hall Light, you usually turn on "
                                 "the Kettle shortly after.")
    assert s["trigger"]["label"] == "after you turn on the Hall Light"
    assert habit_to_wizard_prefill(s)["trigger"].get("hint") == "after you turn on the Hall Light"
