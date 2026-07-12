"""Resolution tests for the IR-TV automation template (`tv_off_when_empty`).

Covers: registry presence, can_run capability gating (needs an IR blaster AND
a motion OR presence sensor), Suggested-tab surfacing, and the build_prefill
shape — trigger / ir_device_state condition / single `ir_command power` action.
The existing 16-template library must keep resolving unchanged.
"""
import services.automation_templates as at
from services.automation_templates import (
    TEMPLATES,
    build_prefill,
    can_run,
    matches_suggestion,
    get_missing_required,
)


def _tpl(tid):
    return next((t for t in TEMPLATES if t["id"] == tid), None)


def test_ir_tv_template_registered():
    tpl = _tpl("tv_off_when_empty")
    assert tpl is not None, "tv_off_when_empty missing from TEMPLATES"
    assert tpl["category"] == "comfort"
    assert tpl["required_capabilities"] == ["has_ir_blaster"]
    assert ["motion_sensor", "presence_sensor"] in tpl["required_any"]
    # Israel-first: ships a Hebrew name for localized surfaces.
    assert tpl.get("name_he")


def test_existing_library_intact():
    # Forward-port must be additive: the curated ids all still resolve.
    ids = {t["id"] for t in TEMPLATES}
    for expected in (
        "leave_home", "welcome_home", "precool_on_arrival", "sleep_mode",
        "morning_routine", "smart_climate", "child_room_monitor",
        "motion_night_light", "night_watch", "circadian_lighting",
        "ac_window_interlock", "fake_occupancy",
    ):
        assert expected in ids


def test_can_run_needs_ir_blaster_and_a_sensor():
    tpl = _tpl("tv_off_when_empty")
    # Blaster + presence → runnable
    assert can_run(tpl, {"has_ir_blaster": ["remote.rm4"], "presence_sensor": ["binary_sensor.p"]})
    # Blaster + motion → runnable (required_any satisfied by the other option)
    assert can_run(tpl, {"has_ir_blaster": ["remote.rm4"], "motion_sensor": ["binary_sensor.m"]})
    # Blaster but no trigger sensor → not runnable
    assert not can_run(tpl, {"has_ir_blaster": ["remote.rm4"]})
    # Sensor but no blaster → not runnable
    assert not can_run(tpl, {"presence_sensor": ["binary_sensor.p"]})
    # The missing-required surface names the blaster and the unmet sensor group.
    missing = get_missing_required(tpl, {"presence_sensor": ["binary_sensor.p"]})
    assert "has_ir_blaster" in missing


def test_surfaces_in_suggested_on_any_relevant_device():
    tpl = _tpl("tv_off_when_empty")
    assert matches_suggestion(tpl, {"has_ir_blaster": ["remote.rm4"]})
    assert matches_suggestion(tpl, {"motion_sensor": ["binary_sensor.m"]})
    assert not matches_suggestion(tpl, {"door_sensor": ["binary_sensor.d"]})


def test_prefill_shape_with_presence_and_tv(monkeypatch):
    monkeypatch.setattr(at, "_first_tv_ir_device",
                        lambda: {"id": "ir_tv_lr", "room": "living_room", "type": "tv"})
    cap_map = {
        "has_ir_blaster":  ["remote.rm4"],
        "presence_sensor": ["binary_sensor.presence_lr"],
        "motion_sensor":   ["binary_sensor.motion_lr"],
    }
    pre = build_prefill(_tpl("tv_off_when_empty"), cap_map)

    # Trigger: presence preferred over motion, "empty" = off for a grace window.
    assert pre["trigger"]["entity_id"] == "binary_sensor.presence_lr"
    assert pre["trigger"]["state"] == "off"
    assert pre["trigger"]["for_minutes"] == 20

    # Condition: gate on the TV's IR assumed_state so we never toggle an
    # already-off set back on (TV `power` is a single toggle command).
    conds = pre["conditions"]
    assert len(conds) == 1
    assert conds[0]["type"] == "ir_device_state"
    assert conds[0]["ir_device_id"] == "ir_tv_lr"
    assert conds[0]["value"] == "on"

    # Action: exactly one ir_command power step, bound to the TV.
    acts = pre["actions"]
    assert len(acts) == 1
    assert acts[0]["type"] == "ir_command"
    assert acts[0]["ir_device_id"] == "ir_tv_lr"
    assert acts[0]["ir_command"] == "power"


def test_prefill_motion_only_uses_longer_grace(monkeypatch):
    monkeypatch.setattr(at, "_first_tv_ir_device", lambda: None)
    cap_map = {"has_ir_blaster": ["remote.rm4"], "motion_sensor": ["binary_sensor.motion_lr"]}
    pre = build_prefill(_tpl("tv_off_when_empty"), cap_map)
    assert pre["trigger"]["entity_id"] == "binary_sensor.motion_lr"
    assert pre["trigger"]["for_minutes"] == 30      # motion-only → longer window
    # No TV discovered → no gating condition, action slot left empty for the wizard.
    assert pre["conditions"] == []
    assert pre["actions"][0]["ir_device_id"] == ""
