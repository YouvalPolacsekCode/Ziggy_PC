"""
Bridge: forward PWA WebSocket broadcasts to connected mobile devices.

The debug_bus has a single ws_callback (set in server.py to
backend.ws_manager.manager.broadcast). PWA clients receive everything that
flows through it — state_changed events, intent responses, automation results.

To give mobile devices the same realtime fabric without coupling the two
managers, this module installs a wrapper callback: it calls the existing PWA
broadcast first, then forwards a filtered subset of message types to
mobile_ws_manager for per-device fan-out.

Filtering rules:
  - Only message types listed in _MOBILE_RELEVANT_TYPES are forwarded.
  - The PWA side is never affected — its callback runs unchanged. Mobile
    delivery is best-effort; failures inside mobile_ws.broadcast are swallowed
    so they can't ever degrade the PWA path.

To add a new mobile-relevant event: append its type string to
_MOBILE_RELEVANT_TYPES. No other change needed.
"""
from __future__ import annotations

from typing import Any

from core.debug_bus import bus
from core.logger_module import log_info, log_error
from backend.ws_manager import manager as pwa_manager
from services.mobile_ws_manager import mobile_ws


# Allowlist — message types worth sending to phones. Loud / debug-only events
# stay PWA-only so we don't drain battery + bandwidth on devices that can't
# usefully react to them.
_MOBILE_RELEVANT_TYPES = frozenset({
    "state_changed",          # HA entity state push — main realtime fabric
    "command_failed",         # device command failure toasts
    "execution_result",       # automation / routine completion
    "ir_command_detected",    # physical remote was used; mobile may show toast
    "ziggy_response",         # response to natural-language intents
})


async def _broadcast_to_both(data: Any) -> None:
    """Combined fan-out: PWA always, mobile only if allowlisted.

    Ordering: PWA first (cheap, ~always-fast) so a slow mobile push never
    delays a state_changed reaching the web tabs. Mobile is fired but its
    completion isn't awaited beyond its internal timeout.
    """
    # PWA path — unchanged from the original registration.
    try:
        await pwa_manager.broadcast(data)
    except Exception as e:
        log_error(f"[mobile_ws_bridge] PWA broadcast errored: {e}")

    # Mobile path — filtered, never raises.
    if not isinstance(data, dict):
        return
    msg_type = data.get("type")
    if msg_type not in _MOBILE_RELEVANT_TYPES:
        return
    if mobile_ws.count == 0:
        return
    try:
        sent = await mobile_ws.broadcast(data)
        if sent:
            log_info(f"[mobile_ws_bridge] forwarded {msg_type} to {sent} device(s)")
    except Exception as e:
        log_error(f"[mobile_ws_bridge] mobile broadcast errored: {e}")


def install() -> None:
    """Wrap the existing PWA ws-callback with the combined broadcaster.

    Safe to call exactly once at server startup, AFTER the original
    `bus.register_ws_callback(manager.broadcast)` has run. Re-registering
    replaces the prior callback — since our wrapper calls pwa_manager.broadcast
    directly, the PWA path remains intact.
    """
    bus.register_ws_callback(_broadcast_to_both)
    log_info("[mobile_ws_bridge] installed — PWA broadcasts now also forward to mobile")
