"""Button rules must live in Home Assistant, because only HA hears the press.

David's pergola (2026-10-31): three button automations saved cleanly, listed
cleanly, ran fine from "Run" — and never fired from the button. `needs_ha()`
did not know `controller`, so they were stored Ziggy-local, where nothing
listens for an MQTT press. HA's automations.yaml stayed `[]`.

Covered here: routing, the save path (HA config written with an mqtt trigger,
local copy retired), the migration of rules already stranded locally, and the
integrity sweep noticing one it could not move.
"""
from __future__ import annotations

import json

import pytest

from core import automation_file
from services import controllers as C
from services import ha_automations as A
from services import automation_integrity as I

IEEE = "0xcc36bbfffe02c030"
TOPIC = f"zigbee2mqtt/{IEEE}/action"

# David's single-press rule, exactly as his hub stored it.
DAVID_SINGLE = {
    "id": "ba13475857e7479bbf66c90da4f74cc2",
    "name": "תאורת פרגולה ",
    "description": "לחיצה אחת מפעיל תאורה",
    "enabled": True,
    "trigger": {"type": "controller", "controller_id": IEEE, "action": "single"},
    "conditions": [{"type": "entity", "entity_id": "switch.0x6ce4a4fffe9a0a04",
                    "operator": "is", "value": "off"}],
    "actions": [{"type": "call_service", "entity_id": "switch.0x6ce4a4fffe9a0a04",
                 "service": "homeassistant.turn_on", "service_value": "turn_on"}],
    "rooms": [], "mode": "single",
}


class _Resp:
    def __init__(self, code=200, body=None):
        self.status_code = code
        self._body = body or {}
        self.text = json.dumps(self._body)

    def json(self):
        return self._body


@pytest.fixture
def hub(monkeypatch, tmp_path):
    """A hub with one SONOFF button discovered, a temp local store, and a fake HA."""
    monkeypatch.setattr(automation_file, "AUTOMATION_FILE", str(tmp_path / "automations.json"))
    monkeypatch.setattr(C, "cached", lambda: [{
        "ieee": IEEE, "name": "כפתור פרגולה",
        "actions": [{"subtype": s, "label": s, "type": "action", "topic": TOPIC, "payload": s}
                    for s in ("single", "double", "long")],
    }])
    # Side stores and validators that would otherwise touch disk or HA.
    import services.local_automation_actions as L
    monkeypatch.setattr(L, "save_ziggy_actions", lambda *a, **k: None)
    monkeypatch.setattr(L, "save_automation_meta", lambda *a, **k: None)
    monkeypatch.setattr(A, "_duplicate_name_of", lambda *a, **k: None)
    monkeypatch.setattr(A, "invalid_action_entity", lambda *a, **k: None)
    monkeypatch.setattr(A, "_validate_trigger_entities", lambda *a, **k: None)
    monkeypatch.setattr(A, "HA_URL", lambda: "http://ha")
    monkeypatch.setattr(A, "HEADERS", lambda: {})

    state = {"posted": {}, "toggled": [], "ha_up": True}

    def post(url, json=None, **kw):
        if "/api/config/automation/config/" in url:
            if not state["ha_up"]:
                raise ConnectionError("HA down")
            state["posted"][url.rsplit("/", 1)[1]] = json
        return _Resp(200)

    monkeypatch.setattr(A.requests, "post", post)
    monkeypatch.setattr(A, "toggle_automation",
                        lambda auto_id, enable: state["toggled"].append((auto_id, enable)) or True)
    return state


def test_button_rules_route_to_home_assistant():
    assert A.needs_ha({"trigger": {"type": "controller", "controller_id": IEEE, "action": "single"}})


def test_time_rules_still_stay_local():
    assert not A.needs_ha({"trigger": {"type": "time", "time": "07:00"}})


def test_saving_a_button_rule_writes_an_mqtt_trigger_to_ha(hub):
    res = A.save_automation(dict(DAVID_SINGLE), auto_id=DAVID_SINGLE["id"])
    assert res == {"ok": True, "id": DAVID_SINGLE["id"], "source": "ha"}
    cfg = hub["posted"][DAVID_SINGLE["id"]]
    assert cfg["triggers"] == [{"platform": "mqtt", "topic": TOPIC, "payload": "single"}]
    assert cfg["actions"], "the action list must reach HA too"
    assert automation_file.list_automations() == [], "nothing may be stored Ziggy-local"


def test_a_button_rule_with_no_reachable_topic_is_refused_not_saved_empty(hub, monkeypatch):
    monkeypatch.setattr(C, "cached", lambda: [])          # cold cache, no stored topic
    res = A.save_automation(dict(DAVID_SINGLE), auto_id=DAVID_SINGLE["id"])
    assert res["ok"] is False and res["reason"] == "invalid_trigger"
    assert hub["posted"] == {}, "HA must never get a rule with zero triggers"


def test_migration_moves_stranded_button_rules_into_ha(hub):
    automation_file.create_automation(dict(DAVID_SINGLE))
    automation_file.create_automation({"id": "morning", "name": "Morning",
                                       "trigger": {"type": "time", "time": "07:00"},
                                       "actions": DAVID_SINGLE["actions"]})
    out = A.migrate_local_to_ha()
    assert out == {"moved": [DAVID_SINGLE["id"]], "failed": []}
    assert DAVID_SINGLE["id"] in hub["posted"]
    assert [a["id"] for a in automation_file.list_automations()] == ["morning"], \
        "the time rule stays local; the button rule's local copy is retired"
    assert hub["toggled"] == [], "an enabled rule is not switched off"


def test_migration_keeps_a_disabled_rule_disabled(hub):
    automation_file.create_automation({**DAVID_SINGLE, "enabled": False})
    A.migrate_local_to_ha()
    assert hub["toggled"] == [(DAVID_SINGLE["id"], False)]


