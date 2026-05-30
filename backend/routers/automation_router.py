from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from core.logger_module import log_info
from core.debug_bus import bus as _bus, BASIC as _BASIC, VERBOSE as _VERBOSE
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
    get_automation_meta,
    save_automation_meta,
)
from services.automation_history import get_history, delete_history

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


class AutomationSnooze(BaseModel):
    minutes: int


@router.get("/api/automations")
async def get_automations():
    # ha_list_automations() does a sync `requests.get` against HA's REST
    # /api/states (10s timeout). Without to_thread, every Automations page
    # load froze the FastAPI event loop for the full HA response time —
    # piling up other requests behind it. Wrapping releases the loop while
    # HA replies.
    autos = await asyncio.to_thread(ha_list_automations)
    return {"automations": autos}


def _cap_snapshot(all_states, ir_devices=None):
    """Build cap_map once and reuse across both template endpoints."""
    from services.capability_matcher import detect_capabilities
    from services.home_automation import get_all_states as _get
    return detect_capabilities(all_states, ir_devices or [])


def _enrich_template(tmpl, cap_map, existing_names=None, signal_fires=None):
    """Return the serialisable template dict with all computed fields.

    signal_fires: optional {template_id: fire_record} from
    pattern_detector.get_active_template_signals(). When present, templates
    whose habit_signal is currently firing get an extra `habit_signal_fired`
    field so the Suggested tab can surface them with a re-surfacing badge.
    """
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

    enriched = {
        **tmpl,
        "can_run":             runnable,
        "tier":                tier,
        "wizard_prefill":      prefill,
        "matched_labels":      matched_labels,
        "missing_req_labels":  missing_req_labels,
        "missing_opt_labels":  missing_opt_labels,
        "already_exists":      already_exists,
    }

    # Attach habit_signal fire info if this template's curated signal is
    # currently firing. The frontend uses this to add a "we noticed you keep
    # doing X" re-surfacing badge on top of the regular Suggested card.
    if signal_fires and tmpl.get("id") in signal_fires:
        enriched["habit_signal_fired"] = signal_fires[tmpl["id"]]

    return enriched


def _safe_list_automations() -> list:
    """Wrap ha_list_automations so a transient HA failure (during the
    parallel fetch in get_suggested_templates) doesn't break the page."""
    try:
        return ha_list_automations() or []
    except Exception:
        return []


def _safe_signal_fires() -> dict:
    """Wrap get_active_template_signals so a broken events.jsonl or
    pattern_detector import failure can't take down the templates endpoint.
    Returns {template_id: fire_record} on success, {} on any failure."""
    try:
        from services.pattern_detector import get_active_template_signals
        return get_active_template_signals() or {}
    except Exception:
        return {}


@router.get("/api/automations/templates")
async def get_automation_templates():
    """Return the full curated template library with runability flags."""
    from services.automation_templates import TEMPLATES
    from services.home_automation import get_all_states

    # Sync HA REST call — release the event loop while HA replies.
    all_states = await asyncio.to_thread(get_all_states)
    ir_devices: list = []
    try:
        from services.ir_manager import list_ir_devices
        ir_devices = list_ir_devices()
    except Exception:
        pass
    cap_map = _cap_snapshot(all_states, ir_devices)
    signal_fires = _safe_signal_fires()

    return {"templates": [_enrich_template(t, cap_map, signal_fires=signal_fires) for t in TEMPLATES]}


@router.get("/api/automations/templates/suggested")
async def get_suggested_templates():
    """Return templates that match the user's installed devices, with pre-filled wizard data."""
    from services.automation_templates import TEMPLATES, matches_suggestion
    from services.home_automation import get_all_states

    # Both calls below hit HA REST sync. Run them in parallel via threads so
    # the page (Dashboard mounts this) doesn't pay them serially.
    all_states, existing_autos = await asyncio.gather(
        asyncio.to_thread(get_all_states),
        asyncio.to_thread(lambda: _safe_list_automations()),
    )
    ir_devices: list = []
    try:
        from services.ir_manager import list_ir_devices
        ir_devices = list_ir_devices()
    except Exception:
        pass
    cap_map = _cap_snapshot(all_states, ir_devices)
    signal_fires = _safe_signal_fires()

    existing_names: set = {(a.get("name") or "").lower() for a in existing_autos}

    suggested = [
        _enrich_template(t, cap_map, existing_names, signal_fires=signal_fires)
        for t in TEMPLATES
        if matches_suggestion(t, cap_map) or t.get("id") in signal_fires
    ]
    # Sort: ready first, then partial, then unavailable
    order = {"ready": 0, "partial": 1, "unavailable": 2}
    suggested.sort(key=lambda t: order.get(t["tier"], 3))

    return {"suggested": suggested}


