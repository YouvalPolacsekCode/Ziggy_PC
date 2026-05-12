"""
Unit tests for canvas position persistence (SQLite + JSON fallback).
Uses a temporary DB path to avoid touching the real user_files/.
"""
import pytest
import asyncio
from pathlib import Path
import tempfile
import json

import backend.routers.map_router as map_router


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    """Redirect DB_PATH and JSON_FALLBACK to tmp directories."""
    monkeypatch.setattr(map_router, "DB_PATH", tmp_path / "test_map.db")
    monkeypatch.setattr(map_router, "JSON_FALLBACK", tmp_path / "test_map.json")


@pytest.mark.asyncio
async def test_get_canvas_empty():
    positions = await map_router._get_canvas_from_db()
    assert positions == []


@pytest.mark.asyncio
async def test_put_and_get_canvas_position():
    await map_router._save_position_to_db("bedroom", 10.0, 20.0, 120.0, 80.0)
    positions = await map_router._get_canvas_from_db()
    assert len(positions) == 1
    p = positions[0]
    assert p["room_id"] == "bedroom"
    assert p["x"] == 10.0
    assert p["y"] == 20.0
    assert p["width"] == 120.0
    assert p["height"] == 80.0


@pytest.mark.asyncio
async def test_canvas_position_update():
    await map_router._save_position_to_db("bedroom", 10.0, 20.0, 120.0, 80.0)
    await map_router._save_position_to_db("bedroom", 50.0, 60.0, 150.0, 100.0)
    positions = await map_router._get_canvas_from_db()
    assert len(positions) == 1  # upserted, not duplicated
    assert positions[0]["x"] == 50.0


@pytest.mark.asyncio
async def test_multiple_rooms():
    await map_router._save_position_to_db("bedroom", 0, 0, 100, 80)
    await map_router._save_position_to_db("kitchen", 110, 0, 80, 80)
    await map_router._save_position_to_db("living_room", 200, 0, 120, 100)
    positions = await map_router._get_canvas_from_db()
    assert len(positions) == 3
    ids = {p["room_id"] for p in positions}
    assert ids == {"bedroom", "kitchen", "living_room"}


@pytest.mark.asyncio
async def test_json_fallback_write_and_read(monkeypatch):
    """When SQLite is unavailable, positions fall back to JSON."""
    async def _bad_db(*args, **kwargs):
        raise RuntimeError("DB unavailable")

    monkeypatch.setattr(map_router, "_init_db", _bad_db)
    # Falls back to JSON
    map_router._save_position_to_json("office", 30.0, 40.0, 90.0, 70.0)
    positions = map_router._get_canvas_from_json()
    assert len(positions) == 1
    assert positions[0]["room_id"] == "office"
