"""
Map router — canvas positions, room summaries, and anomaly endpoints.

Canvas persistence: aiosqlite (async-safe for FastAPI).
Fallback: user_files/home_map.json if SQLite write fails.

Endpoints:
  GET  /api/map/rooms/summary          per-room state summary (template strings)
  GET  /api/map/canvas                 saved canvas positions
  PUT  /api/map/canvas/{room_id}       save room position
  GET  /api/map/anomalies/active       current active anomalies
  POST /api/map/anomalies/snooze/{room_id}/{rule_id}  snooze a rule for a room
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Optional

import aiosqlite
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.logger_module import log_info, log_error
from services.ha_areas import get_areas

router = APIRouter()

DB_PATH = Path("user_files/home_map.db")
JSON_FALLBACK = Path("user_files/home_map.json")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS canvas_rooms (
    room_id   TEXT PRIMARY KEY,
    x         REAL NOT NULL DEFAULT 0,
    y         REAL NOT NULL DEFAULT 0,
    width     REAL NOT NULL DEFAULT 120,
    height    REAL NOT NULL DEFAULT 80
);
CREATE TABLE IF NOT EXISTS anomaly_snooze (
    key        TEXT PRIMARY KEY,
    snooze_until REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS map_render (
    layout_hash  TEXT PRIMARY KEY,
    svg          TEXT NOT NULL,
    viewbox_x    REAL NOT NULL DEFAULT 0,
    viewbox_y    REAL NOT NULL DEFAULT 0,
    viewbox_w    REAL NOT NULL DEFAULT 800,
    viewbox_h    REAL NOT NULL DEFAULT 600,
    generated_at REAL NOT NULL,
    model        TEXT NOT NULL DEFAULT 'gpt-4o'
);
"""


async def _init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(_SCHEMA)
        await db.commit()


async def _get_canvas_from_db() -> list[dict]:
    try:
        await _init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT room_id, x, y, width, height FROM canvas_rooms") as cur:
                rows = await cur.fetchall()
                return [dict(r) for r in rows]
    except Exception as e:
        log_error(f"[MapRouter] SQLite read failed, trying JSON fallback: {e}")
        return _get_canvas_from_json()


def _get_canvas_from_json() -> list[dict]:
    try:
        data = json.loads(JSON_FALLBACK.read_text())
        return data.get("canvas", [])
    except Exception:
        return []


async def _save_position_to_db(room_id: str, x: float, y: float, w: float, h: float) -> None:
    try:
        await _init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO canvas_rooms (room_id, x, y, width, height) VALUES (?,?,?,?,?) "
                "ON CONFLICT(room_id) DO UPDATE SET x=excluded.x, y=excluded.y, "
                "width=excluded.width, height=excluded.height",
                (room_id, x, y, w, h),
            )
            await db.commit()
    except Exception as e:
        log_error(f"[MapRouter] SQLite write failed, using JSON fallback: {e}")
        _save_position_to_json(room_id, x, y, w, h)


def _save_position_to_json(room_id: str, x: float, y: float, w: float, h: float) -> None:
    try:
        JSON_FALLBACK.parent.mkdir(parents=True, exist_ok=True)
        data = json.loads(JSON_FALLBACK.read_text()) if JSON_FALLBACK.exists() else {}
        canvas = {r["room_id"]: r for r in data.get("canvas", [])}
        canvas[room_id] = {"room_id": room_id, "x": x, "y": y, "width": w, "height": h}
        data["canvas"] = list(canvas.values())
        JSON_FALLBACK.write_text(json.dumps(data, indent=2))
    except Exception as e:
        log_error(f"[MapRouter] JSON fallback write also failed: {e}")


# ---------------------------------------------------------------------------
# Room name prettification
# ---------------------------------------------------------------------------

def _prettify(name: str) -> str:
    import re
    name = re.sub(r'^(area|room)_', '', name, flags=re.IGNORECASE)
    return name.replace("_", " ").title()


# ---------------------------------------------------------------------------
# Template summary builder
# ---------------------------------------------------------------------------

