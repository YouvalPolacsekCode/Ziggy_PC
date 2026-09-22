"""Guards on the way into the store: a saved automation must be able to work.

The worst failure this system has is a rule that stores cleanly, lists
cleanly, reports a successful run and does nothing. It has happened twice:

  * 2026-09-05, a customer's balcony motion light saved with zero actions.
    `has_executable_actions` came out of that.
  * The mirror on the trigger side went unguarded until 2026-09-22 — the
    converter turned half-filled input into HA config that can never match
    (a `controller` with no id compiled to NO triggers at all).

Everything here is about refusing at save time rather than discovering it in
a log later.
"""

import pytest

from services.ha_automations import (
    invalid_trigger_reason,
    has_executable_actions,
    _condition_to_ha,
    _duplicate_name_of,
    needs_ha,
)


def _auto(trigger, **kw):
    base = {"name": "t", "trigger": trigger,
            "actions": [{"type": "call_service", "entity_id": "light.a", "service": "light.turn_on"}]}
    base.update(kw)
    return base


# ── Triggers that could never fire ──────────────────────────────────────────

@pytest.mark.parametrize("trigger,hint", [
    ({"type": "state", "entity_id": "", "state": "on"},               "watches no device"),
    ({"type": "numeric_state", "entity_id": "", "above": 5},          "watches no device"),
    ({"type": "occupancy", "entity_id": "", "state": "on"},           "watches no device"),
    ({"type": "time", "time": ""},                                     "no time set"),
    ({"type": "time_pattern"},                                         "no repeat interval"),
    ({"type": "controller", "controller_id": "", "action": ""},        "no remote or button"),
    ({"type": "controller", "controller_id": "btn1", "action": ""},    "no remote or button"),
    ({"type": "webhook", "webhook_id": ""},                            "no id"),
    ({"type": "zone", "entity_id": ""},                                "tracks no one"),
])
def test_incomplete_triggers_are_refused(trigger, hint):
    reason = invalid_trigger_reason(_auto(trigger))
    assert reason, f"{trigger} was accepted but can never fire"
    assert hint in reason, f"unhelpful message for {trigger}: {reason!r}"


@pytest.mark.parametrize("trigger", [
    {"type": "state", "entity_id": "binary_sensor.door", "state": "on"},
    {"type": "time", "time": "07:30"},
    {"type": "time_pattern", "minutes": "/15"},
    {"type": "controller", "controller_id": "btn1", "action": "single"},
    {"type": "webhook", "webhook_id": "abc"},
    {"type": "person_arrives", "person": "*"},
    {"type": "person_leaves", "person": "Rachel"},
    {"type": "all_persons_left"},
    {"type": "zone_entered", "zone": "Near Home", "person": "*"},
    {"type": "sunrise"},
    {"type": "sunset", "offset": "-00:30"},
    {"type": "manual"},
])
def test_complete_triggers_are_accepted(trigger):
    assert invalid_trigger_reason(_auto(trigger)) is None, trigger


def test_blueprint_bodies_are_left_alone():
    """They carry their own HA triggers; this check must not second-guess them."""
    data = _auto({}, ha_native_body={"trigger": [{"platform": "state"}]})
    assert invalid_trigger_reason(data) is None


def test_paired_stages_are_each_checked():
    ok = {"type": "state", "entity_id": "binary_sensor.a", "state": "on"}
    bad = {"type": "time", "time": ""}
    assert invalid_trigger_reason({"paired": True, "stages": [{"trigger": ok}, {"trigger": ok}]}) is None
    assert invalid_trigger_reason({"paired": True, "stages": [{"trigger": ok}, {"trigger": bad}]})


def test_actions_guard_still_holds():
    """The balcony case, so the original guard can't be lost in a refactor."""
    assert has_executable_actions(_auto({"type": "manual"})) is True
    assert has_executable_actions({"name": "x", "trigger": {"type": "manual"}, "actions": []}) is False


# ── Duplicate names ─────────────────────────────────────────────────────────

