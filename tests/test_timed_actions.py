"""'Turn it on for N minutes' — one step, expanded to on → wait → off, with a
safety net for the off a restart drops (services/timed_actions.py)."""
import json
from unittest.mock import MagicMock, patch

import pytest

from services import timed_actions as ta

VALVE_ON = {"type": "call_service", "entity_id": "switch.garden_valve",
            "service": "homeassistant.turn_on", "for_minutes": 20}


# ── Which steps can take a duration ──────────────────────────────────────────

@pytest.mark.parametrize("step,undo", [
    (VALVE_ON, "turn_off"),
    ({**VALVE_ON, "entity_id": "cover.blind", "service": "homeassistant.open_cover"}, "close_cover"),
    ({**VALVE_ON, "entity_id": "valve.main", "service": "homeassistant.open_valve"}, "close_valve"),
    ({**VALVE_ON, "service": "homeassistant.turn_off"}, None),
    ({**VALVE_ON, "entity_id": "script.go"}, None),
    ({**VALVE_ON, "entity_id": "lock.door", "service": "homeassistant.unlock"}, None),
    ({"type": "notify", "message": "x", "for_minutes": 5}, None),
])
def test_undo_service(step, undo):
    assert ta.undo_service(step) == undo


def test_expand_on_wait_off():
    out = ta.expand([VALVE_ON, {"type": "notify", "message": "done"}])
    assert out == [
        {"type": "call_service", "entity_id": "switch.garden_valve", "service": "homeassistant.turn_on"},
        {"type": "delay", "seconds": 1200},
        {"type": "call_service", "entity_id": "switch.garden_valve", "service": "homeassistant.turn_off"},
        {"type": "notify", "message": "done"},
    ]


def test_expand_is_idempotent_and_leaves_untimed_alone():
    plain = {"type": "call_service", "entity_id": "light.x", "service": "homeassistant.turn_on"}
    assert ta.expand([plain]) == [plain]
    once = ta.expand([VALVE_ON])
    assert ta.expand(once) == once


def test_expand_keeps_service_data_and_hold_on_the_on_step_only():
    step = {"type": "call_service", "entity_id": "light.porch", "service": "homeassistant.turn_on",
            "service_data": {"brightness_pct": 40}, "respect_hold": True, "for_minutes": 1.5}
    on, wait, off = ta.expand([step])
    assert on["service_data"] == {"brightness_pct": 40} and on["respect_hold"] is True
    assert wait == {"type": "delay", "seconds": 90}
    assert off == {"type": "call_service", "entity_id": "light.porch", "service": "homeassistant.turn_off"}


def test_a_duration_on_a_step_with_no_off_is_dropped_not_kept():
    step = {"type": "call_service", "entity_id": "switch.x", "service": "homeassistant.turn_off", "for_minutes": 5}
    assert ta.expand([step]) == [{"type": "call_service", "entity_id": "switch.x", "service": "homeassistant.turn_off"}]


@pytest.mark.parametrize("val,bad", [(20, False), (0, False), (None, False), (-1, True),
                                     ("abc", True), (24 * 60 + 1, True)])
def test_invalid_reason(val, bad):
    assert bool(ta.invalid_reason([{**VALVE_ON, "for_minutes": val}])) is bad


def test_invalid_reason_refuses_duration_on_turn_off():
    assert ta.invalid_reason([{**VALVE_ON, "service": "homeassistant.turn_off"}])


# ── HA compile ───────────────────────────────────────────────────────────────

def test_ha_compile_emits_on_delay_off(tmp_path, monkeypatch):
    from services import ha_automations as ha
    posted = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        posted["cfg"] = json
        r = MagicMock(); r.status_code = 200; return r

    monkeypatch.setattr(ha.requests, "post", fake_post)
    monkeypatch.setattr(ha, "_known_entity_ids", lambda: set())
    monkeypatch.setattr(ha, "_duplicate_name_of", lambda *a, **k: None)
    with patch("services.local_automation_actions.save_ziggy_actions") as save_actions, \
         patch("services.local_automation_actions.save_automation_meta"), \
         patch.object(ha, "_retire_local_copy"):
        res = ha.save_automation({
            "name": "Water garden",
            "trigger": {"type": "state", "entity_id": "binary_sensor.x", "state": "on"},
            "actions": [VALVE_ON],
        }, auto_id="water_garden")
    assert res["ok"], res
    assert posted["cfg"]["actions"] == [
        {"service": "switch.turn_on", "target": {"entity_id": "switch.garden_valve"}},
        {"delay": "00:20:00"},
        {"service": "switch.turn_off", "target": {"entity_id": "switch.garden_valve"}},
    ]
    # What Ziggy keeps (and the wizard edits) is still the ONE step.
    assert save_actions.call_args[0][1] == [VALVE_ON]


