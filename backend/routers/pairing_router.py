from __future__ import annotations

import asyncio
import threading
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.ha_zha import (
    start_permit_join, get_devices as zha_get_devices,
    get_device_entities, rename_device as zha_rename_device,
)
from services.ha_pairing import (
    start_zwave_inclusion, stop_zwave_inclusion,
    commission_matter, get_pending_config_flows,
    WIFI_INTEGRATIONS,
)
from core.debug_bus import bus as _dbus, BASIC, VERBOSE

router = APIRouter()


# ---------------------------------------------------------------------------
# Shared helper: refresh device registry + broadcast devices_changed to frontend
# ---------------------------------------------------------------------------

def _schedule_registry_refresh(delay_s: float = 5.0) -> None:
    """Trigger a device-registry refresh after `delay_s` seconds.

    Called after pairing succeeds so newly joined devices appear promptly
    without waiting for the 60-second reconciliation loop.
    """
    def _run():
        import time
        time.sleep(delay_s)
        try:
            from services.device_registry import refresh
            refresh()
        except Exception:
            pass
        try:
            from backend.ws_manager import manager
            import asyncio as _aio
            loop = _aio.new_event_loop()
            loop.run_until_complete(manager.broadcast({"type": "devices_changed"}))
            loop.close()
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True).start()


# ---------------------------------------------------------------------------
# ZHA pairing
# ---------------------------------------------------------------------------

class ZhaPermitBody(BaseModel):
    duration: int = 60


class DeviceRename(BaseModel):
    name: str


@router.post("/api/ha/zha/permit")
async def zha_permit(body: ZhaPermitBody):
    _dbus.emit("ha", BASIC, "pairing_permit_join_started",
               duration_s=body.duration,
               message=f"Zigbee permit join opened for {body.duration}s")
    result = await start_permit_join(body.duration)
    if not result.get("ok"):
        _dbus.emit("ha", BASIC, "pairing_permit_join_failed",
                   error=result.get("error"), result="error",
                   suggestion="Check ZHA integration is enabled in Home Assistant.")
        raise HTTPException(status_code=502, detail=result.get("error", "ZHA error"))
    # Refresh registry shortly after the permit window closes so new devices appear immediately.
    _schedule_registry_refresh(delay_s=body.duration + 5)
    _dbus.emit("ha", BASIC, "pairing_permit_join_ok",
               duration_s=body.duration, result="ok",
               message=f"Permit join active. Pair your device within {body.duration}s.")
    return result


@router.get("/api/ha/devices")
async def ha_devices():
    devices = await zha_get_devices()
    _dbus.emit("ha", VERBOSE, "pairing_devices_listed", count=len(devices))
    return {"devices": devices}


@router.get("/api/ha/devices/{device_id}/entities")
async def ha_device_entities(device_id: str):
    entity_ids = await get_device_entities(device_id)
    return {"entity_ids": entity_ids}


@router.patch("/api/ha/devices/{device_id}/rename")
async def ha_rename_device(device_id: str, body: DeviceRename):
    result = await zha_rename_device(device_id, body.name)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    return result


# ---------------------------------------------------------------------------
# Z-Wave pairing
# ---------------------------------------------------------------------------

@router.post("/api/ha/zwave/include")
async def zwave_include():
    result = await start_zwave_inclusion()
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "Z-Wave error"))
    _schedule_registry_refresh(delay_s=30)
    return result


@router.post("/api/ha/zwave/stop")
async def zwave_stop():
    await stop_zwave_inclusion()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Matter commissioning
# ---------------------------------------------------------------------------

class MatterCommissionBody(BaseModel):
    code: str


@router.post("/api/ha/matter/commission")
async def matter_commission(body: MatterCommissionBody):
    if not body.code.strip():
        raise HTTPException(status_code=422, detail="Setup code is required")
    result = await commission_matter(body.code.strip())
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "Matter error"))
    _schedule_registry_refresh(delay_s=10)
    return result


# ---------------------------------------------------------------------------
# Config flows (Wi-Fi / Broadlink discovery)
# ---------------------------------------------------------------------------

@router.get("/api/ha/config_flows")
async def ha_config_flows(protocol: Optional[str] = None):
    integrations = None
    if protocol == "wifi":
        integrations = list(WIFI_INTEGRATIONS)
    elif protocol == "broadlink":
        integrations = ["broadlink"]
    return get_pending_config_flows(integrations)
