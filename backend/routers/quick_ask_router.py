from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import services.quick_ask_manager as qam

router = APIRouter()


class QuickAskCreate(BaseModel):
    label: str
    icon: str = "⚡"
    intent: str
    params: dict = {}


class QuickAskUpdate(BaseModel):
    label: Optional[str] = None
    icon: Optional[str] = None
    intent: Optional[str] = None
    params: Optional[dict] = None


@router.get("/api/quick-asks")
async def api_get_quick_asks():
    return qam.get_all()


@router.post("/api/quick-asks")
async def api_create_quick_ask(body: QuickAskCreate):
    return qam.create(
        label=body.label,
        icon=body.icon,
        intent=body.intent,
        params=body.params,
    )


@router.patch("/api/quick-asks/{qa_id}")
async def api_update_quick_ask(qa_id: str, body: QuickAskUpdate):
    item = qam.update(qa_id, body.model_dump())
    if not item:
        raise HTTPException(status_code=404, detail="Quick ask not found")
    return item


@router.delete("/api/quick-asks/{qa_id}")
async def api_delete_quick_ask(qa_id: str):
    if not qam.delete(qa_id):
        raise HTTPException(status_code=404, detail="Quick ask not found")
    return {"ok": True}
