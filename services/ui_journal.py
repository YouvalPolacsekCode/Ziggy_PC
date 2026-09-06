"""What people did in the app recently — the app → agent half of the sync.

A small in-memory ring buffer of user-initiated actions (device tile toggles,
quick-asks, /api/actions calls, external MCP calls). The agent reads it each
turn (core/agent/context.py) so "why is the kitchen light on?" can be answered
with "you turned it on from the app at 21:04", and so a follow-up in chat
knows what the user just did with their thumbs.

Process-local and deliberately small: 24 h window, last 30 entries. Not a
log — the debug bus and command_ledger are the durable records.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Optional

_MAX = 30
_WINDOW_S = 24 * 3600
_lock = threading.Lock()
_entries: deque[dict] = deque(maxlen=_MAX)


def record(action: str, args: Optional[dict] = None, *, actor: Optional[str] = None,
           source: str = "app", label: Optional[str] = None, ok: bool = True) -> None:
    """Note one user-initiated action. Never raises."""
    try:
        with _lock:
            _entries.append({
                "ts": time.time(), "action": str(action), "args": dict(args or {}),
                "actor": actor, "source": source, "label": label, "ok": bool(ok),
            })
    except Exception:
        pass


def recent(hours: float = 24.0, limit: int = _MAX) -> list[dict]:
    cutoff = time.time() - min(hours * 3600, _WINDOW_S)
    with _lock:
        rows = [e for e in _entries if e["ts"] >= cutoff]
    rows.sort(key=lambda e: e["ts"], reverse=True)
    return rows[:limit]


def clear() -> None:
    with _lock:
        _entries.clear()


def format_for_prompt(rows: list[dict], names: dict[str, str] | None = None) -> str:
    """One line per entry: HH:MM who did what (device names, never ids)."""
    names = names or {}
    out: list[str] = []
    for e in rows:
        who = (e.get("actor") or "someone").split(":", 1)[-1]
        src = e.get("source") or "app"
        args = e.get("args") or {}
        target = args.get("entity_id") or args.get("name") or args.get("room") or ""
        target = names.get(target, target)
        what = e.get("label") or e.get("action")
        act = args.get("action") or args.get("enabled")
        tail = f" {act}" if act not in (None, "") else ""
        hhmm = time.strftime("%H:%M", time.localtime(e["ts"]))
        out.append(f"  {hhmm} {who} via {src}: {what}{tail} {target}".rstrip()
                   + ("" if e.get("ok", True) else " (failed)"))
    return "\n".join(out)
