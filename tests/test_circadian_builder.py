"""Bug 6: the Smart Light Schedule created blank, non-working automations.

Two roots covered here:
  * The Ziggy metadata must be keyed by the HA ENTITY object_id (derived from
    the alias), not the config id — otherwise the app renders the schedule blank.
    _entity_object_id must reproduce the object_ids we saw live on the Canary:
    automation.ziggy_smart_light_schedule_{sunrise,midday,sunset,bedtime}.
  * auto_on must control whether off lights are turned on (choose-gate) vs
    driven directly.
"""
from services import circadian_builder as cb


def test_object_id_matches_live_entity_ids():
    got = {pid: cb._entity_object_id(alias) for pid, alias, *_ in cb.PHASES}
    assert got == {
        "sunrise":    "ziggy_smart_light_schedule_sunrise",
        "solar_noon": "ziggy_smart_light_schedule_midday",
        "sunset":     "ziggy_smart_light_schedule_sunset",
        "bedtime":    "ziggy_smart_light_schedule_bedtime",
    }


def test_auto_on_true_drives_lights_directly():
    acts = cb._actions_for(["light.a", "light.b"], 3000, 80, auto_on=True)
    assert len(acts) == 1
    assert acts[0]["service"] == "light.turn_on"
    assert acts[0]["target"]["entity_id"] == ["light.a", "light.b"]
    assert acts[0]["data"] == {"color_temp_kelvin": 3000, "brightness_pct": 80}
    assert "choose" not in acts[0]


def test_auto_on_false_only_adjusts_already_on():
    acts = cb._actions_for(["light.a", "light.b"], 3000, 80, auto_on=False)
    assert "choose" in acts[0]
    branches = acts[0]["choose"]
    assert len(branches) == 2
    assert branches[0]["conditions"][0] == {
        "condition": "state", "entity_id": "light.a", "state": "on"}


def test_bedtime_meta_trigger_carries_time_for_frontend():
    # The frontend reads bedtimeAuto.trigger.time to show the bedtime.
    assert cb._meta_trigger("bedtime", "23:15") == {"time": "23:15"}
    assert cb._meta_trigger("solar_noon", "22:00") == {"time": "12:00"}
    assert cb._meta_trigger("sunrise", "22:00")["platform"] == "sun"


def test_build_bundle_has_four_phases_with_lights():
    cfgs = cb.build_bundle(["light.a"], "22:00", auto_on=True)
    assert len(cfgs) == 4
    ids = [c["id"] for c in cfgs]
    assert ids == ["ziggy_circadian_sunrise", "ziggy_circadian_solar_noon",
                   "ziggy_circadian_sunset", "ziggy_circadian_bedtime"]
    # non-light entries are dropped
    assert cb.build_bundle(["switch.x"], "22:00") == []
