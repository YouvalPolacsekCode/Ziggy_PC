from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.logger_module import log_error
from services.suggestion_manager import (
    get_all as get_all_suggestions,
    get_pending as get_pending_suggestions,
    update_status as update_suggestion_status,
)
from services.wizard_prefill import habit_to_wizard_prefill

router = APIRouter()


class SuggestionSnoozeBody(BaseModel):
    days: int = 3


def _enrich_with_prefill(suggestions: list[dict]) -> list[dict]:
    """Attach `wizard_prefill` to each habit suggestion so the Configure
    button can open AutomationWizard with the same shape device-based
    templates use. Failures are non-fatal — the suggestion is returned
    without prefill rather than breaking the whole list."""
    enriched: list[dict] = []
    for s in suggestions:
        try:
            prefill = habit_to_wizard_prefill(s)
        except Exception as exc:
            log_error(f"[Suggestions] wizard_prefill build failed for {s.get('id')}: {exc}")
            prefill = None
        # Shallow copy so we don't mutate the suggestion_manager store.
        out = dict(s)
        if prefill is not None:
            out["wizard_prefill"] = prefill
        enriched.append(out)
    return enriched


@router.get("/api/suggestions")
async def api_get_suggestions():
    return {"suggestions": _enrich_with_prefill(get_all_suggestions())}


@router.get("/api/suggestions/pending")
async def api_get_pending_suggestions():
    pending = _enrich_with_prefill(get_pending_suggestions())
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


# ---------------------------------------------------------------------------
# Unified feed (additive — both /api/suggestions/pending and
# /api/automations/templates/suggested keep working)
# ---------------------------------------------------------------------------

def _habit_to_feed_item(s: dict) -> dict:
    """Project a habit suggestion onto the unified feed shape."""
    return {
        "source":         "habit",
        "id":             s.get("id"),
        "title":          s.get("pattern_summary") or s.get("user_message") or "Suggested automation",
        "description":    s.get("user_message") or s.get("pattern_summary") or "",
        "tier":           "ready",           # habit suggestions are always actionable once surfaced
        "confidence":     s.get("confidence"),
        "icon":           None,
        "wizard_prefill": s.get("wizard_prefill"),
        "raw":            s,
    }


def _template_to_feed_item(t: dict) -> dict:
    """Project an enriched template onto the unified feed shape."""
    return {
        "source":         "template",
        "id":             t.get("id"),
        "title":          t.get("name") or "Suggested automation",
        "description":    t.get("description") or "",
        "tier":           t.get("tier") or "unavailable",
        "confidence":     None,
        "icon":           t.get("icon"),
        "wizard_prefill": t.get("wizard_prefill"),
        "raw":            t,
    }


_TIER_ORDER = {"ready": 0, "partial": 1, "unavailable": 2}


def _feed_sort_key(item: dict) -> tuple:
    """Habits with confidence outrank everything else, then ready templates,
    then partial, then unavailable. Within habits, higher confidence first.
    Within templates, original capability-match ordering is preserved by
    tier alone."""
    src = item["source"]
    tier = _TIER_ORDER.get(item.get("tier"), 3)
    # Habits sort first (bucket 0) so personalised patterns win the top
    # of the Suggested tab. Templates fall in by tier afterwards.
    bucket = 0 if src == "habit" else 1
    conf = item.get("confidence") or 0.0
    # Negate confidence so higher values sort earlier.
    return (bucket, tier, -conf)


@router.get("/api/suggestions/feed")
async def api_unified_suggestion_feed():
    """Discriminated union of habit-based and device-template suggestions.

    Adds `source` as the discriminator. Both legacy endpoints
    (/api/suggestions/pending, /api/automations/templates/suggested)
    keep working unchanged — this is an additive, single-fetch feed
    for the Suggested tab.

    Failures on either side are non-fatal: the surviving side still
    returns so a transient HA outage can't blank the Suggested tab.
    """
    habit_items: list[dict] = []
    template_items: list[dict] = []
    errors: list[str] = []

    # Habit side — local SQLite/JSON only, won't block on HA.
    try:
        habits = _enrich_with_prefill(get_pending_suggestions())
        habit_items = [_habit_to_feed_item(s) for s in habits]
    except Exception as exc:
        log_error(f"[SuggestionsFeed] habit side failed: {exc}")
        errors.append("habit_unavailable")

    # Template side — calls into automation_router which hits HA REST.
    # Imported lazily so a broken HA bridge doesn't prevent the habit
    # side from loading on cold start.
    try:
        from backend.routers.automation_router import get_suggested_templates
        templates_resp = await get_suggested_templates()
        templates = templates_resp.get("suggested", []) if isinstance(templates_resp, dict) else []
        template_items = [_template_to_feed_item(t) for t in templates]
    except Exception as exc:
        log_error(f"[SuggestionsFeed] template side failed: {exc}")
        errors.append("templates_unavailable")

    items = habit_items + template_items
    items.sort(key=_feed_sort_key)

    return {
        "items":          items,
        "count":          len(items),
        "habit_count":    len(habit_items),
        "template_count": len(template_items),
        "errors":         errors,   # empty list means both sides loaded
    }
