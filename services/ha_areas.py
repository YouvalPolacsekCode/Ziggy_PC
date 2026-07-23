"""
HA Area Registry — all operations via WebSocket (template API blocks .append in newer HA).
"""
from __future__ import annotations
import asyncio
import time

from core.logger_module import log_error, log_info
from services.ha_client import ws as _ws  # short-lived WS helper lives in ha_client now

# _ws is re-exported so existing importers (ha_zigbee, ha_pairing, ha_flow_driver,
# ha_capabilities) keep working without churn.


# ─── Registry snapshot cache ─────────────────────────────────────────────────
# Areas, the device registry, and the entity registry are mutated only when
# the user (or an integration) touches HA's config. In Ziggy's workload they
# change minute-to-day, but get_areas() / sync_device_area_to_ha() / pairing
# code were re-fetching the full triple on every endpoint call — meaning a
# single user action like "force refresh" fired N parallel fresh-handshake
# WebSocket sessions to HA and reliably triggered the timeouts you saw in
# the logs.
#
# Cache the triple with a short TTL, share one in-flight fetch across
# concurrent callers, and invalidate when a write hits.
_REGISTRY_TTL_S = 15.0
_registry_cache: dict | None = None       # {"areas": [...], "devices": [...], "entities": [...]}
_registry_cached_at: float = 0.0
_registry_inflight: asyncio.Future | None = None
_registry_lock = asyncio.Lock()


def _registry_fresh() -> bool:
    return _registry_cache is not None and (time.time() - _registry_cached_at) < _REGISTRY_TTL_S


def invalidate_registry_cache() -> None:
    """Drop the registry snapshot so the next read pulls fresh from HA.
    Call after any operation that mutates areas/devices/entities.

    Also flushes downstream caches that derive from this snapshot
    (device_groups builds its own group index) so consumers don't see
    a fresh entity registry alongside a stale grouping decision.
    """
    global _registry_cache, _registry_cached_at
    _registry_cache = None
    _registry_cached_at = 0.0
    try:
        from services.device_groups import invalidate_cache as _invalidate_groups
        _invalidate_groups()
    except Exception:
        pass


async def _fetch_registry_snapshot() -> dict:
    """Pull areas + device + entity registry lists in ONE WS session."""
    areas_res, devices_res, entities_res = await _ws(
        {"type": "config/area_registry/list"},
        {"type": "config/device_registry/list"},
        {"type": "config/entity_registry/list"},
    )
    return {
        "areas":    areas_res.get("result") or [],
        "devices":  devices_res.get("result") or [],
        "entities": entities_res.get("result") or [],
    }


async def get_registry_snapshot(force: bool = False) -> dict:
    """Return the cached HA registry triple. Single fetch shared by all
    concurrent callers; populated on first miss; refreshed on TTL expiry."""
    global _registry_cache, _registry_cached_at, _registry_inflight
    if not force and _registry_fresh():
        return _registry_cache

    async with _registry_lock:
        # Recheck inside the lock — another waiter may have populated it.
        if not force and _registry_fresh():
            return _registry_cache
        if _registry_inflight is not None and not _registry_inflight.done():
            # In-flight from before we grabbed the lock — await its result.
            try:
                return await _registry_inflight
            except Exception:
                pass

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        _registry_inflight = fut

    try:
        snap = await _fetch_registry_snapshot()
        _registry_cache = snap
        _registry_cached_at = time.time()
        fut.set_result(snap)
        return snap
    except Exception as e:
        fut.set_exception(e)
        # Last-resort: if we have a stale cache, hand it back instead of
        # blowing up the page. The next call after TTL will retry.
        if _registry_cache is not None:
            log_info(f"[HA Areas] registry fetch failed ({e}); serving stale snapshot")
            return _registry_cache
        raise
    finally:
        _registry_inflight = None


