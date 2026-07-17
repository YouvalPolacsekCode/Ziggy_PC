"""Bug 1: assigning a device to a 'ghost' room (a name-inferred room slug with
no HA area behind it) used to silently orphan the entity — HA accepts an unknown
area_id but creates no area, so the device pointed at a phantom room and showed
as unassigned. The fix (_resolve_or_create_area) must ensure a real area exists
before assigning: reuse a matching one, else create it from the slug.
"""
import asyncio
import pytest

from services import ha_areas


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture
def snapshot(monkeypatch):
    state = {
        "areas": [
            {"area_id": "office", "name": "Office"},
            {"area_id": "slvn", "name": "סלון"},
        ],
        "entities": [{"entity_id": "light.lamp1", "device_id": "dev1"}],
        "devices": [{"id": "dev1", "area_id": None}],
    }

    async def fake_snapshot(force=False):
        return state

    created = []

    async def fake_create_area(name):
        aid = name.strip().lower().replace(" ", "_")
        created.append(name)
        state["areas"].append({"area_id": aid, "name": name})
        return {"ok": True, "area": {"area_id": aid, "name": name}}

    calls = []

    async def fake_ws(*cmds):
        calls.extend(cmds)
        return [{"success": True} for _ in cmds]

    monkeypatch.setattr(ha_areas, "get_registry_snapshot", fake_snapshot)
    monkeypatch.setattr(ha_areas, "create_area", fake_create_area)
    monkeypatch.setattr(ha_areas, "_ws", fake_ws)
    monkeypatch.setattr(ha_areas, "invalidate_registry_cache", lambda: None)
    return state, created, calls


def test_existing_area_id_used_as_is(snapshot):
    state, created, calls = snapshot
    res = _run(ha_areas.assign_entity_to_area("light.lamp1", "office"))
    assert res["ok"] is True
    assert created == []  # no new area needed
    assert calls[0]["area_id"] == "office"


def test_ghost_room_slug_creates_real_area(snapshot):
    state, created, calls = snapshot
    # 'living_room' has no HA area -> must be created, then assigned to the NEW id
    res = _run(ha_areas.assign_entity_to_area("light.lamp1", "living_room"))
    assert res["ok"] is True
    assert created == ["Living Room"]
    assert calls[0]["area_id"] == "living_room"  # the newly-created area id


def test_slug_matches_existing_area_by_name(snapshot):
    state, created, calls = snapshot
    # token 'Office' (differs in case/space) must reuse existing 'office', not create
    res = _run(ha_areas.assign_entity_to_area("light.lamp1", "Office"))
    assert res["ok"] is True
    assert created == []
    assert calls[0]["area_id"] == "office"


def test_unassign_none_skips_self_heal(snapshot):
    state, created, calls = snapshot
    res = _run(ha_areas.assign_entity_to_area("light.lamp1", None))
    assert res["ok"] is True
    assert created == []
    assert calls[0]["area_id"] is None
