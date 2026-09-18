"""Home modes — the fixed set (sleep, movie, cleaning, guest, vacation).

GET  /api/modes              → every mode with on/since/until/by + labels + effect
POST /api/modes/{mode}       → {"on": bool, "hours": float|null}; sets and broadcasts

Any household member may flip a mode; a wall tablet too (a mode is low-risk
and the whole point of a shared house screen). The legacy single-value
/api/mode lives in mode_router as a facade over this.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user
from services import modes

router = APIRouter()


class SetModeBody(BaseModel):
    on: bool = True
    hours: Optional[float] = None


@router.get("/api/modes")
async def list_modes(user: dict = Depends(get_current_user)):
    return {"modes": modes.list_modes()}


@router.post("/api/modes/{mode}")
async def set_mode(mode: str, body: SetModeBody, user: dict = Depends(get_current_user)):
    try:
        return await modes.set_mode(mode, body.on, by=user.get("username", "?"), hours=body.hours)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
