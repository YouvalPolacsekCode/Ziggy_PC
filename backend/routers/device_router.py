from __future__ import annotations

import asyncio
import threading
import time as _time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from pydantic import BaseModel

from core.errors import ErrorCode, ZiggyError, ha_unavailable
from core.logger_module import log_info
from core.debug_bus import bus as _bus, BASIC as _BASIC, VERBOSE as _VERBOSE
from core.settings_loader import save_settings, settings
from services.ha_areas import (
    get_areas, create_area, delete_area, rename_area,
    assign_entity_to_area, assign_device_to_area, sync_device_area_to_ha,
    invalidate_registry_cache, _ws,
)
from services.home_automation import get_all_states, get_state
from .auth_deps import require_role

router = APIRouter()

# Bucket-B promotions in PROMPT_SECURITY_HARDENING_V2:
# - Structural mutations (rooms CRUD, device registry CRUD, HA entity delete,
#   registry entity delete) require admin tier.
# - GET /api/debug/registry promoted to super_admin to align with the rest
#   of /api/debug/* gated in debug_router.
# - Reads, area-assignment patches, and entity-name rename stay at user.
# Per-handler emits with auth_added=True populate the 30-day audit window.

# ---------------------------------------------------------------------------
# /api/devices enrichment cache
# ---------------------------------------------------------------------------
#
# Dashboard, Devices page and Rooms page all hit /api/devices on focus and
# every WS bump. Without a cache, each hit triggers a full HA REST snapshot
# (get_all_states ~150-300 ms) plus an IR-device file walk. With a small
# TTL — long enough to coalesce a burst of concurrent fetches, short enough
# that the UI still feels live — we save those round-trips entirely.
#
# Live state still flows over WebSocket via state_changed events; the cache
# only governs how often a fresh enriched LIST is rebuilt for the REST
# fallback. 1.5 s gives the Dashboard ~6 cache misses/minute instead of one
# per fetch.
_ENRICH_TTL_S = 1.5
_enrich_lock = threading.Lock()
_enrich_cache: dict = {"ts": 0.0, "data": None, "key": None}


def _enrich_cache_key() -> tuple:
    """Cheap dependency signature so we can bust the cache on registry edits
    without timing them. Uses len() of the registry and the IR device count;
    any add/remove on either side will produce a different key."""
    try:
        import services.device_registry as dr
        registry_len = len(dr._registry) if dr._initialized else 0
    except Exception:
        registry_len = 0
    try:
        from services.ir_manager import list_ir_devices as _list_ir
        ir_len = len(_list_ir(enabled_only=False))
    except Exception:
        ir_len = 0
    return (registry_len, ir_len)


def _invalidate_enrich_cache() -> None:
    with _enrich_lock:
        _enrich_cache["ts"] = 0.0
        _enrich_cache["data"] = None
        _enrich_cache["key"] = None


def _get_enriched_devices() -> list[dict]:
    """Cached gateway to _enrich_devices_with_ha_state(dr.get_all()).

    Returns the same enriched list to every caller within the TTL window.
    Previously /api/devices, /api/devices/grouped and /api/rooms/devices each
    paid the full enrichment cost (state-map build + IR cross-index) — three
    independent rebuilds on every Dashboard fetchAll(). The cache key picks
    up registry/IR mutations; explicit mutations (upsert, area assign, etc.)
    also call _invalidate_enrich_cache().
    """
    import services.device_registry as dr
    if not dr._initialized:
        dr.init()
    now = _time.monotonic()
    key = _enrich_cache_key()
    with _enrich_lock:
        cached = _enrich_cache["data"]
        cached_key = _enrich_cache["key"]
        cached_ts = _enrich_cache["ts"]
        if cached is not None and cached_key == key and (now - cached_ts) < _ENRICH_TTL_S:
            return cached
    # Build outside the lock — concurrent misses may overlap on the work,
    # but the cost is bounded and the result is idempotent.
    enriched = _enrich_devices_with_ha_state(dr.get_all())
    with _enrich_lock:
        _enrich_cache["data"] = enriched
        _enrich_cache["key"] = key
        _enrich_cache["ts"] = _time.monotonic()
    return enriched


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_IR_TYPE_TO_DOMAIN: dict[str, str] = {
    "tv":        "media_player",
    "soundbar":  "media_player",
    "receiver":  "media_player",
    "projector": "media_player",
    "ac":        "climate",
    "fan":       "fan",
    "custom":    "switch",
}


def _enrich_devices_with_ha_state(devices: list[dict]) -> list[dict]:
    # WS-fed cache from ha_subscriber is continuously fresh — no need to pay
    # the 150-300 ms /api/states REST round-trip just to enrich device cards.
    # Fall back to the REST snapshot only when the WS cache hasn't populated
    # yet (the very first second of a cold boot).
    try:
        from services.ha_subscriber import state_cache
        if state_cache:
            state_map = state_cache
        else:
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

    # User tile/icon curation (B) — one read, applied per row below.
    try:
        from services import entity_prefs
        _prefs = entity_prefs.get_all()
    except Exception:
        _prefs = {}

    enriched = []
    for d in devices:
        entry = dict(d)
        eid = d.get("entity_id")
        ir_id = d.get("ir_device_id")
        _p = _prefs.get(eid or "", {})
        entry["is_tile"] = bool(_p.get("is_tile"))
        entry["hidden"]  = bool(_p.get("hidden"))
        entry["icon"]    = _p.get("icon")

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
        threading.Thread(target=refresh, daemon=True).start()
    except Exception:
        pass
    _invalidate_enrich_cache()


