"""Schedule triggers: days of the week and several times a day, on the `time` trigger.

The user asked for "3 times a day, 4 days a week". Everything here is also
about not changing what an existing time rule does: no `days` = every day,
one `time` = exactly the config it always compiled to.
"""
from __future__ import annotations

from datetime import datetime

import pytest

from services import schedule_trigger as S
from services import ha_automations as A

# 2026-11-01 is a Sunday.
SUN, MON, WED, FRI, SAT = (datetime(2026, 11, d, 7, 0) for d in (1, 2, 4, 6, 7))

THREE_A_DAY_FOUR_DAYS = {"type": "time", "time": "07:00", "times": ["07:00", "13:00", "19:30"],
                        "days": ["sun", "mon", "tue", "wed"]}


def at(day: datetime, hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return day.replace(hour=h, minute=m)


# ── Firing ──────────────────────────────────────────────────────────────────

def test_old_rule_still_fires_every_day_at_its_time():
    old = {"type": "time", "time": "07:00"}
    for day in (SUN, MON, WED, FRI, SAT):
        assert S.fires_at(old, at(day, "07:00"))
        assert not S.fires_at(old, at(day, "07:01"))


@pytest.mark.parametrize("day,hhmm,expect", [
    (SUN, "07:00", True), (SUN, "13:00", True), (SUN, "19:30", True),
    (MON, "13:00", True), (WED, "19:30", True),
    (FRI, "07:00", False), (SAT, "13:00", False),     # not one of the four days
    (SUN, "08:00", False), (MON, "19:31", False),     # not one of the three times
])
def test_three_times_a_day_four_days_a_week(day, hhmm, expect):
    assert S.fires_at(THREE_A_DAY_FOUR_DAYS, at(day, hhmm)) is expect


def test_all_seven_days_is_every_day():
    t = {"type": "time", "time": "07:00", "days": list(S.DAY_CODES)}
    assert S.trigger_days(t) is None
    assert S.normalized(t) == {"type": "time", "time": "07:00"}


def test_times_are_cleaned_sorted_and_deduplicated():
    t = {"type": "time", "times": ["19:30", "7:00", "07:00:00", "bad", "", None]}
    assert S.trigger_times(t) == ["07:00", "19:30"]


def test_day_names_and_numbers_are_understood():
    assert S.normalize_days(["Sunday", "MON", 2, "thurs"]) == ["mon", "wed", "thu", "sun"]
    assert S.normalize_days(None) is None
    assert S.normalize_days(["xyz"]) == []


# ── Save guard ──────────────────────────────────────────────────────────────

def _auto(trigger):
    return {"name": "t", "trigger": trigger,
            "actions": [{"type": "call_service", "entity_id": "light.a", "service": "light.turn_on"}]}


@pytest.mark.parametrize("trigger,hint", [
    ({"type": "time", "time": ""}, "no time set"),
    ({"type": "time", "times": ["", "nope"]}, "no time set"),
    ({"type": "time", "time": "07:00", "days": []}, "no days picked"),
    ({"type": "time", "time": "07:00", "days": ["funday"]}, "no days picked"),
])
def test_schedules_that_can_never_run_are_refused(trigger, hint):
    reason = A.invalid_trigger_reason(_auto(trigger))
    assert reason and hint in reason


@pytest.mark.parametrize("trigger", [
    {"type": "time", "time": "07:00"},
    {"type": "time", "time": "07:00", "days": None},
    THREE_A_DAY_FOUR_DAYS,
])
def test_valid_schedules_are_accepted(trigger):
    assert A.invalid_trigger_reason(_auto(trigger)) is None


def test_normalized_leaves_an_old_rule_untouched():
    old = {"type": "time", "time": "07:00"}
    assert S.normalized(old) == old


def test_normalized_canonical_form():
    t = S.normalized({"type": "time", "times": ["19:30", "07:00"], "days": ["wed", "sun"]})
    assert t == {"type": "time", "time": "07:00", "times": ["07:00", "19:30"], "days": ["wed", "sun"]}


# ── Routing + HA converter ──────────────────────────────────────────────────

def test_schedules_stay_with_ziggys_scheduler():
    assert A.needs_ha({"trigger": THREE_A_DAY_FOUR_DAYS}) is False


def test_single_time_compiles_exactly_as_before():
    assert A._trigger_to_ha({"type": "time", "time": "07:00"}) == [{"platform": "time", "at": "07:00:00"}]


def test_several_times_compile_to_an_ha_list_and_read_back():
    ha = A._trigger_to_ha(THREE_A_DAY_FOUR_DAYS)
    assert ha == [{"platform": "time", "at": ["07:00:00", "13:00:00", "19:30:00"]}]
    back = A._ha_trigger_to_ziggy(ha)
    assert back == {"type": "time", "time": "07:00", "times": ["07:00", "13:00", "19:30"]}


def test_days_become_an_ha_weekday_condition():
    assert A._schedule_day_condition(THREE_A_DAY_FOUR_DAYS) == {
        "condition": "time", "weekday": ["mon", "tue", "wed", "sun"]}
    assert A._schedule_day_condition({"type": "time", "time": "07:00"}) is None
    assert A._schedule_day_condition({"type": "state", "days": ["mon"]}) is None


def test_save_stores_the_schedule_locally_in_canonical_form(monkeypatch, tmp_path):
    from core import automation_file
    import services.local_automation_actions as L
    monkeypatch.setattr(automation_file, "AUTOMATION_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(L, "save_ziggy_actions", lambda *a, **k: None)
    monkeypatch.setattr(L, "save_automation_meta", lambda *a, **k: None)
    monkeypatch.setattr(A, "_duplicate_name_of", lambda *a, **k: None)
    monkeypatch.setattr(A, "invalid_action_entity", lambda *a, **k: None)
    res = A.save_automation(_auto({"type": "time", "times": ["19:30", "07:00", "13:00"],
                                   "days": ["wed", "sun", "mon", "tue"]}), auto_id="s1")
    assert res == {"ok": True, "id": "s1", "source": "ziggy"}
    stored = automation_file.get_automation("s1")["trigger"]
    assert stored == {"type": "time", "time": "07:00", "times": ["07:00", "13:00", "19:30"],
                      "days": ["mon", "tue", "wed", "sun"]}


# ── Scheduler ───────────────────────────────────────────────────────────────

def test_scheduler_uses_the_shared_schedule_logic():
    import inspect
    from services import ziggy_scheduler
    src = inspect.getsource(ziggy_scheduler.run_scheduler)
    assert "_schedule.fires_at(trigger, now)" in src
    assert 'trigger.get("time") != current_time' not in src


# ── Chat agent ──────────────────────────────────────────────────────────────

def test_agent_schedule_fields_land_on_the_trigger():
    from core.handlers.automation_handler import _apply_schedule_params
    t = {"type": "time", "time": "08:00"}
    _apply_schedule_params(t, {"trigger_times": ["07:00", "13:00", "19:30"],
                               "trigger_days": ["sun", "mon", "tue", "wed"]})
    assert t == {"type": "time", "time": "07:00", "times": ["07:00", "13:00", "19:30"],
                 "days": ["sun", "mon", "tue", "wed"]}


def test_agent_without_schedule_fields_changes_nothing():
    from core.handlers.automation_handler import _apply_schedule_params
    t = {"type": "time", "time": "08:00"}
    _apply_schedule_params(t, {"trigger_time": "08:00"})
    assert t == {"type": "time", "time": "08:00"}


def test_both_agent_schemas_offer_days_and_times():
    from core.tools_schema import TOOLS  # noqa: F401  (import check)
    import core.tools_schema as TS
    import core.agent.tools as AT
    for src in (open(TS.__file__).read(), open(AT.__file__).read()):
        assert '"trigger_days"' in src and '"trigger_times"' in src
