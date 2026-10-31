"""Weather conditions: "water the garden unless it rains".

Yes/no facts from Open-Meteo for the home's location; Ziggy's evaluator and
the HA mirror must agree, and an unknown forecast is never read as "no rain".
"""
from __future__ import annotations

import time
from datetime import date

import pytest

from services import weather as W
from services import ha_automations as A

TODAY = date(2026, 11, 1)


def _payload(rain=(0.0, 3.2, 0.0), cloud=40.0, tmax=24.0, dates=None):
    return {"daily": {
        "time": dates or ["2026-10-31", "2026-11-01", "2026-11-02"],
        "precipitation_sum": list(rain),
        "cloud_cover_mean": [10.0, cloud, 20.0],
        "temperature_2m_max": [22.0, tmax, 25.0],
    }}


def test_facts_from_open_meteo():
    f = W.facts_from_open_meteo(_payload(), TODAY)
    assert (f["rain_yesterday"], f["rain_today"], f["rain_tomorrow"]) == (False, True, False)
    assert f["cloudy_today"] is False and f["max_temp_today"] == 24.0


def test_drizzle_is_not_rain():
    f = W.facts_from_open_meteo(_payload(rain=(0.3, 0.9, 0.1)), TODAY)
    assert not any((f["rain_yesterday"], f["rain_today"], f["rain_tomorrow"]))


def test_rows_are_matched_by_date_not_position():
    """A payload one day off must not turn tomorrow into today."""
    shifted = _payload(rain=(9.0, 0.0, 0.0), dates=["2026-11-01", "2026-11-02", "2026-11-03"])
    f = W.facts_from_open_meteo(shifted, TODAY)
    assert f["rain_today"] is True and f["rain_yesterday"] is None
    assert W.facts_from_open_meteo(_payload(dates=["2026-10-01", "2026-10-02", "2026-10-03"]), TODAY) is None


FACTS = W.facts_from_open_meteo(_payload(rain=(5.0, 0.0, 2.0), cloud=85.0, tmax=33.0), TODAY)


@pytest.mark.parametrize("cond,expect", [
    ({"check": "rain_today", "is": False}, True),        # water unless it rains today
    ({"check": "rain_today", "is": True}, False),
    ({"check": "rain_yesterday", "is": False}, False),    # it did rain yesterday
    ({"check": "rain_tomorrow", "is": True}, True),
    ({"check": "cloudy_today", "is": True}, True),        # solar heater won't cope
    ({"check": "hot_today", "is": True, "above": 30}, True),
    ({"check": "hot_today", "is": True, "above": 35}, False),
    ({"check": "hot_today", "is": False, "above": 35}, True),
])
def test_evaluate(cond, expect):
    ok, reason = W.evaluate({"type": "weather", **cond}, FACTS)
    assert ok is expect, reason


@pytest.mark.parametrize("is_", [True, False])
def test_unknown_forecast_is_never_met(is_, monkeypatch):
    """'Skip if it rains' must not water blind, and 'only if hot' must not fire blind."""
    monkeypatch.setattr(W, "_cache", {"at": 0.0, "facts": None, "for_date": None})
    for check in W.CHECKS:
        ok, reason = W.evaluate({"type": "weather", "check": check, "is": is_, "above": 30})
        assert ok is False and "unknown" in reason


def test_stale_or_yesterdays_cache_is_unknown(monkeypatch):
    monkeypatch.setattr(W, "_cache", {"at": time.time() - 7 * 3600, "facts": FACTS, "for_date": date.today().isoformat()})
    assert W.current() is None
    monkeypatch.setattr(W, "_cache", {"at": time.time(), "facts": FACTS, "for_date": "2000-01-01"})
    assert W.current() is None
    monkeypatch.setattr(W, "_cache", {"at": time.time(), "facts": FACTS, "for_date": date.today().isoformat()})
    assert W.current() is FACTS


def test_local_evaluator_routes_weather(monkeypatch):
    from services.local_automation_actions import _eval_single_condition
    monkeypatch.setattr(W, "_cache", {"at": time.time(), "facts": FACTS, "for_date": date.today().isoformat()})
    assert _eval_single_condition({"type": "weather", "check": "rain_today", "is": False})[0] is True
    assert _eval_single_condition({"type": "weather", "check": "rain_yesterday", "is": False})[0] is False


