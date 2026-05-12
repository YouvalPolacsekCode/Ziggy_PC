from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.logger_module import log_info
from core.settings_loader import save_settings, settings
from services.ha_areas import (
    get_areas, create_area, delete_area, rename_area,
    assign_entity_to_area, assign_device_to_area, sync_device_area_to_ha,
)
from services.home_automation import get_all_states, get_state

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_IR_TYPE_TO_DOMAIN: dict[str, str] = {
    "tv":        "media_player",
    "soundbar":  "media_player",
    "projector": "media_player",
    "ac":        "climate",
    "fan":       "fan",
    "custom":    "switch",
}


def _enrich_devices_with_ha_state(devices: list[dict]) -> list[dict]:
    try:
        states = get_all_states()
        state_map = {s["entity_id"]: s for s in states}
    except Exception:
        state_map = {}

    # Build ha_entity_id → IR device map so HA entities can expose their linked remote
    try:
        from services.ir_manager import list_ir_devices as _list_ir
        _ir_by_ha_eid: dict[str, dict] = {}
        for _ir in _list_ir(enabled_only=False):
            _linked = _ir.get("ha_entity_id") or ""
            if _linked:
                _ir_by_ha_eid[_linked] = _ir
    except Exception:
        _ir_by_ha_eid = {}

    def _ir_snapshot(ir_data: dict) -> dict:
        """Compact IR device snapshot embedded in HA entity attributes."""
        return {
            "id":              ir_data.get("id"),
            "name":            ir_data.get("name"),
            "type":            ir_data.get("type"),
            "commands":        ir_data.get("commands") or {},
            "learned_commands":ir_data.get("learned_commands") or [],
            "capabilities":    ir_data.get("capabilities") or [],
            "sequences":       ir_data.get("sequences") or {},
            "assumed_state":   ir_data.get("assumed_state"),
            "ac_config":       ir_data.get("ac_config"),
            "ac_memory":       ir_data.get("ac_memory"),
        }

    enriched = []
    for d in devices:
        entry = dict(d)
        eid = d.get("entity_id")
        ir_id = d.get("ir_device_id")

        if eid and eid in state_map:
            # Normal HA entity with live state
            s = state_map[eid]
            attrs = dict(s.get("attributes", {}) or {})
            entry["ha_state"]      = s.get("state")
            entry["domain"]        = eid.split(".")[0]
            entry["friendly_name"] = attrs.get("friendly_name") or eid.split(".")[-1]
            entry["display_name"]  = attrs.get("friendly_name") or d.get("name") or eid.split(".")[-1]
            # Attach linked IR device snapshot so the room view can render IR controls
            if eid in _ir_by_ha_eid:
                attrs["_linkedIr"] = _ir_snapshot(_ir_by_ha_eid[eid])
            entry["ha_attributes"] = attrs

        elif ir_id and not eid:
            # Pure IR device — enrich from ir_manager
            try:
                from services.ir_manager import get_ir_device
                ir_data = get_ir_device(ir_id) or {}
            except Exception:
                ir_data = {}

            # Use linked HA entity state when available (more reliable than assumed)
            linked_eid = ir_data.get("ha_entity_id") or ""
            if linked_eid and linked_eid in state_map:
                raw = state_map[linked_eid].get("state", "unknown")
                ha_state = ("on" if raw in ("on", "playing", "idle", "paused")
                            else "off" if raw in ("off", "unavailable")
                            else "unknown")
            else:
                ha_state = ir_data.get("assumed_state") or "unknown"

            dtype = d.get("device_type", "custom")
            entry["domain"]        = _IR_TYPE_TO_DOMAIN.get(dtype, "switch")
            entry["ha_state"]      = ha_state
            entry["ha_attributes"] = {
                "_is_ir":           True,
                "_ir_device_id":    ir_id,
                "commands":         ir_data.get("commands") or {},
                "learned_commands": ir_data.get("learned_commands") or [],
                "assumed_state":    ir_data.get("assumed_state"),
                "ac_config":        ir_data.get("ac_config"),
                "ac_memory":        ir_data.get("ac_memory"),
                "capabilities":     ir_data.get("capabilities") or [],
                "brand":            ir_data.get("brand", ""),
                "sequences":        ir_data.get("sequences") or {},
            }
            entry["display_name"]  = ir_data.get("name") or d.get("name") or dtype
            entry["friendly_name"] = entry["display_name"]

        else:
            entry.setdefault("ha_state", None)
            entry.setdefault("ha_attributes", {})
            entry.setdefault("domain", (eid or "").split(".")[0] if eid else d.get("device_type"))
            entry.setdefault("display_name", d.get("name") or eid or "")

        enriched.append(entry)
    return enriched


def _refresh_device_registry():
    try:
        from services.device_registry import refresh
        import threading
        threading.Thread(target=refresh, daemon=True).start()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Debug
