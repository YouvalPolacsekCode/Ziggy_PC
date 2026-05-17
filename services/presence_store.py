"""Thin read-only helpers for the Ziggy-native presence registry.

The canonical read/write logic lives in backend/routers/presence_router.py.
This module exposes read-only helpers so non-HTTP code (anomaly engine,
voice handler) can query presence without importing from the router layer.

Effective state: a ping older than STALE_AFTER_MINUTES degrades to 'unknown'
so a phone that stops reporting is never permanently locked in as 'home'.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

_REGISTRY = Path(__file__).resolve().parent.parent / "user_files" / "persons.json"

# Asymmetric staleness — matches presence_router._effective_state.
# Home persists 8 h (phone backgrounded ≠ person left).
# Away expires in 30 min (they may have come back without opening the app).
STALE_HOME_HOURS   = 8
STALE_AWAY_MINUTES = 30
STALE_AFTER_MINUTES = STALE_AWAY_MINUTES  # kept for any external callers


def load_persons() -> list[dict]:
    try:
        return json.loads(_REGISTRY.read_text(encoding="utf-8"))
    except Exception:
        return []


def effective_state(person: dict) -> str:
    """Return the presence state with asymmetric staleness decay."""
    last_seen = person.get("last_seen")
    if not last_seen:
        return "unknown"
    try:
        ts    = datetime.fromisoformat(last_seen)
        age   = datetime.now(timezone.utc) - ts
        state = person.get("state", "unknown")
        if state == "home":
            if age > timedelta(hours=STALE_HOME_HOURS):
                return "unknown"
        else:
            if age > timedelta(minutes=STALE_AWAY_MINUTES):
                return "unknown"
    except Exception:
        return "unknown"
    return person.get("state", "unknown")


def home_person_names() -> list[str]:
    """Return display names of persons whose effective state is 'home'."""
    return [p["name"] for p in load_persons() if effective_state(p) == "home"]


def all_away() -> bool:
    """True only if the registry is non-empty and every person's effective state is not home."""
    persons = load_persons()
    return bool(persons) and all(effective_state(p) != "home" for p in persons)


def any_home() -> bool:
    return any(effective_state(p) == "home" for p in load_persons())
