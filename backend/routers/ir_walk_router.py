"""
Walk-wizard API — guided capture sessions that teach Ziggy a new AC
remote's protocol. See services/ir_walk_session.py for the state machine
and services/ir_walk_analyzer.py for the cracking method.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import ir_walk_session as walk

router = APIRouter()


class WalkStartBody(BaseModel):
    device_id: str


class WalkObserveBody(BaseModel):
    observed: dict


class WalkValidateBody(BaseModel):
    obeyed: bool


@router.post("/api/ir/walk/start")
async def walk_start(body: WalkStartBody):
    from services.ir_manager import get_ir_device
    if not get_ir_device(body.device_id):
        raise HTTPException(status_code=404, detail="IR device not found")
    return walk.start_session(body.device_id)


@router.get("/api/ir/walk/{session_id}")
async def walk_get(session_id: str):
    s = walk.get_session(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Walk session not found")
    return s


@router.post("/api/ir/walk/{session_id}/observe")
async def walk_observe(session_id: str, body: WalkObserveBody):
    s = walk.observe(session_id, body.observed)
    if not s:
        raise HTTPException(status_code=404, detail="Walk session not active")
    return s


@router.post("/api/ir/walk/{session_id}/next")
async def walk_next(session_id: str):
    s = walk.next_step(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="Walk session not active")
    return s


@router.post("/api/ir/walk/{session_id}/finish")
async def walk_finish(session_id: str):
    result = walk.finish_session(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Walk session not found")
    return result


@router.post("/api/ir/walk/{session_id}/validate")
async def walk_validate(session_id: str, body: WalkValidateBody):
    result = walk.validate_session(session_id, body.obeyed)
    if result is None:
        raise HTTPException(status_code=404, detail="Walk session has no card")
    return result


@router.post("/api/ir/walk/{session_id}/abort")
async def walk_abort(session_id: str):
    if not walk.abort_session(session_id):
        raise HTTPException(status_code=404, detail="Walk session not found")
    return {"ok": True}
