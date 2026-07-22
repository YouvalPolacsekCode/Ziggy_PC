"""Reconciler + shadow-mode enforcement tests."""
from __future__ import annotations

import pytest

from services.permissions.audit import AuditLog
from services.permissions.grants import Grant
from services.permissions.reconcile import (
    HOME_SCOPE,
    reconcile_devices,
    reconcile_users,
)
from services.permissions.runtime import set_service
from services.permissions.service import PermissionService
from services.permissions.shadow import command_to_capability, evaluate_command
from services.permissions.store import PolicyStore
from services.permissions.types import Effect, Principal


@pytest.fixture
def svc(tmp_path):
    s = PermissionService(store=PolicyStore(str(tmp_path / "p.db")),
                          audit=AuditLog(str(tmp_path / "a.db")))
    yield s


REGISTRY_DEVICES = [
    {"entity_id": "light.living_room", "room": "living_room", "device_type": "light"},
    {"entity_id": "lock.front_door", "room": "entryway", "device_type": "lock"},
    {"entity_id": "camera.porch", "room": "entryway", "device_type": "camera",
     "tags": ["outdoor"]},
    {"entity_id": "sensor.hallway_motion", "room": "hallway", "device_type": "motion"},
]


# --------------------------------------------------------------------------
# Reconciler
# --------------------------------------------------------------------------

def test_reconcile_creates_spaces_and_devices(svc):
    counts = reconcile_devices(svc, REGISTRY_DEVICES)
    assert counts["devices_added"] == 4
    st = svc.state()
    assert "home" in st.spaces
    assert "living_room" in st.spaces and "entryway" in st.spaces
    # lock domain mapped to the "lock" capability class
    assert st.devices["lock.front_door"].device_class == "lock"
    assert st.devices["camera.porch"].device_class == "camera"
    # camera keeps its registry tag + device_type tag
    assert "outdoor" in st.devices["camera.porch"].tags


def test_reconcile_stores_human_names_never_entity_ids(svc):
    # Without a friendly map, names are humanized from the entity_id.
    reconcile_devices(svc, [
        {"entity_id": "light.living_room_lamp", "room": "living_room", "device_type": "light"},
    ])
    dev = svc.state().devices["light.living_room_lamp"]
    assert dev.attrs["name"] == "Living Room Lamp"
    assert "." not in dev.attrs["name"]
    # With a friendly map (HA), the friendly name wins.
    reconcile_devices(svc, [
        {"entity_id": "lock.front", "room": "entryway", "device_type": "lock"},
    ], friendly={"lock.front": "Front Door"})
    assert svc.state().devices["lock.front"].attrs["name"] == "Front Door"


def test_reconcile_backfills_name_on_change(svc):
    # A device that landed before names existed gets its name backfilled.
    svc.add_device("light.x", "light", space_id="home", attrs={"source": "registry"})
    counts = reconcile_devices(svc, [
        {"entity_id": "light.x", "room": "home", "device_type": "light"}])
    assert counts["devices_updated"] == 1
    assert svc.state().devices["light.x"].attrs["name"] == "X"


def test_reconcile_is_idempotent(svc):
    reconcile_devices(svc, REGISTRY_DEVICES)
    seq1 = svc.store.latest_seq()
    counts = reconcile_devices(svc, REGISTRY_DEVICES)  # no changes
    assert counts["devices_added"] == 0 and counts["devices_updated"] == 0
    assert svc.store.latest_seq() == seq1  # nothing appended


def test_reconcile_updates_and_prunes(svc):
    reconcile_devices(svc, REGISTRY_DEVICES)
    # Move the light to a new room + drop the motion sensor.
    changed = [
        {"entity_id": "light.living_room", "room": "den", "device_type": "light"},
        {"entity_id": "lock.front_door", "room": "entryway", "device_type": "lock"},
        {"entity_id": "camera.porch", "room": "entryway", "device_type": "camera"},
    ]
    counts = reconcile_devices(svc, changed)
    assert counts["devices_updated"] >= 1     # light moved rooms
    assert counts["devices_removed"] == 1     # motion sensor pruned
    st = svc.state()
    assert st.devices["light.living_room"].space_id == "den"
    assert "sensor.hallway_motion" not in st.devices