async def _sync_device_to_registry_room(device_id: str, area_id: str | None) -> None:
    """Mirror a completed HA device→area assignment into the Ziggy device registry.

    Called immediately after assign_device_to_area so the room is visible without
    waiting for the 60-second background reconciliation loop.
    Handles two cases:
      1. Entity already in registry (status=UNCLAIMED) — update its room field.
      2. Entity not yet tracked (registry refresh hasn't fired) — create the entry.
    """
    import re
    import services.device_registry as dr
    from services.ha_areas import _ws

    if not dr._initialized:
        return

    try:
        areas_res, entities_res = await _ws(
            {"type": "config/area_registry/list"},
            {"type": "config/entity_registry/list"},
        )
    except Exception as e:
        log_info(f"[API] _sync_device_to_registry_room WS failed: {e}")
        return

    # Resolve area_id → normalized room key (same logic as _norm_room_key)
    room_key: str | None = None
    if area_id:
        areas = {a["area_id"]: a for a in (areas_res.get("result") or [])}
        area = areas.get(area_id)
        if area:
            name = area["name"]
            slug = re.sub(r"[''`]", "", name.lower())
            room_key = re.sub(r"[^a-z0-9]+", "_", slug).strip("_")

    # Find all entities that belong to this HA device
    entity_ids = {
        e["entity_id"]
        for e in (entities_res.get("result") or [])
        if e.get("device_id") == device_id and e.get("entity_id")
    }
    if not entity_ids:
        return

    with dr._lock:
        existing_eids = {d.get("entity_id") for d in dr._registry if d.get("entity_id")}
        updated = 0
        for d in dr._registry:
            if d.get("entity_id") in entity_ids:
                d["room"] = room_key
                if room_key:
                    if d.get("status") in (dr.UNCLAIMED, dr.UNCONFIGURED):
                        d["status"] = dr.CONNECTED
                elif d.get("status") == dr.UNCLAIMED:
                    # Explicit "no room" — promote from unclaimed to connected
                    d["status"] = dr.CONNECTED
                updated += 1
        # Create entries for entities not yet tracked (registry refresh hasn't fired yet)
        for eid in entity_ids:
            if eid not in existing_eids:
                dr._registry.append({
                    "room":        room_key,
                    "device_type": eid.split(".")[0] if "." in eid else "unknown",
                    "entity_id":   eid,
                    "ir_device_id": None,
                    "status":      dr.CONNECTED if room_key else dr.UNCLAIMED,
                    "name":        eid,
                })
                updated += 1
        if updated:
            dr._save_persistent(dr._registry)
    log_info(f"[API] Registry room synced to '{room_key}' for {updated} entries (device {device_id})")


async def _sync_entity_to_registry_room(entity_id: str, area_id: str | None) -> None:
    """Sync a single entity's room in the device registry after an entity-level area assignment."""
    import re
    import services.device_registry as dr
    from services.ha_areas import _ws

    if not dr._initialized:
        return

    room_key: str | None = None
    if area_id:
        try:
            areas_res, = await _ws({"type": "config/area_registry/list"})
            areas = {a["area_id"]: a for a in (areas_res.get("result") or [])}
            area = areas.get(area_id)
            if area:
                name = area["name"]
                slug = re.sub(r"[''`]", "", name.lower())
                room_key = re.sub(r"[^a-z0-9]+", "_", slug).strip("_")
        except Exception as e:
            log_info(f"[API] _sync_entity_to_registry_room WS failed: {e}")
            return

    with dr._lock:
        found = False
        for d in dr._registry:
            if d.get("entity_id") == entity_id:
                d["room"] = room_key
                if room_key:
                    if d.get("status") in (dr.UNCLAIMED, dr.UNCONFIGURED):
                        d["status"] = dr.CONNECTED
                elif d.get("status") == dr.UNCLAIMED:
                    # Explicit "no room" — promote from unclaimed to connected
                    d["status"] = dr.CONNECTED
                found = True
                break
        if not found and room_key:
            dr._registry.append({
                "room":         room_key,
                "device_type":  entity_id.split(".")[0] if "." in entity_id else "unknown",
                "entity_id":    entity_id,
                "ir_device_id": None,
                "status":       dr.CONNECTED,
                "name":         entity_id,
            })
        dr._save_persistent(dr._registry)
    log_info(f"[API] Registry room synced to '{room_key}' for entity {entity_id}")


# ---------------------------------------------------------------------------
# Debug
# ---------------------------------------------------------------------------

@router.get("/api/debug/registry")
async def debug_registry(_user: dict = Depends(require_role("super_admin"))):
    _bus.emit("auth", _BASIC, "auth_promoted_route_called",
              route="GET /api/debug/registry",
              user=_user.get("username"), auth_added=True)
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
        raise ZiggyError(
            code=ErrorCode.INTERNAL_ERROR,
            log_message=f"debug_registry failed: {type(e).__name__}: {e}",
            details={"initialized": dr._initialized, "cause": repr(e)},
            cause=e,
        )


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------

class DeviceUpsert(BaseModel):
    room: str
    type: str
    entity_id: str
    validate_ha: bool = True


class TilePrefBody(BaseModel):
    entity_id: str
    is_tile: Optional[bool] = None   # promote a sibling to its own tile
    hidden: Optional[bool] = None    # hide the tile from the room grid
    icon: Optional[str] = None       # custom icon (emoji)
    clear_icon: bool = False


@router.post("/api/devices/tile")
async def set_tile_pref(body: TilePrefBody, _user: dict = Depends(require_role("admin"))):
    """User tile curation for one entity: promote to its own tile (is_tile),
    hide it (hidden), or set a custom icon. Omitted fields are left unchanged."""
    from services import entity_prefs
    kwargs: dict = {}
    if body.is_tile is not None:
        kwargs["is_tile"] = body.is_tile
    if body.hidden is not None:
        kwargs["hidden"] = body.hidden
    if body.clear_icon:
        kwargs["icon"] = None
    elif body.icon is not None:
        kwargs["icon"] = body.icon
    pref = entity_prefs.set_pref(body.entity_id, **kwargs)
    _invalidate_enrich_cache()
    return {"ok": True, "entity_id": body.entity_id, "pref": pref}


@router.get("/api/devices")
async def get_devices(request: Request):
    from backend.middleware.etag import etag_response
    try:
        body = {"devices": _get_enriched_devices()}
    except Exception:
        body = {"devices": [
            {"room": room, "device_type": dtype, "entity_id": eid, "status": "unknown"}
            for room, dtypes in settings.get("device_map", {}).items()
            for dtype, eid in (dtypes or {}).items()
            if eid
        ]}
    return etag_response(request, body)


@router.get("/api/devices/grouped")
async def get_devices_grouped():
    """Return devices grouped by HA device_id (one card per physical device).

    Each group surfaces a primary entity that drives the card's main state +
    controls, with the remaining sibling entities exposed as `entities[]`
    (metric / secondary / diagnostic). The flat /api/devices endpoint is
    untouched and remains the source for legacy/external consumers.

    Failure modes:
      - HA WS down → registry cache empty → every row becomes a "solo" group
        (matches the old card-per-entity behaviour for that fetch).
      - device_registry not initialised → triggered here, same as /api/devices.
    """
    from services.device_groups import build_groups, get_cached_registry_async

    # Shared enrichment cache with /api/devices and /api/rooms/devices —
    # Dashboard fetchAll() used to fire two parallel enrichment passes
    # (this endpoint + /api/rooms/devices) on every mount.
    enriched = _get_enriched_devices()
    registry = await get_cached_registry_async()
    groups = build_groups(enriched, registry)
    return {"groups": groups}


