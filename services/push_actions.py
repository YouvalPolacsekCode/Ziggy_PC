"""
Actionable Push Notifications — bind notification buttons to deferred Actions.

A `notify_actionable` step issues a web push that carries an `actions` array
(["Turn off", "Snooze 30m"]). Each button is bound to a token; when the user
taps it, the service worker POSTs /api/push/action/{token} which looks up the
bound action and executes it.

Tokens are kept in memory with a TTL (default 1 hour). After expiry or one
use, they are discarded.
"""
from __future__ import annotations

import secrets
import threading
import time
from typing import Any

DEFAULT_TTL_SECONDS = 3600
_tokens: dict[str, dict[str, Any]] = {}  # token -> {action: dict, expires_at: float, used: bool}
_lock = threading.Lock()


def _purge_expired() -> None:
    now = time.time()
    for tok in list(_tokens.keys()):
        if _tokens[tok].get("expires_at", 0) < now:
            _tokens.pop(tok, None)


def register_action(action: dict, ttl_seconds: int = DEFAULT_TTL_SECONDS) -> str:
    """Stash an Action dict and return a token the SW can submit to /api/push/action/{token}."""
    token = secrets.token_urlsafe(16)
    with _lock:
        _purge_expired()
        _tokens[token] = {
            "action": action,
            "expires_at": time.time() + max(60, int(ttl_seconds)),
            "used": False,
        }
    return token


def consume(token: str) -> dict | None:
    """Look up and (single-use) consume the token. Returns the action dict or None."""
    with _lock:
        _purge_expired()
        rec = _tokens.get(token)
        if not rec:
            return None
        if rec.get("used"):
            return None
        rec["used"] = True
        return rec.get("action")


async def execute_action(action: dict) -> dict:
    """Run a single registered action as if it were one step of an automation.

    Supports the same step types as the executor (call_service, notify, ir_command,
    send_intent, ziggy_intent, delay, automation, speak, wait_for_state).
    For simplicity, we proxy via the executor by running a synthetic 1-step automation
    inline: we just call execute_ziggy_actions on a transient id.
    """
    if not action or not action.get("type"):
        return {"ok": False, "message": "empty action"}

    # Inline single-step execution — write a transient store entry, run, then clear.
    from services.local_automation_actions import (
        save_ziggy_actions, execute_ziggy_actions, delete_ziggy_actions,
        save_automation_meta, delete_automation_meta,
    )
    tid = f"_push_action_{secrets.token_hex(4)}"
    try:
        save_automation_meta(tid, {"name": "Push action", "trigger": {"type": "manual"}})
        save_ziggy_actions(tid, [action])
        results = await execute_ziggy_actions(tid, label="Push action")
        ok = all(r.get("ok") for r in results) if results else False
        return {"ok": ok, "results": results}
    finally:
        delete_ziggy_actions(tid)
        delete_automation_meta(tid)
