"""Rooms and device→room assignments are USER-DRIVEN ONLY.

Regression cover for two real-home bugs:
  A. Ghost rooms (e.g. Kitchen / Dining Room) that the user deleted kept
     reappearing on every restart.
  B. A device the user manually assigned to one room silently jumped to
     another based on its *name* (bathroom light → Bathroom).

The guarantees under test:
  - New devices are NEVER auto-placed (no name / HA-area inference).
  - Only a room stamped room_source="user" survives; any other room value on
    an HA-connected row is auto-junk and is cleared (so deleted rooms can't
    resurrect and nothing auto-moves).
  - IR-only rows and Ziggy smart sensors keep their user-driven rooms.
  - Grandfathering adopts a pre-existing layout once so the invariant doesn't
    wipe it on upgrade.
"""
import pytest

from services import device_registry as dr


def test_add_unclaimed_never_auto_places(monkeypatch):
    # Even with an HA area available for the entity, a newly-discovered device
    # must come in room-less and UNCLAIMED — no name/area inference.
    monkeypatch.setattr(dr, "_is_hidden_category", lambda eid: False)
    monkeypatch.setattr(dr, "_infer_device_type", lambda eid, attrs: "light")
    out = dr._add_unclaimed(
        [], {"light.kitchen_ceiling"},
        states=[{"entity_id": "light.kitchen_ceiling", "attributes": {}}],
        entity_areas={"light.kitchen_ceiling": "kitchen"},
    )
    row = next(d for d in out if d["entity_id"] == "light.kitchen_ceiling")
    assert row["room"] is None
    assert row.get("room_source") is None
    assert row["status"] == dr.UNCLAIMED


def test_enforce_clears_non_user_rooms_but_keeps_user():
    devices = [
        # ghost / name-inferred assignment (bug A & B) — must be cleared
        {"entity_id": "light.x", "room": "kitchen", "room_source": None,
         "status": dr.CONNECTED},
        # a device that auto-jumped by name — must be cleared
        {"entity_id": "light.bath", "room": "bathroom", "status": dr.CONNECTED},
        # user-assigned — must survive untouched
        {"entity_id": "light.y", "room": "bedroom", "room_source": "user",
         "status": dr.CONNECTED},
    ]
    dr._enforce_user_rooms(devices)
    by = {d["entity_id"]: d for d in devices}
    assert by["light.x"]["room"] is None and by["light.x"]["status"] == dr.UNCLAIMED
    assert by["light.bath"]["room"] is None
    assert by["light.y"]["room"] == "bedroom"  # user choice preserved


def test_enforce_preserves_ir_and_smart_sensor_rooms():
    devices = [
        # IR-only row (no entity_id) — user manages via IR pairing
        {"entity_id": None, "ir_device_id": "ir_ac", "room": "living_room",
         "status": dr.IR_ONLY},
        # Ziggy smart sensor — room from the user's smart-room config
        {"entity_id": "binary_sensor.ziggy_occ", "origin": "ziggy_template",
         "room": "office", "status": dr.SMART_SENSOR},
    ]
    dr._enforce_user_rooms(devices)
    assert devices[0]["room"] == "living_room"
    assert devices[1]["room"] == "office"


def test_grandfather_adopts_layout_once(monkeypatch, tmp_path):
    sentinel = tmp_path / ".migrated"
    monkeypatch.setattr(dr, "_ROOM_MIGRATION_SENTINEL", str(sentinel))
    devices = [
        {"entity_id": "light.a", "room": "bedroom"},          # -> user
        {"entity_id": "light.b", "room": "office", "room_source": "user"},
        {"entity_id": "light.c", "room": None},               # no room, untouched
    ]
    dr._grandfather_rooms(devices)
    assert devices[0]["room_source"] == "user"
    assert devices[1]["room_source"] == "user"
    assert devices[2].get("room_source") is None
    assert sentinel.exists()

    # Second run is a no-op: a NEW stray room is NOT grandfathered.
    devices.append({"entity_id": "light.d", "room": "kitchen"})
    dr._grandfather_rooms(devices)
    assert devices[-1].get("room_source") is None


def test_deleted_room_stays_gone_after_grandfather(monkeypatch, tmp_path):
    # End-to-end shape of the real bug: grandfather locks the good layout,
    # then a device still carrying a *deleted* room (never re-stamped user)
    # is cleared by the invariant and cannot resurrect.
    monkeypatch.setattr(dr, "_ROOM_MIGRATION_SENTINEL", str(tmp_path / ".m"))
    devices = [
        {"entity_id": "light.kitchen", "room": "kitchen"},   # ghost to purge
        {"entity_id": "light.bed", "room": "bedroom"},       # real, keep
    ]
    dr._grandfather_rooms(devices)
    # user then deletes "kitchen": its member is unstamped back to auto
    for d in devices:
        if d["room"] == "kitchen":
            d["room_source"] = None
    dr._enforce_user_rooms(devices)
    rooms = {d["entity_id"]: d["room"] for d in devices}
    assert rooms["light.kitchen"] is None
    assert rooms["light.bed"] == "bedroom"
