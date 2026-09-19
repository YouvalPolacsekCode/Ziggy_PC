"""The office-lamp incident, 2026-09-19, as a test.

The operator turned the office lamp off in the app at 21:40:59. Smart Room put
it back on eight seconds later and the hold was GONE — because an automation
Home Assistant runs natively sets no attribution at all, so its relight was
indistinguishable from the person flipping the light on themselves.

A hold must survive an automation relighting the light, and must still be
cleared by a person doing it.
"""
import pytest

from services import local_automation_actions as laa
from services import light_hold as LH

T0 = 1_700_000_000.0
LAMP = "light.office_lamp"


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr(laa, "STORE_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(LH, "_room_and_occupancy", lambda eid: ("office", "binary_sensor.office_occ"))
    monkeypatch.setattr(LH, "_broadcast_hook", lambda p: None)
    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: None)
    LH._engine_touch.clear()
    yield
    LH._engine_touch.clear()


def _install_smart_room():
    """A Smart Room Night rule exactly as it is stored on a hub."""
    laa.save_ziggy_actions("ziggy_smart_room_office_night", [
        {"type": "call_service", "entity_id": LAMP, "service": "light.turn_on",
         "service_data": {"brightness_pct": 30}},
    ])


def test_the_office_lamp_incident_does_not_repeat():
    _install_smart_room()
    # 21:40:59 — the person turns it off in the app.
    LH.on_state_change(LAMP, "on", "off", engine_initiated=False, now=T0)
    assert LH.is_held(LAMP)

    # 21:41:07 — Smart Room fires. HA will run the turn_on itself, so nothing
    # marks it as Ziggy's; the fired-bridge is the only signal there is.
    LH.note_automation_fired("automation.ziggy_smart_room_office_night",
                             {"id": "ziggy_smart_room_office_night"}, now=T0 + 8)
    LH.on_state_change(LAMP, "off", "on", engine_initiated=False, now=T0 + 8)

    rec = LH.get(LAMP)
    assert LH.is_held(LAMP), "the hold must survive an automation relighting the light"
    assert rec["engine_on_since_release"] is False   # it was held, not released-then-relit


def test_a_person_still_clears_the_hold():
    LH.on_state_change(LAMP, "on", "off", engine_initiated=False, now=T0)
    assert LH.is_held(LAMP)
    # No automation fired — a wall switch or an app tap.
    LH.on_state_change(LAMP, "off", "on", engine_initiated=False, now=T0 + 8)
    assert not LH.is_held(LAMP) and LH.get(LAMP) is None


def test_attribution_window_expires():
    _install_smart_room()
    LH.on_state_change(LAMP, "on", "off", engine_initiated=False, now=T0)
    LH.note_automation_fired("automation.ziggy_smart_room_office_night",
                             {"id": "ziggy_smart_room_office_night"}, now=T0)
    # Well past the window — this is a person, not that automation.
    LH.on_state_change(LAMP, "off", "on", engine_initiated=False,
                       now=T0 + LH._ENGINE_WINDOW_S + 5)
    assert not LH.is_held(LAMP)


def test_only_lights_the_rule_turns_on_are_attributed():
    laa.save_ziggy_actions("ziggy_smart_room_office_off", [
        {"type": "call_service", "entity_id": LAMP, "service": "light.turn_off"},
    ])
    marked = LH.note_automation_fired("automation.ziggy_smart_room_office_off",
                                      {"id": "ziggy_smart_room_office_off"}, now=T0)
    assert marked == [], "an off-rule must not excuse a later turn-on"


def test_lights_an_automation_turns_on_reads_stored_steps():
    laa.save_ziggy_actions("some_rule", [
        {"type": "call_service", "entity_id": "light.a", "service": "light.turn_on"},
        {"type": "call_service", "entity_id": "light.b", "service_value": "turn_on"},
        {"type": "call_service", "entity_id": "light.c", "service": "light.turn_off"},
        {"type": "call_service", "entity_id": "switch.x", "service": "switch.turn_on"},
        {"type": "notify", "message": "hi"},
    ])
    assert LH.lights_an_automation_turns_on("some_rule") == ["light.a", "light.b"]
    # A hand-written HA automation has no stored steps — we cannot tell, so []
    assert LH.lights_an_automation_turns_on("not_a_ziggy_rule") == []


def test_second_strike_still_works_through_an_automation_relight(monkeypatch):
    """The escalation must survive the new path: released by empty, relit by a
    rule, turned off again → held until morning."""
    _install_smart_room()
    monkeypatch.setattr(LH, "_next_morning", lambda now: now + 8 * 3600)
    LH.on_state_change(LAMP, "on", "off", engine_initiated=False, now=T0)
    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: T0)
    LH.tick(now=T0 + 31 * 60)                       # released — room empty
    assert LH.get(LAMP)["last_release"] == "empty"

    monkeypatch.setattr(LH, "_occupancy_off_since", lambda occ: None)
    LH.note_automation_fired("automation.ziggy_smart_room_office_night",
                             {"id": "ziggy_smart_room_office_night"}, now=T0 + 40 * 60)
    LH.on_state_change(LAMP, "off", "on", engine_initiated=False, now=T0 + 40 * 60)
    assert LH.get(LAMP)["engine_on_since_release"] is True

    rec = LH.on_manual_off(LAMP, now=T0 + 41 * 60)
    assert rec["state"] == "held_until_morning" and rec["strikes"] == 2


def test_subscriber_attributes_before_running_deferred_actions():
    """Ordering matters: a deferred action can reach the device immediately."""
    import inspect
    from services import ha_subscriber
    src = inspect.getsource(ha_subscriber._process_event)
    assert "note_automation_fired" in src
    assert src.index("note_automation_fired") < src.index("_run_deferred_automation_actions(")
