"""
Virtual device registry — non-HA capabilities (YouTube, email, news, etc.)
instantiated as named devices with saved params, room assignment, and last-triggered state.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any, Optional

from services.capability_catalog import get_capability

VDEV_FILE = "user_files/virtual_devices.json"


# ── Persistence ───────────────────────────────────────────────────────────────

def _load() -> list[dict]:
    if not os.path.exists(VDEV_FILE):
        return []
    with open(VDEV_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(devices: list[dict]) -> None:
    os.makedirs(os.path.dirname(VDEV_FILE), exist_ok=True)
    with open(VDEV_FILE, "w", encoding="utf-8") as f:
        json.dump(devices, f, indent=2, ensure_ascii=False)


# ── CRUD ──────────────────────────────────────────────────────────────────────

def list_virtual_devices(room: Optional[str] = None, category: Optional[str] = None) -> list[dict]:
    devices = _load()
    if room:
        devices = [d for d in devices if d.get("room") == room]
    if category:
        devices = [d for d in devices if d.get("category") == category]
    return devices


def get_virtual_device(device_id: str) -> Optional[dict]:
    for d in _load():
        if d["id"] == device_id:
            return d
    return None


def create_virtual_device(
    name: str,
    capability: str,
    room: Optional[str] = None,
    default_params: Optional[dict] = None,
    enabled: bool = True,
) -> dict:
    meta = get_capability(capability)
    if not meta:
        raise ValueError(f"Unknown capability: {capability}")
    device = {
        "id": f"vd_{uuid.uuid4().hex[:10]}",
        "name": name.strip(),
        "capability": capability,
        "category": meta.get("category", "other"),
        "icon": meta.get("icon", "⚡"),
        "room": room,
        "default_params": default_params or {},
        "enabled": enabled,
        "last_triggered": None,
        "created": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    devices = _load()
    devices.append(device)
    _save(devices)
    return device


def update_virtual_device(device_id: str, updates: dict) -> Optional[dict]:
    devices = _load()
    for i, d in enumerate(devices):
        if d["id"] == device_id:
            allowed = {"name", "room", "default_params", "enabled", "icon"}
            for k, v in updates.items():
                if k in allowed:
                    devices[i][k] = v
            _save(devices)
            return devices[i]
    return None


def delete_virtual_device(device_id: str) -> bool:
    devices = _load()
    updated = [d for d in devices if d["id"] != device_id]
    if len(updated) == len(devices):
        return False
    _save(updated)
    return True


# ── Trigger ───────────────────────────────────────────────────────────────────

async def trigger_virtual_device(device_id: str, runtime_params: Optional[dict] = None) -> dict:
    """Dispatch the device's capability intent with merged params."""
    device = get_virtual_device(device_id)
    if not device:
        return {"ok": False, "message": f"Virtual device '{device_id}' not found."}
    if not device.get("enabled"):
        return {"ok": False, "message": f"Device '{device['name']}' is disabled."}

    from core.action_parser import handle_intent

    params = {**device.get("default_params", {}), **(runtime_params or {})}
    intent_result = {
        "intent": device["capability"],
        "params": params,
        "source": "virtual_device",
    }

    result = await handle_intent(intent_result)

    # Record last triggered time
    devices = _load()
    for d in devices:
        if d["id"] == device_id:
            d["last_triggered"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            break
    _save(devices)

    return result
