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


def _cap_snapshot(all_states, ir_devices=None):
    """Build cap_map once and reuse across both template endpoints."""
    from services.capability_matcher import detect_capabilities
    from services.home_automation import get_all_states as _get
    return detect_capabilities(all_states, ir_devices or [])


def _enrich_template(tmpl, cap_map, existing_names=None):
    """Return the serialisable template dict with all computed fields."""
    from services.automation_templates import (
        build_prefill, can_run as tmpl_can_run,
        get_matched_caps, get_missing_required, get_missing_optional, friendly_cap,
    )

    runnable   = tmpl_can_run(tmpl, cap_map)
    matched    = get_matched_caps(tmpl, cap_map)
    miss_req   = get_missing_required(tmpl, cap_map)
    miss_opt   = get_missing_optional(tmpl, cap_map)
    prefill    = build_prefill(tmpl, cap_map) if runnable else None

    # Friendly labels split into what you have vs. what's missing
    matched_labels = [
        {"cap": c, "label": friendly_cap(tmpl, c), "entity": (cap_map.get(c) or [None])[0]}
        for c in matched
    ]
    missing_req_labels = [{"cap": c, "label": friendly_cap(tmpl, c)} for c in miss_req]
    missing_opt_labels = [{"cap": c, "label": friendly_cap(tmpl, c)} for c in miss_opt]

    already_exists = False
    if existing_names is not None:
        already_exists = tmpl["name"].lower() in existing_names

    # Readiness tier: ready | partial | unavailable
    relevant = tmpl.get("relevant_capabilities", [])
    if runnable:
        tier = "ready"
    elif matched:
        tier = "partial"
    elif not relevant:
        tier = "ready"          # no requirements (device_offline_alert)
    else:
        tier = "unavailable"

    return {
        **tmpl,
        "can_run":             runnable,
        "tier":                tier,
        "wizard_prefill":      prefill,
        "matched_labels":      matched_labels,
        "missing_req_labels":  missing_req_labels,
        "missing_opt_labels":  missing_opt_labels,
        "already_exists":      already_exists,
    }


@router.get("/api/automations/templates")
async def get_automation_templates():
    """Return the full curated template library with runability flags."""
    from services.automation_templates import TEMPLATES
    from services.home_automation import get_all_states

    all_states = get_all_states()
    ir_devices: list = []
    try:
        from services.ir_manager import list_ir_devices
        ir_devices = list_ir_devices()
    except Exception:
        pass
    cap_map = _cap_snapshot(all_states, ir_devices)

    return {"templates": [_enrich_template(t, cap_map) for t in TEMPLATES]}


@router.get("/api/automations/templates/suggested")
async def get_suggested_templates():
    """Return templates that match the user's installed devices, with pre-filled wizard data."""
    from services.automation_templates import TEMPLATES, matches_suggestion
    from services.home_automation import get_all_states

    all_states = get_all_states()
    ir_devices: list = []
    try:
        from services.ir_manager import list_ir_devices
        ir_devices = list_ir_devices()
    except Exception:
        pass
    cap_map = _cap_snapshot(all_states, ir_devices)

    existing_names: set = set()
    try:
        existing_names = {(a.get("name") or "").lower() for a in ha_list_automations()}
    except Exception:
        pass

    suggested = [
        _enrich_template(t, cap_map, existing_names)
        for t in TEMPLATES
        if matches_suggestion(t, cap_map)
    ]
    # Sort: ready first, then partial, then unavailable
    order = {"ready": 0, "partial": 1, "unavailable": 2}
    suggested.sort(key=lambda t: order.get(t["tier"], 3))

    return {"suggested": suggested}


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
    # Always use Ziggy's executor — it handles call_service, IR, delay, and all
    # other step types natively. Calling trigger_automation() in addition would
    # cause HA to double-execute call_service steps for HA-backed automations.
    # HA state-triggered automations auto-fire independently of this endpoint.
    from services.local_automation_actions import get_automation_meta
    label = get_automation_meta(automation_id).get("name") or automation_id
    background_tasks.add_task(execute_ziggy_actions, automation_id, label)
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
