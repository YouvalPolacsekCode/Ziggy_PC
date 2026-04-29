"""
HA Area Registry — all operations via WebSocket (template API blocks .append in newer HA).
"""
from __future__ import annotations
import json
import websockets

from core.settings_loader import settings
from core.logger_module import log_error

HA_URL: str = settings["home_assistant"]["url"].rstrip("/")
HA_TOKEN: str = settings["home_assistant"]["token"]
WS_URL = HA_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/websocket"


async def _ws(*commands: dict) -> list[dict]:
    """Open one WS connection, authenticate, send N commands, return N results."""
    async with websockets.connect(WS_URL) as ws:
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": HA_TOKEN}))
        auth = json.loads(await ws.recv())
        if auth.get("type") != "auth_ok":
            raise RuntimeError(f"HA WS auth failed: {auth}")
        results = []
        for i, cmd in enumerate(commands, start=1):
            await ws.send(json.dumps({"id": i, **cmd}))
        for _ in commands:
            results.append(json.loads(await ws.recv()))
        return results


async def get_areas() -> list:
    """Return [{id, name, entities: [entity_id, ...]}, ...]"""
    try:
        areas_res, devices_res, entities_res = await _ws(
            {"type": "config/area_registry/list"},
            {"type": "config/device_registry/list"},
            {"type": "config/entity_registry/list"},
        )
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
            return {"ok": True, "area": res.get("result", {})}
        return {"ok": False, "error": res.get("error", {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] create_area: {e}")
        return {"ok": False, "error": str(e)}


async def delete_area(area_id: str) -> dict:
    try:
        res, = await _ws({"type": "config/area_registry/delete", "area_id": area_id})
        if res.get("success"):
            return {"ok": True}
        return {"ok": False, "error": res.get("error", {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] delete_area: {e}")
        return {"ok": False, "error": str(e)}


async def assign_entity_to_area(entity_id: str, area_id: str | None) -> dict:
    """Assign (or unassign when area_id=None) an entity and its parent device to an HA area."""
    try:
        entities_res, = await _ws({"type": "config/entity_registry/list"})
        entities = entities_res.get("result") or []
        entity = next((e for e in entities if e.get("entity_id") == entity_id), None)
        device_id = entity.get("device_id") if entity else None

        commands = [{"type": "config/entity_registry/update", "entity_id": entity_id, "area_id": area_id}]
        if device_id:
            commands.append({"type": "config/device_registry/update", "device_id": device_id, "area_id": area_id})

        results = await _ws(*commands)
        if not results[0].get("success"):
            return {"ok": False, "error": (results[0].get("error") or {}).get("message", "Unknown")}
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
            return {"ok": True}
        return {"ok": False, "error": (res.get("error") or {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] assign_device_to_area: {e}")
        return {"ok": False, "error": str(e)}


async def sync_device_area_to_ha(entity_id: str, room_name: str) -> dict:
    """Given an entity_id and a Ziggy room name, find the matching HA area and
    assign the device (not just the entity) to it so HA reflects the change."""
    try:
        areas_res, entities_res = await _ws(
            {"type": "config/area_registry/list"},
            {"type": "config/entity_registry/list"},
        )
        areas = areas_res.get("result") or []
        entities = entities_res.get("result") or []

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
            return {"ok": True, "area": res.get("result", {})}
        return {"ok": False, "error": res.get("error", {}).get("message", "Unknown")}
    except Exception as e:
        log_error(f"[HA Areas] rename_area: {e}")
        return {"ok": False, "error": str(e)}