def test_davids_rule_end_to_end(monkeypatch):
    """Sun/Tue/Thu/Sat at 06:00 unless it rained yesterday or rains today."""
    from datetime import datetime
    from services import schedule_trigger as S
    from services.local_automation_actions import _eval_single_condition
    trigger = {"type": "time", "time": "06:00", "days": ["sun", "tue", "thu", "sat"]}
    conds = [{"type": "weather", "check": "rain_today", "is": False},
             {"type": "weather", "check": "rain_yesterday", "is": False}]
    sunday_6 = datetime(2026, 11, 1, 6, 0)
    assert S.fires_at(trigger, sunday_6)
    dry = W.facts_from_open_meteo(_payload(rain=(0.0, 0.0, 0.0)), TODAY)
    wet = W.facts_from_open_meteo(_payload(rain=(6.0, 0.0, 0.0)), TODAY)
    for facts, runs in ((dry, True), (wet, False)):
        monkeypatch.setattr(W, "_cache", {"at": time.time(), "facts": facts, "for_date": date.today().isoformat()})
        assert all(_eval_single_condition(c)[0] for c in conds) is runs


# ── HA side ─────────────────────────────────────────────────────────────────

def test_ha_compiles_to_the_mirrored_entities(monkeypatch):
    from services import weather_mqtt
    monkeypatch.setattr(weather_mqtt, "entity_id", lambda fact: f"x.ziggy_weather_{fact}")
    assert A._condition_to_ha({"type": "weather", "check": "rain_today", "is": False}) == {
        "condition": "state", "entity_id": "x.ziggy_weather_rain_today", "state": "off"}
    assert A._condition_to_ha({"type": "weather", "check": "hot_today", "is": True, "above": 30}) == {
        "condition": "numeric_state", "entity_id": "x.ziggy_weather_max_temp_today", "above": 30.0}
    not_hot = A._condition_to_ha({"type": "weather", "check": "hot_today", "is": False, "above": 30})
    assert not_hot["condition"] == "numeric_state" and "below" in not_hot, "never a bare `not` (passes when unavailable)"


def test_ha_rule_is_refused_rather_than_dropping_the_weather_check(monkeypatch):
    """A button rule 'water unless it rains' must not reach HA without the rain check."""
    from services import weather_mqtt
    import services.local_automation_actions as L
    monkeypatch.setattr(weather_mqtt, "entity_id", lambda fact: None)
    monkeypatch.setattr(L, "save_ziggy_actions", lambda *a, **k: None)
    monkeypatch.setattr(L, "save_automation_meta", lambda *a, **k: None)
    monkeypatch.setattr(A, "_duplicate_name_of", lambda *a, **k: None)
    monkeypatch.setattr(A, "invalid_action_entity", lambda *a, **k: None)
    posted = []
    monkeypatch.setattr(A.requests, "post", lambda *a, **k: posted.append(a) or None)
    res = A.save_automation({
        "name": "Water", "trigger": {"type": "state", "entity_id": "binary_sensor.b", "state": "on"},
        "conditions": [{"type": "weather", "check": "rain_today", "is": False}],
        "actions": [{"type": "call_service", "entity_id": "switch.valve", "service": "turn_on"}],
    }, auto_id="w1")
    assert res["ok"] is False and res["reason"] == "invalid_condition"
    assert posted == []


@pytest.mark.parametrize("cond", [
    {"type": "weather"}, {"type": "weather", "check": "snow"},
    {"type": "weather", "check": "hot_today", "above": ""},
    {"type": "or", "conditions": [{"type": "weather", "check": "nope"}]},
])
def test_half_filled_weather_conditions_are_refused(cond):
    assert A._invalid_weather_condition([cond])


def test_mirror_marks_unknown_unavailable_not_off(monkeypatch):
    from services import weather_mqtt as M
    sent = []
    monkeypatch.setattr(M, "_publish", lambda topic, payload: sent.append((topic, payload)) or True)
    monkeypatch.setattr(M, "_announced", True)
    M.publish(None)
    assert sent == [(M.AVAILABILITY_TOPIC, b"offline")]
    sent.clear()
    M.publish(FACTS)
    assert (M.state_topic("rain_today"), b"OFF") in sent
    assert (M.state_topic("max_temp_today"), b"33.0") in sent
    assert sent[-1] == (M.AVAILABILITY_TOPIC, b"online")


def test_mirrored_entities_are_hidden_from_device_lists():
    from services.entity_filter import is_hidden_entity
    assert is_hidden_entity("binary_sensor.ziggy_weather_rain_today")
    assert is_hidden_entity("sensor.ziggy_weather_max_temp_today")


def test_catalog_lists_weather_as_supported():
    from services.automation_catalog import get_catalog, detect_drift
    conds = {c["id"]: c for c in get_catalog()["ha_capabilities"]["conditions"]}
    assert conds["weather"]["ziggy_supported"] is True
    assert detect_drift() == {k: [] for k in detect_drift()}


def test_weather_refresh_runs_before_the_schedule_check():
    import inspect
    from services import ziggy_scheduler
    src = inspect.getsource(ziggy_scheduler.run_scheduler)
    assert src.index("weather.refresh()") < src.index("_schedule.fires_at(trigger, now)")
