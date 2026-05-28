"""Home mode (Home / Away / Night / Vacation).

Phase 1: a single value persisted to disk + broadcast on the WebSocket so all
clients update in sync. The presence engine currently *infers* state from
location + time-of-day for anomaly scoring; this module is the user-settable
counterpart so the Hub can show "Mode: Night" and let the user override.

Future: an "auto" toggle that lets presence_engine drive the value, and per-mode
hooks (turn off lights when switching to Away, etc.). v1 only stores and emits;
no side effects.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Optional

from core.logger_module import log_error

MODES = ("home", "away", "night", "vacation")
DEFAULT_MODE = "home"

_FILE = Path(__file__).parent.parent / "user_files" / "home_mode.json"


def _load() -> dict:
    if not _FILE.exists():
        return {"mode": DEFAULT_MODE, "changed_at": time.time(), "changed_by": None}
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        if data.get("mode") not in MODES:
            data["mode"] = DEFAULT_MODE
        return data
    except Exception as e:
        log_error(f"[mode_service] Read failed: {e}")
        return {"mode": DEFAULT_MODE, "changed_at": time.time(), "changed_by": None}


def _save(data: dict) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        _FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:
        log_error(f"[mode_service] Write failed: {e}")


async def get_mode() -> dict:
    return await asyncio.to_thread(_load)


async def set_mode(new_mode: str, changed_by: Optional[str] = None) -> dict:
    if new_mode not in MODES:
        raise ValueError(f"Unknown mode '{new_mode}'. Allowed: {MODES}")
    rec = {"mode": new_mode, "changed_at": time.time(), "changed_by": changed_by}
    await asyncio.to_thread(_save, rec)
    # Broadcast so every connected tablet/web client re-renders the mode chip
    # without polling. Failure here is non-fatal — the save already happened.
    try:
        from backend.ws_manager import manager
        await manager.broadcast({"type": "mode_changed", **rec})
    except Exception as e:
        log_error(f"[mode_service] WS broadcast failed: {e}")
    return rec
