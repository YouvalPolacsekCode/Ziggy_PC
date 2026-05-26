"""
HA Area Registry — all operations via WebSocket (template API blocks .append in newer HA).
"""
from __future__ import annotations
import asyncio
import json
import time
import websockets

from core.settings_loader import settings
from core.logger_module import log_error, log_info

HA_URL: str = settings["home_assistant"]["url"].rstrip("/")
HA_TOKEN: str = settings["home_assistant"]["token"]
WS_URL = HA_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/websocket"


async def _ws(*commands: dict, timeout: float = 4.0) -> list[dict]:
    """Open one WS connection, authenticate, send N commands, return N results.

    Aggressive timeout (default 4s) — when HA's WS is stalled, every caller
    of _ws() blocks for ~10s on the default handshake timeout. Backend
    endpoints (capabilities, areas, pairing) all pile up behind a single
    unresponsive HA, locking the whole app. Fail fast here so callers can
    return a cached/empty result and the FE stays usable.
    """
    async with websockets.connect(
        WS_URL,
        open_timeout=timeout,
        ping_interval=None,
        close_timeout=2,
    ) as ws:
        await asyncio.wait_for(ws.recv(), timeout=timeout)  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": HA_TOKEN}))
        auth = json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout))
        if auth.get("type") != "auth_ok":
            raise RuntimeError(f"HA WS auth failed: {auth}")
        results = []
        for i, cmd in enumerate(commands, start=1):
            await ws.send(json.dumps({"id": i, **cmd}))
        for _ in commands:
            results.append(json.loads(await asyncio.wait_for(ws.recv(), timeout=timeout)))
        return results


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


async def assign_entity_to_area(entity_id: str, area_id: str | None) -> dict:
    """Assign (or unassign when area_id=None) an entity and its parent device to an HA area."""
    try:
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