# ── Circadian Lighting bundle ────────────────────────────────────────────────
# The "Smart Light Schedule" suggestion (D1) expands to 4 HA automations
# (sunrise / solar-noon / sunset / bedtime). The standard wizard speaks the
# single-trigger schema only, so Configure on this suggestion routes here
# instead. The bundle is idempotent — re-saving overwrites the same HA IDs.

class CircadianBundleBody(BaseModel):
    lights:  list[str]
    bedtime: Optional[str] = "22:00"


@router.get("/api/automations/circadian-bundle")
async def get_circadian_bundle():
    from services.circadian_builder import get_bundle
    return await asyncio.to_thread(get_bundle)


@router.post("/api/automations/circadian-bundle")
async def save_circadian_bundle(body: CircadianBundleBody):
    from services.circadian_builder import save_bundle
    result = await asyncio.to_thread(save_bundle, body.lights, body.bedtime or "22:00")
    if not result.get("ok"):
        _bus.emit("automation", _BASIC, "circadian_bundle_save_failed",
                  light_count=len(body.lights), bedtime=body.bedtime,
                  failed=[f.get("id") for f in result.get("failed", [])],
                  result="error")
        raise HTTPException(status_code=502, detail=result)
    _bus.emit("automation", _BASIC, "circadian_bundle_saved",
              light_count=len(body.lights), bedtime=body.bedtime,
              saved=result.get("saved", []), result="ok")
    return {"ok": True, **result}


@router.delete("/api/automations/circadian-bundle")
async def delete_circadian_bundle():
    from services.circadian_builder import delete_bundle
    result = await asyncio.to_thread(delete_bundle)
    _bus.emit("automation", _BASIC, "circadian_bundle_deleted",
              deleted=result.get("deleted", []),
              missed=result.get("missed", []), result="ok")
    return result


# ── Single-automation endpoints ──────────────────────────────────────────────

@router.get("/api/automations/{automation_id}")
async def get_automation_by_id(automation_id: str):
    a = get_automation_for_ui(automation_id)
    if not a:
        raise HTTPException(status_code=404, detail="Automation not found")
    return a


@router.post("/api/automations")
async def create_automation_endpoint(body: AutomationBody):
    data = body.model_dump()
    is_update = bool(body.id)
    result = save_automation(data, auto_id=body.id)
    if not result.get("ok"):
        _bus.emit("automation", _BASIC, "automation_save_failed",
                  name=body.name, automation_id=body.id,
                  result="error", error=result.get("error"))
        raise HTTPException(status_code=502, detail=result.get("error", "HA error"))
    auto_id = result["id"]
    _bus.emit("automation", _BASIC,
              "automation_updated" if is_update else "automation_created",
              automation_id=auto_id, name=body.name,
              trigger_kind=(body.trigger or {}).get("kind"),
              action_count=len(body.actions or []),
              rooms=body.rooms or [],
              result="ok")
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
        _bus.emit("automation", _BASIC, "automation_toggle_failed",
                  automation_id=automation_id, enabled=body.enabled,
                  result="error")
        raise HTTPException(status_code=502, detail="Failed to toggle automation")
    # Disabling a Fake Occupancy automation must immediately stop its
    # multi-day activation — otherwise the per-minute scheduler would keep
    # cycling lights even after the user toggled it off in the UI. Safe
    # no-op for any automation that isn't currently running an activation.
    if not body.enabled:
        try:
            from services import fake_occupancy_scheduler
            fake_occupancy_scheduler.stop(automation_id)
        except Exception:
            pass
    _bus.emit("automation", _BASIC, "automation_toggled",
              automation_id=automation_id, enabled=body.enabled, result="ok")
    return {"ok": True, "enabled": body.enabled}


