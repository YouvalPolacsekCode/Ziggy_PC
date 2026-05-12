from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from services.ha_scripts import (
    list_scripts, get_script_for_ui, save_script, delete_script, run_script,
)
from services.local_automation_actions import (
    save_ziggy_actions, delete_ziggy_actions, execute_ziggy_actions,
)

router = APIRouter()


class RoutineBody(BaseModel):
    name: str
    description: Optional[str] = ""
    icon: Optional[str] = "⚡"
    steps: Optional[list] = []


@router.get("/api/routines")
async def get_routines():
    return {"routines": list_scripts()}


@router.get("/api/routines/{script_id}")
async def get_routine_by_id(script_id: str):
    r = get_script_for_ui(script_id)
    if not r:
        raise HTTPException(status_code=404, detail="Script not found")
    return r


@router.post("/api/routines")
async def create_routine_endpoint(body: RoutineBody):
    data = body.model_dump()
    result = save_script(data)
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
    # Trigger the HA script so HA-side call_service steps execute natively.
    # IR / delay / capability steps run via Ziggy in the background.
    run_script(script_id)
    background_tasks.add_task(execute_ziggy_actions, script_id)
    return {"ok": True, "message": "Routine running"}


@router.delete("/api/routines/{script_id}")
async def delete_routine_endpoint(script_id: str):
    if not delete_script(script_id):
        raise HTTPException(status_code=404, detail="Script not found")
    delete_ziggy_actions(script_id)
    return {"ok": True}
