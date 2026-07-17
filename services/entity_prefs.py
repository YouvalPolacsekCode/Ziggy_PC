"""Per-entity UI preferences — the user's overrides on top of automatic device
grouping (services/device_groups).

Grouping decides the DEFAULT "one card per physical device" (its primary). These
prefs let the user curate:
  - is_tile : promote a non-primary sibling to its OWN tile (e.g. surface a
              sensor's temperature as a separate card alongside its presence).
  - hidden  : hide a device/tile entirely from the room grid (still reachable
              in the device's details).
  - icon    : a custom icon (emoji) for the tile.

Sparse + server-side: only entities the user has touched appear here, and it
lives on the hub so a phone reinstall / new device inherits the same choices.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Optional

_FILE = os.environ.get("ZIGGY_ENTITY_PREFS_PATH", "user_files/entity_prefs.json")
_lock = threading.Lock()
_cache: Optional[dict] = None
_UNSET = object()


def _load() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    try:
        with open(_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        _cache = data if isinstance(data, dict) else {}
    except Exception:
        _cache = {}
    return _cache


def _save(data: dict) -> None:
    global _cache
    _cache = data
    os.makedirs(os.path.dirname(_FILE) or ".", exist_ok=True)
    tmp = _FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, _FILE)


def get_all() -> dict:
    """entity_id → {is_tile?, hidden?, icon?}. Copy, safe to mutate."""
    with _lock:
        return {k: dict(v) for k, v in _load().items()}


def get_pref(entity_id: str) -> dict:
    if not entity_id:
        return {}
    with _lock:
        return dict(_load().get(entity_id, {}))


def set_pref(entity_id: str, *, is_tile=_UNSET, hidden=_UNSET, icon=_UNSET) -> dict:
    """Update one entity's prefs. Pass a value to set, None to clear that field,
    or omit to leave unchanged. Empty records are pruned so the file stays sparse."""
    if not entity_id:
        return {}
    with _lock:
        data = dict(_load())
        cur = dict(data.get(entity_id, {}))
        if is_tile is not _UNSET:
            if is_tile is None:
                cur.pop("is_tile", None)
            else:
                cur["is_tile"] = bool(is_tile)
        if hidden is not _UNSET:
            if hidden:
                cur["hidden"] = True
            else:
                cur.pop("hidden", None)
        if icon is not _UNSET:
            if icon:
                cur["icon"] = str(icon)[:16]
            else:
                cur.pop("icon", None)
        if cur:
            data[entity_id] = cur
        else:
            data.pop(entity_id, None)
        _save(data)
        return cur
