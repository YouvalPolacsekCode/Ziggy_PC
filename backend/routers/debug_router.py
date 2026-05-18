"""
Debug API — control debug mode, query buffered events, simulate intents, export reports.

All endpoints require super_admin role.

Endpoints:
  GET  /api/debug/config              — current debug level + scope config
  POST /api/debug/config              — set level and/or scopes
  GET  /api/debug/events              — query buffered debug events
  DELETE /api/debug/events            — clear the debug event buffer
  GET  /api/debug/export              — download full debug report as JSON
  POST /api/debug/simulate            — parse + trace an intent without executing it
  GET  /api/debug/last-request/{id}   — get all events for a specific request_id
"""
from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.routers.auth_deps import require_role
from core.debug_bus import bus, BASIC, VERBOSE, TRACE, _LEVEL_VALUES

router = APIRouter(prefix="/api/debug")

_VALID_SCOPES = {
    "intent", "ha", "ir", "automation", "sensor",
    "presence", "ws", "voice", "scheduler", "general",
}

_VALID_LEVELS = {"off", "basic", "verbose", "trace"}


# ─── Config ──────────────────────────────────────────────────────────────────

@router.get("/config")
async def get_debug_config(_: dict = Depends(require_role("super_admin"))):
    return bus.get_config()


class DebugConfigBody(BaseModel):
    level:  Optional[str]       = None   # "off" | "basic" | "verbose" | "trace"
    scopes: Optional[List[str]] = None   # [] = all; ["intent","ha"] = filter


@router.post("/config")
async def set_debug_config(body: DebugConfigBody, _: dict = Depends(require_role("super_admin"))):
    if body.level is not None:
        if body.level not in _VALID_LEVELS:
            raise HTTPException(400, f"Invalid level '{body.level}'. Must be one of: {sorted(_VALID_LEVELS)}")
        bus.set_level(body.level)

    if body.scopes is not None:
        invalid = set(body.scopes) - _VALID_SCOPES - {""}
        if invalid:
            raise HTTPException(400, f"Unknown scopes: {sorted(invalid)}. Valid: {sorted(_VALID_SCOPES)}")
        bus.set_scopes(body.scopes)

    # Persist to settings.yaml so debug config survives server restarts
    from core.settings_loader import settings, save_settings
    debug = settings.setdefault("debug", {})
    if body.level is not None:
        debug["level"] = body.level
    if body.scopes is not None:
        debug["scopes"] = body.scopes
    save_settings(settings)

    return {"ok": True, **bus.get_config()}


# ─── Events ──────────────────────────────────────────────────────────────────

@router.get("/events")
async def get_debug_events(
    limit:      int           = Query(100, ge=1, le=500),
    scope:      Optional[str] = Query(None),
    level:      Optional[str] = Query(None),
    request_id: Optional[str] = Query(None, alias="request_id"),
    result:     Optional[str] = Query(None),
    _: dict = Depends(require_role("super_admin")),
):
    events = bus.get_events(
        limit=limit,
        scope=scope,
        level=level,
        request_id=request_id,
        result=result,
    )
    return {
        "events": events,
        "count": len(events),
        "config": bus.get_config(),
    }


@router.delete("/events")
async def clear_debug_events(_: dict = Depends(require_role("super_admin"))):
    bus.clear()
    return {"ok": True, "message": "Debug event buffer cleared."}


# ─── Export ──────────────────────────────────────────────────────────────────

@router.get("/export")
async def export_debug_report(_: dict = Depends(require_role("super_admin"))):
    report = bus.export()
    content = json.dumps(report, indent=2, ensure_ascii=False, default=str)
    return JSONResponse(
        content=report,
        headers={"Content-Disposition": "attachment; filename=ziggy_debug_report.json"},
    )


# ─── Per-request trace ───────────────────────────────────────────────────────

@router.get("/request/{request_id}")
async def get_request_trace(
    request_id: str,
    _: dict = Depends(require_role("super_admin")),
):
    events = bus.get_events(limit=500, request_id=request_id)
    if not events:
        return {"events": [], "request_id": request_id, "found": False}

    timeline = sorted(events, key=lambda e: e.get("ts", ""))
    first = timeline[0]
    last = timeline[-1]

    # Summarise: what was the outcome?
    result_events = [e for e in timeline if e.get("data", {}).get("result")]
    final_result = result_events[-1]["data"]["result"] if result_events else "unknown"
    intent = next((e["data"].get("intent") for e in timeline if "intent" in e.get("data", {})), None)

    return {
        "request_id": request_id,
        "found": True,
        "intent": intent,
        "final_result": final_result,
        "started_at": first.get("ts"),
        "ended_at":   last.get("ts"),
        "steps": len(timeline),
        "timeline": timeline,
    }