def test_save_refuses_nonsense_duration(monkeypatch):
    from services import ha_automations as ha
    monkeypatch.setattr(ha, "_duplicate_name_of", lambda *a, **k: None)
    res = ha.save_automation({
        "name": "x", "trigger": {"type": "time", "time": "06:00"},
        "actions": [{**VALVE_ON, "for_minutes": -5}],
    })
    assert not res["ok"] and res["reason"] == "invalid_action"


def test_deferred_bridge_runs_only_the_held_on_never_the_off():
    """A hold-aware timed turn-on: HA runs the wait and the off; Ziggy runs only the on."""
    from services.ha_automations import ha_defers_action
    step = {**VALVE_ON, "entity_id": "light.porch", "respect_hold": True}
    expanded = ta.expand([step])
    deferred = [s for s in expanded if ha_defers_action(s)]
    assert len(deferred) == 1 and deferred[0]["service"].endswith("turn_on")


# ── Safety net ───────────────────────────────────────────────────────────────

@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(ta, "STORE_FILE", str(tmp_path / "timed_actions.json"))
    monkeypatch.setattr(ta, "_still_running", lambda *a, **k: False)
    return tmp_path / "timed_actions.json"


def _iso(ts):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def test_deadline_counts_the_steps_before_it():
    steps = [{"type": "delay", "seconds": 300}, VALVE_ON]
    [d] = ta.deadlines(steps, 1000.0)
    assert d["deadline"] == 1000 + 300 + 1200
    assert d["service"] == "switch.turn_off"


def test_note_fired_replaces_the_previous_run(store):
    ta.note_fired("water", [VALVE_ON], 1000.0)
    ta.note_fired("water", [VALVE_ON], 5000.0)
    items = json.loads(store.read_text())
    assert len(items) == 1 and items[0]["started_at"] == 5000.0


def test_nothing_sent_before_the_grace_runs_out(store):
    ta.note_fired("water", [VALVE_ON], 0.0)
    cache = {"switch.garden_valve": {"state": "on", "last_changed": _iso(10)}}
    send, keep = ta.due_offs(now=1200 + ta.GRACE_S - 1, state_cache=cache)
    assert send == [] and len(keep) == 1


def test_off_sent_when_still_on_past_the_deadline(store):
    ta.note_fired("water", [VALVE_ON], 0.0)
    cache = {"switch.garden_valve": {"state": "on", "last_changed": _iso(10)}}
    send, keep = ta.due_offs(now=1200 + ta.GRACE_S + 1, state_cache=cache)
    assert [s["entity_id"] for s in send] == ["switch.garden_valve"] and keep == []


def test_never_touches_a_device_already_off(store):
    ta.note_fired("water", [VALVE_ON], 0.0)
    cache = {"switch.garden_valve": {"state": "off", "last_changed": _iso(1200)}}
    send, keep = ta.due_offs(now=5000, state_cache=cache)
    assert send == [] and keep == []


def test_never_overrides_a_person_who_turned_it_on_again(store):
    ta.note_fired("water", [VALVE_ON], 0.0)
    cache = {"switch.garden_valve": {"state": "on", "last_changed": _iso(1500)}}
    send, keep = ta.due_offs(now=5000, state_cache=cache)
    assert send == [] and keep == []


def test_waits_while_the_run_is_still_going(store, monkeypatch):
    ta.note_fired("water", [VALVE_ON], 0.0)
    monkeypatch.setattr(ta, "_still_running", lambda *a, **k: True)
    cache = {"switch.garden_valve": {"state": "on", "last_changed": _iso(10)}}
    send, keep = ta.due_offs(now=5000, state_cache=cache)
    assert send == [] and len(keep) == 1


def test_cold_cache_decides_later(store):
    ta.note_fired("water", [VALVE_ON], 0.0)
    send, keep = ta.due_offs(now=5000, state_cache={})
    assert send == [] and len(keep) == 1


def test_sweep_sends_off_and_retries_a_failure(store, monkeypatch):
    ta.note_fired("water", [VALVE_ON], 0.0)
    cache = {"switch.garden_valve": {"state": "on", "last_changed": _iso(10)}}
    monkeypatch.setattr(ta.time, "time", lambda: 5000.0)
    monkeypatch.setattr("services.ha_subscriber.state_cache", cache, raising=False)
    calls = []
    with patch("services.home_automation.call_service",
               side_effect=lambda d, s, p: calls.append((d, s, p)) or {"ok": False}):
        assert ta.sweep() == []
    assert len(json.loads(store.read_text())) == 1          # kept for the next tick
    with patch("services.home_automation.call_service",
               side_effect=lambda d, s, p: calls.append((d, s, p)) or {"ok": True}):
        assert len(ta.sweep()) == 1
    assert calls[-1] == ("switch", "turn_off", {"entity_id": "switch.garden_valve"})
    assert json.loads(store.read_text()) == []
