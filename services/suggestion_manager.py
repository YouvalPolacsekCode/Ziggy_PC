"""
Suggestion CRUD for pattern-learning automation suggestions.

Suggestions are persisted to user_files/suggestions.json.
Each suggestion has a lifecycle: pending → accepted/rejected/snoozed → implemented.

Ziggy never creates automations silently. All suggestions require user approval.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path

SUGGESTIONS_FILE = Path("user_files/suggestions.json")


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _load() -> list[dict]:
    if not SUGGESTIONS_FILE.exists():
        return []
    with open(SUGGESTIONS_FILE, encoding="utf-8") as f:
        return json.load(f)


def _save(suggestions: list[dict]) -> None:
    SUGGESTIONS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SUGGESTIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(suggestions, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Write API
# ---------------------------------------------------------------------------

def add_suggestion(
    pattern_type: str,
    pattern_summary: str,
    user_message: str,
    trigger: dict,
    actions: list[dict],
    confidence: float,
    reasoning: str,
    safety_note: str | None = None,
) -> dict:
    """
    Add a new suggestion. If a pending/snoozed suggestion with the same
    pattern_summary already exists, return that instead of creating a duplicate.
    """
    suggestions = _load()

    for s in suggestions:
        if (
            s["pattern_summary"] == pattern_summary
            and s["status"] in ("pending", "snoozed")
        ):
            return s

    sug: dict = {
        "id": f"sug_{uuid.uuid4().hex[:8]}",
        "pattern_type": pattern_type,
        "pattern_summary": pattern_summary,
        "user_message": user_message,
        "trigger": trigger,
        "actions": actions,
        "confidence": round(confidence, 2),
        "reasoning": reasoning,
        "safety_note": safety_note,
        "status": "pending",
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "seen_at": None,
        "responded_at": None,
        "snooze_until": None,
    }
    suggestions.append(sug)
    _save(suggestions)
    return sug


def update_status(sug_id: str, status: str, snooze_days: int = 3) -> bool:
    """Update a suggestion's status. Returns True if found."""
    suggestions = _load()
    for s in suggestions:
        if s["id"] == sug_id:
            s["status"] = status
            s["responded_at"] = datetime.now().isoformat(timespec="seconds")
            if status == "snoozed":
                until = datetime.now() + timedelta(days=snooze_days)
                s["snooze_until"] = until.isoformat(timespec="seconds")
            _save(suggestions)
            return True
    return False


def mark_seen(sug_id: str) -> None:
    suggestions = _load()
    for s in suggestions:
        if s["id"] == sug_id and s.get("seen_at") is None:
            s["seen_at"] = datetime.now().isoformat(timespec="seconds")
    _save(suggestions)


# ---------------------------------------------------------------------------
# Read API
# ---------------------------------------------------------------------------

def get_pending() -> list[dict]:
    """Return all suggestions that are actionable right now."""
    now = datetime.now()
    results: list[dict] = []
    changed = False

    suggestions = _load()
    for s in suggestions:
        if s["status"] == "pending":
            results.append(s)
        elif s["status"] == "snoozed" and s.get("snooze_until"):
            if datetime.fromisoformat(s["snooze_until"]) <= now:
                s["status"] = "pending"
                s["snooze_until"] = None
                results.append(s)
                changed = True

    if changed:
        _save(suggestions)
    return results


def get_all() -> list[dict]:
    return _load()


def get_by_id(sug_id: str) -> dict | None:
    for s in _load():
        if s["id"] == sug_id:
            return s
    return None


def count_pending() -> int:
    return len(get_pending())
