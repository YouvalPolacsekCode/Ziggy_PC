"""Door-less rooms: the presence engine as a plain hold.

Home Assistant's template helper cannot hold (its 2026.6 binary_sensor form has
no delay_off — the only advanced field is `availability`), so a room with only
motion / mmWave sources is enrolled in Ziggy's engine with no doors.

Semantics: any motion → occupied; every source quiet → clear after the hold.
No latch — a latch needs a door to release it, and a door-less latch would hold
a room occupied forever after one PIR blip.
"""
from __future__ import annotations

from services.room_presence_engine import RoomStateMachine

DOOR = "binary_sensor.office_door"
PIR = "binary_sensor.office_motion"
MMWAVE = "binary_sensor.office_presence"
HOLD = 300


def _machine(motions=(PIR, MMWAVE), clear=HOLD, states=None, now=0.0):
    m = RoomStateMachine("office", [], list(motions), clear_delay_s=clear, walkout_grace_s=120)
    m.init_from_states(states or {}, now)
    return m


def test_doorless_motion_occupies_without_latch():
    m = _machine()
    assert m.occupied is False
    assert m.on_sensor(PIR, "on", now=1) is True
    assert m.latched is False
    assert m.next_deadline() is None


def test_doorless_quiet_clears_only_after_hold():
    m = _machine(motions=(PIR,))
    m.on_sensor(PIR, "on", now=0)
    assert m.on_sensor(PIR, "off", now=90) is None      # still occupied
    assert m.next_deadline() == 90 + HOLD
    assert m.on_tick(now=200) is None                    # hold running
    assert m.occupied is True
    assert m.on_tick(now=391) is False                   # hold expired → clear
    assert m.occupied is False


def test_doorless_fresh_motion_cancels_the_hold():
    m = _machine()
    m.on_sensor(PIR, "on", now=0)
    m.on_sensor(PIR, "off", now=90)
    m.on_sensor(MMWAVE, "on", now=100)
    assert m.next_deadline() is None
    m.on_sensor(MMWAVE, "off", now=130)
    assert m.next_deadline() == 130 + HOLD
    assert m.on_tick(now=431) is False


def test_doorless_hold_waits_for_every_source_to_go_quiet():
    m = _machine()
    m.on_sensor(PIR, "on", now=0)
    m.on_sensor(MMWAVE, "on", now=1)
    m.on_sensor(PIR, "off", now=90)
    assert m.next_deadline() is None                     # mmWave still sees you
    m.on_sensor(MMWAVE, "off", now=500)
    assert m.next_deadline() == 500 + HOLD


def test_doorless_init_from_states_follows_motion_without_latch():
    m = _machine(motions=(PIR,), states={PIR: "on"})
    assert m.occupied is True and m.latched is False
    m2 = _machine(motions=(PIR,), states={PIR: "off"})
    assert m2.occupied is False


def test_door_rooms_still_latch():
    """The door-aware behaviour is untouched: fresh motion behind a closed door latches."""
    m = RoomStateMachine("bath", [DOOR], [PIR], clear_delay_s=30, walkout_grace_s=120)
    m.init_from_states({}, 0.0)
    m.on_sensor(PIR, "on", now=5)
    assert m.latched is True


def test_enroll_requires_a_door_or_a_motion_source():
    from services import room_presence_engine as engine
    assert engine.enroll_room({"room": "office", "doors": [], "motions": []})["ok"] is False
    assert engine.enroll_room({"room": "", "doors": [DOOR]})["ok"] is False