async def get_areas() -> list:
    """Return [{id, name, entities: [entity_id, ...]}, ...]"""
    try:
        snap = await get_registry_snapshot()
        areas_res    = {"result": snap["areas"]}
        devices_res  = {"result": snap["devices"]}
        entities_res = {"result": snap["entities"]}
        area_map: dict = {}
        for area in (areas_res.get("result") or []):
            area_map[area["area_id"]] = {
                "id": area["area_id"],
                "name": area["name"],
                "entities": [],
            }

        # Build device_id → area_id map (area can be on the device, not the entity)
        device_area: dict = {}
        for device in (devices_res.get("result") or []):
            if device.get("area_id"):
                device_area[device["id"]] = device["area_id"]

        for entity in (entities_res.get("result") or []):
            eid = entity.get("entity_id")
            if not eid:
                continue
            # Entity-level area takes precedence; fall back to device-level area
            aid = entity.get("area_id") or device_area.get(entity.get("device_id"))
            if aid and aid in area_map:
                area_map[aid]["entities"].append(eid)

        return sorted(area_map.values(), key=lambda x: x["name"])
    except Exception as e:
        log_error(f"[HA Areas] get_areas: {e}")
        raise  # propagate — server.py converts to 502


def resolve_room_name(room_id: str | None, name_by_id: dict[str, str]) -> str | None:
    """Human room label for an anomaly/alert `room_id`.

    Anomalies bucket by HA area_id; entity-scoped rules on a device with NO
    area fall back to the raw entity_id (contains a ".") — that must never be
    shown as a room (it would leak entity_ids like
    'binary_sensor.0xa4c138…contact'). Home-scoped rules use "home".

    Returns the HA area's real display name (e.g. "Roni's Room"), or None when
    the room_id is home-scoped, an entity_id form, or an unknown area — callers
    render None as 'No Room' / 'Home', never the raw id.
    """
    if not room_id or room_id == "home":
        return None
    if "." in room_id:
        return None
    return name_by_id.get(room_id)


async def get_area_name_map() -> dict[str, str]:
    """{area_id → display name} from the registry (single source of truth for
    room names). Verbatim HA names, so "Roni's Room" stays correct."""
    try:
        areas = await get_areas()
        return {a["id"]: a["name"] for a in areas}
    except Exception:
        return {}


