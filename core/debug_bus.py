"""
Central debug event bus for Ziggy.

Levels (ordered):
  off      — no debug events emitted
  basic    — user-friendly troubleshooting summary
  verbose  — detailed technical info (params, HA payloads, timing)
  trace    — full developer tracing (every step, raw data)

Scopes — enable per-feature granularity:
  intent      — intent parsing and routing
  ha          — Home Assistant service calls and state queries
  ir          — IR blaster commands and learning
  automation  — automation and routine execution
  sensor      — sensor alert polling
  presence    — presence/location tracking
  ws          — WebSocket connection events
  voice       — voice interface
  scheduler   — scheduled tasks
  api         — HTTP request lifecycle (request_received → request_completed)
  device      — device command dispatch and result confirmation
  frontend    — events emitted by the React app (clicks, navigation, FE API calls)
  settings    — user-visible configuration changes
  general     — anything that does not fit a more specific scope

Usage:
  from core.debug_bus import bus, BASIC, VERBOSE, TRACE

  bus.emit("intent", VERBOSE, "intent_dispatched",
      request_id=req_id, input=text, intent=intent, params=params)
"""
from __future__ import annotations

import uuid
import asyncio
from collections import deque
from datetime import datetime, timezone
from typing import Any, Callable, Optional

# ─── Level constants ─────────────────────────────────────────────────────────

OFF     = 0
BASIC   = 1
VERBOSE = 2
TRACE   = 3

_LEVEL_NAMES  = {OFF: "off", BASIC: "basic", VERBOSE: "verbose", TRACE: "trace"}
_LEVEL_VALUES = {v: k for k, v in _LEVEL_NAMES.items()}

# ─── Sensitive field masking ──────────────────────────────────────────────────
# Any key containing these substrings will be masked in debug event data.

_SENSITIVE_KEYS = {
    "token", "password", "api_key", "secret", "auth",
    "hash", "salt", "key", "credential", "bearer",
}


def _mask_value(key: str) -> bool:
    k = key.lower()
    return any(s in k for s in _SENSITIVE_KEYS)


def _sanitize(data: Any, depth: int = 0) -> Any:
    """Recursively mask sensitive fields. Max depth 5 to avoid infinite recursion."""
    if depth > 5:
        return data
    if isinstance(data, dict):
        return {
            k: ("••••••••" if _mask_value(k) else _sanitize(v, depth + 1))
            for k, v in data.items()
        }
    if isinstance(data, (list, tuple)):
        return [_sanitize(i, depth + 1) for i in data]
    return data


# ─── Event model ─────────────────────────────────────────────────────────────

def _make_event(
    scope: str,
    level: int,
    step: str,
    request_id: Optional[str],
    **data: Any,
) -> dict:
    return {
        "id":         uuid.uuid4().hex[:12],
        "ts":         datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "level":      _LEVEL_NAMES.get(level, "verbose"),
        "scope":      scope,
        "step":       step,
        "request_id": request_id,
        "data":       _sanitize(data),
    }


# ─── Debug bus ───────────────────────────────────────────────────────────────

class DebugBus:
    def __init__(self, buffer_size: int = 500):
        self._level: int = OFF
        self._scopes: set[str] = set()   # empty = all scopes enabled
        self._all_scopes: bool = True
        self._buffer: deque[dict] = deque(maxlen=buffer_size)
        self._ws_callback: Optional[Callable] = None  # set by server.py at startup
        self._loop = None                             # event loop reference for thread-safe push

    # ── Configuration ────────────────────────────────────────────────────────

    def set_level(self, level: str | int) -> None:
        if isinstance(level, str):
            self._level = _LEVEL_VALUES.get(level, OFF)
        else:
            self._level = level

    def set_scopes(self, scopes: list[str]) -> None:
        """Empty list = all scopes. Otherwise filter to the given list."""
        self._scopes = set(scopes)
        self._all_scopes = len(scopes) == 0

    def is_active(self, scope: str = "", level: int = BASIC) -> bool:
        if self._level < level:
            return False
        if not self._all_scopes and scope and scope not in self._scopes:
            return False
        return True

    def get_config(self) -> dict:
        return {
            "level":       _LEVEL_NAMES.get(self._level, "off"),
            "level_int":   self._level,
            "scopes":      sorted(self._scopes) if self._scopes else [],
            "all_scopes":  self._all_scopes,
            "buffer_size": self._buffer.maxlen,
            "buffered":    len(self._buffer),
        }

    # ── Event emission ───────────────────────────────────────────────────────

    def emit(
        self,
        scope: str,
        level: int,
        step: str,
        *,
        request_id: Optional[str] = None,
        **data: Any,
    ) -> Optional[dict]:
        """
        Emit a debug event. Returns the event dict if emitted, else None.
        Never raises — debug must not break production flows.
        """
        if not self.is_active(scope, level):
            return None
        try:
            event = _make_event(scope, level, step, request_id, **data)
            self._buffer.append(event)
            self._push_ws(event)
            return event
        except Exception:
            return None

    def _push_ws(self, event: dict) -> None:
        """Push event to all WebSocket clients via the registered callback."""
        if self._ws_callback is None:
            return
        payload = {"type": "debug_event", **event}
        try:
            # Try get_running_loop first — works when called from within asyncio context
            # (e.g., from an async route handler calling a sync service function).
            loop = asyncio.get_running_loop()
            loop.create_task(self._ws_callback(payload))
        except RuntimeError:
            # No running loop in this thread — we're in a background thread
            # (sensor alerts, MQTT, scheduler).  Use the stored loop reference.
            if self._loop is not None:
                asyncio.run_coroutine_threadsafe(self._ws_callback(payload), self._loop)
        except Exception:
            pass

    def register_ws_callback(self, callback: Callable) -> None:
        """Called once at server startup to wire in the WebSocket broadcast function."""
        self._ws_callback = callback
        # Store the running loop so background threads can push events thread-safely.
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

    # ── Buffer access ────────────────────────────────────────────────────────

    def get_events(
        self,
        limit: int = 100,
        scope: Optional[str] = None,
        level: Optional[str] = None,
        request_id: Optional[str] = None,
        result: Optional[str] = None,
    ) -> list[dict]:
        events = list(self._buffer)
        if scope:
            events = [e for e in events if e.get("scope") == scope]
        if level:
            level_int = _LEVEL_VALUES.get(level, -1)
            events = [e for e in events if _LEVEL_VALUES.get(e.get("level", ""), 0) <= level_int]
        if request_id:
            events = [e for e in events if e.get("request_id") == request_id]
        if result:
            events = [e for e in events if e.get("data", {}).get("result") == result]
        return events[-limit:]

    def clear(self) -> None:
        self._buffer.clear()

    def export(self) -> dict:
        """Export a full debug report as a serialisable dict."""
        import platform, sys
        return {
            "exported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "config":  self.get_config(),
            "system": {
                "platform": platform.platform(),
                "python":   sys.version.split()[0],
            },
            "events": list(self._buffer),
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

bus = DebugBus()