def test_duplicate_name_detection(monkeypatch):
    monkeypatch.setattr("core.automation_file.list_automations",
                        lambda: [{"id": "a1", "name": "Good Night"}])
    assert _duplicate_name_of("Good Night", None) == "Good Night"
    assert _duplicate_name_of("  good   night ", None) == "Good Night"   # case + spacing
    assert _duplicate_name_of("Good Night", "a1") is None                # editing itself
    assert _duplicate_name_of("Movie Time", None) is None
    assert _duplicate_name_of("", None) is None


def test_duplicate_check_never_blocks_on_its_own_failure(monkeypatch):
    def boom():
        raise RuntimeError("store unavailable")
    monkeypatch.setattr("core.automation_file.list_automations", boom)
    assert _duplicate_name_of("Anything", None) is None


# ── Boolean condition groups ────────────────────────────────────────────────

def _ent(e):
    return {"type": "entity", "entity_id": e, "value": "on"}


def test_or_and_groups_compile_to_home_assistant():
    """They used to compile to None and be dropped from the list.

    For an OR that means "no restriction at all" — HA fired the automation in
    cases the user had explicitly narrowed. Ziggy's own executor always
    evaluated them, so the two engines disagreed about the same rule.
    """
    out = _condition_to_ha({"type": "or", "conditions": [_ent("binary_sensor.a"), _ent("binary_sensor.b")]})
    assert out["condition"] == "or"
    assert len(out["conditions"]) == 2

    assert _condition_to_ha({"type": "and", "conditions": [_ent("binary_sensor.a")]})["condition"] == "and"
    # The catalog's alias spelling must work too.
    assert _condition_to_ha({"type": "or_group", "conditions": [_ent("binary_sensor.a")]})["condition"] == "or"


def test_group_with_no_convertible_children_is_dropped_not_emptied():
    """`{"condition": "or", "conditions": []}` is FALSE in HA.

    Emitting one would wedge the automation off forever — the same silent
    failure as dropping the group, in the opposite direction.
    """
    out = _condition_to_ha({"type": "or", "conditions": [{"type": "presence", "value": "anyone_home"}]})
    assert out is None


def test_groups_nest():
    out = _condition_to_ha({"type": "or", "conditions": [
        _ent("binary_sensor.a"),
        {"type": "and", "conditions": [_ent("binary_sensor.b"), {"type": "sun", "after": "sunset"}]},
    ]})
    assert out["condition"] == "or"
    inner = out["conditions"][1]
    assert inner["condition"] == "and"
    assert {c["condition"] for c in inner["conditions"]} == {"state", "sun"}


# ── Routing ─────────────────────────────────────────────────────────────────

def test_native_presence_triggers_never_go_to_home_assistant():
    for t in ("person_arrives", "person_leaves", "all_persons_left", "zone_entered", "zone_left"):
        assert needs_ha({"trigger": {"type": t}}) is False, t


# ── Defence in depth / round-trip breadcrumbs ───────────────────────────────

def test_converter_complains_about_an_incomplete_trigger(caplog):
    """Nothing should reach the converter half-filled — but if it does, say so.

    A restored backup or a future caller could bypass save_automation. Silence
    here is what made the original bug so hard to see: the config was written,
    stored and reported fine, and simply never matched.
    """
    from services.ha_automations import _trigger_to_ha
    import logging
    with caplog.at_level(logging.ERROR):
        _trigger_to_ha({"type": "time", "time": ""})
    assert any("incomplete trigger" in r.getMessage() for r in caplog.records), \
        "converting an impossible trigger passed silently"


def test_occupancy_ui_stamp_survives_the_trigger_converter():
    """The wizard stamps `ui: 'occupancy'` so reopening is deterministic.

    It must not confuse the HA converter, which should ignore it entirely.
    """
    from services.ha_automations import _trigger_to_ha, invalid_trigger_reason
    t = {"type": "state", "ui": "occupancy", "entity_id": "binary_sensor.office_occupied", "state": "on"}
    assert invalid_trigger_reason({"trigger": t}) is None
    out = _trigger_to_ha(t)
    assert out == [{"platform": "state", "entity_id": "binary_sensor.office_occupied", "to": "on"}], out