# ─── Simulate (dry-run) ───────────────────────────────────────────────────────

class SimulateBody(BaseModel):
    text:   Optional[str]  = None   # natural language input
    intent: Optional[str]  = None   # or provide intent directly
    params: dict           = {}


@router.post("/simulate")
async def simulate_intent(body: SimulateBody, _: dict = Depends(require_role("super_admin"))):
    """
    Parse and trace an intent WITHOUT executing it.
    Returns what Ziggy would have done: intent, params, which handler, plus a full
    debug event trace — all with dry_run=True so no HA calls, no state changes.
    """
    import uuid as _uuid
    from core.intent_parser import quick_parse
    from core.action_parser import handle_intent
    from core.result_utils import render_result

    # Temporarily force debug to at least VERBOSE for the simulation
    prev_level = bus._level
    if bus._level < VERBOSE:
        bus.set_level("verbose")

    request_id = f"sim_{_uuid.uuid4().hex[:8]}"
    bus.emit("intent", BASIC, "simulation_start",
             request_id=request_id,
             input=body.text,
             intent_override=body.intent,
             params_override=body.params)

    try:
        if body.text:
            intent_data = quick_parse(body.text)
            intent_data["_raw_input"] = body.text
        elif body.intent:
            intent_data = {"intent": body.intent, "params": body.params}
        else:
            raise HTTPException(400, "Provide 'text' or 'intent'.")

        intent_data["source"] = "simulation"
        intent_data["request_id"] = request_id
        intent_data["dry_run"] = True

        result = await handle_intent(intent_data)
        reply = render_result(result)

        # Collect the events generated during this simulation
        sim_events = bus.get_events(limit=50, request_id=request_id)

        bus.emit("intent", BASIC, "simulation_complete",
                 request_id=request_id,
                 intent=intent_data.get("intent"),
                 result="ok" if result.get("ok") else "dry_run",
                 steps=len(sim_events))

        return {
            "ok": True,
            "request_id": request_id,
            "parsed_intent": intent_data.get("intent"),
            "params": intent_data.get("params", {}),
            "reply": reply,
            "dry_run": True,
            "events": sim_events,
        }

    finally:
        # Restore previous debug level
        bus.set_level(prev_level)


# ─── Quick diagnostics ────────────────────────────────────────────────────────

@router.get("/status")
async def get_debug_status(_: dict = Depends(require_role("super_admin"))):
    """
    Lightweight check: debug config + latest 5 events.
    Useful for confirming debug mode is active without loading the full page.
    """
    return {
        "config":        bus.get_config(),
        "recent_events": bus.get_events(limit=5),
    }


@router.post("/self-test")
async def debug_self_test(_: dict = Depends(require_role("super_admin"))):
    """
    Emit a test event and return a full diagnostic snapshot.
    Tells you: whether the bus is active, whether the WS callback is wired,
    and whether the event made it into the buffer.
    """
    ws_callback_wired = bus._ws_callback is not None
    loop_stored = bus._loop is not None
    was_active = bus.is_active("general", BASIC)

    # Force the bus on for this test regardless of current level
    prev_level = bus._level
    bus.set_level("basic")

    test_event = bus.emit(
        "general", BASIC, "debug_self_test",
        message="Self-test triggered from /api/debug/self-test",
        result="ok",
    )

    bus.set_level(prev_level)

    return {
        "config":             bus.get_config(),
        "ws_callback_wired":  ws_callback_wired,
        "event_loop_stored":  loop_stored,
        "was_active_before":  was_active,
        "test_event_emitted": test_event is not None,
        "test_event":         test_event,
        "buffer_size":        len(bus.get_events(limit=500)),
        "diagnosis": (
            "OK — bus is wired and events are flowing"
            if ws_callback_wired and test_event
            else "PROBLEM — see ws_callback_wired and test_event_emitted fields"
        ),
    }
