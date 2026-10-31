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


def test_integrity_flags_a_local_rule_nothing_can_trigger():
    autos = [{**DAVID_SINGLE, "source": "ziggy"},
             {"id": "m", "name": "Morning", "source": "ziggy", "trigger": {"type": "time"}},
             {"id": "h", "name": "In HA", "source": "ha", "trigger": {"type": "controller"}},
             {"id": "p", "name": "Arrive", "source": "ziggy", "trigger": {"type": "person_arrives"}}]
    assert I.unfireable(autos) == [
        {"id": DAVID_SINGLE["id"], "name": DAVID_SINGLE["name"], "trigger": "controller"}]
