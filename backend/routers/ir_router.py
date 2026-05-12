from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.ir_manager import (
    list_ir_devices, get_ir_device, create_ir_device,
    update_ir_device, delete_ir_device,
    list_ir_blasters, send_ir_command, start_learning,
    mark_command_learned,
)

router = APIRouter()


class IrDeviceCreate(BaseModel):
    name: str
    device_type: str
    blaster_entity_id: str
    room: Optional[str] = ""
    brand: Optional[str] = ""
    model: Optional[str] = ""
    aliases: Optional[list] = None
    commands: Optional[dict] = None
    ac_config: Optional[dict] = None


class IrDevicePatch(BaseModel):
    name: Optional[str] = None
    room: Optional[str] = None            # empty string '' = unassign from room
    brand: Optional[str] = None
    model: Optional[str] = None
    enabled: Optional[bool] = None
    aliases: Optional[list] = None
    commands: Optional[dict] = None
    ac_config: Optional[dict] = None
    assumed_state: Optional[str] = None   # 'on' | 'off' | 'unknown'
    ha_entity_id: Optional[str] = None    # link to HA entity for state fallback


class IrLearnBody(BaseModel):
    device_id: str
    command_name: str


class IrSendBody(BaseModel):
    device_id: str
    command: str
    repeats: int = 1


@router.get("/api/ir/blasters")
async def ir_blasters():
    return {"blasters": list_ir_blasters()}


@router.get("/api/ir/devices")
async def get_ir_devices(room: Optional[str] = None, device_type: Optional[str] = None):
    return {"devices": list_ir_devices(room=room, device_type=device_type, enabled_only=False)}


@router.get("/api/ir/devices/{device_id}")
async def get_single_ir_device(device_id: str):
    device = get_ir_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    return device


@router.post("/api/ir/devices")
async def create_ir_device_endpoint(body: IrDeviceCreate):
    try:
        device = create_ir_device(
            name=body.name,
            device_type=body.device_type,
            blaster_entity_id=body.blaster_entity_id,
            room=body.room,
            brand=body.brand or "",
            model=body.model or "",
            aliases=body.aliases,
            commands=body.commands,
            ac_config=body.ac_config,
        )
        return {"ok": True, "device": device}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/api/ir/devices/{device_id}")
async def patch_ir_device(device_id: str, body: IrDevicePatch):
    data = body.model_dump()
    updates = {}
    for k, v in data.items():
        if v is not None:
            updates[k] = v
        elif k == "room":
            # Explicit null/empty for room means "unassign" — store as empty string
            updates["room"] = ""
    device = update_ir_device(device_id, updates)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    # Refresh device registry so room changes are reflected immediately
    try:
        from services.device_registry import refresh as dr_refresh
        import threading
        threading.Thread(target=dr_refresh, daemon=True).start()
    except Exception:
        pass
    return device


@router.delete("/api/ir/devices/{device_id}")
async def remove_ir_device(device_id: str):
    if not delete_ir_device(device_id):
        raise HTTPException(status_code=404, detail="IR device not found")
    return {"ok": True}


@router.post("/api/ir/learn")
async def ir_learn(body: IrLearnBody):
    device = get_ir_device(body.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")

    command_map: dict = device.get("commands") or {}
    ha_command = command_map.get(body.command_name, body.command_name)

    result = start_learning(
        blaster_entity=device["blaster_entity_id"],
        device_namespace=device["ha_device_namespace"],
        ha_command=ha_command,
    )
    if result.get("ok"):
        mark_command_learned(body.device_id, body.command_name)

    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Learning mode failed"))
    return result


@router.post("/api/ir/send")
async def ir_send(body: IrSendBody):
    result = send_ir_command(body.device_id, body.command, repeats=body.repeats)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Send failed"))
    return result