@router.post("/api/devices")
async def upsert_device(device: DeviceUpsert,
                        _user: dict = Depends(require_role("admin"))):
    _bus.emit("auth", _BASIC, "auth_promoted_route_called",
              route="POST /api/devices",
              user=_user.get("username"), auth_added=True)
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
    _bus.emit("settings", _BASIC, "device_map_updated",
              room=room, type=dtype, entity_id=device.entity_id, result="ok")

    ha_sync = {"ok": True}
    if device.entity_id:
        ha_sync = await sync_device_area_to_ha(device.entity_id, room)
        if not ha_sync.get("ok"):
            log_info(f"[API] HA area sync skipped: {ha_sync.get('error')}")

    _invalidate_enrich_cache()
    return {"ok": True, "message": f"Saved {room}.{dtype} → {device.entity_id}", "ha_sync": ha_sync}


@router.delete("/api/devices/{room}/{dtype}")
async def delete_device(room: str, dtype: str,
                        _user: dict = Depends(require_role("admin"))):
    _bus.emit("auth", _BASIC, "auth_promoted_route_called",
              route="DELETE /api/devices/{room}/{dtype}",
              user=_user.get("username"), auth_added=True)
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
        raise ZiggyError(
            code=ErrorCode.INTERNAL_ERROR,
            log_message=f"device-registry validate failed: {type(e).__name__}: {e}",
            details={"cause": repr(e)},
            cause=e,
        )


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------

class RoomCreate(BaseModel):
    name: str


@router.get("/api/rooms")
async def get_rooms(request: Request):
    from backend.middleware.etag import etag_response
    try:
        rooms = await get_areas()
        return etag_response(request, {"rooms": rooms})
    except Exception as e:
        raise ha_unavailable(e)


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

    # Resolver: any room reference (area_id / normalized area_id / normalized
    # name) → its HA area. A registry room that resolves to an HA area is NOT a
    # separate Ziggy-native room — this stops "Roni's Room" (area_id
    # "roni_s_room") appearing twice, once as the HA area and once as a titleized
    # "Roni S Room".
    ref_to_area: dict[str, dict] = {}
    for r in ha_rooms:
        ref_to_area[r["id"]] = r
        ref_to_area[_norm_room_key(r["id"])] = r
        ref_to_area[_norm_room_key(r["name"])] = r

    ziggy_rooms: list[dict] = []
    seen_ziggy: set[str] = set()
    for d in dr.get_all():
        room_raw = d.get("room")
        if not room_raw:
            continue
        if ref_to_area.get(room_raw) or ref_to_area.get(_norm_room_key(room_raw)):
            continue  # already an HA area
        norm = _norm_room_key(room_raw)
        if norm in seen_ziggy:
            continue
        seen_ziggy.add(norm)
        ziggy_rooms.append({
            "id":     room_raw,
            "name":   room_raw.replace("_", " ").title(),
            "source": "ziggy",  # no HA area — Ziggy-only label
        })

    result = [
        {**r, "source": "ha"} for r in ha_rooms
    ] + sorted(ziggy_rooms, key=lambda x: x["name"])

    return {"rooms": result}


@router.post("/api/rooms")
async def create_room(body: RoomCreate,
                      _user: dict = Depends(require_role("admin"))):
    _bus.emit("auth", _BASIC, "auth_promoted_route_called",
              route="POST /api/rooms",
              user=_user.get("username"), auth_added=True)
    result = await create_area(body.name)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    log_info(f"[API] Room created in HA: {body.name}")
    return result


@router.delete("/api/rooms/{area_id}")
async def delete_room(area_id: str,
                      _user: dict = Depends(require_role("admin"))):
    _bus.emit("auth", _BASIC, "auth_promoted_route_called",
              route="DELETE /api/rooms/{area_id}",
              user=_user.get("username"), auth_added=True)
    # Fetch area list BEFORE deleting so we can read entity membership and name.
    area_cache: list[dict] = []
    ha_area_exists = False
    try:
        area_cache = await get_areas()
        ha_area_exists = any(a.get("id") == area_id for a in area_cache)
    except Exception:
        pass

    # Delete from HA only if it actually exists there.
    # Ziggy-native rooms (source="ziggy") have no HA area — don't 502 on those.
    if ha_area_exists:
        result = await delete_area(area_id)
        if not result.get("ok"):
            err_msg = result.get("error", "")
            # "Not found" means already deleted — treat as success
            if "not found" not in err_msg.lower() and "does not exist" not in err_msg.lower():
                raise HTTPException(status_code=502, detail=err_msg or "HA error")

    # Always clean device-registry entries pointing to this room.
    # Matching strategy:
    #   1. Entity-ID overlap — catches duplicate slugs (e.g. roni_room + ronis_room
    #      both pointing to the same sensors).
    #   2. Slug match — catches IR-only rooms and any remaining slug variants.
    try:
        import services.device_registry as dr
        if dr._initialized:
            area_entity_ids: set[str] = set()
            area_name_str: str = area_id
            for a in area_cache:
                if a.get("id") == area_id:
                    area_entity_ids = set(a.get("entities") or [])
                    area_name_str = a.get("name", area_id)
                    break

            norm_ids = {_norm_room_key(area_id), _norm_room_key(area_name_str)}
            changed = 0
            with dr._lock:
                for d in dr._registry:
                    eid = d.get("entity_id") or ""
                    room_raw = d.get("room") or ""
                    if (eid and eid in area_entity_ids) or \
                       (room_raw and _norm_room_key(room_raw) in norm_ids):
                        d["room"] = None
                        changed += 1
                if changed:
                    dr._save_persistent(dr._registry)
            if changed:
                log_info(f"[API] Cleared room '{area_id}' from {changed} registry entries")
    except Exception as e:
        log_info(f"[API] Registry room cleanup failed for '{area_id}': {e}")

    log_info(f"[API] Room deleted: {area_id} (ha_existed={ha_area_exists})")
    return {"ok": True}