# ---------------------------------------------------------------------------

@router.get("/api/debug/registry")
async def debug_registry():
    import services.device_registry as dr
    try:
        if not dr._initialized:
            dr.init()
        devs = dr.get_all()
        rooms = {}
        for d in devs:
            r = d.get("room", "<none>")
            rooms[r] = rooms.get(r, 0) + 1
        return {"initialized": dr._initialized, "total": len(devs), "by_room": rooms}
    except Exception as e:
        return {"error": str(e), "initialized": dr._initialized}


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------

class DeviceUpsert(BaseModel):
    room: str
    type: str
    entity_id: str
    validate_ha: bool = True


@router.get("/api/devices")
async def get_devices():
    try:
        import services.device_registry as dr
        if not dr._initialized:
            dr.init()
        return {"devices": _enrich_devices_with_ha_state(dr.get_all())}
    except Exception:
        pass
    return {"devices": [
        {"room": room, "device_type": dtype, "entity_id": eid, "status": "unknown"}
        for room, dtypes in settings.get("device_map", {}).items()
        for dtype, eid in (dtypes or {}).items()
        if eid
    ]}


@router.post("/api/devices")
async def upsert_device(device: DeviceUpsert):
    room = device.room.lower().strip().replace(" ", "_")
    dtype = device.type.lower().strip()

    if device.validate_ha and device.entity_id:
        check = get_state(device.entity_id)
        if not check.get("ok"):
            raise HTTPException(status_code=422, detail=f"Entity '{device.entity_id}' not found in Home Assistant.")

    dm = settings.setdefault("device_map", {})
    dm.setdefault(room, {})[dtype] = device.entity_id
    save_settings(settings)
    log_info(f"[API] Device saved: {room}.{dtype} = {device.entity_id}")

    ha_sync = {"ok": True}
    if device.entity_id:
        ha_sync = await sync_device_area_to_ha(device.entity_id, room)
        if not ha_sync.get("ok"):
            log_info(f"[API] HA area sync skipped: {ha_sync.get('error')}")

    return {"ok": True, "message": f"Saved {room}.{dtype} → {device.entity_id}", "ha_sync": ha_sync}


@router.delete("/api/devices/{room}/{dtype}")
async def delete_device(room: str, dtype: str):
    dm = settings.get("device_map", {})
    if room not in dm or dtype not in dm[room]:
        raise HTTPException(status_code=404, detail="Device not found")
    del settings["device_map"][room][dtype]
    if not settings["device_map"][room]:
        del settings["device_map"][room]
    save_settings(settings)
    return {"ok": True, "message": f"Removed {room}.{dtype}"}


