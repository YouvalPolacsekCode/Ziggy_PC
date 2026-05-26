"""
Structured event logger for pattern learning.

Appends one normalized JSON line per handled intent to user_files/events.jsonl.
This file is the raw data source for the pattern detector.

Three hygiene filters applied at log time:
  1. Session dedup  — same (intent, room, action) within 60 s from same source is a retry,
                      not a new occurrence. Discarded.
  2. Reversal mark  — if an event is immediately followed by the opposite action on the same
                      (intent, room) within 120 s, both are tagged reversed=true and excluded
                      from pattern analysis. Reversals are mistakes, not habits.
  3. Automatable    — query intents (get_*, is_*) are logged but tagged automatable=false
                      so the detector ignores them.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

EVENTS_FILE = Path("user_files/events.jsonl")

# Intents that are meta/system — never log. These represent user interactions
# with Ziggy itself (browsing, managing, asking) — they aren't habits Ziggy can
# turn into automations, so they have no business in the pattern store.
_SKIP_INTENTS = {
    "ziggy_identity", "ziggy_help", "ziggy_status", "ziggy_chat",
    "get_time", "get_date", "get_day_of_week",
    "get_system_status", "get_ip_address", "get_disk_usage",
    "get_wifi_status", "get_network_adapters", "get_network_info",
    "restart_ziggy", "shutdown_ziggy",
    "chat_with_gpt",
    "list_suggestions", "accept_suggestion", "reject_suggestion",
    "snooze_suggestion", "explain_suggestion",
    "ping_test",
    "debug_mode",
    # Failed parses — not a behavior, just noise
    "unrecognized_command", "unknown_intent",
    # Listing / browsing — queries about Ziggy state, not habits
    "list_rooms", "list_devices", "list_active_devices",
    "list_automations", "list_routines",
    "list_tasks", "list_notes", "list_reminders",
    # Automation / routine management — meta actions on Ziggy
    "create_automation", "update_automation", "delete_automation",
    "trigger_automation", "toggle_automation",
    "create_routine", "delete_routine",
    # Tasks / notes / reminders — separate subsystem, not home-automation habits
    "add_task", "update_task", "delete_task", "complete_task",
    "save_note", "read_note", "delete_note",
    "add_reminder", "delete_reminder",
}

# Intents that read state — log them but mark automatable=false so the detector skips them
_QUERY_INTENTS = {
    "get_temperature", "get_humidity", "get_sensor", "get_sensor_data",
    "is_someone_home", "get_presence", "list_devices", "list_active_devices",
    "get_device_state", "get_light_state", "get_room_summary",
}

# Gap within which the same action is treated as a retry, not a new occurrence
_SESSION_DEDUP_SECONDS = 60

# Gap within which an opposite action is treated as a reversal (correction, not a habit)
_REVERSAL_WINDOW_SECONDS = 120


def log_event(intent: str, params: dict, result: dict, source: str) -> None:
    """Append a normalized, hygiene-filtered event record to the JSONL event log."""
    if intent in _SKIP_INTENTS:
        return

    automatable = intent not in _QUERY_INTENTS
    now = datetime.now()
    action = _extract_action(intent, params)
    room = params.get("room")

    # --- Filter 1: session dedup ---
    if automatable and _is_recent_duplicate(intent, room, action, source, now):
        return

    entry = {
        "ts": now.isoformat(timespec="seconds"),
        "source": source,
        "intent": intent,
        "room": room,
        "entity_id": params.get("entity_id"),
        "action": action,
        "value": _extract_value(params),
        "result": "ok" if result.get("ok") else "err",
        "automatable": automatable,
        "reversed": False,
        "ctx": {
            "hour": now.hour,
            "minute": now.minute,
            "day_of_week": now.weekday(),  # 0=Mon, 6=Sun
            "time_slot": _time_slot(now.hour),
        },
    }

    try:
        EVENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(EVENTS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except OSError:
        return  # Never crash Ziggy because of logging

    # --- Filter 2: reversal marking (post-write) ---
    if automatable and result.get("ok"):
        _mark_reversal_pair(intent, room, action, now)


def load_events(lookback_days: int = 30) -> list[dict]:
    """Load events from the last N days, oldest first."""
    if not EVENTS_FILE.exists():
        return []

    cutoff = datetime.now().timestamp() - lookback_days * 86400
    events: list[dict] = []

    with open(EVENTS_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
                ts = datetime.fromisoformat(ev["ts"]).timestamp()
                if ts >= cutoff:
                    events.append(ev)
            except (json.JSONDecodeError, KeyError, ValueError):
                continue

    return events


def inject_sample_events(events: list[dict]) -> None:
    """Write sample events directly to the log (used for testing only)."""
    EVENTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(EVENTS_FILE, "a", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")


# ---------------------------------------------------------------------------
# Hygiene helpers
# ---------------------------------------------------------------------------

def _is_recent_duplicate(
    intent: str, room: str | None, action: str, source: str, now: datetime
) -> bool:
    """Return True if the same (intent, room, action, source) was logged within the dedup window."""
    if not EVENTS_FILE.exists():
        return False

    cutoff = now - timedelta(seconds=_SESSION_DEDUP_SECONDS)
    try:
        with open(EVENTS_FILE, "rb") as f:
            # Read last 8 KB — enough to cover recent events without loading the whole file
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 8192))
            tail = f.read().decode("utf-8", errors="ignore")
    except OSError:
        return False

    for line in reversed(tail.splitlines()):
        if not line.strip():
            continue
        try:
            ev = json.loads(line)
            ts = datetime.fromisoformat(ev["ts"])
            if ts < cutoff:
                break
            if (
                ev.get("intent") == intent
                and ev.get("room") == room
                and ev.get("action") == action
                and ev.get("source") == source
            ):
                return True
        except (json.JSONDecodeError, KeyError, ValueError):
            continue

    return False


def _mark_reversal_pair(
    intent: str, room: str | None, action: str, now: datetime
) -> None:
    """
    Scan the recent log for the opposite action on the same (intent, room).
    If found within the reversal window, rewrite both lines as reversed=true.

    Operates on the tail of the file to stay efficient.
    """
    opposite = _opposite_action(action)
    if opposite is None:
        return

    if not EVENTS_FILE.exists():
        return

    cutoff = now - timedelta(seconds=_REVERSAL_WINDOW_SECONDS)

    try:
        with open(EVENTS_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return

    # Scan from the end; only look at the tail within the reversal window
    changed = False
    # Mark the just-written event (last line) as reversed
    last_idx = len(lines) - 1
    if last_idx < 0:
        return

    for i in range(last_idx - 1, max(last_idx - 50, -1), -1):
        line = lines[i].strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            ts = datetime.fromisoformat(ev["ts"])
            if ts < cutoff:
                break
            if (
                ev.get("intent") == intent
                and ev.get("room") == room
                and ev.get("action") == opposite
                and not ev.get("reversed", False)
            ):
                # Mark the prior event as reversed
                ev["reversed"] = True
                lines[i] = json.dumps(ev) + "\n"
                # Mark the current (last) event as reversed too
                try:
                    last_ev = json.loads(lines[last_idx].strip())
                    last_ev["reversed"] = True
                    lines[last_idx] = json.dumps(last_ev) + "\n"
                except (json.JSONDecodeError, KeyError):
                    pass
                changed = True
                break
        except (json.JSONDecodeError, KeyError, ValueError):
            continue

    if changed:
        try:
            with open(EVENTS_FILE, "w", encoding="utf-8") as f:
                f.writelines(lines)
        except OSError:
            pass


def _opposite_action(action: str) -> str | None:
    pairs = {"on": "off", "off": "on", "open": "close", "close": "open"}
    return pairs.get(action)


# ---------------------------------------------------------------------------
# Field extractors
# ---------------------------------------------------------------------------

def _time_slot(hour: int) -> str:
    if 5 <= hour < 9:
        return "early_morning"
    if 9 <= hour < 12:
        return "morning"
    if 12 <= hour < 14:
        return "midday"
    if 14 <= hour < 18:
        return "afternoon"
    if 18 <= hour < 22:
        return "evening"
    return "night"


def _extract_action(intent: str, params: dict) -> str:
    if "turn_on" in params:
        return "on" if params["turn_on"] else "off"
    if "action" in params:
        return str(params["action"])
    parts = intent.split("_")
    return parts[0] if parts else intent


def _extract_value(params: dict) -> str | None:
    for key in ("temperature", "brightness", "color", "volume", "value"):
        if key in params:
            return str(params[key])
    return None
