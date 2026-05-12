from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.virtual_devices import (
    list_virtual_devices, get_virtual_device, create_virtual_device,
    update_virtual_device, delete_virtual_device, trigger_virtual_device,
)

router = APIRouter()


class VirtualDeviceCreate(BaseModel):
    name: str
    capability: str
    room: Optional[str] = None
    default_params: Optional[dict] = None
    enabled: bool = True


class VirtualDevicePatch(BaseModel):
    name: Optional[str] = None
    room: Optional[str] = None
    default_params: Optional[dict] = None
    enabled: Optional[bool] = None
    icon: Optional[str] = None


class VirtualDeviceTrigger(BaseModel):
    params: Optional[dict] = None


@router.get("/api/virtual-devices")
async def get_virtual_devices(room: Optional[str] = None, category: Optional[str] = None):
    return {"devices": list_virtual_devices(room=room, category=category)}


@router.get("/api/virtual-devices/{device_id}")
async def get_single_virtual_device(device_id: str):
    device = get_virtual_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="Virtual device not found")
    return device


@router.post("/api/virtual-devices")
async def create_vdevice(body: VirtualDeviceCreate):
    try:
        device = create_virtual_device(
            name=body.name,
            capability=body.capability,
            room=body.room,
            default_params=body.default_params,
            enabled=body.enabled,
        )
        return {"ok": True, "device": device}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/api/virtual-devices/{device_id}")
async def patch_vdevice(device_id: str, body: VirtualDevicePatch):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    device = update_virtual_device(device_id, updates)
    if not device:
        raise HTTPException(status_code=404, detail="Virtual device not found")
    return device


@router.delete("/api/virtual-devices/{device_id}")
async def delete_vdevice(device_id: str):
    ok = delete_virtual_device(device_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Virtual device not found")
    return {"ok": True}


@router.post("/api/virtual-devices/{device_id}/trigger")
async def trigger_vdevice(device_id: str, body: VirtualDeviceTrigger = VirtualDeviceTrigger()):
    result = await trigger_virtual_device(device_id, runtime_params=body.params)
    return result
