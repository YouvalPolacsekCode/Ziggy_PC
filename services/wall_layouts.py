"""Per-tablet wall dashboard layouts (schema v2).

ADDITIVE: a separate file from `dashboard_layouts.json`. The older hub layout
service is neither read nor written here, so /hub is completely unaffected.

Schema v2 is a free grid rather than the v1 sized-section list:

    { "version": 2,
      "cols": 12,
      "modules": [ {"id","type","x","y","w","h","config"} ],
      "rail":   {"collapsed": bool},
      "idle":   {"enabled": bool, "timeout_s": int} }

Sanitisation never raises and never rejects: a tablet that posts a slightly
odd document gets a repaired one back rather than an error and a blank wall.
The client's grid engine re-flows whatever survives, so the worst case is a
card in an unexpected place — not a broken screen on someone's kitchen wall.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

from core.logger_module import log_error

_FILE = Path(__file__).parent.parent / "user_files" / "wall_layouts.json"
_LOCK = asyncio.Lock()

SCHEMA_VERSION = 2

_MAX_MODULES = 40
_MAX_BYTES = 128_000

# Types the client knows how to render. Unknown types are dropped on save so a
# downgraded tablet never has to cope with a card it has no component for.
KNOWN_TYPES = {
    "ziggy", "agenda", "shopping", "scenes", "pinned", "room",
    "cameras", "weather", "tasks", "alerts", "media", "modes", "clock",
}


def default_layout() -> dict:
    return {
        "version": SCHEMA_VERSION,
        "cols": 12,
        # Fills all 12 columns — a fresh tablet should look arranged, not like
        # someone abandoned it with a blank right-hand third. Mirrors
        # defaultLayout() in frontend/src/stores/wallStore.js.
        "modules": [
            {"id": "w_ziggy",    "type": "ziggy",    "x": 0, "y": 0, "w": 12, "h": 2, "config": {}},
            {"id": "w_agenda",   "type": "agenda",   "x": 0, "y": 2, "w": 4,  "h": 5, "config": {}},
            {"id": "w_shopping", "type": "shopping", "x": 4, "y": 2, "w": 4,  "h": 5, "config": {}},
            {"id": "w_scenes",   "type": "scenes",   "x": 8, "y": 2, "w": 4,  "h": 3, "config": {}},
            {"id": "w_pinned",   "type": "pinned",   "x": 8, "y": 5, "w": 4,  "h": 3, "config": {}},
        ],
        "rail": {"collapsed": False},
        "idle": {"enabled": True, "timeout_s": 300},
    }


def _load() -> dict:
    if not _FILE.exists():
        return {}
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as e:
        log_error(f"[wall_layouts] Read failed, starting empty: {e}")
        return {}


def _save(data: dict) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(_FILE)
    except Exception as e:
        log_error(f"[wall_layouts] Write failed: {e}")


def _int(v, lo: int, hi: int, fallback: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except Exception:
        return fallback


def sanitize(doc) -> dict:
    """Coerce any posted document into a renderable layout. Never raises."""
    if not isinstance(doc, dict):
        return default_layout()

    raw = doc.get("modules")
    raw = raw if isinstance(raw, list) else []

    modules: list[dict] = []
    seen: set[str] = set()
    for i, m in enumerate(raw[:_MAX_MODULES]):
        if not isinstance(m, dict):
            continue
        mtype = m.get("type")
        if mtype not in KNOWN_TYPES:
            continue
        mid = str(m.get("id") or f"w_{mtype}_{i}")[:64]
        while mid in seen:
            mid += "_"
        seen.add(mid)
        cfg = m.get("config")
        modules.append({
            "id":   mid,
            "type": mtype,
            "x":    _int(m.get("x"), 0, 64, 0),
            "y":    _int(m.get("y"), 0, 400, 0),
            "w":    _int(m.get("w"), 1, 24, 4),
            "h":    _int(m.get("h"), 1, 24, 3),
            "config": cfg if isinstance(cfg, dict) else {},
        })

    if not modules:
        modules = default_layout()["modules"]

    rail = doc.get("rail") if isinstance(doc.get("rail"), dict) else {}
    idle = doc.get("idle") if isinstance(doc.get("idle"), dict) else {}

    return {
        "version": SCHEMA_VERSION,
        "cols":    _int(doc.get("cols"), 2, 24, 12),
        "modules": modules,
        "rail":    {"collapsed": bool(rail.get("collapsed"))},
        "idle": {
            "enabled":   idle.get("enabled", True) is not False,
            "timeout_s": _int(idle.get("timeout_s"), 30, 3600, 300),
        },
    }


async def get_layout(tablet_id: Optional[str]) -> dict:
    """The layout this tablet should render. Unpaired tablets get the default."""
    if not tablet_id:
        return default_layout()
    data = await asyncio.to_thread(_load)
    stored = data.get(tablet_id)
    return sanitize(stored) if stored else default_layout()


async def save_layout(tablet_id: str, doc: dict) -> dict:
    if not tablet_id:
        # Refusing here is what keeps an unpaired tablet from overwriting the
        # shipped default for everyone else.
        raise ValueError("tablet_id is required to save a layout.")
    cleaned = sanitize(doc)
    if len(json.dumps(cleaned)) > _MAX_BYTES:
        raise ValueError("Layout is too large.")
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        data[tablet_id] = cleaned
        await asyncio.to_thread(_save, data)
    return cleaned


async def delete_layout(tablet_id: str) -> bool:
    if not tablet_id:
        return False
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        if tablet_id not in data:
            return False
        del data[tablet_id]
        await asyncio.to_thread(_save, data)
        return True
