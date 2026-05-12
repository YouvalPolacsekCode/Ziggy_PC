from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.event_manager import add_event, remove_event, days_until_event, next_event, get_all_events

router = APIRouter()


class EventCreate(BaseModel):
    name: str
    date_str: str
    notes: Optional[str] = ""
    repeat: Optional[str] = "none"


@router.get("/api/events")
async def get_events():
    return {"events": get_all_events()}


@router.post("/api/events")
async def create_event(body: EventCreate):
    result = add_event(body.name, body.date_str, notes=body.notes or "", repeat=body.repeat or "none")
    return {"ok": True, "result": result}


@router.delete("/api/events/{event_name:path}")
async def delete_event_endpoint(event_name: str):
    result = remove_event(event_name)
    if "❌" in result:
        raise HTTPException(status_code=404, detail=result)
    return {"ok": True, "result": result}


@router.get("/api/events/next")
async def get_next_event():
    return {"result": next_event()}


@router.get("/api/events/days-until/{event_name:path}")
async def get_days_until(event_name: str):
    return {"result": days_until_event(event_name)}