@router.post("/api/automations/{automation_id}/trigger")
async def trigger_automation_endpoint(automation_id: str, background_tasks: BackgroundTasks):
    # Always use Ziggy's executor — it handles call_service, IR, delay, and all
    # other step types natively. Calling trigger_automation() in addition would
    # cause HA to double-execute call_service steps for HA-backed automations.
    # HA state-triggered automations auto-fire independently of this endpoint.
    label = get_automation_meta(automation_id).get("name") or automation_id
    _bus.emit("automation", _BASIC, "automation_triggered",
              automation_id=automation_id, name=label, source="manual")
    background_tasks.add_task(
        execute_ziggy_actions, automation_id, label, "manual",
    )
    return {"ok": True, "message": "Automation triggered"}


@router.get("/api/automations/{automation_id}/history")
async def get_automation_history(automation_id: str, limit: int = 20):
    return {"automation_id": automation_id, "history": get_history(automation_id, limit)}


@router.post("/api/automations/{automation_id}/snooze")
async def snooze_automation_endpoint(automation_id: str, body: AutomationSnooze):
    """Pause an automation for N minutes. minutes=0 clears the snooze."""
    meta = get_automation_meta(automation_id) or {}
    if body.minutes <= 0:
        meta.pop("snoozed_until", None)
        save_automation_meta(automation_id, meta)
        return {"ok": True, "snoozed_until": None}
    until = (datetime.now(timezone.utc) + timedelta(minutes=int(body.minutes))).isoformat()
    meta["snoozed_until"] = until
    save_automation_meta(automation_id, meta)
    return {"ok": True, "snoozed_until": until}


@router.delete("/api/automations/{automation_id}")
async def delete_automation_endpoint(automation_id: str):
    from core.automation_file import delete_automation as delete_ziggy_automation
    ha_ok = ha_delete_automation(automation_id)
    ziggy_ok = delete_ziggy_automation(automation_id)
    if not ha_ok and not ziggy_ok:
        _bus.emit("automation", _BASIC, "automation_delete_not_found",
                  automation_id=automation_id, result="not_found")
        raise HTTPException(status_code=404, detail="Automation not found")
    delete_ziggy_actions(automation_id)
    delete_automation_meta(automation_id)
    delete_history(automation_id)
    # Drop any Fake Occupancy activation tied to this automation so a deleted
    # "Away — Simulate Presence" stops the per-minute scheduler immediately.
    try:
        from services import fake_occupancy_scheduler
        fake_occupancy_scheduler.stop(automation_id)
    except Exception:
        pass
    _bus.emit("automation", _BASIC, "automation_deleted",
              automation_id=automation_id,
              ha_deleted=ha_ok, ziggy_deleted=ziggy_ok,
              result="ok")
    return {"ok": True}


# ── Push action callback ─────────────────────────────────────────────────────
# Moved to backend/routers/push_action_router.py in PROMPT_SECURITY_HARDENING_V2.
# The handler is service-worker-driven (no bearer header possible), so it had
# to leave a router mounted under `_auth = [Depends(get_current_user)]`.
# See push_action_router.py for the design rationale and the bucket-D comment.


# ── Fake Occupancy (Away — Simulate Presence) status / stop ─────────────────
# The "start" side runs through the normal Run-automation path (POST /trigger),
# which executes a `fake_occupancy_start` step. These endpoints expose the
# scheduler's internal activation list so the UI can show "Day 3 of 7" and
# offer a Stop button without having to disable the whole automation.

@router.get("/api/automations/fake_occupancy/active")
async def list_fake_occupancy_active():
    from services import fake_occupancy_scheduler
    return {"activations": fake_occupancy_scheduler.list_active()}


@router.post("/api/automations/{automation_id}/fake_occupancy/stop")
async def stop_fake_occupancy(automation_id: str):
    from services import fake_occupancy_scheduler
    stopped = fake_occupancy_scheduler.stop(automation_id)
    return {"ok": True, "stopped": stopped}


# ── Manual override inspection / clearing ────────────────────────────────────

@router.get("/api/overrides")
async def list_overrides():
    from services import manual_overrides
    return {"overrides": manual_overrides.list_active()}


@router.delete("/api/overrides/{entity_id}")
async def clear_override(entity_id: str):
    from services import manual_overrides
    cleared = manual_overrides.clear_override(entity_id)
    return {"ok": True, "cleared": cleared}
