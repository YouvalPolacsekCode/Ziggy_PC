"""services/recipes — the deterministic bundles the designer composes from."""
import pytest

from services import recipes as R


def _home():
    return {"rooms": [
        {"id": "kitchen", "entities": {"light": [{"entity_id": "light.k"}],
                                       "motion": [{"entity_id": "binary_sensor.km"}], "presence": [],
                                       "climate": [{"entity_id": "climate.k"}]},
         "occupancy_sensor": None},
        {"id": "living_room", "entities": {"light": [{"entity_id": "light.l"}],
                                           "motion": [{"entity_id": "binary_sensor.lm"}], "presence": []},
         "occupancy_sensor": None},
    ], "persons": [{"name": "Youval"}]}


def _conds(a):
    return [(c.get("type"), c.get("mode"), c.get("is")) for c in a["conditions"]]


def test_registry_names():
    assert set(R.REGISTRY) == {"smart_room", "motion_light", "welcome_home", "leave_home"}


def test_motion_light_shape():
    out = R.REGISTRY["motion_light"]({"room": "kitchen", "linger_minutes": 5}, home=_home(), language="en")
    assert out["ok"]
    a = out["automations"][0]
    assert a["alias"] == "Ziggy Motion Light Kitchen" and a["mode"] == "restart"
    assert a["trigger"] == {"type": "state", "entity_id": ["binary_sensor.km"], "state": "on"}
    assert ("mode", "sleep", False) in _conds(a) and ("mode", "movie", False) in _conds(a)
    kinds = [s["type"] for s in a["actions"]]
    assert kinds == ["call_service", "wait_for_state", "delay", "call_service"]
    assert a["actions"][0]["respect_hold"] is True and a["actions"][0]["service"] == "light.turn_on"
    assert a["actions"][2]["seconds"] == 300
    assert "respect_hold" not in a["actions"][3]


def test_motion_light_night_only_and_hebrew():
    out = R.REGISTRY["motion_light"]({"room": "kitchen", "night_only": True}, home=_home(), language="he")
    a = out["automations"][0]
    assert a["conditions"][0] == {"type": "time", "after": "19:00", "before": "06:30"}
    assert "מטבח" in a["name"]


def test_welcome_home_after_dark():
    out = R.REGISTRY["welcome_home"]({"lights": ["light.l"]}, home=_home(), language="he")
    a = out["automations"][0]
    assert a["auto_id"] == "ziggy_welcome_home"
    assert a["trigger"] == {"type": "person_arrives", "person": "*"}
    assert {"type": "sun", "after": "sunset"} in a["conditions"]
    assert a["actions"][0]["respect_hold"] is True
    out = R.REGISTRY["welcome_home"]({"lights": ["light.nope"]}, home=_home(), language="en")
    assert not out["ok"]


def test_leave_home_guard_and_guest():
    out = R.REGISTRY["leave_home"]({"quiet_minutes": 30}, home=_home(), language="en")
    a = out["automations"][0]
    assert a["auto_id"] == "ziggy_leave_home"
    assert a["trigger"]["type"] == "state" and a["trigger"]["for_minutes"] == 30
    assert set(a["trigger"]["entity_id"]) == {"binary_sensor.km", "binary_sensor.lm"}
    per_sensor = [c for c in a["conditions"] if c.get("entity_id")]
    assert all(c["for_minutes"] == 30 for c in per_sensor) and len(per_sensor) == 2
    assert ("mode", "guest", False) in _conds(a)
    assert {"type": "presence", "value": "all_away"} in a["conditions"]
    assert a["actions"][0] == {"type": "turn_off_all_lights"}
    assert any(s.get("service") == "climate.turn_off" for s in a["actions"])
    assert a["actions"][-1]["type"] == "notify" and "AC" in a["actions"][-1]["message"]


def test_leave_home_without_ac_or_notify():
    out = R.REGISTRY["leave_home"]({"ac": False, "notify": False}, home=_home(), language="en")
    assert [s["type"] for s in out["automations"][0]["actions"]] == ["turn_off_all_lights"]


def test_smart_room_wrapper_carries_mode_conditions(monkeypatch):
    from services import smart_room_recipe as sr
    monkeypatch.setattr(sr, "_light_color_caps", lambda: {"light.l": ["brightness"]})
    monkeypatch.setattr(sr, "_scheduled_lights_set", lambda: set())
    out = R.REGISTRY["smart_room"]({"room": "living_room", "occupancy_entity": "binary_sensor.lm"},
                                   home=_home(), language="en")
    assert out["ok"], out
    day, night, off = out["automations"]
    assert ("mode", "sleep", False) in _conds(day) and ("mode", "movie", False) in _conds(night)
    assert ("mode", "cleaning", False) in _conds(off)
    assert all(s.get("respect_hold") for s in day["actions"])
    assert all("respect_hold" not in s for s in off["actions"])


def test_unknown_room_is_an_honest_error():
    out = R.REGISTRY["motion_light"]({"room": "attic"}, home=_home(), language="en")
    assert not out["ok"] and out["error"]
    out = R.REGISTRY["smart_room"]({"room": "attic"}, home=_home(), language="en")
    assert not out["ok"]
