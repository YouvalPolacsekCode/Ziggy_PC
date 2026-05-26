from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from services.ha_scripts import (
    list_scripts, get_script_for_ui, save_script, delete_script,
)
from services.local_automation_actions import (
    save_ziggy_actions, delete_ziggy_actions, execute_ziggy_actions,
)

router = APIRouter()


class RoutineBody(BaseModel):
    # `id` present → update existing script in place (no slugify-on-name).
    # Absent → backend slugs the name to produce a new id, as before.
    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    icon: Optional[str] = "⚡"
    steps: Optional[list] = []


@router.get("/api/routines")
async def get_routines():
    # list_scripts() does a sync `requests.get` against HA — wrap so the
    # FastAPI event loop stays responsive while HA replies (10s timeout).
    routines = await asyncio.to_thread(list_scripts)
    return {"routines": routines}


@router.get("/api/routines/{script_id}")
async def get_routine_by_id(script_id: str):
    r = get_script_for_ui(script_id)
    if not r:
        raise HTTPException(status_code=404, detail="Script not found")
    return r


@router.post("/api/routines")
async def create_routine_endpoint(body: RoutineBody):
    data = body.model_dump()
    # Thread the id through so updates land on the same HA script. Without
    # this, save_script() would re-slug from the name on every save — orphaning
    # the original script whenever the user renamed a routine.
    result = save_script(data, script_id=data.get("id") or None)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    script_id = result["id"]
    save_ziggy_actions(script_id, data.get("steps", []))
    routine = get_script_for_ui(script_id) or {
        "id": script_id, "name": body.name, "icon": body.icon, "steps": []
    }
    return {"ok": True, "routine": routine}


@router.post("/api/routines/{script_id}/run")
async def run_routine_endpoint(script_id: str, background_tasks: BackgroundTasks):
    routine = get_script_for_ui(script_id)
    label = routine.get("name", script_id) if routine else script_id
    background_tasks.add_task(execute_ziggy_actions, script_id, label)
    return {"ok": True, "message": "Routine running"}


@router.delete("/api/routines/{script_id}")
async def delete_routine_endpoint(script_id: str):
    if not delete_script(script_id):
        raise HTTPException(status_code=404, detail="Script not found")
    delete_ziggy_actions(script_id)
    return {"ok": True}
