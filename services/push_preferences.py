"""Per-user push notification preferences.

Preferences are keyed by username and stored in user_files/push_preferences.json.
Each user can toggle notification categories and configure quiet hours.

Category "anomaly_critical" bypasses quiet hours — it is always delivered.
"""
from __future__ import annotations

import json
import threading
from datetime import datetime
from pathlib import Path

_PREFS_FILE = Path("user_files/push_preferences.json")
_lock = threading.Lock()

CATEGORIES: dict[str, str] = {
    "anomaly_critical": "Critical anomalies",
    "anomaly_warning":  "Anomaly warnings",
    "task_reminder":    "Task reminders",
    "sensor_alert":     "Sensor alerts",
    "presence":         "Presence changes",
    "suggestion":       "Suggestions",
    "automation":       "Automation notifications",
}

_DEFAULT_PREFS: dict = {
    "categories": {
        **{k: True for k in CATEGORIES},
        "suggestion": False,  # low-urgency; shown in-app, not worth a push by default
    },
    "quiet_hours": {"enabled": False, "start": "23:00", "end": "07:00"},
}


# ── Persistence ───────────────────────────────────────────────────────────────

def _load() -> dict:
    try:
        return json.loads(_PREFS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save(all_prefs: dict) -> None:
    _PREFS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _PREFS_FILE.write_text(json.dumps(all_prefs, indent=2, ensure_ascii=False), encoding="utf-8")


def get_prefs(user_id: str) -> dict:
    """Return preferences for user_id, filling missing keys with defaults."""
    import copy
    with _lock:
        all_prefs = _load()
    user = all_prefs.get(user_id, {})
    merged = copy.deepcopy(_DEFAULT_PREFS)
    merged["categories"].update(user.get("categories", {}))
    merged["quiet_hours"].update(user.get("quiet_hours", {}))
    return merged


def set_prefs(user_id: str, patch: dict) -> None:
    """Deep-merge patch into user's preferences and persist."""
    with _lock:
        all_prefs = _load()
        user = all_prefs.setdefault(user_id, {})
        if "categories" in patch:
            user.setdefault("categories", {}).update(patch["categories"])
        if "quiet_hours" in patch:
            user.setdefault("quiet_hours", {}).update(patch["quiet_hours"])
        _save(all_prefs)


# ── Gate logic ────────────────────────────────────────────────────────────────

def _in_quiet_hours(prefs: dict) -> bool:
    qh = prefs.get("quiet_hours", {})
    if not qh.get("enabled"):
        return False
    try:
        now = datetime.now()
        current = now.hour * 60 + now.minute
        sh, sm = map(int, qh.get("start", "23:00").split(":"))
        eh, em = map(int, qh.get("end",   "07:00").split(":"))
        start, end = sh * 60 + sm, eh * 60 + em
        if start <= end:
            return start <= current < end
        return current >= start or current < end   # overnight window
    except Exception:
        return False


def is_allowed(user_id: str, category: str) -> bool:
    """Return True if this category should be pushed to this user right now."""
    prefs = get_prefs(user_id)

    # Category enabled check
    if not prefs["categories"].get(category, True):
        return False

    # Quiet hours — critical anomalies always get through
    if category != "anomaly_critical" and _in_quiet_hours(prefs):
        return False

    return True
