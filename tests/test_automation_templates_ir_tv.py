"""Resolution tests for the IR-TV automation template (`tv_off_when_empty`).

Covers: registry presence, can_run capability gating (needs an IR blaster AND
a motion OR presence sensor), and the build_prefill shape — trigger /
ir_device_state condition / single `ir_command power` action.

Curation (2026-07-19 IA addendum A4): tv_off_when_empty is RETIRED from the
surfaced Library, so it resolves via RETIRED_TEMPLATES. Its builder must keep
working — automations users already created from it still edit/run.
"""
import services.automation_templates as at
from services.automation_templates import (
    TEMPLATES,
    RETIRED_TEMPLATES,
    build_prefill,
    can_run,
    matches_suggestion,
    get_missing_required,
)


def _tpl(tid):
    return next((t for t in TEMPLATES + RETIRED_TEMPLATES if t["id"] == tid), None)


def test_ir_tv_template_registered():
    tpl = _tpl("tv_off_when_empty")
    assert tpl is not None, "tv_off_when_empty missing from template registry"
    assert tpl["category"] == "comfort"
    assert tpl["required_capabilities"] == ["has_ir_blaster"]
    assert ["motion_sensor", "presence_sensor"] in tpl["required_any"]
    # Israel-first: ships a Hebrew name for localized surfaces.
    assert tpl.get("name_he")
    # Curated out of the Library surface (2026-07-19) but never deleted.
    assert tpl.get("retired") is True


def test_curated_library_is_exactly_the_8():
    # The curation gate: only the 8 approved Automatic templates surface.
    ids = {t["id"] for t in TEMPLATES}
    assert ids == {
        "leave_home", "precool_on_arrival", "smart_climate",
        "motion_night_light", "night_watch", "circadian_lighting",
        "smart_room", "ac_window_interlock",
    }
    # Every surfaced template declares its trigger kind for the UI chips.
    assert all(t.get("trigger_kind") == "automatic" for t in TEMPLATES)


def test_retired_stay_resolvable():
    # Retired templates keep resolving (existing installs reference them).
    retired_ids = {t["id"] for t in RETIRED_TEMPLATES}
    assert {
        "welcome_home", "sleep_mode", "morning_routine",
        "child_room_monitor", "tv_off_when_empty", "fake_occupancy",
    } == retired_ids


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
