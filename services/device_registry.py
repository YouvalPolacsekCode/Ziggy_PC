"""
Unified in-memory device table.

Build order at startup:
  1. Load persistent model from user_files/device_registry.json
  2. Seed from YAML device_map (backward compat — deprecated entries logged)
  3. Merge IR virtual devices from ir_devices.json
  4. Validate against live HA entity states → assign connection status
  5. Start reconciliation loop (every 60 s)

Connection states:
  connected     — entity_id set, HA confirms it's live
  unclaimed     — entity exists in HA, not yet assigned to any Ziggy device
  unconfigured  — Ziggy device entry exists but entity_id is None
  lost          — was connected last session, entity_id now missing from HA
  ir_only       — IR virtual device, no HA entity expected
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Optional

from core.logger_module import log_info, log_error
from core.settings_loader import settings

REGISTRY_FILE = "user_files/device_registry.json"

CONNECTED    = "connected"
UNCLAIMED    = "unclaimed"
UNCONFIGURED = "unconfigured"
LOST         = "lost"
IR_ONLY      = "ir_only"

_registry: list[dict] = []
_lock = threading.Lock()
_initialized = False


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _load_persistent() -> list[dict]:
    if not os.path.exists(REGISTRY_FILE):
        return []
    try:
        with open(REGISTRY_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log_error(f"[DeviceRegistry] Failed to load {REGISTRY_FILE}: {e}")
        return []


def _save_persistent(devices: list[dict]) -> None:
    os.makedirs(os.path.dirname(REGISTRY_FILE), exist_ok=True)
    try:
        with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
            json.dump(devices, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log_error(f"[DeviceRegistry] Failed to save {REGISTRY_FILE}: {e}")


# ---------------------------------------------------------------------------
# Population
# ---------------------------------------------------------------------------

def _seed_from_yaml(devices: list[dict]) -> list[dict]:
    device_map = settings.get("device_map", {})
    existing = {(d["room"], d["device_type"]) for d in devices}
    added = 0
    for room, dtypes in device_map.items():
        for dtype, entity_id in (dtypes or {}).items():
            if not entity_id:
                continue
            if (room, dtype) not in existing:
                devices.append({
                    "room": room,
                    "device_type": dtype,
                    "entity_id": entity_id,
                    "ir_device_id": None,
                    "status": UNCONFIGURED,
                    "name": f"{room} {dtype}".replace("_", " ").title(),
                })
                existing.add((room, dtype))
                added += 1
    if added:
        log_info(
            f"[DeviceRegistry] Seeded {added} devices from YAML device_map "
            "(deprecated — configure devices via Ziggy UI)"
        )
    return devices


def _merge_ir_devices(devices: list[dict]) -> list[dict]:
    try:
        from services.ir_manager import list_ir_devices
        existing = {(d["room"], d["device_type"]) for d in devices}
        for ir in list_ir_devices(enabled_only=False):
            room = ir.get("room")
            dtype = ir.get("type")
            key = (room, dtype)
            if key not in existing:
                devices.append({
                    "room": room,
                    "device_type": dtype,
                    "entity_id": None,
                    "ir_device_id": ir["id"],
                    "status": IR_ONLY,
                    "name": ir.get("name", f"{room} {dtype}"),
                })
                existing.add(key)
    except Exception as e:
        log_error(f"[DeviceRegistry] Failed to merge IR devices: {e}")
    return devices


# ---------------------------------------------------------------------------
# Reconciliation
# ---------------------------------------------------------------------------

def _live_entity_ids() -> set[str]:
    try:
        from services.home_automation import get_all_states
        return {s["entity_id"] for s in get_all_states()}
    except Exception as e:
        log_error(f"[DeviceRegistry] Could not fetch HA states: {e}")
        return set()


def _reconcile(devices: list[dict], live_ids: set[str]) -> list[dict]:
    if not live_ids:
        return devices
    for d in devices:
        if d.get("ir_device_id") and not d.get("entity_id"):
            d["status"] = IR_ONLY
            continue
        eid = d.get("entity_id")
        if not eid:
            d["status"] = UNCONFIGURED
            continue
        d["status"] = CONNECTED if eid in live_ids else LOST
    return devices


def _add_unclaimed(devices: list[dict], live_ids: set[str]) -> list[dict]:
    if not live_ids:
        return devices
    try:
        from services.entity_filter import filter_entities
        from services.home_automation import get_all_states
        states = filter_entities(get_all_states())
        filtered_ids = {s["entity_id"] for s in states}
    except Exception as e:
        log_error(f"[DeviceRegistry] Unclaimed scan failed: {e}")
        return devices

    claimed = {d["entity_id"] for d in devices if d.get("entity_id")}
    existing_unclaimed = {d["entity_id"] for d in devices if d["status"] == UNCLAIMED}

    for eid in filtered_ids:
        if eid in claimed or eid in existing_unclaimed:
            continue
        devices.append({
            "room": None,
            "device_type": eid.split(".")[0],
            "entity_id": eid,
            "ir_device_id": None,
            "status": UNCLAIMED,
            "name": eid,
        })
    return devices


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def init() -> None:
    """Populate the device table. Safe to call multiple times — idempotent."""
    global _registry, _initialized
    with _lock:
        devices = _load_persistent()
        devices = _seed_from_yaml(devices)
        devices = _merge_ir_devices(devices)
        live_ids = _live_entity_ids()
        devices = _reconcile(devices, live_ids)
        devices = _add_unclaimed(devices, live_ids)
        _save_persistent(devices)
        _registry = devices
        _initialized = True
    log_info(f"[DeviceRegistry] Initialized with {len(_registry)} devices")


def refresh() -> None:
    """Re-reconcile against live HA. Call after any device/room change."""
    global _registry
    with _lock:
        live_ids = _live_entity_ids()
        _registry = _reconcile(list(_registry), live_ids)
        _registry = _add_unclaimed(_registry, live_ids)
        _save_persistent(_registry)
    log_info("[DeviceRegistry] Refreshed")


def get_entity(room: str, device_type: str) -> Optional[str]:
    """Return entity_id for a connected device, or None. Logs the reason if missing."""
    room_norm = (room or "").lower().replace(" ", "_").strip()
    dtype_norm = (device_type or "").lower().strip()
    with _lock:
        for d in _registry:
            if d.get("room") == room_norm and d.get("device_type") == dtype_norm:
                if d["status"] == CONNECTED:
                    return d["entity_id"]
                if d["status"] == LOST:
                    log_error(
                        f"[DeviceRegistry] {room_norm}.{dtype_norm} is lost "
                        f"(entity '{d['entity_id']}' removed from HA)"
                    )
                elif d["status"] == UNCONFIGURED:
                    log_error(f"[DeviceRegistry] {room_norm}.{dtype_norm} has no entity_id assigned")
                return None
    return None


def get_ir_device_id(room: str, device_type: str) -> Optional[str]:
    """Return the IR device id for a room + device_type, or None."""
    room_norm = (room or "").lower().replace(" ", "_").strip()
    dtype_norm = (device_type or "").lower().strip()
    with _lock:
        for d in _registry:
            if (
                d.get("room") == room_norm
                and d.get("device_type") == dtype_norm
                and d["status"] == IR_ONLY
            ):
                return d.get("ir_device_id")
    return None


def get_status(room: str, device_type: str) -> Optional[str]:
    room_norm = (room or "").lower().replace(" ", "_").strip()
    dtype_norm = (device_type or "").lower().strip()
    with _lock:
        for d in _registry:
            if d.get("room") == room_norm and d.get("device_type") == dtype_norm:
                return d["status"]
    return None


def get_all() -> list[dict]:
    with _lock:
        return list(_registry)


def get_all_for_room(room: str) -> list[dict]:
    room_norm = (room or "").lower().replace(" ", "_").strip()
    with _lock:
        return [d for d in _registry if d.get("room") == room_norm]


# ---------------------------------------------------------------------------
# Background reconciliation loop
# ---------------------------------------------------------------------------

def start_reconciliation_loop(interval_s: int = 60) -> threading.Thread:
    def _loop():
        while True:
            time.sleep(interval_s)
            try:
                refresh()
            except Exception as e:
                log_error(f"[DeviceRegistry] Reconciliation loop error: {e}")

    t = threading.Thread(target=_loop, name="DeviceRegistryReconcile", daemon=True)
    t.start()
    return t
