"""Alerts inbox endpoint for the Hub.

The existing /map/anomalies/active feeds the map view; this endpoint returns
the same active anomalies flattened into a sorted list suitable for the Hub's
alerts widget. No new alert storage — single source of truth stays in
services/anomaly_engine.py's active_anomalies dict.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from backend.routers.auth_deps import get_current_user

router = APIRouter()


@router.get("/api/alerts")
async def list_alerts(limit: int = 20, severity: Optional[str] = None,
                      user: dict = Depends(get_current_user)):
    """Flattened list of active anomalies, newest first.

    `limit` caps the response (1..100); the Hub widget typically asks for 5–10.
    `severity` filters to "critical" or "warning" when set.
    """
    try:
        from services.anomaly_engine import active_anomalies
    except Exception:
        active_anomalies = {}

    # Resolve room_id → real HA area name (single source), never leak entity_ids.
    from services.ha_areas import get_area_name_map, resolve_room_name
    name_by_id = await get_area_name_map()

    limit = max(1, min(int(limit or 20), 100))
    out = []
    for room_id, items in (active_anomalies or {}).items():
        for it in items or []:
            if severity and it.get("severity") != severity:
                continue
            out.append({
                "room_id":    room_id,
                "room_name":  resolve_room_name(room_id, name_by_id),
                "rule_id":    it.get("rule_id"),
                "severity":   it.get("severity") or "warning",
                "message":    it.get("message") or "",
                "confidence": it.get("confidence"),
                "since":      it.get("since"),
                "action_available": bool(it.get("action_available")),
                "suggested_action": it.get("suggested_action"),
            })
    out.sort(key=lambda a: a.get("since") or 0, reverse=True)
    return {"alerts": out[:limit], "total": len(out)}
