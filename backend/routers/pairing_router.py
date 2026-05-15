from __future__ import annotations

import asyncio
import threading
from typing import List, Optional

import re
import requests as _requests

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


class SceneCreate(BaseModel):
    name: str
    snapshot_entities: List[str]


@router.post("/api/ha/scenes")
async def create_scene(body: SceneCreate):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Scene name is required")
    # Convert name → safe scene_id (lowercase, underscores)
    scene_id = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    result = call_service("scene", "create", {
        "scene_id": scene_id,
        "snapshot_entities": body.snapshot_entities,
    })
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "HA error"))
    return {"ok": True, "scene_id": f"scene.{scene_id}"}


@router.delete("/api/ha/scenes/{entity_id:path}")
async def delete_scene(entity_id: str):
    # Strip scene. prefix to get the scene_id used by HA config API
    scene_id = entity_id.removeprefix("scene.")
    from services.home_automation import _ha_endpoint, _headers
    try:
        resp = _requests.delete(
            _ha_endpoint(f"/api/config/scene/config/{scene_id}"),
            headers=_headers(),
            timeout=10,
        )
        if resp.status_code in (200, 204):
            return {"ok": True}
        raise HTTPException(status_code=resp.status_code, detail=f"HA returned {resp.status_code}: {resp.text[:200]}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


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
    # Refresh registry shortly after the permit window closes so new devices appear immediately.
    _schedule_registry_refresh(delay_s=body.duration + 5)
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
