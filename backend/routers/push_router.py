from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user
from services.push_notify import (
    get_vapid_public_key,
    add_subscription,
    remove_subscription,
    load_subs,
    push_notify,
)
from services.push_preferences import CATEGORIES, get_prefs, set_prefs

router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class PushSubscription(BaseModel):
    endpoint: str
    keys: dict
    user_agent: str = ""


class RevokeBody(BaseModel):
    endpoint: str


class PrefsPatch(BaseModel):
    categories: dict | None = None
    quiet_hours: dict | None = None


# ── VAPID public key ──────────────────────────────────────────────────────────

@router.get("/api/push/vapid-public-key")
async def vapid_public_key(_=Depends(get_current_user)):
    return {"publicKey": get_vapid_public_key()}


# ── Subscribe / unsubscribe ───────────────────────────────────────────────────

@router.post("/api/push/subscribe")
async def subscribe(body: PushSubscription, user=Depends(get_current_user)):
    add_subscription({
        "endpoint":      body.endpoint,
        "keys":          body.keys,
        "user_id":       user["username"],
        "user_agent":    body.user_agent,
        "subscribed_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"ok": True}


@router.delete("/api/push/subscribe")
async def unsubscribe(body: RevokeBody, user=Depends(get_current_user)):
    remove_subscription(body.endpoint)
    return {"ok": True}


# ── Device list (this user's subscriptions) ───────────────────────────────────

@router.get("/api/push/devices")
async def list_devices(user=Depends(get_current_user)):
    subs = load_subs()
    user_subs = [s for s in subs if s.get("user_id") == user["username"]]
    return {
        "devices": [
            {
                "endpoint":      s["endpoint"],
                "user_agent":    s.get("user_agent", ""),
                "subscribed_at": s.get("subscribed_at"),
            }
            for s in user_subs
        ]
    }


# ── Preferences ───────────────────────────────────────────────────────────────

@router.get("/api/push/preferences")
async def get_preferences(user=Depends(get_current_user)):
    prefs = get_prefs(user["username"])
    return {"preferences": prefs, "category_labels": CATEGORIES}


@router.patch("/api/push/preferences")
async def update_preferences(body: PrefsPatch, user=Depends(get_current_user)):
    patch: dict = {}
    if body.categories is not None:
        patch["categories"] = body.categories
    if body.quiet_hours is not None:
        patch["quiet_hours"] = body.quiet_hours
    if patch:
        set_prefs(user["username"], patch)
    return {"ok": True}


# ── Test push ─────────────────────────────────────────────────────────────────

@router.post("/api/push/test")
async def send_test(user=Depends(get_current_user)):
    await push_notify("Ziggy", "Push notifications are working.", "/", category="general")
    return {"ok": True}


# ── Dynamic category list ─────────────────────────────────────────────────────

@router.get("/api/push/categories")
async def get_categories(user=Depends(get_current_user)):
    """Return all push categories: fixed system ones + one per configured sensor."""
    from core.settings_loader import settings as _s
    from services.push_preferences import get_prefs

    prefs = get_prefs(user["username"])
    cat_prefs = prefs.get("categories", {})

    system = [
        {"id": "anomaly_critical", "label": "Critical anomalies",  "description": "Fires even during quiet hours", "bypass_quiet_hours": True,  "type": "system"},
        {"id": "anomaly_warning",  "label": "Anomaly warnings",    "description": "Lights left on, door open, etc.",                            "type": "system"},
        {"id": "task_reminder",    "label": "Task reminders",      "description": "When a task reminder fires",                                 "type": "system"},
        {"id": "presence",         "label": "Presence changes",    "description": "Someone arrives or leaves home",                             "type": "system"},
        {"id": "automation",       "label": "Automation notify",   "description": "Notify steps in automations",                                "type": "system"},
        {"id": "suggestion",       "label": "Suggestions",         "description": "New automation suggestions ready",                           "type": "system"},
    ]

    sensors = []
    for s in _s.get("sensor_alerts", {}).get("sensors", []):
        eid = s.get("entity_id", "")
        if not eid:
            continue
        cat_id = f"sensor:{eid}"
        sensors.append({
            "id":          cat_id,
            "label":       s.get("label", eid),
            "description": s.get("message", ""),
            "type":        "sensor",
            "entity_id":   eid,
            "conditions":  s.get("conditions", {}),
        })

    # Annotate each category with the user's current enabled state
    all_cats = system + sensors
    for c in all_cats:
        default = False if c["id"] == "suggestion" else True
        c["enabled"] = cat_prefs.get(c["id"], default)

    return {"categories": all_cats}
