"""Per-user UI preferences.

Persists Dashboard pin state server-side so it survives:
  - PWA "clear site data"
  - service-worker cache eviction on app update
  - switching browsers / devices (same user gets the same pins)

Storage: a single JSON file keyed by the authenticated user's email. Small
enough to read+write whole on every change without contention.

API:
  GET  /api/ui/prefs              -> { pinnedShortcuts: [...], quickControlIds: [...] }
  PUT  /api/ui/prefs              -> body merges into the user's record

The shape mirrors deviceStore on the frontend so the client doesn't need to
translate between server and store representations.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user
from core.logger_module import log_error
from core.debug_bus import bus as _bus, VERBOSE as _VERBOSE

router = APIRouter()

_FILE = Path(__file__).parent.parent.parent / "user_files" / "ui_prefs.json"

# Hard caps mirror the frontend's QUICK_MAX / SHORTCUTS_MAX so the server can't
# be tricked into storing unbounded arrays. Keep these in lockstep with
# frontend/src/stores/deviceStore.js.
_QUICK_MAX = 4
_SHORTCUTS_MAX = 8


def _load_all() -> dict:
    if not _FILE.exists():
        return {}
    try:
        return json.loads(_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        log_error(f"[ui_prefs] Read failed, starting from empty: {e}")
        return {}


def _save_all(data: dict) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        _FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:
        log_error(f"[ui_prefs] Write failed: {e}")


def _user_key(user: dict) -> str:
    # Email is the stable identifier across token rotations (session_tokens
    # change on logout/login; email doesn't). Fall back to username if missing.
    return (user.get("email") or user.get("username") or "_anon").lower()


def _empty_prefs() -> dict:
    return {
        "pinnedShortcuts":   [],
        "quickControlIds":   [],
        "roomPhotos":        {},  # { roomId: presetKey } — overrides which preset photo a room uses
        "roomCustomPhotos":  {},  # { roomId: dataUrl }   — user-uploaded image (base64 JPEG)
        "roomsOrder":        [],  # [roomId, …] user-defined room display order; rooms not listed fall to the end in their natural order
        "theme":             None,  # 'light' | 'dark' | None (use system default)
    }


def _sanitize_theme(v):
    if v in ("light", "dark"):
        return v
    return None


def _sanitize_shortcuts(arr) -> list:
    if not isinstance(arr, list):
        return []
    out = []
    for s in arr:
        if not isinstance(s, dict):
            continue
        if s.get("type") not in ("routine", "ask"):
            continue
        if not s.get("id"):
            continue
        out.append({"type": s["type"], "id": str(s["id"])})
        if len(out) >= _SHORTCUTS_MAX:
            break
    return out


def _sanitize_quick(arr) -> list:
    if not isinstance(arr, list):
        return []
    return [str(x) for x in arr if x][:_QUICK_MAX]


def _sanitize_room_photos(obj) -> dict:
    """Preset overrides: { roomId: presetKey }, both must be strings."""
    if not isinstance(obj, dict):
        return {}
    return {str(k): str(v) for k, v in obj.items() if k and v}


# Per-image cap: 800px JPEG @ 0.82 ≈ 200-400KB → 800KB is 2x headroom for big rooms.
# Per-user cap: 20 rooms * 800KB = 16MB — generous for the use case while preventing
# pathological prefs files that would OOM the read/write loop.
_MAX_DATAURL_BYTES = 800_000
_MAX_CUSTOM_PHOTOS = 20


_MAX_ROOMS_ORDER = 64


def _sanitize_rooms_order(arr) -> list:
    """User-defined room order — list of room id strings, deduped, capped."""
    if not isinstance(arr, list):
        return []
    seen = set()
    out = []
    for x in arr:
        if not x:
            continue
        s = str(x)
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
        if len(out) >= _MAX_ROOMS_ORDER:
            break
    return out


def _sanitize_room_custom_photos(obj) -> dict:
    """Custom photo data URLs: { roomId: dataUrl }. Drop anything that isn't a
    plausible data URL or that exceeds the per-image cap."""
    if not isinstance(obj, dict):
        return {}
    out = {}
    for k, v in obj.items():
        if not k or not isinstance(v, str):
            continue
        if not v.startswith("data:image/"):
            continue
        if len(v) > _MAX_DATAURL_BYTES:
            continue
        out[str(k)] = v
        if len(out) >= _MAX_CUSTOM_PHOTOS:
            break
    return out


class PrefsUpdate(BaseModel):
    pinnedShortcuts:   Optional[list] = None
    quickControlIds:   Optional[list] = None
    roomPhotos:        Optional[dict] = None
    roomCustomPhotos:  Optional[dict] = None
    roomsOrder:        Optional[list] = None
    theme:             Optional[str]  = None


@router.get("/api/ui/prefs")
async def get_prefs(user: dict = Depends(get_current_user)):
    all_prefs = await asyncio.to_thread(_load_all)
    # Backfill any missing fields with empty defaults so the client doesn't have
    # to special-case "key absent" vs "key present but empty".
    record = {**_empty_prefs(), **all_prefs.get(_user_key(user), {})}
    return record


@router.put("/api/ui/prefs")
async def put_prefs(body: PrefsUpdate, user: dict = Depends(get_current_user)):
    all_prefs = await asyncio.to_thread(_load_all)
    key = _user_key(user)
    current = {**_empty_prefs(), **all_prefs.get(key, {})}

    if body.pinnedShortcuts is not None:
        current["pinnedShortcuts"] = _sanitize_shortcuts(body.pinnedShortcuts)
    if body.quickControlIds is not None:
        current["quickControlIds"] = _sanitize_quick(body.quickControlIds)
    if body.roomPhotos is not None:
        current["roomPhotos"] = _sanitize_room_photos(body.roomPhotos)
    if body.roomCustomPhotos is not None:
        current["roomCustomPhotos"] = _sanitize_room_custom_photos(body.roomCustomPhotos)
    if body.roomsOrder is not None:
        current["roomsOrder"] = _sanitize_rooms_order(body.roomsOrder)
    if body.theme is not None:
        current["theme"] = _sanitize_theme(body.theme)

    all_prefs[key] = current
    await asyncio.to_thread(_save_all, all_prefs)
    # VERBOSE not BASIC — every dashboard pin drag fires this; we only want
    # to see it when the user has explicitly opted into verbose.
    _bus.emit("settings", _VERBOSE, "ui_prefs_updated",
              user=key,
              fields=[f for f in ("pinnedShortcuts","quickControlIds","roomPhotos",
                                   "roomCustomPhotos","roomsOrder","theme")
                       if getattr(body, f) is not None])
    return current
