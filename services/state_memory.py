"""
Tracks the last intentionally set state for controllable entities so Ziggy
can restore settings after power loss (physical switch off/on, brief outage).

Only domains with rich, user-configurable state are tracked (light, climate, fan).
The restore fires when HA reports an entity transitioning from 'unavailable' or
'unknown' directly to 'on' — the exact footprint of a smart bulb losing and
regaining power.
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Optional

STORE_FILE = "user_files/state_memory.json"

TRACKED_DOMAINS = {"light", "climate", "fan"}

# Keys that carry meaningful user-configured settings (not HA metadata)
_SETTING_KEYS: dict[str, set] = {
    "light":   {"brightness", "color_temp", "hs_color", "rgb_color", "effect", "white"},
    "climate": {"hvac_mode", "temperature", "fan_mode", "preset_mode", "humidity"},
    "fan":     {"percentage", "preset_mode", "oscillating", "direction"},
}


def _load() -> dict:
    if not os.path.exists(STORE_FILE):
        return {}
    with open(STORE_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
    with open(STORE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def record_service_call(entity_id: str, service: str, service_data: dict) -> None:
    """
    Record an intentional service call so its settings can be restored later.

    Merges new settings on top of any previously saved ones so that, e.g.,
    a brightness change followed by a colour change both survive.

    Passing service='turn_off' marks the entity as intentionally off, which
    suppresses restoration if it unexpectedly powers back on.
    """
    domain = entity_id.split(".")[0]
    if domain not in TRACKED_DOMAINS:
        return

    store = _load()
    current = store.get(entity_id, {})

    if service == "turn_off":
        store[entity_id] = {
            **current,
            "intentionally_off": True,
            "saved_at": datetime.now().isoformat(),
        }
        _save(store)
        return

    # Extract only meaningful settings; strip entity_id and HA plumbing keys.
    valid_keys = _SETTING_KEYS.get(domain, set())
    new_settings = {k: v for k, v in service_data.items() if k in valid_keys}

    if not new_settings and service not in ("turn_on",):
        return  # Nothing worth recording

    merged = {**current.get("settings", {}), **new_settings}
    store[entity_id] = {
        "settings": merged,
        "intentionally_off": False,
        "saved_at": datetime.now().isoformat(),
    }
    _save(store)


def get_restore_payload(entity_id: str) -> Optional[dict]:
    """
    Return the full turn_on payload needed to restore the entity's last
    known settings, or None if there is nothing useful to restore.
    """
    record = _load().get(entity_id)
    if not record:
        return None
    if record.get("intentionally_off"):
        return None
    settings = record.get("settings", {})
    if not settings:
        return None
    return {"entity_id": entity_id, **settings}
