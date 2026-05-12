from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from core.logger_module import log_info
from services.ha_automations import (
    list_automations as ha_list_automations,
    get_automation_for_ui,
    save_automation,
    delete_automation as ha_delete_automation,
    toggle_automation,
    trigger_automation,
)
from services.local_automation_actions import (
    delete_ziggy_actions,
    execute_ziggy_actions,
    delete_automation_meta,
)

router = APIRouter()


class AutomationBody(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = ""
    trigger: Optional[dict] = {}
    actions: Optional[list] = []
    rooms: Optional[list] = []


class AutomationToggle(BaseModel):
    enabled: bool


class AutomationRoomsPatch(BaseModel):
    rooms: list[str]


@router.get("/api/automations")
async def get_automations():
    return {"automations": ha_list_automations()}


@router.get("/api/automations/{automation_id}")
async def get_automation_by_id(automation_id: str):
    a = get_automation_for_ui(automation_id)
    if not a:
        raise HTTPException(status_code=404, detail="Automation not found")
    return a


@router.post("/api/automations")
async def create_automation_endpoint(body: AutomationBody):
    data = body.model_dump()
    result = save_automation(data, auto_id=body.id)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    auto_id = result["id"]
    automation = {
        "id": auto_id,
        "name": body.name,
        "description": body.description or "",
        "enabled": True,
        "trigger": body.trigger or {},
        "actions": body.actions or [],
        "rooms": body.rooms or [],
        "source": result.get("source", "ha"),
    }
    return {"ok": True, "automation": automation}


@router.patch("/api/automations/{automation_id}/rooms")
async def patch_automation_rooms(automation_id: str, body: AutomationRoomsPatch):
    from services.local_automation_actions import save_automation_meta, get_automation_meta
    meta = get_automation_meta(automation_id)
    meta["rooms"] = body.rooms
    save_automation_meta(automation_id, meta)
    return {"ok": True, "automation_id": automation_id, "rooms": body.rooms}


@router.patch("/api/automations/{automation_id}/toggle")
async def toggle_automation_endpoint(automation_id: str, body: AutomationToggle):
    ok = toggle_automation(automation_id, body.enabled)
    if not ok:
        raise HTTPException(status_code=502, detail="Failed to toggle automation")
    return {"ok": True, "enabled": body.enabled}


@router.post("/api/automations/{automation_id}/trigger")
async def trigger_automation_endpoint(automation_id: str, background_tasks: BackgroundTasks):
    # Only call HA trigger for HA-backed automations. Ziggy-native automations
    # (stored in automations.json) don't exist in HA — calling trigger_automation
    # on them wastes a full 10-second HA API timeout before any step runs.
    from core.automation_file import get_automation as _get_ziggy
    if not _get_ziggy(automation_id):
        # HA-backed: ask HA to execute call_service steps natively
        trigger_automation(automation_id)

    # Run Ziggy-side steps (IR commands, delays, capabilities, etc.) in the
    # background so the HTTP response returns immediately. This prevents:
    #   • Client/proxy timeouts killing a sequence mid-delay
    #   • asyncio.CancelledError when the client navigates away
    background_tasks.add_task(execute_ziggy_actions, automation_id)
    return {"ok": True, "message": "Automation triggered"}


@router.delete("/api/automations/{automation_id}")
async def delete_automation_endpoint(automation_id: str):
    from core.automation_file import delete_automation as delete_ziggy_automation
    ha_ok = ha_delete_automation(automation_id)
    ziggy_ok = delete_ziggy_automation(automation_id)
    if not ha_ok and not ziggy_ok:
        raise HTTPException(status_code=404, detail="Automation not found")
    delete_ziggy_actions(automation_id)
    delete_automation_meta(automation_id)
    return {"ok": True}
