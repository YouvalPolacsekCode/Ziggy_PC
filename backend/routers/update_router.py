"""
/api/update — Home Assistant update status and breaking-change analysis.

GET  /api/update/status    — cached check (fast, 1 h TTL)
POST /api/update/check     — force a fresh check right now
POST /api/update/dismiss   — dismiss the warning for the current latest version
GET  /api/update/history   — list of previously detected updates
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/api/update/status")
async def get_update_status():
    """Return cached update status (re-uses last result if < 1 h old)."""
    from services.ha_update_checker import check_for_update
    return check_for_update(force=False)


@router.post("/api/update/check")
async def force_update_check():
    """Force a fresh check, bypassing the cache."""
    from services.ha_update_checker import check_for_update
    return check_for_update(force=True)


@router.post("/api/update/dismiss")
async def dismiss_update(body: dict = {}):
    """
    Mark the current latest_version warning as dismissed.
    Body: { "version": "2024.4.2" }
    """
    from services.ha_update_checker import dismiss_update as _dismiss, check_for_update
    version = body.get("version")
    if not version:
        # Dismiss whatever the latest version currently is
        status = check_for_update(force=False)
        version = status.get("latest_version")
    if version:
        _dismiss(version)
    return {"ok": True, "dismissed_version": version}


@router.get("/api/update/history")
async def get_update_history():
    """Return the list of previously detected update events (newest first)."""
    from services.ha_update_checker import get_history
    return {"history": get_history()}