@router.patch("/api/rooms/{area_id}")
async def rename_room(area_id: str, body: RoomCreate,
                      _user: dict = Depends(require_role("admin"))):
    _bus.emit("auth", _BASIC, "auth_promoted_route_called",
              route="PATCH /api/rooms/{area_id}",
              user=_user.get("username"), auth_added=True)
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
    try:
        ha_rooms = await get_areas()
    except Exception:
        ha_rooms = []

    # Resolve ANY room reference — an HA area_id, a normalized area_id, or a
    # normalized area NAME — to its canonical HA area. This is what stops
    # "Roni's Room" splitting into two cards: the registry stores the room as the
    # area_id ("roni_s_room"), while the area NAME normalizes to "ronis_room"
    # (apostrophe stripped) — different strings that must map to the SAME area.
    area_by_id: dict[str, dict] = {}
    ref_to_area: dict[str, dict] = {}
    for a in ha_rooms:
        area_by_id[a["id"]] = a
        ref_to_area[a["id"]] = a
        ref_to_area[_norm_room_key(a["id"])] = a
        ref_to_area[_norm_room_key(a["name"])] = a

    def _canonical_room_key(room: str) -> str:
        a = ref_to_area.get(room) or ref_to_area.get(_norm_room_key(room))
        return a["id"] if a else _norm_room_key(room)

    # Shared enrichment cache with /api/devices and /api/devices/grouped.
    devices = _get_enriched_devices()

    room_devices: dict[str, list] = {}
    unclaimed = []   # status=UNCLAIMED — new HA entities not yet placed in Ziggy
    no_room   = []   # room=None, non-UNCLAIMED — intentionally left without a room
    for d in devices:
        room = d.get("room")
        if not room:
            if d.get("status") == "unclaimed":
                unclaimed.append(d)
            else:
                no_room.append(d)
        else:
            room_devices.setdefault(_canonical_room_key(room), []).append(d)

    all_room_keys = set(room_devices.keys()) | set(area_by_id.keys())
    rooms_out = []
    for room_key in sorted(all_room_keys):
        area = area_by_id.get(room_key)
        rooms_out.append({
            "id":      area["id"]   if area else room_key,
            "name":    area["name"] if area else room_key.replace("_", " ").title(),
            "devices": room_devices.get(room_key, []),
        })

    return {"rooms": rooms_out, "unclaimed": unclaimed, "no_room": no_room}


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
    # Sync room for this specific entity immediately
    try:
        await _sync_entity_to_registry_room(entity_id, body.area_id or None)
    except Exception as e:
        log_info(f"[API] Registry room sync failed for entity {entity_id}: {e}")
    _refresh_device_registry()
    return result


@router.patch("/api/ha/devices/{device_id}/area")
async def patch_device_area(device_id: str, body: DeviceAreaPatch):
    result = await assign_device_to_area(device_id, body.area_id or None)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    # Sync room into registry immediately so the Rooms page updates without waiting
    # for the 60-second background reconciliation loop.
    try:
        await _sync_device_to_registry_room(device_id, body.area_id or None)
    except Exception as e:
        log_info(f"[API] Registry room sync failed for device {device_id}: {e}")
    _refresh_device_registry()
    return result


