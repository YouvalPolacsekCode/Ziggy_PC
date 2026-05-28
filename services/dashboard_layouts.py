"""Hub dashboard layouts.

Backs the tablet-only `/hub` route. Layouts are JSON documents (sections array,
grid config, scope) keyed by tablet_id. Storage mirrors ui_prefs.json — a
single JSON file in user_files/, small enough to read + write whole on every
change.

Why JSON (not SQLite): we already store per-user UI prefs as JSON; matching
that pattern keeps deployment unchanged and lets layouts evolve schema-free
during Phase 1. If contention or per-layout indexing ever matters, migration
to a table is straightforward (the resolver is the only call site).

Resolution order (most specific wins):
    (tablet_id, mode) > (tablet_id, None) > DEFAULT_LAYOUT
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

from core.logger_module import log_error

_FILE = Path(__file__).parent.parent / "user_files" / "dashboard_layouts.json"

SCHEMA_VERSION = 1

# Bounds — guard against pathological JSON that would OOM the read/write loop.
_MAX_SECTIONS = 64
_MAX_LAYOUT_BYTES = 256_000  # 250KB per layout is generous; real layouts ~5KB

# Sizes the renderer understands. Unknown sizes fall back to "M".
_VALID_SIZES = {"S", "M", "L", "FULL"}

# Section types the renderer dispatches on. Sections with unknown types render
# as a placeholder ("Unsupported widget"); we don't reject them server-side so
# old saved layouts keep working after a tablet downgrade.
_KNOWN_TYPES = {
    "status_strip",
    "weather_card",
    "mode_switcher",
    "rooms_carousel",
    "room_summary",
    "scene_grid",
    "scene_button",
    "command_button",
    "device_tile",
    "quick_devices",
    "climate_card",
    "camera_tile",
    "alerts_inbox",
    "suggestion_card",
    "tasks_list",
    "notes_card",
    "sensor_strip",
    "presence_card",
    "media_card",
    "activity_log",
    "section_header",
}


# ---------------------------------------------------------------------------
# Default layout — what an unpaired or freshly-paired tablet sees out of the
# box. Mirrors today's Dashboard.jsx order so behavior is familiar.
# ---------------------------------------------------------------------------

DEFAULT_LAYOUT: dict = {
    "schema_version": SCHEMA_VERSION,
    "id": "lay_default",
    "name": "Default",
    "scope": {"tablet_id": None, "mode": None},
    "grid": {"cols": {"mobile": 4, "tablet": 8, "desktop": 12}},
    "sections": [
        {"id": "sec_status",  "type": "status_strip",    "size": "FULL", "config": {}},
        {"id": "sec_rooms",   "type": "rooms_carousel",  "size": "FULL", "config": {}},
        {"id": "sec_scenes",  "type": "scene_grid",      "size": "FULL", "config": {}},
        {"id": "sec_quick",   "type": "quick_devices",   "size": "FULL", "config": {}},
        {"id": "sec_tasks",   "type": "tasks_list",      "size": "M",    "config": {"limit": 5}},
        {"id": "sec_alerts",  "type": "alerts_inbox",    "size": "M",    "config": {"limit": 5}},
    ],
}


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _load_all() -> dict:
    if not _FILE.exists():
        return {}
    try:
        return json.loads(_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        log_error(f"[dashboard_layouts] Read failed, starting empty: {e}")
        return {}


def _save_all(data: dict) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        _FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:
        log_error(f"[dashboard_layouts] Write failed: {e}")


# ---------------------------------------------------------------------------
# Sanitization — accept any shape, return a renderable layout. Never raises.
# ---------------------------------------------------------------------------

def _sanitize_section(s) -> Optional[dict]:
    if not isinstance(s, dict):
        return None
    stype = s.get("type")
    if not isinstance(stype, str) or not stype:
        return None
    size = s.get("size") if s.get("size") in _VALID_SIZES else "M"
    sid = str(s.get("id") or "")[:64]
    if not sid:
        return None
    config = s.get("config") if isinstance(s.get("config"), dict) else {}
    return {"id": sid, "type": stype, "size": size, "config": config}


def sanitize_layout(doc) -> dict:
    """Coerce a posted document into a valid layout. Drops bad sections,
    enforces caps, fills missing fields. Never raises."""
    if not isinstance(doc, dict):
        doc = {}

    raw_sections = doc.get("sections") if isinstance(doc.get("sections"), list) else []
    sections: list[dict] = []
    for s in raw_sections[: _MAX_SECTIONS]:
        cleaned = _sanitize_section(s)
        if cleaned:
            sections.append(cleaned)

    scope_in = doc.get("scope") if isinstance(doc.get("scope"), dict) else {}
    scope = {
        "tablet_id": (str(scope_in.get("tablet_id"))[:64] if scope_in.get("tablet_id") else None),
        "mode":      (str(scope_in.get("mode"))[:32] if scope_in.get("mode") else None),
    }

    grid_in = doc.get("grid") if isinstance(doc.get("grid"), dict) else {}
    cols_in = grid_in.get("cols") if isinstance(grid_in.get("cols"), dict) else {}
    grid = {
        "cols": {
            "mobile":  int(cols_in.get("mobile", 4)),
            "tablet":  int(cols_in.get("tablet", 8)),
            "desktop": int(cols_in.get("desktop", 12)),
        }
    }

    return {
        "schema_version": SCHEMA_VERSION,
        "id":    str(doc.get("id") or "lay_anon")[:64],
        "name":  str(doc.get("name") or "Layout")[:120],
        "scope": scope,
        "grid":  grid,
        "sections": sections,
    }


# ---------------------------------------------------------------------------
# Resolver — pick the best matching layout for a request.
# ---------------------------------------------------------------------------

def _resolve(all_layouts: dict, tablet_id: Optional[str], mode: Optional[str]) -> dict:
    candidates = []
    for key, layout in all_layouts.items():
        scope = (layout or {}).get("scope") or {}
        l_tab  = scope.get("tablet_id")
        l_mode = scope.get("mode")
        # Must match tablet_id if scoped, else match anything
        if l_tab and l_tab != tablet_id:
            continue
        if l_mode and l_mode != mode:
            continue
        # Score: tablet match (2) + mode match (1)
        score = (2 if l_tab == tablet_id and l_tab else 0) + (1 if l_mode == mode and l_mode else 0)
        candidates.append((score, key, layout))
    if not candidates:
        return DEFAULT_LAYOUT
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][2]


# ---------------------------------------------------------------------------
# Async API used by the router
# ---------------------------------------------------------------------------

async def get_active_layout(tablet_id: Optional[str], mode: Optional[str] = None) -> dict:
    """Return the layout this tablet should render right now."""
    all_layouts = await asyncio.to_thread(_load_all)
    return _resolve(all_layouts, tablet_id, mode)


async def save_layout(tablet_id: str, doc: dict) -> dict:
    """Upsert a tablet-scoped layout."""
    if not tablet_id:
        # Caller must scope to a tablet; refusing here keeps DEFAULT_LAYOUT
        # safe from drive-by overwrites.
        raise ValueError("tablet_id is required to save a layout")

    cleaned = sanitize_layout(doc)
    cleaned["scope"]["tablet_id"] = tablet_id

    serialized = json.dumps(cleaned)
    if len(serialized) > _MAX_LAYOUT_BYTES:
        raise ValueError(f"layout exceeds {_MAX_LAYOUT_BYTES} bytes")

    all_layouts = await asyncio.to_thread(_load_all)
    all_layouts[tablet_id] = cleaned
    await asyncio.to_thread(_save_all, all_layouts)
    return cleaned


async def delete_layouts_for_tablet(tablet_id: str) -> bool:
    """Drop any layouts tied to a specific tablet. Called on un-pair."""
    if not tablet_id:
        return False
    all_layouts = await asyncio.to_thread(_load_all)
    if tablet_id not in all_layouts:
        return False
    del all_layouts[tablet_id]
    await asyncio.to_thread(_save_all, all_layouts)
    return True


async def list_layouts() -> list[dict]:
    """Admin view — every layout we know about."""
    all_layouts = await asyncio.to_thread(_load_all)
    return list(all_layouts.values())
