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


def _enrich_routine_template(tmpl: dict, cap_map: dict, existing_names: set | None = None) -> dict:
    """Mirror of _enrich_template in automation_router but for routine templates.
    Adds runability flags, tier, wizard_prefill, matched/missing labels and
    already_exists deduplication against the user's existing routines."""
    from services.routine_templates import (
        build_wizard_prefill, can_run as rt_can_run,
        get_matched_caps, get_missing_required, get_missing_optional, friendly_cap,
    )

    runnable   = rt_can_run(tmpl, cap_map)
    matched    = get_matched_caps(tmpl, cap_map)
    miss_req   = get_missing_required(tmpl, cap_map)
    miss_opt   = get_missing_optional(tmpl, cap_map)
    prefill    = build_wizard_prefill(tmpl, cap_map) if runnable else None

    matched_labels = [
        {"cap": c, "label": friendly_cap(tmpl, c), "entity": (cap_map.get(c) or [None])[0]}
        for c in matched
    ]
    missing_req_labels = [{"cap": c, "label": friendly_cap(tmpl, c)} for c in miss_req]
    missing_opt_labels = [{"cap": c, "label": friendly_cap(tmpl, c)} for c in miss_opt]

    already_exists = False
    if existing_names is not None:
        already_exists = (tmpl.get("name") or "").lower() in existing_names

    relevant = tmpl.get("relevant_capabilities", [])
    if runnable:
        tier = "ready"
    elif matched:
        tier = "partial"
    elif not relevant:
        tier = "ready"
    else:
        tier = "unavailable"

    return {
        **tmpl,
        # Drop the un-JSON-serialisable build_steps callable. Frontend gets
        # the resolved steps via wizard_prefill instead.
        "build_steps":         None,
        "can_run":             runnable,
        "tier":                tier,
        "wizard_prefill":      prefill,
        "matched_labels":      matched_labels,
        "missing_req_labels":  missing_req_labels,
        "missing_opt_labels":  missing_opt_labels,
        "already_exists":      already_exists,
    }


@router.get("/api/routines/suggested")
async def get_suggested_routines():
    """Return curated routine templates matching the user's installed devices,
    with pre-filled wizard data. Parallel to /api/automations/templates/suggested
    but for the Routines tab. Surfaces 0 entries until ROUTINE_TEMPLATES is
    populated by subsequent prompts — the endpoint is wired now so frontend
    can rely on it being present."""
    from services.routine_templates import ROUTINE_TEMPLATES, matches_suggestion
    from services.home_automation import get_all_states
    from services.capability_matcher import detect_capabilities

    # Same off-thread pattern as get_suggested_templates — HA REST is sync.
    all_states, existing_routines = await asyncio.gather(
        asyncio.to_thread(get_all_states),
        asyncio.to_thread(_safe_list_scripts),
    )
    ir_devices: list = []
    try:
        from services.ir_manager import list_ir_devices
        ir_devices = list_ir_devices()
    except Exception:
        pass
    cap_map = detect_capabilities(all_states, ir_devices)

    existing_names: set = {(r.get("name") or "").lower() for r in existing_routines}

    suggested = [
        _enrich_routine_template(t, cap_map, existing_names)
        for t in ROUTINE_TEMPLATES
        if matches_suggestion(t, cap_map)
    ]
    order = {"ready": 0, "partial": 1, "unavailable": 2}
    suggested.sort(key=lambda t: order.get(t["tier"], 3))

    return {"suggested": suggested}


def _safe_list_scripts() -> list:
    """Wrap list_scripts so a transient HA failure doesn't break the
    suggested-routines endpoint (mirrors automation_router._safe_list_automations)."""
    try:
        return list_scripts() or []
    except Exception:
        return []


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