@router.delete("/api/ha/entity/{entity_id:path}")
async def delete_ha_entity(entity_id: str, delete_device: bool = False,
                           _user: dict = Depends(require_role("admin"))):
    """Remove an entity from Home Assistant (and clean up Ziggy's registry).

    Maps to HA's "Delete" affordance in its UI. Useful for one-shot cleanup
    of a paired Zigbee/Z-Wave/etc. entity the user no longer wants — without
    having to flip between Ziggy and HA.

    When `delete_device=true`, every entity on the same HA device_id is
    removed (battery, signal_strength, diagnostic buttons, firmware update
    helpers — the lot), then the device's config_entries are dropped. This
    mirrors what a user means by "delete the door sensor": gone in one shot,
    not "delete one entity and leave 4 orphans behind."

    Per-entity invocation (`delete_device=false`) keeps only the named
    entity — for niche cases where the user wants to suppress just one
    helper on a multi-purpose device.

    The physical device itself is NOT unpaired from the radio — for Zigbee,
    the user should still re-pair / press the reset button if they want to
    use it elsewhere.

    Always also drops removed entities from Ziggy's device registry and from
    `settings.yaml`'s `device_map`, so nothing reappears as a ghost after
    the next refresh or restart.
    """
    _bus.emit("auth", _BASIC, "auth_promoted_route_called",
              route="DELETE /api/ha/entity/{entity_id:path}",
              user=_user.get("username"), auth_added=True)
    # 1) Look up the HA device_id + (optionally) the full entity list on it.
    device_id: str | None = None
    targets: list[str] = [entity_id]
    try:
        ent_res, = await _ws({"type": "config/entity_registry/list"})
        entity_entries = ent_res.get("result") or []
        match = next((e for e in entity_entries if e.get("entity_id") == entity_id), None)
        if not match:
            log_info(f"[API] delete_ha_entity: {entity_id} not in HA registry (already gone)")
        else:
            device_id = match.get("device_id")
        if delete_device and device_id:
            # Cascade scope: every entity HA has registered against this
            # device. Ordered with the user's chosen entity first so its
            # state_cache eviction and broadcast happen before any siblings
            # — slightly nicer UX if the frontend is rendering siblings.
            siblings = [
                e.get("entity_id") for e in entity_entries
                if e.get("device_id") == device_id and e.get("entity_id")
            ]
            targets = [entity_id] + [eid for eid in siblings if eid != entity_id]
    except Exception as e:
        log_info(f"[API] delete_ha_entity: HA registry lookup failed for {entity_id}: {e}")

    ha_removed = False        # at least one entity removed from HA
    ha_device_removed = False # parent device's config_entries removed
    entities_removed: list[str] = []
    try:
        from services.ha_subscriber import state_cache
    except Exception:
        state_cache = None

    # 2) Remove each target entity from HA + evict its state_cache row inline.
    for eid in targets:
        try:
            res, = await _ws({"type": "config/entity_registry/remove", "entity_id": eid})
            if res.get("success"):
                ha_removed = True
                entities_removed.append(eid)
                if state_cache is not None:
                    state_cache.pop(eid, None)
            else:
                err = (res.get("error") or {}).get("message", "")
                # "not_found" is fine — the entity may have been removed already.
                if "not_found" in err.lower() or "not found" in err.lower():
                    entities_removed.append(eid)
                    if state_cache is not None:
                        state_cache.pop(eid, None)
                else:
                    log_info(f"[API] delete_ha_entity: HA refused removal of {eid}: {err}")
        except Exception as e:
            log_info(f"[API] delete_ha_entity: WS remove failed for {eid}: {e}")

    # 3) When asked to remove the device too, drop its config_entries now
    #    that we've cleared every entity. HA refuses device removal while
    #    entities are still attached, hence the strict ordering.
    if delete_device and device_id:
        try:
            dev_res, = await _ws({"type": "config/device_registry/list"})
            target = next((d for d in (dev_res.get("result") or []) if d.get("id") == device_id), None)
            config_entries = (target or {}).get("config_entries") or []
            for ce in config_entries:
                try:
                    await _ws({
                        "type": "config/device_registry/remove_config_entry",
                        "device_id": device_id,
                        "config_entry_id": ce,
                    })
                    ha_device_removed = True
                except Exception as ce_err:
                    log_info(f"[API] delete_ha_entity: remove_config_entry failed ({device_id}/{ce}): {ce_err}")
        except Exception as e:
            log_info(f"[API] delete_ha_entity: device cleanup failed for {device_id}: {e}")

    # 4) Drop the Ziggy registry rows for every removed entity. Done even
    #    when HA refused (the user asked for it to be gone — don't strand
    #    them with a half-stuck device).
    try:
        import services.device_registry as dr
        if not dr._initialized:
            dr.init()
        wipe_set = set(entities_removed) or {entity_id}
        with dr._lock:
            before = len(dr._registry)
            dr._registry[:] = [d for d in dr._registry if d.get("entity_id") not in wipe_set]
            if before != len(dr._registry):
                dr._save_persistent(dr._registry)
    except Exception as e:
        log_info(f"[API] delete_ha_entity: registry cleanup failed for {entity_id}: {e}")

    # 5) Strip every removed entity from settings.yaml's `device_map` too.
    #    Without this, `_seed_from_yaml` re-adds them on the next Ziggy boot
    #    and the user's "deleted" device resurrects.
    for eid in (entities_removed or [entity_id]):
        try:
            _strip_entity_from_yaml_device_map(eid)
        except Exception as e:
            log_info(f"[API] delete_ha_entity: YAML cleanup failed for {eid}: {e}")

    # Bust the registry-snapshot cache AND the device-groups cache so the
    # next /api/devices, /api/rooms, /api/devices/grouped all see the
    # change instead of serving up to 60s of stale grouped data.
    if ha_removed or ha_device_removed:
        invalidate_registry_cache()
        try:
            from services.device_groups import invalidate_cache as _invalidate_groups
            _invalidate_groups()
        except Exception:
            pass
    _refresh_device_registry()
    log_info(
        f"[API] delete_ha_entity: {entity_id} done "
        f"(removed={len(entities_removed)} entities, ha={ha_removed}, device={ha_device_removed})"
    )
    return {
        "ok": True,
        "ha_removed": ha_removed,
        "ha_device_removed": ha_device_removed,
        "entities_removed": entities_removed,
    }


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
                if new_room:
                    if d.get("status") in (dr.UNCLAIMED, dr.UNCONFIGURED):
                        d["status"] = dr.CONNECTED
                elif d.get("status") == dr.UNCLAIMED:
                    d["status"] = dr.CONNECTED
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


def _strip_entity_from_yaml_device_map(entity_id: str) -> int:
    """Remove an entity_id from settings.yaml's `device_map`.

    Without this, every Ziggy restart re-seeds the entity from YAML via
    services.device_registry._seed_from_yaml — so the ghost the user just
    cleaned up comes back to haunt them on the next boot. Returns the
    number of (room, dtype) entries removed.
    """
    dm = settings.get("device_map") or {}
    removed = 0
    empty_rooms: list[str] = []
    for room, dtypes in dm.items():
        if not isinstance(dtypes, dict):
            continue
        for dtype, eid in list(dtypes.items()):
            if eid == entity_id:
                del dtypes[dtype]
                removed += 1
        if not dtypes:
            empty_rooms.append(room)
    for r in empty_rooms:
        del dm[r]
    if removed:
        settings["device_map"] = dm
        save_settings(settings)
        log_info(f"[API] Stripped {entity_id} from settings.yaml device_map ({removed} entries)")
    return removed


@router.delete("/api/registry/entity/{entity_id:path}")
async def delete_registry_entity(entity_id: str,
                                 _user: dict = Depends(require_role("admin"))):
    """Drop an entity from the Ziggy device registry.

    Intended use: the entity was deleted directly in Home Assistant, so
    Ziggy is holding a ghost row that no longer has live state. The detail
    page surfaces a "Remove from Ziggy" button that hits this endpoint to
    clean up the stale entry. No HA roundtrip — registry is authoritative
    for Ziggy-side membership.

    Also strips the entity from settings.yaml's `device_map` so the next
    Ziggy restart doesn't reseed it.

    Always returns ok=true; a missing entity is treated as success (idempotent).
    """
    _bus.emit("auth", _BASIC, "auth_promoted_route_called",
              route="DELETE /api/registry/entity/{entity_id:path}",
              user=_user.get("username"), auth_added=True)
    import services.device_registry as dr
    if not dr._initialized:
        dr.init()
    with dr._lock:
        before = len(dr._registry)
        dr._registry[:] = [d for d in dr._registry if d.get("entity_id") != entity_id]
        removed = before - len(dr._registry)
        if removed:
            dr._save_persistent(dr._registry)
    yaml_removed = _strip_entity_from_yaml_device_map(entity_id)
    log_info(f"[API] Registry entry deleted: {entity_id} (registry={removed}, yaml={yaml_removed})")
    return {"ok": True, "removed": removed, "yaml_removed": yaml_removed}


# ---------------------------------------------------------------------------
# Per-entity detail (device info, diagnostics, siblings, automations)
# ---------------------------------------------------------------------------

# Domains that are HA helpers/internals — excluded from sibling entity lists.
_DETAIL_SKIP_DOMAINS = frozenset({
    "button", "number", "select", "update", "text",
    "automation", "script", "scene", "timer", "counter",
    "input_select", "input_number", "input_text", "input_datetime", "input_button",
    "group", "zone", "sun", "stt", "tts", "conversation",
})


