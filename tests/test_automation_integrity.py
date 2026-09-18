"""An automation that points at a device which no longer exists is BROKEN, and
the app must say so — not run it "successfully" against nothing."""
from services import automation_integrity as ai

KNOWN = {"binary_sensor.bedroom_occupied_2", "light.0x006ce4a4ffbec13b", "light.0xa4c138fe4ba31d47"}

BEDROOM_DAY = {
    "id": "ziggy_smart_room_bedroom_day", "name": "Ziggy Smart Room Bedroom Day",
    "trigger": {"type": "state", "entity_id": "binary_sensor.bedroom_occupied_2", "state": "on"},
    "conditions": [{"type": "time", "after": "06:30", "before": "19:00"}],
    "actions": [],                     # Ziggy stores nothing; HA holds the real list
}
HA_ACTIONS_STALE = [{"action": "light.turn_on", "target": {"entity_id": "light.kajplats_e27_cws_globe_1055lm"}}]
HA_ACTIONS_OK = [{"action": "light.turn_on", "target": {"entity_id": "light.0x006ce4a4ffbec13b"}}]


def test_collects_references_from_trigger_conditions_actions_and_ha_actions():
    a = {"trigger": {"entity_id": ["binary_sensor.a", "binary_sensor.b"]},
         "conditions": [{"entity_id": "sensor.temp", "operator": "above", "value": 24}],
         "actions": [{"entity_id": "light.x", "service": "light.turn_on"},
                     {"type": "ir_command", "ir_device_id": "ir_ba8b01d69c"}]}
    refs = ai.referenced_entities(a, [{"target": {"entity_id": "switch.y"}}, {"data": {"entity_id": "fan.z"}}])
    assert refs == {"binary_sensor.a", "binary_sensor.b", "sensor.temp", "light.x", "switch.y", "fan.z"}


def test_scene_script_and_automation_targets_are_not_judged():
    a = {"actions": [{"entity_id": "scene.movie"}, {"entity_id": "script.good_night"}, {"entity_id": "automation.x"}]}
    assert ai.referenced_entities(a) == set()


def test_bedroom_rule_bound_to_the_old_matter_id_is_broken():
    miss = ai.missing_entities(BEDROOM_DAY, KNOWN, HA_ACTIONS_STALE)
    assert miss == ["light.kajplats_e27_cws_globe_1055lm"]


def test_rebound_rule_is_clean():
    assert ai.missing_entities(BEDROOM_DAY, KNOWN, HA_ACTIONS_OK) == []


def test_check_reports_only_broken_ones_with_names():
    autos = [BEDROOM_DAY, {"id": "ok", "name": "Fine", "trigger": {"entity_id": "light.0xa4c138fe4ba31d47"}}]
    out = ai.check(autos, KNOWN, lambda aid: HA_ACTIONS_STALE if aid == BEDROOM_DAY["id"] else [])
    assert [b["id"] for b in out] == ["ziggy_smart_room_bedroom_day"]
    assert out[0]["name"] == "Ziggy Smart Room Bedroom Day"


def test_annotate_adds_missing_entities_and_never_judges_blind():
    autos = [{"id": "a", "trigger": {"entity_id": "light.gone"}, "actions": []}]
    assert "missing_entities" not in ai.annotate([dict(autos[0])], set())[0]   # HA unknown → no verdict
    assert ai.annotate([dict(autos[0])], KNOWN)[0]["missing_entities"] == ["light.gone"]


def test_anomaly_helpers(monkeypatch):
    from services import anomaly_engine as ae
    monkeypatch.setattr(ae, "_cooldown_ok", lambda rid, rule_id, cd: True)
    monkeypatch.setattr(ae, "_is_snoozed", lambda rid, rule_id: False)
    fired, cleared = [], []
    monkeypatch.setattr(ae, "_push_anomaly", lambda active, rid, rule, res: fired.append((rid, rule.rule_id, res.message)))
    monkeypatch.setattr(ae, "_clear_anomaly", lambda active, rid, rule_id: cleared.append((rid, rule_id)))
    ae.raise_broken_automation({}, "ziggy_smart_room_bedroom_day", "Bedroom lights", ["light.kajplats_e27_cws_globe_1055lm"])
    assert fired[0][1] == "ANOM-15"
    assert "Bedroom lights" in fired[0][2] and "pick" in fired[0][2].lower()
    assert "kajplats" not in fired[0][2].lower()            # no entity ids in a customer message
    ae.clear_broken_automation({}, "ziggy_smart_room_bedroom_day")
    assert cleared == [("ziggy_smart_room_bedroom_day", "ANOM-15")]


def test_wired_into_scheduler_and_list_endpoint():
    assert "automation_integrity" in open("services/ziggy_scheduler.py", encoding="utf-8").read()
    assert "automation_integrity" in open("backend/routers/automation_router.py", encoding="utf-8").read()
