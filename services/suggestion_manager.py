"""
Suggestion CRUD + lifecycle for Ziggy pattern-learning automation suggestions.

Key invariants:
  - At most MAX_PENDING suggestions in PENDING state at any time.
  - A suggestion that has been rejected or expired twice is permanently suppressed.
  - Rejected canonical keys are remembered across analysis runs so the same pattern
    never resurfaces as a new suggestion.
  - Suggestions in PENDING state are never updated — users see stable content.
  - Suggestions unseen for EXPIRY_DAYS are automatically expired.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta
from pathlib import Path

SUGGESTIONS_FILE = Path("user_files/suggestions.json")
REJECTED_PATTERNS_FILE = Path("user_files/rejected_patterns.json")

MAX_PENDING = 3
EXPIRY_DAYS = 14        # PENDING suggestion not seen for this many days → expired
REJECTION_COOLDOWN_DAYS = 30   # after first rejection, re-evaluate after this period


# ---------------------------------------------------------------------------
# Persistence — suggestions
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
# Persistence — rejection memory
# ---------------------------------------------------------------------------

def _load_rejected() -> dict:
    if not REJECTED_PATTERNS_FILE.exists():
        return {}
    try:
        with open(REJECTED_PATTERNS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_rejected(data: dict) -> None:
    REJECTED_PATTERNS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(REJECTED_PATTERNS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Rejection memory API
# ---------------------------------------------------------------------------

def is_suppressed(canonical_key: str) -> bool:
    """Return True if this pattern key is permanently suppressed."""
    return _load_rejected().get(canonical_key, {}).get("suppressed", False)


def record_rejection(canonical_key: str) -> None:
    """Record a rejection event; suppress after 2 rejections."""
    data = _load_rejected()
    entry = data.get(canonical_key, {"rejection_count": 0, "suppressed": False})
    entry["rejection_count"] = entry.get("rejection_count", 0) + 1
    entry["last_rejected"] = datetime.now().isoformat(timespec="seconds")
    if entry["rejection_count"] >= 2:
        entry["suppressed"] = True
    data[canonical_key] = entry
    _save_rejected(data)


def record_expiry(canonical_key: str) -> None:
    """Record an expiry event; suppress after 2 expirations."""
    data = _load_rejected()
    entry = data.get(canonical_key, {"expiry_count": 0, "suppressed": False})
    entry["expiry_count"] = entry.get("expiry_count", 0) + 1
    entry["last_expired"] = datetime.now().isoformat(timespec="seconds")
    if entry.get("rejection_count", 0) + entry["expiry_count"] >= 2:
        entry["suppressed"] = True
    data[canonical_key] = entry
    _save_rejected(data)


def within_rejection_cooldown(canonical_key: str) -> bool:
    """Return True if a rejected pattern is still within its cooldown period."""
    entry = _load_rejected().get(canonical_key)
    if not entry:
        return False
    last = entry.get("last_rejected") or entry.get("last_expired")
    if not last:
        return False
    try:
        last_dt = datetime.fromisoformat(last)
        return (datetime.now() - last_dt).days < REJECTION_COOLDOWN_DAYS
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Write API
# ---------------------------------------------------------------------------

def add_suggestion(
    canonical_key: str,
    pattern_type: str,
    pattern_summary: str,
    user_message: str,
    trigger: dict,
    actions: list[dict],
    confidence: float,
    reasoning: str,
    safety_note: str | None = None,
    evidence_summary: dict | None = None,
) -> dict | None:
    """
    Add a new suggestion.

    Returns the suggestion dict if created, or None if:
      - an identical suggestion is already pending/snoozed
      - the canonical key is suppressed
      - the pending cap (MAX_PENDING) is already reached
    """
    # Check suppression
    if is_suppressed(canonical_key):
        return None

    # Check cooldown
    if within_rejection_cooldown(canonical_key):
        return None

    suggestions = _load()

    # Check if already pending or snoozed (by canonical_key OR pattern_summary)
    for s in suggestions:
        if s.get("status") in ("pending", "snoozed"):
            if s.get("canonical_key") == canonical_key:
                return s
            if s.get("pattern_summary") == pattern_summary:
                return s

    # Enforce pending cap
    pending_count = sum(
        1 for s in suggestions if s.get("status") == "pending"
    )
    if pending_count >= MAX_PENDING:
        return None

    sug: dict = {
        "id": f"sug_{uuid.uuid4().hex[:8]}",
        "canonical_key": canonical_key,
        "pattern_type": pattern_type,
        "pattern_summary": pattern_summary,
        "user_message": user_message,
        "trigger": trigger,
        "actions": actions,
        "confidence": round(confidence, 3),
        "reasoning": reasoning,
        "evidence_summary": evidence_summary,
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
    """Update a suggestion's status. Records rejections into the rejection memory."""
    suggestions = _load()
    for s in suggestions:
        if s["id"] != sug_id:
            continue

        s["status"] = status
        s["responded_at"] = datetime.now().isoformat(timespec="seconds")

        if status == "snoozed":
            until = datetime.now() + timedelta(days=snooze_days)
            s["snooze_until"] = until.isoformat(timespec="seconds")

        elif status == "rejected":
            ckey = s.get("canonical_key", s.get("pattern_summary", ""))
            if ckey:
                record_rejection(ckey)
            # Also tell the pattern detector to mark this candidate suppressed if needed
            _maybe_suppress_candidate(ckey)

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
    """Return actionable suggestions, auto-expiring stale ones and waking snoozed ones."""
    now = datetime.now()
    suggestions = _load()
    changed = False
    results: list[dict] = []

    for s in suggestions:
        status = s.get("status")

        # Wake snoozed suggestions
        if status == "snoozed" and s.get("snooze_until"):
            if datetime.fromisoformat(s["snooze_until"]) <= now:
                s["status"] = "pending"
                s["snooze_until"] = None
                changed = True
                status = "pending"

        # Auto-expire pending suggestions the user has seen but not acted on
        if status == "pending" and s.get("seen_at"):
            seen_dt = datetime.fromisoformat(s["seen_at"])
            if (now - seen_dt).days >= EXPIRY_DAYS:
                s["status"] = "expired"
                ckey = s.get("canonical_key", s.get("pattern_summary", ""))
                if ckey:
                    record_expiry(ckey)
                changed = True
                continue

        if s.get("status") == "pending":
            results.append(s)

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


def pending_slots_available() -> int:
    """How many more suggestions can be promoted to PENDING right now."""
    suggestions = _load()
    current = sum(1 for s in suggestions if s.get("status") == "pending")
    return max(0, MAX_PENDING - current)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _maybe_suppress_candidate(canonical_key: str) -> None:
    """If the rejection memory marks this key as suppressed, propagate to the candidate store."""
    if not is_suppressed(canonical_key):
        return
    try:
        from services.pattern_detector import mark_candidate_suppressed
        mark_candidate_suppressed(canonical_key)
    except Exception:
        pass
