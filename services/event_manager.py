from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, date
from typing import Optional

import dateparser

EVENT_FILE = "user_files/events.json"


def _load() -> list:
    if not os.path.exists(EVENT_FILE):
        return []
    with open(EVENT_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save(events: list) -> None:
    os.makedirs(os.path.dirname(EVENT_FILE), exist_ok=True)
    with open(EVENT_FILE, "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)


def _parse_date(text: str) -> Optional[str]:
    """Parse a natural-language date string to YYYY-MM-DD."""
    dt = dateparser.parse(text, settings={"PREFER_DATES_FROM": "future"})
    return dt.strftime("%Y-%m-%d") if dt else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def add_event(name: str, date_str: str, notes: str = "", repeat: str = "none") -> str:
    """Add a named event with a date."""
    parsed = _parse_date(date_str)
    if not parsed:
        return f"❌ Couldn't understand the date: '{date_str}'."
    events = _load()
    event = {
        "id": str(uuid.uuid4()),
        "name": name.strip(),
        "date": parsed,
        "notes": notes,
        "repeat": repeat,
        "created": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    events.append(event)
    _save(events)
    return f"📅 Event '{name}' added for {parsed}."


def list_events(limit: int = 10) -> str:
    """List upcoming events sorted by date."""
    events = _load()
    today = date.today()
    upcoming = []
    for e in events:
        try:
            ev_date = datetime.strptime(e["date"], "%Y-%m-%d").date()
            delta = (ev_date - today).days
            upcoming.append((delta, e))
        except Exception:
            pass
    upcoming.sort(key=lambda x: x[0])

    if not upcoming:
        return "📅 No upcoming events."

    lines = ["📅 Upcoming events:"]
    for delta, e in upcoming[:limit]:
        if delta < 0:
            label = f"{abs(delta)} days ago"
        elif delta == 0:
            label = "Today!"
        elif delta == 1:
            label = "Tomorrow!"
        else:
            label = f"in {delta} days"
        lines.append(f"• {e['name']} — {e['date']} ({label})")
    return "\n".join(lines)


def remove_event(name: str) -> str:
    """Remove event by name (case-insensitive partial match)."""
    events = _load()
    lower = name.strip().lower()
    updated = [e for e in events if lower not in e["name"].lower()]
    if len(updated) == len(events):
        return f"❌ No event matching '{name}' found."
    removed = len(events) - len(updated)
    _save(updated)
    return f"🗑️ Removed {removed} event(s) matching '{name}'."


def days_until_event(name: str) -> str:
    """Return days until a named event."""
    events = _load()
    lower = name.strip().lower()
    today = date.today()
    matches = [e for e in events if lower in e["name"].lower()]
    if not matches:
        return f"❌ No event named '{name}' found."
    e = matches[0]
    try:
        ev_date = datetime.strptime(e["date"], "%Y-%m-%d").date()
        delta = (ev_date - today).days
        if delta < 0:
            return f"'{e['name']}' was {abs(delta)} day(s) ago ({e['date']})."
        elif delta == 0:
            return f"'{e['name']}' is today! 🎉"
        elif delta == 1:
            return f"'{e['name']}' is tomorrow! ({e['date']})"
        else:
            return f"'{e['name']}' is in {delta} days ({e['date']})."
    except Exception:
        return f"Invalid date for event '{e['name']}'."


def next_event() -> str:
    """Return the single next upcoming event."""
    events = _load()
    today = date.today()
    upcoming = []
    for e in events:
        try:
            ev_date = datetime.strptime(e["date"], "%Y-%m-%d").date()
            delta = (ev_date - today).days
            if delta >= 0:
                upcoming.append((delta, e))
        except Exception:
            pass
    if not upcoming:
        return "No upcoming events."
    upcoming.sort(key=lambda x: x[0])
    delta, e = upcoming[0]
    label = "Today!" if delta == 0 else ("Tomorrow!" if delta == 1 else f"in {delta} days")
    return f"Next event: {e['name']} on {e['date']} ({label})."


def get_all_events() -> list:
    return _load()
