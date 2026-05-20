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
import time
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
        # WAL persists in the DB header — set it once, every future open
        # (anomaly_engine, map_renderer, this router) inherits it. WAL lets
        # readers and the lone writer proceed in parallel, which matters
        # when an HA-event-driven anomaly write collides with a UI read.
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA synchronous=NORMAL")
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

    # Build a lookup: entity_id → area_id for entity-scoped anomaly bucketing (ANOM-06)
    entity_to_area: dict[str, str] = {}
    for area in areas:
        for eid in area.get("entities", []):
            entity_to_area[eid] = area["id"]

    # Collect entity-level anomalies (keys contain a "." — they are entity_ids)
    entity_anomalies: dict[str, list] = {}
    for key, items in active_anomalies.items():
        if "." in key:   # entity_id form e.g. "switch.iron"
            area_id = entity_to_area.get(key)
            if area_id:
                entity_anomalies.setdefault(area_id, []).extend(items)

    result = []
    for area in areas:
        s = _build_summary(area, state_cache)
        # Merge area-scoped and entity-scoped anomalies for this room
        anomalies = active_anomalies.get(area["id"], []) + entity_anomalies.get(area["id"], [])
        devices = [
            {"entity_id": eid, "state": state_cache.get(eid, {}).get("state", "unknown")}
            for eid in area.get("entities", [])
        ]
        result.append({
            "id":       area["id"],
            "name":     _prettify(area["name"]),
            "raw_name": area["name"],
            **s,
            "devices":   devices,
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


# ─── Dev-only mock anomalies ──────────────────────────────────────────────────
# Lets you populate active_anomalies to exercise the Alerts UI without waiting
# for a real rule to fire.
#
# Persistence: mocks are written to user_files/mock_anomalies.json and reloaded
# into active_anomalies on every backend startup (see load_mock_anomalies()
# called from ha_subscriber). Survives Ziggy restarts so the UI keeps showing
# the same demo state without re-injecting after every restart.
#
# To clear: DELETE this endpoint (wipes file + memory) or just delete the file.

MOCK_ANOMALIES_FILE = Path(__file__).parent.parent.parent / "user_files" / "mock_anomalies.json"

# Mock definitions live here as the source of truth. Each tuple is
# (room_id, entry_template). The `since` is rendered at inject time so the
# "X minutes ago" labels stay fresh on re-inject; persisted entries keep
# their original timestamp so the age grows naturally over the demo session.
# IMPORTANT: rule_ids use a MOCK-* prefix so the anomaly engine never matches
# them. The engine has two sweepers that would otherwise wipe these entries:
#   1) `clear_expired_time_anomalies` blanket-clears every ANOM-04 every minute
#      outside quiet hours.
#   2) `_dispatch` calls `_clear_anomaly(room, rule_id)` whenever the same
#      rule_id evaluates to None for the same area — and your real rooms
#      (kitchen, office, garage) get re-evaluated on every HA state change.
# A MOCK- prefix isn't registered anywhere, so neither path touches it.
# Icon detection in Anomalies.jsx falls back to `message` keywords, so visuals
# stay correct (faucet, door, motion, etc.).
_MOCK_DEFS = [
    ("entrance", {
        "rule_id": "MOCK-DOOR", "severity": "critical",
        "message": "Front door unlocked",
        "confidence": 0.95, "action_available": False,
        "suggested_action": None, "context": None,
        "_age_minutes": 14,
    }),
    ("garden", {
        "rule_id": "MOCK-WATER", "severity": "warning",
        "message": "Garden faucet on 3h",
        "confidence": 0.9, "action_available": True,
        "suggested_action": "turn_off:switch.garden_faucet", "context": None,
        "_age_minutes": 180,
    }),
    ("kitchen", {
        "rule_id": "MOCK-LIGHT", "severity": "warning",
        "message": "Kitchen lights on while away",
        "confidence": 0.88, "action_available": True,
        "suggested_action": "turn_off:light.kitchen_main", "context": "away",
        "_age_minutes": 22,
    }),
    ("office", {
        "rule_id": "MOCK-WINDOW", "severity": "warning",
        "message": "Office window open at night",
        "confidence": 0.82, "action_available": False,
        "suggested_action": None, "context": "night",
        "_age_minutes": 47,
    }),
    ("garage", {
        "rule_id": "MOCK-CAMERA", "severity": "info",
        "message": "Garage camera offline 6h",
        "confidence": 0.99, "action_available": False,
        "suggested_action": None, "context": None,
        "_age_minutes": 360,
    }),
    ("hallway", {
        "rule_id": "MOCK-BATTERY", "severity": "critical",
        "message": "Smoke detector battery low",
        "confidence": 1.0, "action_available": False,
        "suggested_action": None, "context": None,
        "_age_minutes": 1440,  # 1 day
    }),
]
# Room IDs the mock endpoints "own" — only these get cleared on DELETE so we
# don't accidentally wipe a real anomaly that happened to land in the same dict.
_MOCK_ROOM_IDS = {room_id for room_id, _ in _MOCK_DEFS}


def _materialize_mocks(now: float) -> list[tuple[str, dict]]:
    """Expand _MOCK_DEFS to (room_id, entry) tuples with concrete `since` ts."""
    out = []
    for room_id, tmpl in _MOCK_DEFS:
        entry = {k: v for k, v in tmpl.items() if not k.startswith("_")}
        entry["since"] = now - tmpl["_age_minutes"] * 60
        out.append((room_id, entry))
    return out


def _write_mocks_to_file(active: dict) -> None:
    """Persist *only* the mock-owned rooms back to disk."""
    try:
        MOCK_ANOMALIES_FILE.parent.mkdir(parents=True, exist_ok=True)
        payload = {k: v for k, v in active.items() if k in _MOCK_ROOM_IDS}
        MOCK_ANOMALIES_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception as e:
        log_error(f"[MapRouter] Failed to persist mock anomalies: {e}")


def load_mock_anomalies_into(active: dict) -> int:
    """Restore persisted mocks into a live active_anomalies dict at startup.

    Called from services.ha_subscriber once at import time so the demo state
    is back before the first /api/map/anomalies/active hit.
    """
    if not MOCK_ANOMALIES_FILE.exists():
        return 0
    try:
        payload = json.loads(MOCK_ANOMALIES_FILE.read_text(encoding="utf-8"))
        n = 0
        for room_id, entries in payload.items():
            for entry in entries:
                room_list = active.setdefault(room_id, [])
                # De-dup by rule_id so re-loading on a hot-edit doesn't double up.
                active[room_id] = [e for e in room_list if e.get("rule_id") != entry.get("rule_id")]
                active[room_id].append(entry)
                n += 1
        return n
    except Exception as e:
        log_error(f"[MapRouter] Failed to load mock anomalies: {e}")
        return 0


@router.post("/api/map/anomalies/mock")
async def inject_mock_anomalies():
    try:
        from services.ha_subscriber import active_anomalies
    except ImportError:
        return {"ok": False, "error": "ha_subscriber not loaded"}

    for room_id, entry in _materialize_mocks(time.time()):
        room_list = active_anomalies.setdefault(room_id, [])
        active_anomalies[room_id] = [e for e in room_list if e["rule_id"] != entry["rule_id"]]
        active_anomalies[room_id].append(entry)
    _write_mocks_to_file(active_anomalies)
    return {"ok": True, "injected": len(_MOCK_DEFS)}


@router.delete("/api/map/anomalies/mock")
async def clear_mock_anomalies():
    try:
        from services.ha_subscriber import active_anomalies
    except ImportError:
        return {"ok": False, "error": "ha_subscriber not loaded"}

    for k in list(active_anomalies.keys()):
        if k in _MOCK_ROOM_IDS:
            del active_anomalies[k]
    # Wipe the file so the next backend start doesn't re-hydrate them.
    try:
        if MOCK_ANOMALIES_FILE.exists():
            MOCK_ANOMALIES_FILE.unlink()
    except Exception as e:
        log_error(f"[MapRouter] Failed to delete mock file: {e}")
    return {"ok": True}


@router.get("/api/map/anomalies/history")
async def get_anomaly_history(limit: int = 50):
    """Return the most recent anomaly history entries from SQLite."""
    import aiosqlite
    try:
        await _init_db()
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT rule_id, room_id, severity, confidence, message, fired_at, cleared_at, action_taken "
                "FROM anomaly_history ORDER BY fired_at DESC LIMIT ?",
                (limit,),
            ) as cur:
                rows = await cur.fetchall()
                return {"history": [dict(r) for r in rows]}
    except Exception as e:
        log_error(f"[MapRouter] History read failed: {e}")
        return {"history": []}


class SnoozeBody(BaseModel):
    duration_minutes: int = 60


_VALID_RULE_IDS = {f"ANOM-{i:02d}" for i in range(1, 11)}


@router.post("/api/map/anomalies/snooze/{room_id}/{rule_id}")
async def snooze_anomaly(room_id: str, rule_id: str, body: SnoozeBody):
    if rule_id not in _VALID_RULE_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown rule: {rule_id}")
    try:
        from services.anomaly_engine import snooze
        snooze(room_id, rule_id, body.duration_minutes)
    except ImportError:
        raise HTTPException(status_code=503, detail="Anomaly engine not running")
    log_info(f"[MapRouter] Snoozed {rule_id} for {room_id} for {body.duration_minutes}min")
    return {"ok": True, "snoozed_until_minutes": body.duration_minutes}


@router.post("/api/map/anomalies/action/{room_id}/{rule_id}")
async def execute_anomaly_action(room_id: str, rule_id: str):
    """Execute the active anomaly's suggested_action via the appropriate HA service.

    Dispatches:
      - "turn_off_all_lights"  → home_automation.turn_off_all_lights()
      - "turn_off:<entity_id>" → call_service(domain, "turn_off", {...})
      - "check_coordinator"    → reload_zigbee() (same flow as Dashboard)
    On success the anomaly is cleared from active_anomalies immediately so the
    UI reflects the action without waiting for the next state_changed event.
    """
    if rule_id not in _VALID_RULE_IDS:
        raise HTTPException(status_code=404, detail=f"Unknown rule: {rule_id}")

    try:
        from services.ha_subscriber import active_anomalies
    except ImportError:
        raise HTTPException(status_code=503, detail="Anomaly engine not running")

    entry = next((e for e in active_anomalies.get(room_id, []) if e.get("rule_id") == rule_id), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Anomaly not active")
    if not entry.get("action_available"):
        raise HTTPException(status_code=400, detail="No action available for this anomaly")

    action = entry.get("suggested_action") or ""

    from services.home_automation import call_service, turn_off_all_lights
    if action == "turn_off_all_lights":
        result = turn_off_all_lights()
    elif action.startswith("turn_off:"):
        eid = action.split(":", 1)[1]
        if "." not in eid:
            raise HTTPException(status_code=400, detail=f"Invalid entity_id in action: {eid}")
        result = call_service(eid.split(".", 1)[0], "turn_off", {"entity_id": eid})
    elif action == "check_coordinator":
        from backend.routers.health_router import reload_zigbee
        result = await reload_zigbee()
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    if not result.get("ok"):
        msg = result.get("message") or result.get("error") or "Action failed"
        log_info(f"[MapRouter] Action failed for {rule_id} room='{room_id}' action='{action}': {msg}")
        return {"ok": False, "message": msg}

    try:
        from services.anomaly_engine import _clear_anomaly
        _clear_anomaly(active_anomalies, room_id, rule_id)
    except Exception as e:
        log_error(f"[MapRouter] Cleared HA but failed to clear anomaly entry: {e}")

    log_info(f"[MapRouter] Executed action '{action}' for {rule_id} room='{room_id}'")
    return {"ok": True, "message": result.get("message", "Done")}


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