def _ghost_payload_from_registry(entity_id: str) -> dict | None:
    """Build a details-shaped payload from the Ziggy device registry for an
    entity that no longer exists in HA. Returns None when the entity isn't
    in the registry either (true 404).

    Goal: deleting a device directly in HA leaves Ziggy with a registry
    entry but no live HA state. Without this hook, the frontend hung on a
    blank details fetch. Now it gets a well-formed payload it can render as
    "Removed from Home Assistant" with a Clean-up action.
    """
    try:
        import services.device_registry as dr
        if not dr._initialized:
            dr.init()
        with dr._lock:
            entry = next(
                (d for d in dr._registry if d.get("entity_id") == entity_id),
                None,
            )
        if not entry:
            return None
        return {
            "entity_id":        entity_id,
            "domain":           entity_id.split(".", 1)[0] if "." in entity_id else entry.get("device_type"),
            "state":            "unavailable",
            "attributes":       {"friendly_name": entry.get("name") or entity_id},
            "last_changed":     None,
            "last_updated":     None,
            "domain_meta":      {},
            "ha_device":        {},
            "diagnostics":      {},
            "sibling_entities": [],
            "automations_using": [],
            "ghost":            True,
            "ghost_reason":     "removed_from_ha",
            "ghost_status":     entry.get("status") or "lost",
            "ghost_room":       entry.get("room"),
            "ghost_name":       entry.get("name") or entity_id,
        }
    except Exception as e:
        log_info(f"[EntityDetails] _ghost_payload_from_registry failed for {entity_id}: {e}")
        return None


@router.get("/api/ha/entity/{entity_id}/details")
async def entity_details(entity_id: str):
    """
    Rich detail for a single entity.

    Returns:
      state, attributes, domain_meta, ha_device (manufacturer/model/firmware),
      diagnostics (battery, signal, last_changed, last_seen),
      sibling_entities (other entities on the same physical device),
      automations_using (automations whose actions reference this entity).

    Note: entity_id must be passed URL-encoded when it contains dots
    (e.g. light.office → /api/ha/entity/light.office/details).
    No :path modifier is used because HA entity IDs never contain slashes.

    Perf: every call reads cached state from ha_subscriber.state_cache first
    (continuously updated via WS) — only the entity/device registry needs a
    live HA round-trip. The sibling-states fan-out now reads from the same
    cache instead of the full /api/states REST endpoint (was pulling 500+
    entities to look up <20).
    """
    import time as _time
    from services.ha_subscriber import state_cache

    t0 = _time.perf_counter()

    # ── 1. Read state from the WS cache (continuously updated). Fall back to
    #       one REST hit ONLY if the cache is cold for this entity — handles
    #       the brief window before the subscriber's snapshot completes on
    #       boot. Using the thread pool so even the fallback doesn't block
    #       the event loop. ────────────────────────────────────────────────
    cached = state_cache.get(entity_id)
    if cached is None:
        from services.home_automation import get_state
        rest = await asyncio.to_thread(get_state, entity_id)
        if not rest.get("ok"):
            msg = (rest.get("message") or "")
            is_404 = "404" in msg or "not_found" in msg.lower()
            # Ghost path: when HA doesn't have this entity but Ziggy's device
            # registry still does, return a 200 payload that flags it as
            # `ghost: true`. The frontend then renders a clear "removed from
            # HA" page with a Clean-up button, instead of hanging on a
            # silent fetch failure (which is what happens if the user deletes
            # a device directly in HA without touching Ziggy first).
            if is_404:
                ghost = _ghost_payload_from_registry(entity_id)
                if ghost:
                    elapsed_ms = round((_time.perf_counter() - t0) * 1000, 1)
                    log_info(f"[EntityDetails] {entity_id} is a ghost (in registry, not in HA) — returned in {elapsed_ms} ms")
                    return ghost
                raise HTTPException(status_code=404, detail=f"Entity '{entity_id}' not found in HA.")
            raise HTTPException(status_code=502, detail=msg or "HA unreachable")
        cached = {
            "state":        (rest["data"] or {}).get("state"),
            "attributes":   (rest["data"] or {}).get("attributes") or {},
            "last_changed": None,
        }

    attrs: dict = cached.get("attributes") or {}
    state_val: str = cached.get("state", "unknown")
    last_changed: Optional[str] = cached.get("last_changed")
    last_updated: Optional[str] = cached.get("last_updated") or cached.get("last_changed")

    # ── 2. Entity & device registry via WebSocket. The WS round trip
    #       dominates this endpoint's latency — keep the two registry calls in
    #       one batch so we pay one connection setup, not two. ──────────────
    ha_device: dict = {}
    sibling_ids: list[str] = []
    try:
        ent_res, dev_res = await _ws(
            {"type": "config/entity_registry/list"},
            {"type": "config/device_registry/list"},
        )
        entity_entries: list[dict] = ent_res.get("result") or []
        device_entries: dict = {d["id"]: d for d in (dev_res.get("result") or [])}

        this_entry = next((e for e in entity_entries if e.get("entity_id") == entity_id), None)
        device_id: Optional[str] = this_entry.get("device_id") if this_entry else None

        if device_id and device_id in device_entries:
            d = device_entries[device_id]
            ha_device = {
                "id":           device_id,
                "name":         d.get("name_by_user") or d.get("name") or "",
                "manufacturer": d.get("manufacturer") or "",
                "model":        d.get("model") or "",
                "sw_version":   d.get("sw_version") or "",
                "hw_version":   d.get("hw_version") or "",
            }
            sibling_ids = [
                e["entity_id"] for e in entity_entries
                if e.get("device_id") == device_id
                and e.get("entity_id") != entity_id
                and e.get("entity_id", "").split(".")[0] not in _DETAIL_SKIP_DOMAINS
            ]
    except Exception as e:
        log_info(f"[EntityDetails] WS registry fetch failed for {entity_id}: {e}")

    # ── 3. Sibling entity states — read from the WS cache directly, NOT
    #       through get_all_states() (which pulls 500+ entities over REST just
    #       to filter down to <20 siblings). The cache is at least as fresh. ──
    sibling_states: list[dict] = []
    for sid in sibling_ids[:20]:
        s = state_cache.get(sid)
        if not s:
            continue
        sa = s.get("attributes") or {}
        sibling_states.append({
            "entity_id":     sid,
            "domain":        sid.split(".")[0],
            "state":         s.get("state"),
            "device_class":  sa.get("device_class"),
            "unit":          sa.get("unit_of_measurement"),
            "friendly_name": sa.get("friendly_name") or sid,
            "last_changed":  s.get("last_changed"),
        })

    # ── 4. Diagnostics — from attrs + siblings ─────────────────────────────────
    battery: Optional[int] = None
    battery_unit = "%"
    lqi: Optional[int] = None
    rssi: Optional[int] = None
    last_seen: Optional[str] = attrs.get("last_seen")
    # last_changed already extracted from raw HA response above — no override needed

    # Try attributes first (many Zigbee devices embed these directly)
    for key in ("battery_level", "battery", "battery_percent"):
        if key in attrs:
            try:
                battery = int(attrs[key])
                break
            except (ValueError, TypeError):
                pass
    for key in ("lqi", "link_quality", "link_quality_index"):
        if key in attrs:
            try:
                lqi = int(attrs[key])
                break
            except (ValueError, TypeError):
                pass
    for key in ("rssi", "signal", "signal_strength"):
        if key in attrs:
            try:
                rssi = int(attrs[key])
                break
            except (ValueError, TypeError):
                pass

    # Supplement from sibling entities
    for sib in sibling_states:
        dc = sib.get("device_class")
        val = sib.get("state")
        if dc == "battery" and battery is None:
            try:
                battery = int(float(val))
                battery_unit = sib.get("unit") or "%"
            except (ValueError, TypeError):
                pass
        elif dc == "signal_strength" and rssi is None:
            try:
                rssi = int(float(val))
            except (ValueError, TypeError):
                pass

    diagnostics = {
        "battery": battery,
        "battery_unit": battery_unit,
        "lqi": lqi,
        "rssi": rssi,
        "last_changed": last_changed,
        "last_seen": last_seen,
        "firmware": ha_device.get("sw_version") or attrs.get("sw_version") or attrs.get("firmware"),
    }

    # ── 5. Automations referencing this entity. list_automations() does a
    #       sync `requests.get("/api/states")` against HA — wrap it in
    #       to_thread so the event loop stays responsive while HA replies. ──
    automations_using: list[dict] = []
    try:
        from services.ha_automations import list_automations
        autos = await asyncio.wait_for(asyncio.to_thread(list_automations), timeout=3.0)
        for auto in autos:
            actions = auto.get("actions") or []
            if any(a.get("entity_id") == entity_id for a in actions):
                automations_using.append({
                    "id": auto.get("id"),
                    "name": auto.get("name"),
                    "enabled": auto.get("enabled", True),
                })
    except Exception:
        # Soft-fail: empty list is better than blocking the page on HA hiccups.
        pass

    # ── 6. Domain metadata ────────────────────────────────────────────────────
    domain = entity_id.split(".")[0]
    domain_meta_raw: dict = {}
    try:
        from services.domain_registry import get as dr_get
        dm = dr_get(domain)
        if dm:
            domain_meta_raw = {
                "label": dm.label,
                "icon": dm.icon,
                "group": dm.group,
                "controllable": dm.controllable,
                "safety_level": dm.safety_level,
            }
    except Exception:
        pass

    # Lightweight perf log so we can spot regressions in the wild — slow
    # responses (>500 ms) almost always mean HA WS is slow, not Ziggy itself.
    elapsed_ms = round((_time.perf_counter() - t0) * 1000, 1)
    if elapsed_ms > 500:
        log_info(f"[EntityDetails] {entity_id} took {elapsed_ms} ms (slow — HA WS?)")

    return {
        "entity_id":        entity_id,
        "domain":           domain,
        "state":            state_val,
        "attributes":       attrs,
        "last_changed":     last_changed,
        "last_updated":     last_updated,
        "domain_meta":      domain_meta_raw,
        "ha_device":        ha_device,
        "diagnostics":      diagnostics,
        "sibling_entities": sibling_states,
        "automations_using":automations_using,
    }


