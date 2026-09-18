"""services/bundle_lint — the shapes the 2026-09-18 bundle had, each caught."""
from services import bundle_lint as L

HOME = {"rooms": [
    {"id": "kitchen", "entities": {"light": [{"entity_id": "light.k"}], "motion": [{"entity_id": "binary_sensor.km"}]}},
    {"id": "entry",   "entities": {"light": [{"entity_id": "light.e"}], "motion": []}},
]}


def _b(**auto):
    base = {"name": "x", "source": "custom",
            "trigger": {"type": "state", "entity_id": "binary_sensor.km", "state": "on"},
            "conditions": [],
            "actions": [{"type": "call_service", "entity_id": "light.k", "service": "turn_on"}],
            "mode": "single"}
    base.update(auto)
    return {"name": "B", "artifacts": {"automations": [base]}}


def test_tautology_dropped():
    b = _b(conditions=[{"entity_id": "binary_sensor.km", "operator": "is", "value": "on"},
                       {"type": "mode", "mode": "sleep", "is": False}])
    out, notes = L.lint(b, HOME)
    assert out["artifacts"]["automations"][0]["conditions"] == [{"type": "mode", "mode": "sleep", "is": False}]
    assert notes == []


def test_non_tautological_condition_on_trigger_entity_kept():
    b = _b(conditions=[{"entity_id": "binary_sensor.km", "operator": "is", "value": "off"}])
    out, _ = L.lint(b, HOME)
    assert len(out["artifacts"]["automations"][0]["conditions"]) == 1


def test_out_of_scope_room_action_dropped_with_note():
    b = _b(actions=[{"type": "call_service", "entity_id": "light.k", "service": "turn_on"},
                    {"type": "call_service", "entity_id": "light.e", "service": "turn_off"}])
    out, notes = L.lint(b, HOME, allowed_rooms={"kitchen"})
    assert [a["entity_id"] for a in out["artifacts"]["automations"][0]["actions"]] == ["light.k"]
    assert notes and "entry" in notes[0]["why"]


def test_trigger_room_is_always_in_scope():
    b = _b(actions=[{"type": "call_service", "entity_id": "light.k", "service": "turn_on"}])
    out, notes = L.lint(b, HOME, allowed_rooms={"living_room"})
    assert out["artifacts"]["automations"] and notes == []


def test_no_scope_and_roomless_trigger_means_no_room_filtering():
    b = _b(trigger={"type": "time", "time": "23:00"},
           actions=[{"type": "call_service", "entity_id": "light.e", "service": "turn_off"}])
    out, notes = L.lint(b, HOME)
    assert out["artifacts"]["automations"][0]["actions"][0]["entity_id"] == "light.e" and notes == []


def test_trigger_room_scopes_even_without_named_rooms():
    """A kitchen-motion rule must not reach the entry unless the user said so."""
    b = _b(actions=[{"type": "call_service", "entity_id": "light.k", "service": "turn_on"},
                    {"type": "call_service", "entity_id": "light.e", "service": "turn_off"}])
    out, notes = L.lint(b, HOME)
    assert [a["entity_id"] for a in out["artifacts"]["automations"][0]["actions"]] == ["light.k"]


def test_automation_left_with_no_actions_is_dropped():
    b = _b(actions=[{"type": "call_service", "entity_id": "light.e", "service": "turn_off"}])
    out, notes = L.lint(b, HOME, allowed_rooms={"kitchen"})
    assert out["artifacts"]["automations"] == [] and len(notes) == 2


def test_notify_only_automation_dropped():
    b = _b(actions=[{"type": "notify", "message": "hi"}])
    out, notes = L.lint(b, HOME)
    assert out["artifacts"]["automations"] == [] and "notification" in notes[0]["why"]


def test_blueprint_uuid_input_dropped():
    b = {"name": "B", "artifacts": {"automations": [{"name": "w", "source": "blueprint",
         "blueprint": {"id": "welcome_home", "inputs": {"person_entity": "fb074d1b-f42f-4e40-a222-ae402a2c963b",
                                                        "light_target": "light.k"}}}]}}
    out, notes = L.lint(b, HOME)
    assert out["artifacts"]["automations"] == [] and "person_entity" in notes[0]["why"]


def test_blueprint_with_real_inputs_kept():
    b = {"name": "B", "artifacts": {"automations": [{"name": "w", "source": "blueprint",
         "blueprint": {"id": "motion_light", "inputs": {"motion_entity": "binary_sensor.km",
                                                        "light_target": "light.k", "no_motion_wait": "300"}}}]}}
    out, notes = L.lint(b, HOME)
    assert len(out["artifacts"]["automations"]) == 1 and notes == []


def test_legacy_kinds_stripped():
    b = {"name": "B", "artifacts": {"automations": [], "kv_state": [{"key": "x"}], "voice_intents": [{"phrase": "p"}]}}
    out, notes = L.lint(b, HOME)
    assert "kv_state" not in out["artifacts"] and "voice_intents" not in out["artifacts"]
    assert len(notes) == 2


def test_lint_never_raises_on_garbage():
    assert L.lint(None, HOME) == (None, [])
    assert L.lint({"artifacts": "nope"}, HOME)[1] == []
    out, _ = L.lint({"artifacts": {"automations": ["str", None, {"name": "n", "source": "custom", "actions": None}]}}, HOME)
    assert out["artifacts"]["automations"] == []
