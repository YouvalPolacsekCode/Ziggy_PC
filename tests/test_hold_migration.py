"""Recipe automations installed before respect_hold existed must be upgraded."""
import pytest

from services import hold_migration as HM
from services import local_automation_actions as laa


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STORE_FILE", str(tmp_path / "a.json"))
    monkeypatch.setattr(laa, "META_FILE", str(tmp_path / "m.json"))
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))


def _install(aid, steps, trigger=None):
    laa.save_ziggy_actions(aid, steps)
    laa.save_automation_meta(aid, {
        "name": aid, "description": "",
        "trigger": trigger or {"type": "state", "entity_id": "binary_sensor.occ", "state": "on"},
        "conditions": [], "rooms": [],
    })


ON = {"type": "call_service", "entity_id": "light.a", "service": "light.turn_on",
      "service_data": {"brightness_pct": 30}}
OFF = {"type": "call_service", "entity_id": "light.a", "service": "light.turn_off"}


def test_owns_only_recipe_ids():
    assert HM.owns("ziggy_smart_room_office_day")
    assert HM.owns("ziggy_smart_room_bedroom_2_night")
    assert HM.owns("ziggy_motion_light_kitchen")
    assert HM.owns("ziggy_welcome_home")
    # a user's own rule and the recipes' off-rules are left alone
    assert not HM.owns("storage_light_on")
    assert not HM.owns("ziggy_smart_room_office_off")
    assert not HM.owns("ziggy_leave_home")


def test_plan_finds_unpatched_turn_ons():
    _install("ziggy_smart_room_office_day", [ON, dict(ON, entity_id="light.b")])
    _install("ziggy_smart_room_office_off", [OFF])
    _install("storage_light_on", [ON])
    p = {r["id"]: r for r in HM.plan()}
    assert set(p) == {"ziggy_smart_room_office_day"}
    assert p["ziggy_smart_room_office_day"]["to_patch"] == 2


def test_migrate_patches_and_resaves(monkeypatch):
    saved = {}

    def fake_save(data, auto_id=None):
        saved[auto_id] = data
        return {"ok": True, "id": auto_id}

    monkeypatch.setattr("services.ha_automations.save_automation", fake_save)
    _install("ziggy_smart_room_office_night", [ON, OFF])
    res = HM.migrate()
    assert res["migrated"] == [{"id": "ziggy_smart_room_office_night", "patched": 1, "written": True}]
    assert res["errors"] == []
    acts = saved["ziggy_smart_room_office_night"]["actions"]
    assert acts[0]["respect_hold"] is True          # the turn_on
    assert "respect_hold" not in acts[1]            # the turn_off is untouched
    assert acts[0]["service_data"] == {"brightness_pct": 30}   # nothing else changed


def test_migrate_is_idempotent(monkeypatch):
    calls = []
    monkeypatch.setattr("services.ha_automations.save_automation",
                        lambda data, auto_id=None: calls.append(auto_id) or {"ok": True, "id": auto_id})
    _install("ziggy_motion_light_kitchen", [dict(ON, respect_hold=True)])
    res = HM.migrate()
    assert res["migrated"] == [] and calls == []
    assert HM.plan() == []


def test_dry_run_writes_nothing(monkeypatch):
    calls = []
    monkeypatch.setattr("services.ha_automations.save_automation",
                        lambda data, auto_id=None: calls.append(auto_id) or {"ok": True, "id": auto_id})
    _install("ziggy_welcome_home", [ON])
    res = HM.migrate(dry_run=True)
    assert calls == []
    assert res["migrated"] == [{"id": "ziggy_welcome_home", "patched": 1, "written": False}]


def test_a_save_failure_is_reported_not_raised(monkeypatch):
    monkeypatch.setattr("services.ha_automations.save_automation",
                        lambda data, auto_id=None: {"ok": False, "error": "HA said no"})
    _install("ziggy_smart_room_office_day", [ON])
    res = HM.migrate()
    assert res["migrated"] == [] and res["errors"][0]["error"] == "HA said no"


def test_missing_trigger_is_skipped_not_guessed(monkeypatch):
    monkeypatch.setattr("services.ha_automations.save_automation",
                        lambda data, auto_id=None: {"ok": True, "id": auto_id})
    laa.save_ziggy_actions("ziggy_smart_room_ghost_day", [ON])   # steps, no meta
    res = HM.migrate()
    assert res["migrated"] == []
    assert "no stored trigger" in res["errors"][0]["error"]


def test_scheduler_runs_the_migration():
    import inspect
    from services import ziggy_scheduler
    assert "hold_migration" in inspect.getsource(ziggy_scheduler.run_scheduler)
