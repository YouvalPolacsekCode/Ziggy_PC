"""Controllers must appear in room views.

A controller is not in the device registry — it has no HA entity, so the
registry pass that builds /api/rooms/devices can never see it. Before this,
assigning a remote to a room reported success and then no card appeared
anywhere: not on the Rooms page, not in the Devices "By room" view.
"""
from __future__ import annotations

import pytest

from backend.routers import device_router as dr
from services import controllers as C


IEEE = "0x54ef441001782d71"
DEVID = "dfa43c28740c4a9fe1680b012a50eda2"


def _group(room):
    return {
        "group_id": f"controller_{IEEE}", "card_kind": "controller",
        "kind": "controller", "signature": IEEE, "name": "Wall switch",
        "room": room, "status": "connected", "ha_device_id": DEVID,
        "actions": [{"subtype": "single_left", "label": "Left button — single press"}],
    }


@pytest.fixture
def rooms_for(monkeypatch):
    async def _run(room):
        async def fake_groups():
            return [_group(room)]
        monkeypatch.setattr(C, "groups", fake_groups)
        return await dr.get_rooms_with_devices()
    return _run


def _controllers_in(payload, room_name):
    room = next((r for r in payload["rooms"] if r["name"] == room_name), None)
    if room is None:
        return []
    return [d for d in room.get("devices", []) if d.get("domain") == "controller"]


@pytest.mark.asyncio
async def test_assigned_controller_appears_in_its_room(rooms_for):
    got = _controllers_in(await rooms_for("living_room"), "Living Room")
    assert [d["display_name"] for d in got] == ["Wall switch"]


@pytest.mark.asyncio
async def test_room_row_carries_the_device_id_the_ui_needs_to_reassign(rooms_for):
    got = _controllers_in(await rooms_for("living_room"), "Living Room")
    assert got[0]["ha_device_id"] == DEVID
    assert got[0]["entity_id"] == f"controller.{IEEE}"


@pytest.mark.asyncio
async def test_unassigned_controller_lands_in_no_room_not_unclaimed(rooms_for):
    """"No room" is a user's choice; "unclaimed" means Ziggy hasn't placed it."""
    payload = await rooms_for(None)
    no_room = [d for d in payload["no_room"] if d.get("domain") == "controller"]
    unclaimed = [d for d in payload.get("unclaimed", []) if d.get("domain") == "controller"]
    assert [d["display_name"] for d in no_room] == ["Wall switch"]
    assert unclaimed == []


@pytest.mark.asyncio
async def test_unassigned_controller_is_in_no_room_view_only(rooms_for):
    payload = await rooms_for(None)
    for room in payload["rooms"]:
        assert not [d for d in room.get("devices", []) if d.get("domain") == "controller"]


@pytest.mark.asyncio
async def test_controller_discovery_failure_does_not_break_the_rooms_page(monkeypatch):
    """A broker outage must not empty every room."""
    async def boom():
        raise RuntimeError("broker down")
    monkeypatch.setattr(C, "groups", boom)
    payload = await dr.get_rooms_with_devices()
    assert "rooms" in payload and isinstance(payload["rooms"], list)
