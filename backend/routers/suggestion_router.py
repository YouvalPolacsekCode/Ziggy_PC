from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.logger_module import log_error
from services.suggestion_manager import (
    get_all as get_all_suggestions,
    get_pending as get_pending_suggestions,
    update_status as update_suggestion_status,
)

router = APIRouter()


class SuggestionSnoozeBody(BaseModel):
    days: int = 3


@router.get("/api/suggestions")
async def api_get_suggestions():
    return {"suggestions": get_all_suggestions()}


@router.get("/api/suggestions/pending")
async def api_get_pending_suggestions():
    pending = get_pending_suggestions()
    return {"suggestions": pending, "count": len(pending)}


@router.post("/api/suggestions/{sug_id}/accept")
async def api_accept_suggestion(sug_id: str):
    if not update_suggestion_status(sug_id, "accepted"):
        raise HTTPException(status_code=404, detail=f"Suggestion {sug_id} not found")
    return {"ok": True}


@router.post("/api/suggestions/{sug_id}/reject")
async def api_reject_suggestion(sug_id: str):
    if not update_suggestion_status(sug_id, "rejected"):
        raise HTTPException(status_code=404, detail=f"Suggestion {sug_id} not found")
    return {"ok": True}


@router.post("/api/suggestions/{sug_id}/snooze")
async def api_snooze_suggestion(sug_id: str, body: SuggestionSnoozeBody):
    if not update_suggestion_status(sug_id, "snoozed", snooze_days=body.days):
        raise HTTPException(status_code=404, detail=f"Suggestion {sug_id} not found")
    return {"ok": True}


@router.post("/api/suggestions/analyze")
async def api_run_pattern_analysis():
    try:
        from services.suggestion_engine import run_analysis
        new = run_analysis()
        return {"ok": True, "new_count": len(new), "suggestions": new}
    except Exception as e:
        log_error(f"[API] Pattern analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