def _build_summary(area: dict, state_cache: dict) -> dict:
    """Return { summary, presence, active_count, entity_count } for one area."""
    from core.settings_loader import settings

    entities = area.get("entities", [])
    active_count = sum(
        1 for eid in entities
        if state_cache.get(eid, {}).get("state") == "on"
    )
    entity_count = len(entities)

    # Presence from motion/occupancy sensors
    presence = None
    for eid in entities:
        if not eid.startswith("binary_sensor."):
            continue
        dc = state_cache.get(eid, {}).get("attributes", {}).get("device_class", "")
        if dc in ("motion", "occupancy", "presence"):
            s = state_cache.get(eid, {}).get("state")
            if s == "on":
                presence = "occupied"
                break
            elif s == "off":
                presence = presence or "empty"
            else:
                presence = presence or "uncertain"

    # Temperature from climate or temperature sensors
    temp = None
    for eid in entities:
        if eid.startswith("climate."):
            t = state_cache.get(eid, {}).get("attributes", {}).get("current_temperature")
            if t is not None:
                temp = round(float(t), 1)
                break
        if eid.startswith("sensor.") and "temp" in eid:
            t = state_cache.get(eid, {}).get("state")
            try:
                temp = round(float(t), 1)
                break
            except (TypeError, ValueError):
                pass

    # Build template string
    parts = []
    if active_count > 0:
        parts.append(f"{active_count} on")
    else:
        parts.append("All off")
    if temp is not None:
        parts.append(f"{temp}°")
    summary = " · ".join(parts)

    return {
        "summary": summary,
        "presence": presence,
        "active_count": active_count,
        "entity_count": entity_count,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/api/map/rooms/summary")
async def rooms_summary():
    """Per-room template summary strings + presence state from in-memory cache."""
    try:
        from services.ha_subscriber import state_cache, active_anomalies
    except ImportError:
        state_cache, active_anomalies = {}, {}

    try:
        areas = await get_areas()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch HA areas: {e}")

    result = []
    for area in areas:
        s = _build_summary(area, state_cache)
        anomalies = active_anomalies.get(area["id"], [])
        # Include entity list so the frontend can show device-type icons
        devices = [
            {"entity_id": eid, "state": state_cache.get(eid, {}).get("state", "unknown")}
            for eid in area.get("entities", [])
        ]
        result.append({
            "id": area["id"],
            "name": _prettify(area["name"]),
            "raw_name": area["name"],
            **s,
            "devices": devices,
            "anomalies": anomalies,
        })
    return {"rooms": result}


@router.get("/api/map/canvas")
async def get_canvas():
    positions = await _get_canvas_from_db()
    return {"positions": positions}


class CanvasPosition(BaseModel):
    x: float
    y: float
    width: float = 120.0
    height: float = 80.0


@router.put("/api/map/canvas/{room_id}")
async def put_canvas_position(room_id: str, body: CanvasPosition):
    await _save_position_to_db(room_id, body.x, body.y, body.width, body.height)
    return {"ok": True, "room_id": room_id}


@router.get("/api/map/anomalies/active")
async def get_active_anomalies():
    try:
        from services.ha_subscriber import active_anomalies
    except ImportError:
        active_anomalies = {}
    return {"anomalies": active_anomalies}


class SnoozeBody(BaseModel):
    duration_minutes: int = 60


@router.post("/api/map/anomalies/snooze/{room_id}/{rule_id}")
async def snooze_anomaly(room_id: str, rule_id: str, body: SnoozeBody):
    valid_rules = {"ANOM-01", "ANOM-02", "ANOM-03", "ANOM-04", "ANOM-05", "ANOM-06"}
    if rule_id not in valid_rules:
        raise HTTPException(status_code=404, detail=f"Unknown rule: {rule_id}")
    try:
        from services.anomaly_engine import snooze
        snooze(room_id, rule_id, body.duration_minutes)
    except ImportError:
        raise HTTPException(status_code=503, detail="Anomaly engine not running")
    log_info(f"[MapRouter] Snoozed {rule_id} for {room_id} for {body.duration_minutes}min")
    return {"ok": True, "snoozed_until_minutes": body.duration_minutes}


# ---------------------------------------------------------------------------
# AI render endpoints
# ---------------------------------------------------------------------------

@router.get("/api/map/render")
async def get_map_render():
    """Return cached AI-generated SVG for the current layout, if available."""
    positions = await _get_canvas_from_db()
    if not positions:
        return {"status": "no_layout", "hash": None}

    from services.map_renderer import layout_hash, get_cached_render
    h = layout_hash(positions)
    cached = await get_cached_render(h)
    if cached:
        return {
            "status": "ready",
            "hash": h,
            "svg": cached["svg"],
            "viewbox": {
                "x": cached["viewbox_x"],
                "y": cached["viewbox_y"],
                "w": cached["viewbox_w"],
                "h": cached["viewbox_h"],
            },
        }
    return {"status": "not_generated", "hash": h}


class RenderRequest(BaseModel):
    rooms: list[dict]  # [{id, name}] from the frontend rooms summary


@router.post("/api/map/render/generate")
async def trigger_map_render(body: RenderRequest):
    """Kick off AI SVG generation for the current layout (non-blocking)."""
    positions = await _get_canvas_from_db()
    if not positions:
        raise HTTPException(status_code=400, detail="No layout saved yet — build your floor plan first")

    from services.map_renderer import layout_hash, get_cached_render, generate_render
    h = layout_hash(positions)

    cached = await get_cached_render(h)
    if cached:
        return {"status": "ready", "hash": h}

    asyncio.create_task(generate_render(h, positions, body.rooms))
    log_info(f"[MapRouter] Queued AI render for hash {h}")
    return {"status": "generating", "hash": h}