# ---------------------------------------------------------------------------
# Dynamic command catalog — every HA command an entity supports, Ziggy-shaped.
# Used by the "More controls" panel on the device detail page and by the
# automation/routine builder when picking a device command action.
# ---------------------------------------------------------------------------

@router.get("/api/devices/{entity_id:path}/commands")
async def device_commands(entity_id: str):
    """Return the per-entity command catalog. See services/ha_capabilities.

    For hybrid devices (entity_id + ir_device_id linked), the IR codeset's
    learned commands are merged in so the FE can offer them alongside HA
    commands in one unified list.
    """
    from services.ha_capabilities import commands_for_entity, ensure_catalog_async
    # MUST warm via the async path. _ensure_catalog (sync) silently bails
    # when called inside a running event loop, leaving the catalog empty
    # and the response a useless [] — which is why "More Commands" panels
    # were vanishing for everyone.
    await ensure_catalog_async()
    cmds = commands_for_entity(entity_id)

    # Merge IR commands for hybrid devices — they appear as a separate "ir."
    # synthetic namespace so the executor can tell them apart.
    try:
        from services.device_registry import get_device_info
        from services.ir_manager import get_ir_device
        entry = get_device_info(entity_id) or {}
        ir_id = entry.get("ir_device_id")
        if ir_id:
            ir_dev = get_ir_device(ir_id) or {}
            ir_cmds = (ir_dev.get("commands") or {})
            for cmd_name in ir_cmds.keys():
                cmds.append({
                    "id":            f"ir.{cmd_name}",
                    "domain":        "ir",
                    "service":       cmd_name,
                    "label":         cmd_name.replace("_", " ").title(),
                    "description":   "IR command",
                    "fields":        [],
                    "target_domain": entity_id.split(".")[0],
                    "source":        "ir",
                })
    except Exception:
        pass

    return {"entity_id": entity_id, "commands": cmds}


class DeviceCommandBody(BaseModel):
    command_id: str       # "<domain>.<service>" or "ir.<command>"
    params: dict = {}
    prefer_source: Optional[str] = None  # "wifi" | "ir" — optional one-shot override


