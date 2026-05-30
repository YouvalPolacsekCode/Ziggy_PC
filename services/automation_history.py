"""
Per-Automation execution history (last N runs).

Persisted so it survives restart. Ring-buffer per automation_id (default 20).
The executor calls record_run() at the end of execute_ziggy_actions; the API
returns the buffer for a given id.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any

STORE_FILE = "user_files/automation_history.json"
MAX_PER_AUTOMATION = 20

_lock = threading.Lock()

# In-memory cache keyed by file mtime — every record_run/get_history call
# previously re-read history.json. The cache is invalidated when the file is
# modified out-of-band.
_cache: dict | None = None
_cache_mtime: float = 0.0


def _file_mtime() -> float:
    try:
        return os.path.getmtime(STORE_FILE)
    except OSError:
        return 0.0


def _load() -> dict:
    global _cache, _cache_mtime
    if not os.path.exists(STORE_FILE):
        _cache = {}
        _cache_mtime = 0.0
        return dict(_cache)
    mtime = _file_mtime()
    if _cache is None or mtime != _cache_mtime:
        try:
            with open(STORE_FILE, "r", encoding="utf-8") as f:
                _cache = json.load(f)
        except Exception:
            _cache = {}
        _cache_mtime = mtime
    return dict(_cache)


def _save(data: dict) -> None:
    global _cache, _cache_mtime
    os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
    tmp = STORE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, STORE_FILE)
    _cache = dict(data) if isinstance(data, dict) else {}
    _cache_mtime = _file_mtime()


def record_run(
    automation_id: str,
    *,
    label: str,
    started_at: float,
    finished_at: float,
    ok: bool,
    steps_total: int,
    steps_failed: int,
    trigger_reason: str = "",
    errors: list[str] | None = None,
    skipped_reason: str = "",
) -> None:
    """Append a run entry. Keeps the most recent MAX_PER_AUTOMATION."""
    entry: dict[str, Any] = {
        "started_at": datetime.fromtimestamp(started_at, timezone.utc).isoformat(),
        "finished_at": datetime.fromtimestamp(finished_at, timezone.utc).isoformat(),
        "duration_s": round(max(0.0, finished_at - started_at), 2),
        "ok": ok,
        "steps_total": steps_total,
        "steps_failed": steps_failed,
        "label": label,
        "trigger_reason": trigger_reason,
        "errors": (errors or [])[:5],
    }
    if skipped_reason:
        entry["skipped"] = True
        entry["skipped_reason"] = skipped_reason

    with _lock:
        data = _load()
        runs = data.get(automation_id, [])
        runs.insert(0, entry)
        data[automation_id] = runs[:MAX_PER_AUTOMATION]
        _save(data)


def get_history(automation_id: str, limit: int = MAX_PER_AUTOMATION) -> list[dict]:
    with _lock:
        runs = _load().get(automation_id, [])
    return runs[: max(1, min(limit, MAX_PER_AUTOMATION))]


def get_last_run(automation_id: str) -> dict | None:
    runs = get_history(automation_id, limit=1)
    return runs[0] if runs else None


def delete_history(automation_id: str) -> None:
    with _lock:
        data = _load()
        if data.pop(automation_id, None) is not None:
            _save(data)
