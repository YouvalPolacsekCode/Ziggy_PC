"""Named saved-position presets per device (light card).

A preset is a still position (brightness + colour) the user captures and recalls
in one tap on the device card — see services/device_presets.py. Applying a preset
happens client-side via the normal turn_on service path; this router only owns
the named list (list / save / rename / delete).

Home-scoped, user-tier auth. entity_id is URL-encoded by the client.
"""
from __future__ import annotations

from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.routers.auth_deps import get_current_user
from core.logger_module import log_error
from services import device_presets

router = APIRouter()


class PresetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    settings: dict


class PresetRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


@router.get("/api/device/{entity_id}/presets")
async def get_presets(entity_id: str, user: dict = Depends(get_current_user)):
    return {"presets": device_presets.list_presets(unquote(entity_id))}


@router.post("/api/device/{entity_id}/presets")
async def create_preset(entity_id: str, body: PresetCreate,
                        user: dict = Depends(get_current_user)):
    eid = unquote(entity_id)
    try:
        preset = device_presets.add_preset(eid, body.name, body.settings)
    except device_presets.PresetLimitError:
        raise HTTPException(status_code=409, detail={
            "code": "preset_limit",
            "message": f"This device already has {device_presets.MAX_PRESETS_PER_ENTITY} presets. "
                       "Delete one to add another.",
        })
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "invalid_preset", "message": str(e)})
    except Exception as e:  # noqa: BLE001 — never 500 on a store hiccup
        log_error(f"[device_presets] save failed for {eid}: {e}")
        raise HTTPException(status_code=500, detail={"code": "save_failed", "message": "Could not save preset."})
    return {"preset": preset}


@router.patch("/api/device/{entity_id}/presets/{preset_id}")
async def patch_preset(entity_id: str, preset_id: str, body: PresetRename,
                       user: dict = Depends(get_current_user)):
    eid = unquote(entity_id)
    try:
        preset = device_presets.rename_preset(eid, preset_id, body.name)
    except KeyError:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Preset not found."})
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "invalid_preset", "message": str(e)})
    return {"preset": preset}


@router.delete("/api/device/{entity_id}/presets/{preset_id}")
async def remove_preset(entity_id: str, preset_id: str,
                        user: dict = Depends(get_current_user)):
    eid = unquote(entity_id)
    removed = device_presets.delete_preset(eid, preset_id)
    if not removed:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Preset not found."})
    return {"status": "ok"}


@router.put("/api/device/{entity_id}/presets/{preset_id}/default")
async def make_default(entity_id: str, preset_id: str,
                       user: dict = Depends(get_current_user)):
    eid = unquote(entity_id)
    try:
        preset = device_presets.set_default(eid, preset_id)
    except KeyError:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Preset not found."})
    return {"preset": preset}


@router.delete("/api/device/{entity_id}/default")
async def unset_default(entity_id: str, user: dict = Depends(get_current_user)):
    device_presets.clear_default(unquote(entity_id))
    return {"status": "ok"}
