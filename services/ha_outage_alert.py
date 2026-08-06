"""Escalate a sustained Home Assistant outage into a notification.

WHY THIS EXISTS
---------------
Before this module, `ha_subscriber.ha_connected` was *reported* everywhere and
*acted on* nowhere: /health served it, telemetry shipped it to the relay, the
dashboard rendered it — and no code path turned it into a message to a human.

Canary, 2026-08-05: HA was unreachable for 9h50m. The hub knew. The relay had
ten hours of telemetry rows carrying `ha_version: null`. Nothing fired. The
outage was detected by the owner noticing their lights didn't work.

DESIGN
------
A pure state machine, clock injected, no I/O. It emits at most one "down"
message per outage and one "recovered" message per outage that was announced.

The threshold matters as much as the alert. HA restarts, container updates and
WebSocket hiccups all produce short disconnects; paging on those trains the
owner to ignore the notification, which leaves you worse off than silence.
"""
from __future__ import annotations

import time
from typing import Optional

# How long HA must be continuously unreachable before we tell anyone.
# Comfortably longer than an HA restart (~60-90s) or a container update.
ALERT_AFTER_S = 5 * 60

_state: dict = {"down_since": None, "alerted": False}


def _reset_state_for_tests() -> None:
    _state["down_since"] = None
    _state["alerted"] = False


def _humanize(seconds: float) -> str:
    """'about 3 hours' / 'about 12 minutes' — enough to convey severity."""
    minutes = int(seconds // 60)
    if minutes < 60:
        return f"about {max(minutes, 1)} minutes"
    hours = minutes / 60
    # Render 3.0 as "3" but keep 1.5 as "1.5" so a 90-minute outage reads right.
    text = f"{hours:.0f}" if abs(hours - round(hours)) < 0.05 else f"{hours:.1f}"
    return f"about {text} hours"


def note_ha_state(
    connected: bool,
    *,
    now: Optional[float] = None,
    healed_url: Optional[str] = None,
) -> Optional[dict]:
    """Feed the current HA connection flag; get a message when one is due.

    Returns one of:
      {"kind": "down",      "title", "body", "downtime_s"}  once per outage
      {"kind": "recovered", "title", "body", "downtime_s"}  once per announced outage
      None                                                  nothing to say

    `healed_url` lets the caller name the address recovery landed on, so a
    self-repair is visible rather than silent.
    """
    now = time.time() if now is None else now

    if not connected:
        if _state["down_since"] is None:
            _state["down_since"] = now
            return None
        if _state["alerted"]:
            return None
        downtime = now - _state["down_since"]
        if downtime < ALERT_AFTER_S:
            return None
        _state["alerted"] = True
        return {
            "kind": "down",
            "title": "Ziggy lost contact with your home",
            "body": (
                f"Ziggy hasn't been able to reach Home Assistant for {_humanize(downtime)}. "
                "Automations, schedules and device control are paused until it reconnects."
            ),
            "downtime_s": int(downtime),
        }

    # Connected.
    was_alerted = _state["alerted"]
    downtime = (now - _state["down_since"]) if _state["down_since"] is not None else 0.0
    _state["down_since"] = None
    _state["alerted"] = False

    if not was_alerted:
        return None

    where = f" Reconnected at {healed_url}." if healed_url else ""
    return {
        "kind": "recovered",
        "title": "Ziggy is back in touch with your home",
        "body": (
            f"Home Assistant is reachable again after {_humanize(downtime)}."
            f"{where} Automations and device control have resumed."
        ),
        "downtime_s": int(downtime),
    }
