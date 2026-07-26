"""Door-aware room presence — state machine + creation-path branching.

The state machine is pure (injectable clock): every scenario here is an event
sequence fed with explicit times. The physical behavior (bathroom shower latch,
walk-out-and-close release) is validated on the Canary per the real-life gate —
these tests lock the logic so it can't silently regress.
"""
from __future__ import annotations

import pytest

from services.room_presence_engine import (
    DEFAULT_WALKOUT_GRACE_S,
    RoomStateMachine,
)

DOOR = "binary_sensor.bath_door"
PIR = "binary_sensor.bath_motion"
MMWAVE = "binary_sensor.bath_presence"

CLEAR = 30      # quiet-while-open
GRACE = 120     # walk-out grace


def _machine(doors=(DOOR,), motions=(PIR,), clear=CLEAR, grace=GRACE, states=None, now=0.0):
    m = RoomStateMachine("bathroom", list(doors), list(motions),
                         clear_delay_s=clear, walkout_grace_s=grace)
    m.init_from_states(states or {}, now)
    return m


# ── entering ─────────────────────────────────────────────────────────────────

def test_door_open_marks_occupied_immediately():
    m = _machine()
    assert m.occupied is False
    assert m.on_sensor(DOOR, "on", now=10) is True
    assert m.occupied is True


def test_motion_alone_marks_occupied_and_latches_behind_closed_door():
    m = _machine()
    assert m.on_sensor(PIR, "on", now=5) is True
    assert m.latched is True  # door closed + fresh motion = someone inside


# ── the shower latch ─────────────────────────────────────────────────────────

def test_shower_stillness_holds_forever_while_door_closed():
    """Enter, close the door, move a bit, then go perfectly still: occupied
    holds with NO pending timer — no darkness mid-shower, ever."""
    m = _machine()
    m.on_sensor(DOOR, "on", now=0)          # enter
    m.on_sensor(PIR, "on", now=1)
    m.on_sensor(DOOR, "off", now=3)         # close behind you
    m.on_sensor(PIR, "off", now=10)         # PIR cooldown ends
    m.on_sensor(PIR, "on", now=20)          # fresh edge after close → latch
    m.on_sensor(PIR, "off", now=30)         # then perfectly still
    assert m.occupied is True
    assert m.latched is True
    assert m.next_deadline() is None        # nothing will ever fire
    assert m.on_tick(now=100000) is None    # hours later: still occupied
    assert m.occupied is True


def test_latch_releases_when_door_opens_then_quiet_clears():
    m = _machine()
    m.on_sensor(PIR, "on", now=0)           # latched inside
    m.on_sensor(PIR, "off", now=5)
    assert m.occupied is True
    m.on_sensor(DOOR, "on", now=100)        # step out, door open
    assert m.occupied is True
    assert m.next_deadline() == 100 + CLEAR  # quiet-while-open timer armed
    assert m.on_tick(now=100 + CLEAR) is False
    assert m.occupied is False


# ── walk-out-and-close (the case naive rules get wrong) ──────────────────────

def test_walkout_and_close_clears_after_grace():
    """Leave and shut the door behind you. PIR lingers past the close (cooldown)
    but produces no fresh edge — at grace expiry the room clears."""
    m = _machine()
    m.on_sensor(DOOR, "on", now=0)          # door opens (you're leaving)
    m.on_sensor(PIR, "on", now=1)           # you trip the PIR on the way out
    m.on_sensor(DOOR, "off", now=4)         # close behind you
    m.on_sensor(PIR, "off", now=40)         # cooldown ends, no one inside
    assert m.occupied is True               # still on during the grace
    assert m.next_deadline() == 4 + GRACE
    assert m.on_tick(now=4 + GRACE) is False
    assert m.occupied is False
    assert m.latched is False


def test_fresh_motion_during_grace_latches_instead_of_clearing():
    m = _machine()
    m.on_sensor(DOOR, "on", now=0)
    m.on_sensor(PIR, "on", now=1)
    m.on_sensor(DOOR, "off", now=4)
    m.on_sensor(PIR, "off", now=40)
    m.on_sensor(PIR, "on", now=60)          # someone IS inside
    assert m.latched is True
    assert m.next_deadline() is None        # grace canceled; latch holds
    assert m.on_tick(now=4 + GRACE + 1) is None
    assert m.occupied is True


def test_mmwave_still_held_at_grace_expiry_latches():
    """mmWave holds 'on' continuously (no fresh edge). At grace expiry the
    machine checks current motion: held → latch, not clear."""
    m = _machine(motions=(PIR, MMWAVE))
    m.on_sensor(DOOR, "on", now=0)
    m.on_sensor(MMWAVE, "on", now=1)
    m.on_sensor(DOOR, "off", now=4)
    m.on_sensor(PIR, "off", now=30)
    assert m.on_tick(now=4 + GRACE) is None  # occupied unchanged (True)
    assert m.latched is True
    assert m.occupied is True


