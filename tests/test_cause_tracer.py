"""Causal trace — 'what turned my light off?'.

HA's logbook stamps each device change with its cause (context). This classifies
that into automation / person / device / unknown from the real logbook shape seen
on the Canary (context_domain, context_name, context_entity_id[_name], context_user_id).
"""
from services.cause_tracer import explain_change


def _e(eid, state, when, **ctx):
    d = {"entity_id": eid, "state": state, "when": when, "name": "X"}
    d.update(ctx)
    return d


def test_identifies_automation_cause():
    entries = [_e("light.x", "off", "2026-08-28T14:29:32+00:00",
                  context_domain="automation", context_name="Good Night",
                  context_entity_id="automation.good_night")]
    r = explain_change(entries, "light.x", action="off")
    assert r["cause_kind"] == "automation"
    assert r["cause_name"] == "Good Night"
    assert r["state"] == "off"


def test_identifies_person_cause():
    entries = [_e("light.x", "on", "2026-08-28T17:26:59+00:00",
                  context_domain="light", context_user_id="abc123")]
    r = explain_change(entries, "light.x")
    assert r["cause_kind"] == "person"


def test_identifies_device_trigger():
    entries = [_e("light.x", "on", "2026-08-28T10:00:00+00:00",
                  context_entity_id="binary_sensor.hall_motion",
                  context_entity_id_name="Hall Motion")]
    r = explain_change(entries, "light.x")
    assert r["cause_kind"] == "device"
    assert r["cause_name"] == "Hall Motion"


def test_action_filter_picks_matching_state():
    entries = [
        _e("light.x", "on", "2026-08-28T09:00:00+00:00", context_user_id="u"),
        _e("light.x", "off", "2026-08-28T23:00:00+00:00",
           context_domain="automation", context_name="Good Night"),
    ]
    r = explain_change(entries, "light.x", action="off")
    assert r["cause_kind"] == "automation" and r["state"] == "off"


def test_picks_most_recent_when_no_action():
    entries = [
        _e("light.x", "off", "2026-08-28T09:00:00+00:00",
           context_domain="automation", context_name="Morning"),
        _e("light.x", "on", "2026-08-28T23:00:00+00:00", context_user_id="u"),
    ]
    r = explain_change(entries, "light.x")
    assert r["state"] == "on" and r["cause_kind"] == "person"


def test_filters_to_the_asked_entity():
    entries = [_e("light.other", "off", "2026-08-28T23:00:00+00:00",
                  context_domain="automation", context_name="X")]
    assert explain_change(entries, "light.x") is None


def test_no_entries_returns_none():
    assert explain_change([], "light.x") is None


def test_unknown_cause_when_no_context():
    entries = [_e("light.x", "off", "2026-08-28T12:00:00+00:00")]
    r = explain_change(entries, "light.x")
    assert r["cause_kind"] == "unknown"
