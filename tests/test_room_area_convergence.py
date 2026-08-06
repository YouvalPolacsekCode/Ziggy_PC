"""Guards the HA-area convergence self-heal (services/device_registry.py).

The recurring "registry room vs HA area" divergence bug: a user assigns a device
to a room in Ziggy (registry `room` set, `room_source="user"`) but nothing writes
the HA area, so every HA-area-based read silently drops the device (the office
lamp). `_heal_ha_areas_from_user_rooms` mirrors user rooms onto HA areas on each
reconcile. These tests pin the SKIP rules that keep it safe — it must never
resurrect a deleted room nor touch Ziggy's own virtual sensors.
"""
from services.device_registry import _select_area_heal_targets

EXISTING = {"office", "bathroom", "bedroom", "living_room"}


def _ent(device_id="dev1", platform="mqtt"):
    return {"device_id": device_id, "platform": platform}


def test_real_physical_user_room_missing_ha_area_is_healed():
    rows = [{"entity_id": "light.lamp", "room": "office", "room_source": "user"}]
    ent_by = {"light.lamp": _ent()}
    # entity has NO HA area (not in entity_areas) → should heal to office
    got = _select_area_heal_targets(rows, EXISTING, {}, ent_by, set())
    assert got == ["light.lamp"]


def test_already_aligned_is_skipped():
    rows = [{"entity_id": "light.lamp", "room": "office", "room_source": "user"}]
    ent_by = {"light.lamp": _ent()}
    got = _select_area_heal_targets(rows, EXISTING, {"light.lamp": "office"}, ent_by, set())
    assert got == []


def test_deleted_room_never_resurrected():
    # registry says 'kitchen' but that area no longer exists in HA → skip (the
    # deleted-room-can't-come-back guarantee).
    rows = [{"entity_id": "light.lamp", "room": "kitchen", "room_source": "user"}]
    ent_by = {"light.lamp": _ent()}
    got = _select_area_heal_targets(rows, EXISTING, {}, ent_by, set())
    assert got == []


def test_non_user_rooms_are_skipped():
    rows = [
        {"entity_id": "light.a", "room": "office", "room_source": "ha"},
        {"entity_id": "light.b", "room": "office", "room_source": None},
    ]
    ent_by = {"light.a": _ent(), "light.b": _ent()}
    assert _select_area_heal_targets(rows, EXISTING, {}, ent_by, set()) == []


def test_ziggy_template_origin_is_skipped():
    rows = [{"entity_id": "binary_sensor.fused", "room": "office",
             "room_source": "user", "origin": "ziggy_template"}]
    ent_by = {"binary_sensor.fused": _ent()}
    assert _select_area_heal_targets(rows, EXISTING, {}, ent_by, set()) == []


def test_template_platform_helper_is_skipped():
    # HA template sensor Ziggy publishes as the fused-occupancy output: no
    # backing device / platform == 'template' → not HA-area managed.
    rows = [{"entity_id": "binary_sensor.office_occupied", "room": "office",
             "room_source": "user"}]
    ent_by = {"binary_sensor.office_occupied": {"device_id": None, "platform": "template"}}
    assert _select_area_heal_targets(rows, EXISTING, {}, ent_by, set()) == []


def test_occupancy_registry_sensor_is_skipped():
    rows = [{"entity_id": "binary_sensor.pres_2", "room": "bedroom", "room_source": "user"}]
    ent_by = {"binary_sensor.pres_2": _ent()}  # has a real device, but…
    occ = {"binary_sensor.pres_2"}             # …it's a Ziggy occupancy sensor
    assert _select_area_heal_targets(rows, EXISTING, {}, ent_by, occ) == []


def test_entity_missing_from_ha_registry_is_skipped():
    rows = [{"entity_id": "light.ghost", "room": "office", "room_source": "user"}]
    assert _select_area_heal_targets(rows, EXISTING, {}, {}, set()) == []


def test_ir_row_without_entity_id_is_skipped():
    rows = [{"ir_device_id": "ir1", "room": "office", "room_source": "user"}]
    assert _select_area_heal_targets(rows, EXISTING, {}, {}, set()) == []