# ── door open + quiet ────────────────────────────────────────────────────────

def test_door_left_open_quiet_clears_then_reentry_reoccupies():
    m = _machine()
    m.on_sensor(DOOR, "on", now=0)
    m.on_sensor(PIR, "on", now=1)
    m.on_sensor(PIR, "off", now=20)         # quiet, door open
    assert m.next_deadline() == 20 + CLEAR
    assert m.on_tick(now=20 + CLEAR) is False
    m.on_sensor(PIR, "on", now=200)         # walk back in through the open door
    assert m.occupied is True


def test_motion_cancels_open_quiet_timer():
    m = _machine()
    m.on_sensor(DOOR, "on", now=0)
    m.on_sensor(PIR, "on", now=1)
    m.on_sensor(PIR, "off", now=20)
    m.on_sensor(PIR, "on", now=30)          # motion returns before expiry
    assert m.next_deadline() is None
    assert m.on_tick(now=20 + CLEAR) is None
    assert m.occupied is True


# ── door-only rooms (closet) ─────────────────────────────────────────────────

def test_door_only_room_open_holds_close_clears_after_grace():
    m = _machine(motions=())
    m.on_sensor(DOOR, "on", now=0)
    assert m.occupied is True
    assert m.next_deadline() is None        # no quiet timer without motion sensors
    assert m.on_tick(now=10000) is None     # open all day → stays occupied
    m.on_sensor(DOOR, "off", now=20000)
    assert m.next_deadline() == 20000 + GRACE
    assert m.on_tick(now=20000 + GRACE) is False


# ── odd but real sequences ───────────────────────────────────────────────────

def test_close_from_outside_when_empty_briefly_occupies_then_clears():
    """Someone shuts the door of an empty lit bathroom from outside: touching
    the door is presence evidence, so occupied for the grace, then clear."""
    m = _machine(states={DOOR: "on"}, now=0)   # door standing open, empty
    assert m.occupied is False
    assert m.on_sensor(DOOR, "off", now=10) is True
    assert m.on_tick(now=10 + GRACE) is False


def test_duplicate_state_reports_are_ignored():
    m = _machine()
    m.on_sensor(PIR, "on", now=0)
    assert m.on_sensor(PIR, "on", now=1) is None
    assert m.on_sensor("binary_sensor.unrelated", "on", now=2) is None


# ── startup recovery ─────────────────────────────────────────────────────────

def test_init_closed_door_with_motion_recovers_latched():
    m = _machine(states={DOOR: "off", PIR: "on"}, now=0)
    assert m.occupied is True
    assert m.latched is True


def test_init_closed_door_quiet_recovers_clear():
    m = _machine(states={DOOR: "off", PIR: "off"}, now=0)
    assert m.occupied is False


def test_init_open_door_follows_motion():
    assert _machine(states={DOOR: "on", PIR: "on"}, now=0).occupied is True
    assert _machine(states={DOOR: "on", PIR: "off"}, now=0).occupied is False


def test_init_door_only_room_open_is_occupied():
    m = _machine(motions=(), states={DOOR: "on"}, now=0)
    assert m.occupied is True


# ── creation-path branching (template_sensors) ───────────────────────────────

@pytest.fixture
def kv(monkeypatch):
    """In-memory stand-in for the occupancy_sensors KV namespace."""
    from services import template_sensors as ts
    store: dict = {}
    monkeypatch.setattr(ts, "get_local_state", lambda ns, k: store.get(k))
    monkeypatch.setattr(ts, "set_local_state",
                        lambda ns, k, v: store.pop(k, None) if v is None else store.__setitem__(k, v))
    return store


def test_create_with_door_source_takes_door_aware_path(monkeypatch, kv):
    from services import template_sensors as ts
    from services import room_presence_engine as engine

    monkeypatch.setattr(ts, "_classify_sources",
                        lambda ents: ([DOOR], [PIR]))
    enrolled = {}
    monkeypatch.setattr(engine, "enroll_room",
                        lambda rec, timeout=8.0: (enrolled.update(rec), {"ok": True, "occupied": False})[1])
    monkeypatch.setattr(engine, "lookup_mqtt_entity_id",
                        lambda uid, **kw: "binary_sensor.bathroom_occupied_ziggy")
    # The HA template flow must NEVER run on this path.
    monkeypatch.setattr(ts, "_start_template_flow",
                        lambda **kw: (_ for _ in ()).throw(AssertionError("template flow called")))

    res = ts.create_occupancy_sensor("bathroom", [DOOR, PIR],
                                     delay_off_seconds=25, walkout_grace_seconds=90)
    assert res["ok"] is True
    assert res["mode"] == "door_aware"
    assert res["entity_id"] == "binary_sensor.bathroom_occupied_ziggy"
    assert res["entry_id"] == "ziggy_mqtt_bathroom"
    assert enrolled["doors"] == [DOOR]
    assert enrolled["motions"] == [PIR]
    assert enrolled["walkout_grace_seconds"] == 90
    rec = kv["bathroom"]
    assert rec["mode"] == "door_aware"
    assert rec["walkout_grace_seconds"] == 90
    assert rec["delay_off_seconds"] == 25