def test_migration_leaves_the_rule_local_when_ha_is_down_and_retries_later(hub):
    automation_file.create_automation(dict(DAVID_SINGLE))
    hub["ha_up"] = False
    out = A.migrate_local_to_ha()
    assert out["moved"] == [] and out["failed"][0]["id"] == DAVID_SINGLE["id"]
    assert automation_file.get_automation(DAVID_SINGLE["id"]), "never lose the rule"
    hub["ha_up"] = True
    assert A.migrate_local_to_ha()["moved"] == [DAVID_SINGLE["id"]]


def test_migration_is_idempotent(hub):
    automation_file.create_automation(dict(DAVID_SINGLE))
    A.migrate_local_to_ha()
    assert A.migrate_local_to_ha() == {"moved": [], "failed": []}


# ── The routing flip is backwards compatible ────────────────────────────────

def _needs_ha_before_flip(data):
    """needs_ha exactly as it shipped in release-2026.10.31, for comparison."""
    if isinstance(data.get("ha_native_body"), dict) and data["ha_native_body"]:
        return True
    return data.get("trigger", {}).get("type", "") in (
        "state", "numeric_state", "sunrise", "sunset", "webhook", "zone",
        "time_pattern", "controller")


EVERY_KNOWN_KIND = sorted(A.LOCAL_TRIGGER_TYPES | A.HA_EXPRESSIBLE_TRIGGERS | {
    "occupancy", "presence", "motion", "made_up_by_an_llm", "ir_command"})


@pytest.mark.parametrize("kind", EVERY_KNOWN_KIND)
def test_routing_is_unchanged_for_every_kind(kind):
    data = {"trigger": {"type": kind}}
    before, after = _needs_ha_before_flip(data), A.needs_ha(data)
    assert before == after, f"{kind}: routing changed {before} → {after}"


@pytest.mark.parametrize("data", [
    {}, {"trigger": {}}, {"trigger": None}, {"trigger": {"type": None}},
    {"trigger": {"type": "all_persons_left"}, "ha_native_body": {"actions": [{}]}},
    {"trigger": {"type": "made_up"}, "ha_native_body": {}},
])
def test_routing_edge_shapes_match_the_old_behaviour(data):
    old = _needs_ha_before_flip({**data, "trigger": data.get("trigger") or {}})
    assert A.needs_ha(data) == old


@pytest.mark.parametrize("kind,trigger", [
    ("time", {"time": "07:00"}),
    ("state", {"entity_id": "binary_sensor.d", "state": "on"}),
    ("numeric_state", {"entity_id": "sensor.t", "above": 25}),
    ("sunrise", {}), ("sunset", {}),
    ("webhook", {"webhook_id": "w"}),
    ("zone", {"entity_id": "person.a"}),
    ("time_pattern", {"minutes": "/15"}),
    ("controller", {"controller_id": IEEE, "action": "single"}),
])
def test_every_routable_kind_really_compiles(kind, trigger, monkeypatch):
    monkeypatch.setattr(C, "cached", lambda: [{"ieee": IEEE, "actions": [
        {"subtype": "single", "topic": TOPIC, "payload": "single"}]}])
    assert kind in A.HA_EXPRESSIBLE_TRIGGERS
    assert A._trigger_to_ha({"type": kind, **trigger}), f"{kind} routes to HA but compiles to nothing"


def test_routable_kinds_are_exactly_what_the_converter_compiles():
    """The drift guard: a kind added to _trigger_to_ha must be added here (and to
    the catalog — tests/test_automation_catalog_drift.py), or it would silently
    stay Ziggy-local. The probe compiles a filled-in trigger of every kind."""
    probe = {"time": "07:00", "entity_id": "x.y", "webhook_id": "w", "minutes": "/5",
             "controller_id": IEEE, "action": "single", "topic": TOPIC}
    candidates = EVERY_KNOWN_KIND + ["sun", "device", "event", "template", "mqtt"]
    compiles = {k for k in candidates if A._trigger_to_ha({"type": k, **probe})}
    assert compiles == set(A.HA_EXPRESSIBLE_TRIGGERS)


def test_an_unknown_kind_still_saves_locally_and_runs_from_run(hub):
    """Exactly the old behaviour: saved, listed, runnable — and now reported."""
    rule = {**DAVID_SINGLE, "id": "odd", "trigger": {"type": "made_up_by_an_llm"}}
    res = A.save_automation(dict(rule), auto_id="odd")
    assert res == {"ok": True, "id": "odd", "source": "ziggy"}
    assert hub["posted"] == {}
    assert A.migrate_local_to_ha() == {"moved": [], "failed": []}, "migration must not touch it"
    assert I.unfireable([{**rule, "source": "ziggy"}])[0]["trigger"] == "made_up_by_an_llm"


def test_ziggy_fired_kinds_are_never_reported_as_unfireable():
    autos = [{"id": k, "name": k, "source": "ziggy", "trigger": {"type": k}}
             for k in A.LOCAL_TRIGGER_TYPES]
    assert I.unfireable(autos) == []


def test_integrity_flags_a_local_rule_nothing_can_trigger():
    autos = [{**DAVID_SINGLE, "source": "ziggy"},
             {"id": "m", "name": "Morning", "source": "ziggy", "trigger": {"type": "time"}},
             {"id": "h", "name": "In HA", "source": "ha", "trigger": {"type": "controller"}},
             {"id": "p", "name": "Arrive", "source": "ziggy", "trigger": {"type": "person_arrives"}}]
    assert I.unfireable(autos) == [
        {"id": DAVID_SINGLE["id"], "name": DAVID_SINGLE["name"], "trigger": "controller"}]
