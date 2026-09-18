"""Light holds — lights Ziggy is keeping off because a person turned them off.

GET  /api/light-holds                       → {"holds": [{entity_id, state, since, until, until_text, room}]}
POST /api/light-holds/{entity_id}/release   → {"released": bool}

See services/light_hold.py for the rule. Any household member may release.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.routers.auth_deps import get_current_user
from services import light_hold

router = APIRouter()


@router.get("/api/light-holds")
async def list_holds(user: dict = Depends(get_current_user)):
    return {"holds": light_hold.list_active()}


@router.post("/api/light-holds/{entity_id}/release")
async def release_hold(entity_id: str, user: dict = Depends(get_current_user)):
    return {"released": light_hold.release(entity_id, by=user.get("username", "?"))}
