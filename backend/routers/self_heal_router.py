"""
Self-Heal API.

- POST /api/self-heal/refresh   {entity_id}         → force a real poll + heal once
- POST /api/self-heal/snooze    {entity_id,minutes} → stop auto-healing a device
- GET  /api/self-heal/log       (super_admin)        → diagnostic feed (Canary)

The refresh/snooze endpoints are available to any authenticated user (they back
the per-device refresh button); the log is super_admin-only so it stays an
operator-facing diagnostic surface, not a customer feature.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.routers.auth_deps import require_role
from services import self_heal

router = APIRouter(prefix="/api/self-heal")


class RefreshBody(BaseModel):
    entity_id: str


class SnoozeBody(BaseModel):
    entity_id: str
    minutes: int = 720


@router.post("/refresh")
async def refresh(body: RefreshBody):
    """Force a real device poll and, if it disagrees with intent, heal once."""
    return await self_heal.manual_refresh_heal(body.entity_id)


@router.post("/snooze")
async def snooze(body: SnoozeBody):
    self_heal.snooze(body.entity_id, minutes=body.minutes)
    return {"ok": True, "entity_id": body.entity_id, "minutes": body.minutes}


@router.get("/log")
async def log(limit: int = 100, _: dict = Depends(require_role("super_admin"))):
    return {"events": self_heal.get_log(limit=limit)}
