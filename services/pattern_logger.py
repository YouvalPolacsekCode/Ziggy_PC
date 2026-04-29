"""
Structured event logger for pattern learning.

Appends one normalized JSON line per handled intent to user_files/events.jsonl.
This file is the raw data source for the pattern detector.

Privacy: values are included but redacted in LLM prompts upstream.
Log is local-only and never sent anywhere in raw form.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

EVENTS_FILE = Path("user_files/events.jsonl")

# Intents that produce noise or are meta/system — skip logging them
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
}


def log_event(intent: str, params: dict, result: dict, source: str) -> None:
    """Append a normalized event record to the JSONL event log."""
    if intent in _SKIP_INTENTS:
        return

    now = datetime.now()
    entry = {
        "ts": now.isoformat(timespec="seconds"),
        "source": source,
        "intent": intent,
        "room": params.get("room"),
        "action": _extract_action(intent, params),
        "value": _extract_value(params),
        "result": "ok" if result.get("ok") else "err",
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
        pass  # Never crash Ziggy because of logging


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
# Internal helpers
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