def test_reconcile_does_not_prune_manual_devices(svc):
    reconcile_devices(svc, REGISTRY_DEVICES)
    # A manually/API-added device (no source=registry).
    svc.add_device("virtual.scene", "switch", space_id="home")
    reconcile_devices(svc, [])  # registry now empty
    st = svc.state()
    assert "virtual.scene" in st.devices           # survived
    assert "light.living_room" not in st.devices   # registry ones pruned


def test_reconcile_users(svc):
    reconcile_devices(svc, REGISTRY_DEVICES)  # ensure home exists
    users = [{"username": "owner@x.com", "role": "super_admin"},
             {"username": "kid@x.com", "role": "guest"}]
    counts = reconcile_users(svc, users)
    assert counts["users_seeded"] == 2
    # owner can unlock, guest cannot
    ctx = {"session": {"channel": "app", "trust_level": 3}}
    assert svc.authorize(subject="person:owner@x.com", action="lock.unlock",
                         resource="device:lock.front_door", context=ctx).allowed
    assert not svc.authorize(subject="person:kid@x.com", action="lock.unlock",
                             resource="device:lock.front_door", context=ctx).allowed
    # re-running seeds nobody new
    assert reconcile_users(svc, users)["users_seeded"] == 0


# --------------------------------------------------------------------------
# Command → capability mapping
# --------------------------------------------------------------------------

def test_command_to_capability():
    assert command_to_capability("lock", "unlock") == "lock.unlock"
    assert command_to_capability("lock", "lock") == "lock.lock"
    assert command_to_capability("light", "turn_on") == "light.onoff"
    assert command_to_capability("alarm_control_panel", "alarm_disarm") == "alarm.disarm"
    # unmapped → structured fallback
    assert command_to_capability("weird", "frobnicate") == "weird.frobnicate"


# --------------------------------------------------------------------------
# Shadow / enforce modes
# --------------------------------------------------------------------------

@pytest.fixture
def wired(svc):
    reconcile_devices(svc, REGISTRY_DEVICES)
    svc.add_principal("person:emma", attrs={"age": 40})
    svc.bind_role("b_owner", "person:emma", HOME_SCOPE, "owner")
    svc.add_principal("person:noam", attrs={"age": 9})
    svc.bind_role("b_kid", "person:noam", HOME_SCOPE, "kid")
    set_service(svc)
    yield svc
    set_service(None)


def test_shadow_off_is_noop(wired):
    v = evaluate_command(actor="person:noam", domain="lock", service="unlock",
                         entity_id="lock.front_door", mode="off")
    assert v["evaluated"] is False and v["would_block"] is False


def test_shadow_mode_audits_but_never_blocks(wired):
    v = evaluate_command(actor="person:noam", domain="lock", service="unlock",
                         entity_id="lock.front_door", mode="shadow")
    assert v["evaluated"] is True
    assert v["allowed"] is False       # kid can't unlock
    assert v["would_block"] is False   # ...but shadow never blocks
    # the denied attempt was audited
    assert wired.audit.query(resource="device:lock.front_door")


def test_enforce_blocks_denied_actor(wired):
    v = evaluate_command(actor="person:noam", domain="lock", service="unlock",
                         entity_id="lock.front_door", mode="enforce")
    assert v["allowed"] is False and v["would_block"] is True


def test_enforce_allows_permitted_actor(wired):
    v = evaluate_command(actor="person:emma", domain="lock", service="unlock",
                         entity_id="lock.front_door", mode="enforce")
    assert v["allowed"] is True and v["would_block"] is False
    # high-risk unlock carries a step-up obligation for the PEP to honour
    kinds = {o["kind"] for o in v["obligations"]}
    assert "step_up" in kinds


def test_enforce_fails_open_without_actor(wired):
    v = evaluate_command(actor=None, domain="lock", service="unlock",
                         entity_id="lock.front_door", mode="enforce")
    assert v["would_block"] is False and v["evaluated"] is False