@router.get("/api/devices/validate")
async def validate_device_map():
    try:
        all_states = get_all_states()
        known_ids: set[str] = {e["entity_id"] for e in all_states}
        device_map: dict = settings.get("device_map", {})

        valid, missing = [], []
        for room, devices in device_map.items():
            for dtype, entity_id in devices.items():
                if not entity_id:
                    continue
                entry = {"room": room, "type": dtype, "entity_id": entity_id}
                (valid if entity_id in known_ids else missing).append(entry)

        return {
            "valid": valid,
            "missing": missing,
            "summary": {"total": len(valid) + len(missing), "valid": len(valid), "missing": len(missing)},
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------

class RoomCreate(BaseModel):
    name: str


@router.get("/api/rooms")
async def get_rooms():
    try:
        rooms = await get_areas()
        return {"rooms": rooms}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/api/rooms/all")
async def get_all_rooms():
    """Return every known room: HA areas (source=ha) UNION device-registry rooms (source=ziggy).

    Ziggy-native rooms exist only in the device registry — they were created before HA area
    integration or via legacy device_map YAML. They have no HA area_id, so HA entity assignment
    cannot be used for them; they exist purely as Ziggy-side labels (e.g. IR device rooms).
    """
    import services.device_registry as dr
    if not dr._initialized:
        dr.init()

    # HA areas — canonical rooms
    ha_rooms: list[dict] = []
    ha_area_ids: set[str] = set()
    try:
        ha_rooms = await get_areas()
        ha_area_ids = {r["id"] for r in ha_rooms}
    except Exception:
        pass

    # Ziggy-native rooms from device registry
    norm_to_ha: dict[str, dict] = {_norm_room_key(r["name"]): r for r in ha_rooms}
    ziggy_rooms: list[dict] = []
    seen_norms: set[str] = {_norm_room_key(r["name"]) for r in ha_rooms}

    for d in dr.get_all():
        room_raw = d.get("room")
        if not room_raw:
            continue
        norm = _norm_room_key(room_raw)
        if norm in seen_norms:
            continue
        seen_norms.add(norm)
        display = room_raw.replace("_", " ").title()
        ziggy_rooms.append({
            "id":     room_raw,
            "name":   display,
            "source": "ziggy",  # no HA area — Ziggy-only label
        })

    result = [
        {**r, "source": "ha"} for r in ha_rooms
    ] + sorted(ziggy_rooms, key=lambda x: x["name"])

    return {"rooms": result}


@router.post("/api/rooms")
async def create_room(body: RoomCreate):
    result = await create_area(body.name)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    log_info(f"[API] Room created in HA: {body.name}")
    return result


@router.delete("/api/rooms/{area_id}")
async def delete_room(area_id: str):
    result = await delete_area(area_id)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    log_info(f"[API] Room deleted from HA: {area_id}")
    return result


@router.patch("/api/rooms/{area_id}")
async def rename_room(area_id: str, body: RoomCreate):
    result = await rename_area(area_id, body.name)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    return result


def _norm_room_key(name: str) -> str:
    """Normalize a room name to a stable join key.

    Strips apostrophes and other punctuation so "Roni's Room" and "ronis_room"
    both hash to the same key regardless of how the name was stored.
    """
    import re
    slug = name.lower()
    slug = re.sub(r"[''`]", "", slug)          # strip apostrophes
    slug = re.sub(r"[^a-z0-9]+", "_", slug)    # replace any non-alphanumeric with _
    return slug.strip("_")


@router.get("/api/rooms/devices")
async def get_rooms_with_devices():
    import services.device_registry as dr
    if not dr._initialized:
        dr.init()

    try:
        ha_rooms = await get_areas()
    except Exception:
        ha_rooms = []

    # Index areas by both their normalized key AND their original id for robust lookup
    area_by_norm: dict[str, dict] = {}
    area_by_id: dict[str, dict] = {}
    for a in ha_rooms:
        area_by_norm[_norm_room_key(a["name"])] = a
        area_by_id[a["id"]] = a

    devices_raw = dr.get_all()
    devices = _enrich_devices_with_ha_state(devices_raw)

    room_devices: dict[str, list] = {}
    unclaimed = []
    for d in devices:
        room = d.get("room")
        if not room:
            unclaimed.append(d)
        else:
            # Normalize device room key the same way so apostrophes don't break the join
            room_devices.setdefault(_norm_room_key(room), []).append(d)

    all_room_keys = set(room_devices.keys()) | {_norm_room_key(a["name"]) for a in ha_rooms}
    rooms_out = []
    for room_key in sorted(all_room_keys):
        area = area_by_norm.get(room_key)
        rooms_out.append({
            "id":      area["id"]   if area else room_key,
            "name":    area["name"] if area else room_key.replace("_", " ").title(),
            "devices": room_devices.get(room_key, []),
        })

    return {"rooms": rooms_out, "unclaimed": unclaimed}


# ---------------------------------------------------------------------------
# HA entity area / device area assignment (device-management operations)
# ---------------------------------------------------------------------------

class EntityAreaPatch(BaseModel):
    area_id: Optional[str] = None


class DeviceAreaPatch(BaseModel):
    area_id: Optional[str] = None


@router.patch("/api/ha/entity/{entity_id:path}/area")
async def patch_entity_area(entity_id: str, body: EntityAreaPatch):
    result = await assign_entity_to_area(entity_id, body.area_id or None)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    _refresh_device_registry()
    return result


@router.patch("/api/ha/devices/{device_id}/area")
async def patch_device_area(device_id: str, body: DeviceAreaPatch):
    result = await assign_device_to_area(device_id, body.area_id or None)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    _refresh_device_registry()
    return result


# ---------------------------------------------------------------------------
# Ziggy-native room assignment (device registry, no HA sync needed)
# ---------------------------------------------------------------------------

class ZiggyRoomPatch(BaseModel):
    room: Optional[str] = None   # None = remove from all rooms


@router.patch("/api/registry/entity/{entity_id:path}/room")
async def patch_registry_entity_room(entity_id: str, body: ZiggyRoomPatch):
    """Assign a device to a Ziggy-native room (device registry only, no HA WebSocket).

    Used when the target room has source='ziggy' — i.e. it exists in Ziggy's device
    registry but not as an HA area. Creates or updates the registry entry.
    """
    import services.device_registry as dr
    if not dr._initialized:
        dr.init()

    new_room = body.room or None
    with dr._lock:
        found = False
        for d in dr._registry:
            if d.get("entity_id") == entity_id:
                d["room"] = new_room
                found = True
                break
        if not found:
            dr._registry.append({
                "room": new_room,
                "device_type": entity_id.split(".")[0] if "." in entity_id else "unknown",
                "entity_id": entity_id,
                "ir_device_id": None,
                "status": dr.CONNECTED,
                "name": entity_id,
            })
        dr._save_persistent(dr._registry)

    log_info(f"[API] Registry room updated: {entity_id} → {new_room!r}")
    return {"ok": True}