def test_create_door_aware_fails_honestly_when_mqtt_down(monkeypatch, kv):
    from services import template_sensors as ts
    from services import room_presence_engine as engine

    monkeypatch.setattr(ts, "_classify_sources", lambda ents: ([DOOR], [PIR]))
    monkeypatch.setattr(engine, "enroll_room",
                        lambda rec, timeout=8.0: {"ok": False, "error": "mqtt_unreachable"})
    res = ts.create_occupancy_sensor("bathroom", [DOOR, PIR])
    assert res["ok"] is False
    assert "bathroom" not in kv          # nothing half-created


def test_create_door_aware_cleans_up_when_ha_never_sees_entity(monkeypatch, kv):
    from services import template_sensors as ts
    from services import room_presence_engine as engine

    monkeypatch.setattr(ts, "_classify_sources", lambda ents: ([DOOR], [PIR]))
    monkeypatch.setattr(engine, "enroll_room", lambda rec, timeout=8.0: {"ok": True})
    monkeypatch.setattr(engine, "lookup_mqtt_entity_id", lambda uid, **kw: None)
    cleaned = {}
    monkeypatch.setattr(engine, "unenroll_room",
                        lambda slug, clear_retained=True: (cleaned.__setitem__(slug, clear_retained), {"ok": True})[1])
    res = ts.create_occupancy_sensor("bathroom", [DOOR, PIR])
    assert res["ok"] is False
    assert cleaned == {"bathroom": True}
    assert "bathroom" not in kv


def test_create_without_door_keeps_legacy_template_path(monkeypatch, kv):
    from services import template_sensors as ts

    monkeypatch.setattr(ts, "_classify_sources", lambda ents: ([], [PIR, MMWAVE]))
    called = {}

    def _flow(show_advanced=False):
        called["flow"] = True
        return None, "stop here (test)", None

    monkeypatch.setattr(ts, "_start_template_flow", _flow)
    res = ts.create_occupancy_sensor("bedroom", [PIR, MMWAVE])
    assert called.get("flow") is True    # legacy path reached, engine untouched
    assert res["ok"] is False            # flow aborted by the test stub


def test_default_walkout_grace_applied_when_omitted(monkeypatch, kv):
    from services import template_sensors as ts
    from services import room_presence_engine as engine

    monkeypatch.setattr(ts, "_classify_sources", lambda ents: ([DOOR], []))
    seen = {}
    monkeypatch.setattr(engine, "enroll_room",
                        lambda rec, timeout=8.0: (seen.update(rec), {"ok": True})[1])
    monkeypatch.setattr(engine, "lookup_mqtt_entity_id", lambda uid, **kw: "binary_sensor.x")
    res = ts.create_occupancy_sensor("closet", [DOOR])
    assert res["ok"] is True
    assert seen["walkout_grace_seconds"] == DEFAULT_WALKOUT_GRACE_S


# ── reconciler must not prune MQTT-backed records ────────────────────────────

def test_reconciler_skips_door_aware_records(monkeypatch):
    from services import ha_reconciler as hr

    monkeypatch.setattr(hr, "_live_config_entry_ids", lambda: {"real_entry"})
    kv_state = {"occupancy_sensors": {
        "bathroom": {"entry_id": "ziggy_mqtt_bathroom", "mode": "door_aware",
                     "entity_id": "binary_sensor.bathroom_occupied"},
        "bedroom": {"entry_id": "real_entry", "entity_id": "binary_sensor.bedroom_occupied"},
        "office": {"entry_id": "gone_entry", "entity_id": "binary_sensor.office_occupied"},
    }}
    removed = []
    import services.local_automation_actions as laa
    monkeypatch.setattr(laa, "_load_state", lambda: kv_state)
    monkeypatch.setattr(laa, "set_local_state", lambda ns, k, v: removed.append(k))

    res = hr.reconcile_occupancy_sensors()
    assert res["ok"] is True
    assert removed == ["office"]         # the true orphan — and ONLY it
    assert [p["room"] for p in res["pruned"]] == ["office"]
