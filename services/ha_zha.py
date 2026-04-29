"""
ZHA (Zigbee Home Automation) helpers — permit-join, device registry, device entities.
All calls go through the shared _ws() helper from ha_areas.
"""
from __future__ import annotations
from services.ha_areas import _ws
from core.logger_module import log_error


async def start_permit_join(duration: int = 60) -> dict:
    """Enable ZHA permit-join for `duration` seconds."""
    try:
        res, = await _ws({
            "type": "call_service",
            "domain": "zha",
            "service": "permit",
            "service_data": {"duration": duration},
        })
        if res.get("success"):
            return {"ok": True}
        err = (res.get("error") or {}).get("message", "ZHA not available or not configured")
        return {"ok": False, "error": err}
    except Exception as e:
        log_error(f"[ZHA] start_permit_join: {e}")
        return {"ok": False, "error": str(e)}


async def get_devices() -> list:
    """Return all devices from HA device registry."""
    try:
        res, = await _ws({"type": "config/device_registry/list"})
        devices = res.get("result") or []
        return [
            {
                "id": d["id"],
                "name": d.get("name_by_user") or d.get("name") or d["id"],
                "manufacturer": d.get("manufacturer"),
                "model": d.get("model"),
                "area_id": d.get("area_id"),
            }
            for d in devices
        ]
    except Exception as e:
        log_error(f"[ZHA] get_devices: {e}")
        return []


async def get_device_entities(device_id: str) -> list[str]:
    """Return entity_ids belonging to a specific device."""
    try:
        res, = await _ws({"type": "config/entity_registry/list"})
        entities = res.get("result") or []
        return [e["entity_id"] for e in entities if e.get("device_id") == device_id]
    except Exception as e:
        log_error(f"[ZHA] get_device_entities: {e}")
        return []


async def rename_device(device_id: str, name: str) -> dict:
    """Set a user-friendly name on an HA device."""
    try:
        res, = await _ws({
            "type": "config/device_registry/update",
            "device_id": device_id,
            "name_by_user": name,
        })
        if res.get("success"):
            return {"ok": True}
        err = (res.get("error") or {}).get("message", "Unknown error")
        return {"ok": False, "error": err}
    except Exception as e:
        log_error(f"[ZHA] rename_device: {e}")
        return {"ok": False, "error": str(e)}
