"""Tests for the 'reset home / no rooms' feature.

Covers:
  - device_registry.clear_all_room_assignments blanks room + room_source and
    persists, and is a no-op when nothing has a room.
  - ha_areas.delete_all_areas deletes every listed area and reports failures.
  - rooms_admin.reset_all_rooms orchestrates both.
  - services/rooms_admin._main exits non-zero if any area survives (ship gate).
"""
from __future__ import annotations

from pathlib import Path

import pytest

from services import device_registry as dr
from services import ha_areas, rooms_admin


# ── device_registry.clear_all_room_assignments ───────────────────────────────

@pytest.fixture
def _isolated_registry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(dr, "REGISTRY_FILE", str(tmp_path / "device_registry.json"))
    monkeypatch.setattr(dr, "_registry", [])
    monkeypatch.setattr(dr, "_initialized", True)
    saved = {}
    monkeypatch.setattr(dr, "_save_persistent", lambda devs: saved.update({"devs": list(devs)}))
    monkeypatch.setattr(dr, "_rebuild_indexes", lambda: None)
    return saved


def test_clear_all_room_assignments_blanks_and_persists(_isolated_registry):
    dr._registry = [
        {"entity_id": "light.a", "room": "living_room", "room_source": "user"},
        {"entity_id": "sensor.b", "room": "office", "room_source": "ha"},
        {"entity_id": "ir.c", "room": "bedroom", "room_source": None},
        {"entity_id": "light.d", "room": None, "room_source": None},  # already blank
    ]
    n = dr.clear_all_room_assignments()
    assert n == 3
    assert all(d["room"] is None and d["room_source"] is None for d in dr._registry)
    assert _isolated_registry.get("devs") is not None   # persisted


def test_clear_all_room_assignments_noop_when_no_rooms(_isolated_registry):
    dr._registry = [{"entity_id": "light.a", "room": None, "room_source": None}]
    assert dr.clear_all_room_assignments() == 0
    assert _isolated_registry.get("devs") is None   # nothing saved


# ── ha_areas.delete_all_areas ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_all_areas_deletes_every_area(monkeypatch: pytest.MonkeyPatch):
    async def fake_get_areas():
        return [{"id": "living_room"}, {"id": "office"}, {"id": "mtbkh"}]
    deleted = []
    async def fake_delete_area(aid):
        deleted.append(aid)
        return {"ok": True}
    monkeypatch.setattr(ha_areas, "get_areas", fake_get_areas)
    monkeypatch.setattr(ha_areas, "delete_area", fake_delete_area)
    monkeypatch.setattr(ha_areas, "invalidate_registry_cache", lambda: None)

    res = await ha_areas.delete_all_areas()
    assert res["deleted"] == 3 and res["total"] == 3 and res["failed"] == []
    assert sorted(deleted) == ["living_room", "mtbkh", "office"]


@pytest.mark.asyncio
async def test_delete_all_areas_reports_failures(monkeypatch: pytest.MonkeyPatch):
    async def fake_get_areas():
        return [{"id": "a"}, {"id": "b"}]
    async def fake_delete_area(aid):
        return {"ok": True} if aid == "a" else {"ok": False, "error": "boom"}
    monkeypatch.setattr(ha_areas, "get_areas", fake_get_areas)
    monkeypatch.setattr(ha_areas, "delete_area", fake_delete_area)
    monkeypatch.setattr(ha_areas, "invalidate_registry_cache", lambda: None)

    res = await ha_areas.delete_all_areas()
    assert res["deleted"] == 1
    assert res["failed"] == [{"id": "b", "error": "boom"}]


# ── rooms_admin.reset_all_rooms ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reset_all_rooms_orchestrates_both(monkeypatch: pytest.MonkeyPatch):
    async def fake_delete_all():
        return {"deleted": 2, "total": 2, "failed": []}
    monkeypatch.setattr(rooms_admin.ha_areas, "delete_all_areas", fake_delete_all)
    monkeypatch.setattr(rooms_admin.device_registry, "clear_all_room_assignments", lambda: 5)

    res = await rooms_admin.reset_all_rooms()
    assert res == {
        "areas_deleted": 2, "areas_total": 2, "areas_failed": [], "devices_cleared": 5,
    }


def test_main_fails_when_areas_survive(monkeypatch: pytest.MonkeyPatch):
    # One area couldn't be deleted → ship gate must exit non-zero.
    async def fake_reset():
        return {"areas_deleted": 1, "areas_total": 2, "areas_failed": [{"id": "x"}],
                "devices_cleared": 0}
    monkeypatch.setattr(rooms_admin, "reset_all_rooms", fake_reset)
    monkeypatch.setattr(rooms_admin.device_registry, "init", lambda: None)
    assert rooms_admin._main() == 1


def test_main_succeeds_when_home_blank(monkeypatch: pytest.MonkeyPatch):
    async def fake_reset():
        return {"areas_deleted": 3, "areas_total": 3, "areas_failed": [],
                "devices_cleared": 4}
    monkeypatch.setattr(rooms_admin, "reset_all_rooms", fake_reset)
    monkeypatch.setattr(rooms_admin.device_registry, "init", lambda: None)
    assert rooms_admin._main() == 0