async def create_area(name: str) -> dict:
    try:
        res, = await _ws({"type": "config/area_registry/create", "name": name})
        if res.get("success"):
            invalidate_registry_cache()
            return {"ok": True, "area": res.get("result", {})}
        return {"ok": False, "error": res.get("error", {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] create_area: {e}")
        return {"ok": False, "error": str(e)}


async def delete_area(area_id: str) -> dict:
    try:
        res, = await _ws({"type": "config/area_registry/delete", "area_id": area_id})
        if res.get("success"):
            invalidate_registry_cache()
            return {"ok": True}
        return {"ok": False, "error": res.get("error", {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] delete_area: {e}")
        return {"ok": False, "error": str(e)}


def _norm_area(s: str | None) -> str:
    """Loose key so 'living_room', 'Living Room' and 'living room' all match."""
    return "".join(ch for ch in (s or "").strip().lower().replace("_", " ").split())


async def _resolve_or_create_area(area_token: str) -> str:
    """Map an area token to a REAL HA area_id, creating the area if needed.

    The Devices/Rooms UI can hand us a *ghost room* slug (e.g. 'living_room')
    that was only ever inferred from device names and has NO HA area behind it.
    HA's entity_registry/update accepts an unknown area_id (returns success) but
    creates no area — so the entity ends up pointing at a phantom room and shows
    as unassigned everywhere. To make assignment actually stick we ensure a real
    area exists first: return it if the id already exists, reuse an existing area
    whose id/name matches, else create one from the slug.
    """
    snap = await get_registry_snapshot()
    areas = snap.get("areas") or []
    if any(a.get("area_id") == area_token for a in areas):
        return area_token
    norm = _norm_area(area_token)
    for a in areas:
        if _norm_area(a.get("area_id")) == norm or _norm_area(a.get("name")) == norm:
            return a.get("area_id")
    display = area_token.replace("_", " ").title()
    res = await create_area(display)
    new_id = (res.get("area") or {}).get("area_id")
    if res.get("ok") and new_id:
        log_info(f"[HA Areas] auto-created area '{display}' ({new_id}) for ghost room '{area_token}'")
        return new_id
    log_error(f"[HA Areas] could not ensure area for '{area_token}': {res.get('error')}")
    return area_token  # best-effort; assignment proceeds with the original token


async def assign_entity_to_area(entity_id: str, area_id: str | None) -> dict:
    """Assign (or unassign when area_id=None) an entity and its parent device to an HA area."""
    try:
        # Ghost-room self-heal: promote an inferred room slug to a real HA area
        # so the assignment lands on a room that actually exists.
        if area_id:
            area_id = await _resolve_or_create_area(area_id)
        # Look up device_id from the cached snapshot instead of a fresh WS roundtrip.
        snap = await get_registry_snapshot()
        entity = next((e for e in snap["entities"] if e.get("entity_id") == entity_id), None)
        device_id = entity.get("device_id") if entity else None

        commands = [{"type": "config/entity_registry/update", "entity_id": entity_id, "area_id": area_id}]
        if device_id:
            commands.append({"type": "config/device_registry/update", "device_id": device_id, "area_id": area_id})

        results = await _ws(*commands)
        if not results[0].get("success"):
            return {"ok": False, "error": (results[0].get("error") or {}).get("message", "Unknown")}
        invalidate_registry_cache()
        return {"ok": True}
    except Exception as e:
        log_error(f"[HA Areas] assign_entity_to_area: {e}")
        return {"ok": False, "error": str(e)}


async def assign_device_to_area(device_id: str, area_id: str | None) -> dict:
    """Assign (or unassign when area_id=None) a device to an HA area via device registry."""
    try:
        if area_id:
            area_id = await _resolve_or_create_area(area_id)
        res, = await _ws({
            "type": "config/device_registry/update",
            "device_id": device_id,
            "area_id": area_id,
        })
        if res.get("success"):
            invalidate_registry_cache()
            return {"ok": True}
        return {"ok": False, "error": (res.get("error") or {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] assign_device_to_area: {e}")
        return {"ok": False, "error": str(e)}


async def sync_device_area_to_ha(entity_id: str, room_name: str) -> dict:
    """Given an entity_id and a Ziggy room name, find the matching HA area and
    assign the device (not just the entity) to it so HA reflects the change."""
    try:
        snap = await get_registry_snapshot()
        areas = snap["areas"]
        entities = snap["entities"]

        # Match area by name (case-insensitive, treat _ as space)
        normalized_room = room_name.lower().replace("_", " ")
        area = next(
            (a for a in areas if a["name"].lower().replace("_", " ") == normalized_room),
            None,
        )
        if not area:
            return {"ok": False, "error": f"No HA area matching '{room_name}'"}

        # Find device_id for this entity
        entity = next((e for e in entities if e.get("entity_id") == entity_id), None)
        if not entity:
            return {"ok": False, "error": f"Entity '{entity_id}' not in HA entity registry"}

        device_id = entity.get("device_id")
        if not device_id:
            return {"ok": False, "error": f"Entity '{entity_id}' has no associated device"}

        res, = await _ws({
            "type": "config/device_registry/update",
            "device_id": device_id,
            "area_id": area["area_id"],
        })
        if res.get("success"):
            invalidate_registry_cache()
            return {"ok": True}
        return {"ok": False, "error": (res.get("error") or {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] sync_device_area_to_ha: {e}")
        return {"ok": False, "error": str(e)}


async def get_entities_in_area(area_id: str, domain: str | None = None) -> list[str]:
    """Return entity_ids in an area, optionally filtered by domain (e.g. 'light')."""
    areas = await get_areas()
    for area in areas:
        if area["id"] == area_id:
            entities = area["entities"]
            if domain:
                entities = [e for e in entities if e.startswith(f"{domain}.")]
            return entities
    return []


async def rename_area(area_id: str, name: str) -> dict:
    try:
        res, = await _ws({"type": "config/area_registry/update", "area_id": area_id, "name": name})
        if res.get("success"):
            invalidate_registry_cache()
            return {"ok": True, "area": res.get("result", {})}
        return {"ok": False, "error": res.get("error", {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] rename_area: {e}")
        return {"ok": False, "error": str(e)}
