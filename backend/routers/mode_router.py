"""Home mode endpoint.

GET  /api/mode             → current mode + when/who changed it
POST /api/mode {"mode":..} → set; broadcasts on WS
GET  /api/mode/options     → list of valid modes (so the FE doesn't hardcode)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user
from services import mode_service

router = APIRouter()


class SetModeBody(BaseModel):
    mode: str


@router.get("/api/mode")
async def get_mode(user: dict = Depends(get_current_user)):
    return await mode_service.get_mode()


@router.get("/api/mode/options")
async def mode_options(user: dict = Depends(get_current_user)):
    return {"modes": list(mode_service.MODES)}


@router.post("/api/mode")
async def post_mode(body: SetModeBody, user: dict = Depends(get_current_user)):
    try:
        return await mode_service.set_mode(body.mode, changed_by=user.get("username", "?"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
