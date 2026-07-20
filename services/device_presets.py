"""Named, user-facing saved positions ("presets") per controllable device.

A preset is a still position — a captured brightness + colour the user can
recall in one tap from the device card. This is deliberately SEPARATE from
services/state_memory.py: that one keeps a single hidden slot per device for
power-loss auto-restore; this keeps the user's named list.

Home-scoped (shared by the household), stored as one JSON file keyed by
entity_id. Pure logic — no Home Assistant calls here; applying a preset is done
by the caller via the normal turn_on service path.

Store shape:
    { "light.kitchen": [ {"id", "name", "settings", "saved_at"}, ... ], ... }

`settings` only ever holds the sanitised keys in _ALLOWED_KEYS.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Optional

STORE_FILE = "user_files/device_presets.json"

# A light preset never grows beyond this — keeps the card row tidy.
MAX_PRESETS_PER_ENTITY = 6

_MAX_NAME_LEN = 40

# Only these settings are meaningful for a light position. Anything else the
# frontend sends (entity_id, effect, HA plumbing) is dropped.
_ALLOWED_KEYS = {"brightness_pct", "color_temp_kelvin", "rgb_color"}

# A "look" the caller already asked for. If a light turn_on carries ANY of these,
# the caller has an explicit intent, so a default preset must NOT override it.
_LOOK_KEYS = {
    "brightness", "brightness_pct", "brightness_step", "brightness_step_pct",
    "color_temp", "color_temp_kelvin", "rgb_color", "rgbw_color", "rgbww_color",
    "hs_color", "xy_color", "color_name", "white", "effect", "flash",
}


class PresetLimitError(Exception):
    """Raised when an entity already holds MAX_PRESETS_PER_ENTITY presets."""


def _load() -> dict:
    if not os.path.exists(STORE_FILE):
        return {}
    try:
        with open(STORE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
    with open(STORE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def _clean_name(name: str) -> str:
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("preset name must not be empty")
    return cleaned[:_MAX_NAME_LEN]


def _sanitize_settings(settings: dict) -> dict:
    if not isinstance(settings, dict):
        raise ValueError("settings must be an object")

    out: dict = {}

    bri = settings.get("brightness_pct")
    if bri is None:
        raise ValueError("brightness_pct is required")
    try:
        bri = int(bri)
    except (TypeError, ValueError):
        raise ValueError("brightness_pct must be an integer")
    if not 1 <= bri <= 100:
        raise ValueError("brightness_pct must be between 1 and 100")
    out["brightness_pct"] = bri

    if "color_temp_kelvin" in settings and settings["color_temp_kelvin"] is not None:
        try:
            kelvin = int(settings["color_temp_kelvin"])
        except (TypeError, ValueError):
            raise ValueError("color_temp_kelvin must be an integer")
        if not 1000 <= kelvin <= 10000:
            raise ValueError("color_temp_kelvin out of range")
        out["color_temp_kelvin"] = kelvin

    if "rgb_color" in settings and settings["rgb_color"] is not None:
        rgb = settings["rgb_color"]
        if (not isinstance(rgb, (list, tuple)) or len(rgb) != 3
                or not all(isinstance(c, int) and 0 <= c <= 255 for c in rgb)):
            raise ValueError("rgb_color must be three bytes (0-255)")
        out["rgb_color"] = list(rgb)

    return out


def list_presets(entity_id: str) -> list[dict]:
    """Return the entity's presets (oldest-saved first), or [] if none."""
    return _load().get(entity_id, [])


def add_preset(entity_id: str, name: str, settings: dict) -> dict:
    """Save a new named position for entity_id and return it.

    Raises ValueError on a bad name/settings, PresetLimitError when the entity
    is already at MAX_PRESETS_PER_ENTITY.
    """
    clean_name = _clean_name(name)
    clean_settings = _sanitize_settings(settings)

    store = _load()
    presets = store.get(entity_id, [])
    if len(presets) >= MAX_PRESETS_PER_ENTITY:
        raise PresetLimitError(
            f"{entity_id} already has {MAX_PRESETS_PER_ENTITY} presets")

    preset = {
        "id": uuid.uuid4().hex[:12],
        "name": clean_name,
        "settings": clean_settings,
        "is_default": False,
        "saved_at": datetime.now().isoformat(),
    }
    presets.append(preset)
    store[entity_id] = presets
    _save(store)
    return preset


def rename_preset(entity_id: str, preset_id: str, name: str) -> dict:
    """Rename a preset in place and return it. Raises KeyError if not found."""
    clean_name = _clean_name(name)
    store = _load()
    for preset in store.get(entity_id, []):
        if preset["id"] == preset_id:
            preset["name"] = clean_name
            _save(store)
            return preset
    raise KeyError(preset_id)


def delete_preset(entity_id: str, preset_id: str) -> bool:
    """Delete a preset. Returns True if one was removed, False if not found.

    Deleting the default simply leaves the entity with no default (the flag
    goes away with the preset).
    """
    store = _load()
    presets = store.get(entity_id, [])
    remaining = [p for p in presets if p["id"] != preset_id]
    if len(remaining) == len(presets):
        return False
    if remaining:
        store[entity_id] = remaining
    else:
        store.pop(entity_id, None)
    _save(store)
    return True


# ── Default preset ──────────────────────────────────────────────────────────
# At most one preset per entity carries is_default=True. When it's set, a bare
# turn_on (no explicit look) wakes the light in that preset — including after a
# power cut. See resolve_default_turn_on() and the turn_on/restore call sites.

def set_default(entity_id: str, preset_id: str) -> dict:
    """Make preset_id the entity's default (clearing any previous default).

    Returns the new default preset. Raises KeyError if the preset is unknown.
    """
    store = _load()
    presets = store.get(entity_id, [])
    found = None
    for p in presets:
        p["is_default"] = (p["id"] == preset_id)
        if p["is_default"]:
            found = p
    if found is None:
        raise KeyError(preset_id)
    _save(store)
    return found


def clear_default(entity_id: str) -> bool:
    """Remove the entity's default, if any. Returns True if one was cleared."""
    store = _load()
    changed = False
    for p in store.get(entity_id, []):
        if p.get("is_default"):
            p["is_default"] = False
            changed = True
    if changed:
        _save(store)
    return changed


def get_default(entity_id: str) -> Optional[dict]:
    """Return the entity's default preset, or None."""
    for p in _load().get(entity_id, []):
        if p.get("is_default"):
            return p
    return None


def resolve_default_turn_on(entity_id: str, provided: Optional[dict]) -> dict:
    """Settings to merge into a light turn_on so it wakes in its default preset.

    Returns {} (no override) when: the entity isn't a light, the caller already
    specified a look (any _LOOK_KEYS present), or there is no default. Otherwise
    returns a copy of the default preset's settings.
    """
    if not isinstance(entity_id, str) or entity_id.split(".")[0] != "light":
        return {}
    if any(k in (provided or {}) for k in _LOOK_KEYS):
        return {}
    default = get_default(entity_id)
    return dict(default["settings"]) if default else {}
