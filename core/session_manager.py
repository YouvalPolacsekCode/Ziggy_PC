"""Per-source session state for Ziggy.

Telegram sessions live in context.chat_data (managed by the interface layer).
The helpers below provide a uniform API for reading/writing that dict.

Voice sessions live in a single module-level slot (one microphone, one user).
"""
from __future__ import annotations

import threading
from datetime import datetime

# ── Mode constants ─────────────────────────────────────────────────────────────

MODE_COMMAND = "command"
MODE_CHAT = "chat"

# Max chat turns kept per session (role+content pairs each count as one entry)
MAX_CHAT_HISTORY = 30  # 15 user + 15 assistant

# ── Intents allowed to execute inside chat mode ────────────────────────────────
# Read-only / information intents that feel natural in conversation.
# Excludes all write/action intents (lights, AC, TV, tasks, files, automations, etc.)

CHAT_ALLOWED_INTENTS: frozenset[str] = frozenset({
    # Date / time
    "get_time", "get_date", "get_day_of_week",
    # Weather / sun — dedicated APIs (Open-Meteo, no SerpAPI needed)
    "get_weather", "get_sun_times",
    # Sensors (read-only, live HA data)
    "get_temperature", "get_humidity", "report_all_temperatures",
    # Presence
    "is_someone_home",
    # System info (read-only)
    "get_system_status", "get_ip_address", "get_disk_usage",
    "get_wifi_status", "get_network_adapters",
    "get_internet_speed", "get_internet_status",
    # Tasks / events (read-only)
    "list_tasks", "task_summary",
    "list_events", "next_event", "days_until_event", "countdown",
    # Files / notes (read-only)
    "list_files", "read_file", "read_notes", "search_notes",
    "ref_read_note_or_file", "ref_show_grocery",
    "ref_search_history_or_memory", "ref_read_saved_recipe",
    # Memory (read-only)
    "recall_memory",
    # Devices (read-only)
    "list_active_devices", "list_automations",
    # Ziggy identity
    "ziggy_status", "ziggy_identity", "ziggy_help", "ziggy_chat",
    # Note: web_search_summary, web_news_brief, web_recipe_read,
    # web_trip_updates, web_stocks_update are intentionally excluded —
    # chat mode handles open-ended search autonomously via GPT tool calls.
})

# ── Trigger phrase sets ────────────────────────────────────────────────────────

CHAT_MODE_TRIGGERS: frozenset[str] = frozenset({
    # English
    "chat mode", "let's talk", "lets talk", "just chat",
    "think with me", "talk to me", "have a chat", "conversation mode",
    # Hebrew
    "מצב שיחה", "בוא נדבר", "שוחח איתי", "מצב צ'אט", "מצב צאט",
    "דבר איתי",
})

COMMAND_MODE_TRIGGERS: frozenset[str] = frozenset({
    # English
    "exit chat mode", "back to commands", "stop chatting", "command mode",
    "exit chat", "stop chat", "back to command",
    # Hebrew
    "צא ממצב שיחה", "חזור לפקודות", "הפסק לשוחח", "מצב פקודות",
    "סיים שיחה",
})


def is_chat_trigger(text: str) -> bool:
    return text.strip().lower() in CHAT_MODE_TRIGGERS


def is_command_trigger(text: str) -> bool:
    return text.strip().lower() in COMMAND_MODE_TRIGGERS


# ── Voice session (single global slot) ────────────────────────────────────────

_voice_lock = threading.Lock()

_voice_session: dict = {
    "mode": MODE_COMMAND,
    "mode_changed_at": None,
    "chat_history": [],
}


def get_voice_mode() -> str:
    with _voice_lock:
        return _voice_session["mode"]


def set_voice_mode(mode: str) -> None:
    with _voice_lock:
        _voice_session["mode"] = mode
        _voice_session["mode_changed_at"] = datetime.utcnow().isoformat()
        if mode == MODE_COMMAND:
            _voice_session["chat_history"] = []


def get_voice_chat_history() -> list[dict]:
    with _voice_lock:
        return list(_voice_session["chat_history"])


def append_voice_chat(role: str, content: str) -> None:
    with _voice_lock:
        hist = _voice_session["chat_history"]
        hist.append({"role": role, "content": content})
        if len(hist) > MAX_CHAT_HISTORY:
            _voice_session["chat_history"] = hist[-MAX_CHAT_HISTORY:]


def reset_voice_session() -> None:
    """Reset mode to command. Called at each wake-word activation."""
    with _voice_lock:
        _voice_session["mode"] = MODE_COMMAND
        _voice_session["mode_changed_at"] = None
        _voice_session["chat_history"] = []


# ── Telegram session helpers (operate on context.chat_data) ───────────────────

def get_telegram_mode(chat_data: dict) -> str:
    return chat_data.get("mode", MODE_COMMAND)


def set_telegram_mode(chat_data: dict, mode: str) -> None:
    chat_data["mode"] = mode
    chat_data["mode_changed_at"] = datetime.utcnow().isoformat()
    if mode == MODE_COMMAND:
        chat_data["session_chat_history"] = []


def get_telegram_chat_history(chat_data: dict) -> list[dict]:
    return list(chat_data.get("session_chat_history", []))


def append_telegram_chat(chat_data: dict, role: str, content: str) -> None:
    hist = chat_data.setdefault("session_chat_history", [])
    hist.append({"role": role, "content": content})
    if len(hist) > MAX_CHAT_HISTORY:
        chat_data["session_chat_history"] = hist[-MAX_CHAT_HISTORY:]