@router.post("/api/devices/{entity_id:path}/commands")
async def execute_device_command(
    entity_id: str,
    body: DeviceCommandBody,
    background_tasks: BackgroundTasks,
    request: Request,
):
    """Execute a dynamic command on an entity.

    Routing:
      - "ir.<cmd>" → IR blaster via services.ir_manager (requires linked IR device)
      - "<domain>.<service>" → HA service call (entity_id auto-bound to payload)

    HA calls for Wi-Fi devices (Switcher, Shelly, …) block until the device
    acks — 1-3s typical. We return immediately and run the actual call in
    the background; the real state arrives via the WS state_changed event.
    """
    import time as _time
    from services.device_registry import get_device_info

    # Inherit the request_id from the HTTP middleware so the click → API →
    # background HA call → state_changed ack all share one correlation id.
    req_id = getattr(request.state, "request_id", None)

    cmd_id = body.command_id or ""
    _bus.emit("device", _BASIC, "device_command_received",
              request_id=req_id,
              entity_id=entity_id, command_id=cmd_id,
              params=body.params, prefer_source=body.prefer_source)

    if not cmd_id:
        _bus.emit("device", _BASIC, "device_command_invalid",
                  request_id=req_id, entity_id=entity_id,
                  result="error", error="command_id missing")
        raise HTTPException(status_code=422, detail="command_id is required")

    # IR-namespaced command — route directly to the blaster (also fast).
    if cmd_id.startswith("ir."):
        from services.command_router import resolve_hybrid_entry
        base = get_device_info(entity_id) or {}
        entry = resolve_hybrid_entry(entity_id, base)
        ir_id = entry.get("ir_device_id")
        if not ir_id:
            _bus.emit("device", _BASIC, "device_command_no_ir_link",
                      request_id=req_id, entity_id=entity_id, command_id=cmd_id,
                      result="not_found",
                      suggestion="Link an IR codeset to this device or pick a Wi-Fi command.")
            raise HTTPException(status_code=404, detail="No IR codeset linked to this device.")

        ir_cmd = cmd_id[3:]
        _bus.emit("device", _VERBOSE, "device_command_routed",
                  request_id=req_id, entity_id=entity_id,
                  via="ir", ir_device=ir_id, ir_command=ir_cmd)

        def _ir_bg():
            from services.ir_manager import send_ir_command
            t0 = _time.perf_counter()
            try:
                res = send_ir_command(ir_id, ir_cmd)
                dur = round((_time.perf_counter() - t0) * 1000, 1)
                _bus.emit("device", _BASIC, "device_command_completed",
                          request_id=req_id, entity_id=entity_id,
                          via="ir", ir_device=ir_id, ir_command=ir_cmd,
                          duration_ms=dur,
                          result="ok" if (res or {}).get("ok") else "error",
                          message=(res or {}).get("message"))
            except Exception as e:
                dur = round((_time.perf_counter() - t0) * 1000, 1)
                _bus.emit("device", _BASIC, "device_command_failed",
                          request_id=req_id, entity_id=entity_id,
                          via="ir", duration_ms=dur,
                          error=str(e), error_type=type(e).__name__,
                          result="exception")
        background_tasks.add_task(_ir_bg)
        return {"ok": True, "_routed_via": "ir", "queued": True}

    # HA service command.
    if "." not in cmd_id:
        _bus.emit("device", _BASIC, "device_command_invalid",
                  request_id=req_id, entity_id=entity_id, command_id=cmd_id,
                  result="error", error="malformed command_id")
        raise HTTPException(status_code=422, detail=f"Invalid command_id '{cmd_id}'")
    domain, service = cmd_id.split(".", 1)
    payload = dict(body.params or {})
    payload["entity_id"] = entity_id

    _bus.emit("device", _VERBOSE, "device_command_routed",
              request_id=req_id, entity_id=entity_id,
              via="ha", domain=domain, service=service, payload=payload)

    def _ha_bg():
        from services.home_automation import call_service
        t0 = _time.perf_counter()
        try:
            res = call_service(domain, service, payload)
            dur = round((_time.perf_counter() - t0) * 1000, 1)
            _bus.emit("device", _BASIC, "device_command_completed",
                      request_id=req_id, entity_id=entity_id,
                      via="ha", domain=domain, service=service,
                      duration_ms=dur,
                      result="ok" if (res or {}).get("ok") else "error",
                      message=(res or {}).get("message"))
        except Exception as e:
            dur = round((_time.perf_counter() - t0) * 1000, 1)
            _bus.emit("device", _BASIC, "device_command_failed",
                      request_id=req_id, entity_id=entity_id,
                      via="ha", duration_ms=dur,
                      error=str(e), error_type=type(e).__name__,
                      result="exception")
    background_tasks.add_task(_ha_bg)
    return {"ok": True, "queued": True}


# ---------------------------------------------------------------------------
# Historical state for a single entity (used by the sensor chart on
# DeviceDetail). Wraps HA's /api/history/period/ endpoint and filters to
# numeric states only — non-numeric points (e.g. "unavailable") are dropped
# so the FE chart can render a clean line without per-point guards.
# ---------------------------------------------------------------------------

@router.get("/api/devices/{entity_id:path}/history")
async def entity_history(entity_id: str, hours: int = 24):
    import requests
    from datetime import datetime, timedelta, timezone
    from core.logger_module import log_error

    ha_url = settings.get("home_assistant", {}).get("url", "").rstrip("/")
    ha_tok = settings.get("home_assistant", {}).get("token", "")
    if not ha_url or not ha_tok:
        return {"points": [], "unit": None}

    # Clamp the window — protects against a misbehaving client asking for
    # weeks of data (HA history is expensive on the recorder DB).
    hours = max(1, min(int(hours or 24), 168))
    start = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    try:
        resp = requests.get(
            f"{ha_url}/api/history/period/{start}",
            headers={"Authorization": f"Bearer {ha_tok}"},
            params={
                "filter_entity_id": entity_id,
                "minimal_response": "true",
                "no_attributes": "false",
            },
            timeout=15,
        )
        if not resp.ok:
            return {"points": [], "unit": None}
        data = resp.json() or []
        series = data[0] if data else []
        points = []
        unit = None
        for item in series:
            try:
                v = float(item.get("state"))
            except (TypeError, ValueError):
                continue  # "unavailable", "unknown", strings — skip
            t = item.get("last_changed") or item.get("last_updated")
            if not t:
                continue
            points.append({"t": t, "v": v})
            attrs = item.get("attributes") or {}
            u = attrs.get("unit_of_measurement")
            if u:
                unit = u
        return {"points": points, "unit": unit}
    except Exception as e:
        log_error(f"[device_router] entity_history({entity_id}): {e}")
        return {"points": [], "unit": None}

