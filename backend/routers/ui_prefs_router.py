"""Per-user UI preferences.

Persists Dashboard pin state server-side so it survives:
  - PWA "clear site data"
  - service-worker cache eviction on app update
  - switching browsers / devices (same user gets the same pins)

Storage: one JSON file per user under user_files/ui_prefs/. Previously a
single combined file was read+rewritten on every pin drag; with many users
or large custom-photo blobs that became O(all_users) per write.

On first boot after the upgrade the combined ui_prefs.json (if present)
is migrated automatically — each top-level user key becomes its own file
and the legacy combined file is renamed with a .migrated suffix so it
can't be re-imported on the next reboot.

API:
  GET  /api/ui/prefs              -> { pinnedShortcuts: [...], quickControlIds: [...] }
  PUT  /api/ui/prefs              -> body merges into the user's record
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user
from backend.middleware.etag import etag_response
from core.logger_module import log_error, log_info
from core.debug_bus import bus as _bus, VERBOSE as _VERBOSE

router = APIRouter()

_REPO_ROOT = Path(__file__).parent.parent.parent
_LEGACY_FILE = _REPO_ROOT / "user_files" / "ui_prefs.json"
_SHARDS_DIR  = _REPO_ROOT / "user_files" / "ui_prefs"

# Per-user mtime-invalidated cache. A pin drag now reads/writes only the
# acting user's file instead of every user's record.
_cache: dict[str, dict] = {}
_cache_mtime: dict[str, float] = {}

# Hard caps mirror the frontend's QUICK_MAX / SHORTCUTS_MAX so the server can't
# be tricked into storing unbounded arrays. Keep these in lockstep with
# frontend/src/stores/deviceStore.js.
_QUICK_MAX = 4
_SHORTCUTS_MAX = 8


# ---------------------------------------------------------------------------
# Per-user shard helpers
# ---------------------------------------------------------------------------

_SAFE_KEY_RE = re.compile(r"[^a-z0-9._@+-]")


def _shard_filename(user_key: str) -> str:
    """Filesystem-safe filename for a user key. Email is the normal input.

    Strip control chars / path separators; if the result is empty (or the
    original key is suspiciously long, e.g. > 80 chars), fall back to a
    hex digest. The original key isn't recoverable from the digest, but the
    server already has user_key in memory at every request, so we don't
    need a reverse mapping.
    """
    safe = _SAFE_KEY_RE.sub("_", user_key)
    if not safe or len(user_key) > 80:
        safe = "u_" + hashlib.sha1(user_key.encode("utf-8")).hexdigest()[:16]
    return safe + ".json"


def _shard_path(user_key: str) -> Path:
    return _SHARDS_DIR / _shard_filename(user_key)


def _mtime(p: Path) -> float:
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0


def _migrate_legacy_if_present() -> None:
    """One-shot migration from the old combined ui_prefs.json into per-user
    shards. Renames the legacy file to .migrated on success so re-runs are
    cheap (the .exists() check returns False on the renamed name)."""
    if not _LEGACY_FILE.exists():
        return
    try:
        raw = json.loads(_LEGACY_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        log_error(f"[ui_prefs] Legacy file unreadable, skipping migration: {e}")
        return
    if not isinstance(raw, dict) or not raw:
        # Empty/garbage — just rename it out of the way.
        try:
            _LEGACY_FILE.rename(_LEGACY_FILE.with_suffix(".json.migrated"))
        except OSError:
            pass
        return

    _SHARDS_DIR.mkdir(parents=True, exist_ok=True)
    migrated = 0
    for user_key, record in raw.items():
        if not isinstance(record, dict) or not user_key:
            continue
        path = _shard_path(user_key)
        if path.exists():
            # Already migrated for this user — don't overwrite a newer shard
            # with an older combined-file snapshot.
            continue
        try:
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_text(json.dumps(record, indent=2), encoding="utf-8")
            tmp.replace(path)
            migrated += 1
        except Exception as e:
            log_error(f"[ui_prefs] Migration write failed for {user_key}: {e}")
    try:
        _LEGACY_FILE.rename(_LEGACY_FILE.with_suffix(".json.migrated"))
    except OSError as e:
        log_error(f"[ui_prefs] Could not rename legacy file: {e}")
    if migrated:
        log_info(f"[ui_prefs] Migrated {migrated} users from legacy ui_prefs.json")


_migrate_legacy_if_present()


def _load_user(user_key: str) -> dict:
    """Return the user's prefs dict (empty if missing). mtime-cached."""
    path = _shard_path(user_key)
    if not path.exists():
        _cache[user_key] = {}
        _cache_mtime[user_key] = 0.0
        return {}
    mtime = _mtime(path)
    if user_key not in _cache or mtime != _cache_mtime.get(user_key):
        try:
            _cache[user_key] = json.loads(path.read_text(encoding="utf-8"))
            _cache_mtime[user_key] = mtime
        except Exception as e:
            log_error(f"[ui_prefs] Read failed for {user_key}: {e}")
            _cache[user_key] = {}
            _cache_mtime[user_key] = 0.0
    return dict(_cache[user_key])


def _save_user(user_key: str, data: dict) -> None:
    """Atomic per-user write."""
    path = _shard_path(user_key)
    try:
        _SHARDS_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(path)
        _cache[user_key] = dict(data) if isinstance(data, dict) else {}
        _cache_mtime[user_key] = _mtime(path)
    except Exception as e:
        log_error(f"[ui_prefs] Write failed for {user_key}: {e}")


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
async def get_prefs(request: Request, user: dict = Depends(get_current_user)):
    key = _user_key(user)
    record_raw = await asyncio.to_thread(_load_user, key)
    # Backfill any missing fields with empty defaults so the client doesn't have
    # to special-case "key absent" vs "key present but empty".
    body = {**_empty_prefs(), **record_raw}
    return etag_response(request, body)


@router.put("/api/ui/prefs")
async def put_prefs(body: PrefsUpdate, user: dict = Depends(get_current_user)):
    key = _user_key(user)
    current = {**_empty_prefs(), **(await asyncio.to_thread(_load_user, key))}

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

    await asyncio.to_thread(_save_user, key, current)
    # VERBOSE not BASIC — every dashboard pin drag fires this; we only want
    # to see it when the user has explicitly opted into verbose.
    _bus.emit("settings", _VERBOSE, "ui_prefs_updated",
              user=key,
              fields=[f for f in ("pinnedShortcuts","quickControlIds","roomPhotos",
                                   "roomCustomPhotos","roomsOrder","theme")
                       if getattr(body, f) is not None])
    return current
