from __future__ import annotations

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
from services.home_automation import call_service, get_all_states

router = APIRouter()


# ---------------------------------------------------------------------------
# Scenes
# ---------------------------------------------------------------------------

class SceneActivate(BaseModel):
    entity_id: str


@router.get("/api/ha/scenes")
async def get_scenes():
    try:
        scenes = []
        for s in get_all_states():
            eid = s.get("entity_id", "")
            if not eid.startswith("scene."):
                continue
            attrs = s.get("attributes", {})
            scenes.append({
                "entity_id": eid,
                "name": attrs.get("friendly_name", eid.replace("scene.", "").replace("_", " ").title()),
                "icon": attrs.get("icon", ""),
            })
        return {"scenes": sorted(scenes, key=lambda x: x["name"])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/ha/scenes/activate")
async def activate_scene(body: SceneActivate):
    result = call_service("scene", "turn_on", {"entity_id": body.entity_id})
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "HA error"))
    return {"ok": True}


# ---------------------------------------------------------------------------
# ZHA pairing
# ---------------------------------------------------------------------------

class ZhaPermitBody(BaseModel):
    duration: int = 60


class DeviceRename(BaseModel):
    name: str


@router.post("/api/ha/zha/permit")
async def zha_permit(body: ZhaPermitBody):
    result = await start_permit_join(body.duration)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "ZHA error"))
    return result


@router.get("/api/ha/devices")
async def ha_devices():
    devices = await zha_get_devices()
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
