"""Rehearsal mode (מצב אימון): talk to Ziggy without touching the home.

When `assistant.rehearsal` is on, every chat / voice / intent turn runs
with a request-scoped flag set. Ziggy parses, reasons, replies and speaks
exactly as usual, but the last hop to the house is skipped:

  * Home Assistant service writes (`services.home_automation`)
  * IR blaster sends (`services.ir_manager`, `services.ir_listener`)
  * phrase-triggered routines (`intent_router._run_routine_phrase`)
  * agent tools that change home configuration (create_automation,
    refresh_device, recover_connectivity)

Reads (device state, occupancy, temperature, health) still work, so the
replies stay truthful about the home's current state.

The flag is a contextvar, not a global: it is set only inside a chat /
voice / intent request, so schedulers, automations, Smart Climate, Leave
Home and every other background path keep running the real home. That is
the point — the operator can rehearse the voice for a day while the house
behaves normally.

Every skipped write is logged and emitted on the debug bus as
`rehearsal_skipped`, so a rehearsal session leaves a full trace of what
Ziggy WOULD have done.
"""
from __future__ import annotations

import contextvars
from typing import Any

from core.debug_bus import BASIC, bus
from core.logger_module import log_info

_active: contextvars.ContextVar[bool] = contextvars.ContextVar("ziggy_rehearsal", default=False)


def is_enabled() -> bool:
    """Persisted setting `assistant.rehearsal` (default False)."""
    try:
        from core.settings_loader import settings
        return bool((settings.get("assistant") or {}).get("rehearsal", False))
    except Exception:
        return False


def set_enabled(on: bool) -> None:
    from core.settings_loader import save_settings, settings
    settings.setdefault("assistant", {})["rehearsal"] = bool(on)
    save_settings(settings)
    log_info(f"[rehearsal] {'ON — chat no longer touches the home' if on else 'OFF — chat controls the home again'}")


def activate() -> contextvars.Token:
    """Mark the current request context as rehearsal. Returns the token
    (tests reset it; request handlers just let the context end)."""
    return _active.set(True)


def activate_if_enabled() -> bool:
    """Called at the top of chat / voice / intent routes."""
    if is_enabled():
        _active.set(True)
        return True
    return False


def active() -> bool:
    return _active.get()


def note(kind: str, **detail: Any) -> None:
    """Record a write that was skipped because we are rehearsing."""
    log_info(f"[rehearsal] skipped {kind}: {detail}")
    bus.emit("rehearsal", BASIC, "rehearsal_skipped", kind=kind, **detail)


def simulated(message: str = "rehearsal: not sent", **extra: Any) -> dict:
    """A success-shaped result so callers (and the agent) proceed naturally."""
    return {"ok": True, "rehearsal": True, "message": message, "data": None, **extra}
