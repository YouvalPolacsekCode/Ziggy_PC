"""Shadow-mode enforcement — evaluate real commands without (yet) blocking them.

This is the safe rollout path for wiring the PDP into live command paths. A
call site (e.g. the device handler) calls :func:`evaluate_command` right before
it actuates. Behaviour is controlled by ``features.permission_enforcement`` in
settings:

* ``"off"``     — do nothing (default; zero behaviour change).
* ``"shadow"``  — evaluate + write an audit event, but NEVER block. Lets you
  watch what the engine *would* decide against real traffic before trusting it.
* ``"enforce"`` — evaluate and actually block denied actions — but only when a
  real actor could be resolved (no identity ⇒ fail-open to today's behaviour,
  so turning this on can't lock out un-instrumented call paths).

Returns an advisory dict; the caller decides what to do with ``would_block``.
"""
from __future__ import annotations

from typing import Optional

from .runtime import get_service

# (domain, service) → capability key. Falls back to f"{domain}.{service}" for
# anything unmapped (the registry resolves unknown capabilities fail-safe).
_COMMAND_TO_CAP: dict[tuple[str, str], str] = {
    ("lock", "unlock"): "lock.unlock",
    ("lock", "lock"): "lock.lock",
    ("cover", "open_cover"): "cover.open",
    ("cover", "close_cover"): "cover.close",
    ("garage", "open"): "cover.open",
    ("garage", "close"): "cover.close",
    ("camera", "turn_on"): "camera.live",
    ("alarm_control_panel", "alarm_disarm"): "alarm.disarm",
    ("alarm_control_panel", "alarm_arm_away"): "alarm.arm",
    ("alarm_control_panel", "alarm_arm_home"): "alarm.arm",
    ("alarm_control_panel", "alarm_arm_night"): "alarm.arm",
}
# Domain-level fallbacks when the specific service isn't mapped.
_DOMAIN_DEFAULT_CAP: dict[str, str] = {
    "light": "light.onoff",
    "switch": "light.onoff",
    "climate": "climate.setpoint",
    "fan": "climate.mode",
    "media_player": "media.playback",
    "camera": "camera.live",
    "lock": "lock.lock",
}


def _mode() -> str:
    try:
        from core.settings_loader import settings
        feats = settings.get("features", {}) or {}
        return (feats.get("permission_enforcement") or "off").lower()
    except Exception:
        return "off"


def command_to_capability(domain: str, service: str) -> str:
    key = ((domain or "").lower(), (service or "").lower())
    if key in _COMMAND_TO_CAP:
        return _COMMAND_TO_CAP[key]
    return _DOMAIN_DEFAULT_CAP.get(key[0], f"{key[0]}.{key[1]}")


def evaluate_command(*, actor: Optional[str], domain: str, service: str,
                     entity_id: str, context: dict | None = None,
                     source: str = "unknown", mode: str | None = None) -> dict:
    """Evaluate a device command against the PDP. Non-fatal by contract.

    ``actor`` is a principal ref ("person:emma") or None. Returns::

        {"mode", "evaluated", "allowed", "would_block", "reason", "obligations"}

    ``would_block`` is True only in enforce mode with a resolved actor on a deny.
    The caller is responsible for honouring it (returning an error) — this
    function itself never raises and never actuates anything.
    """
    m = (mode or _mode())
    result = {"mode": m, "evaluated": False, "allowed": True,
              "would_block": False, "reason": "", "obligations": []}
    if m == "off":
        return result
    if not actor:
        # No identity to attribute — cannot enforce; stay out of the way.
        result["reason"] = "no actor resolved"
        return result

    try:
        cap = command_to_capability(domain, service)
        resource = f"device:{entity_id}"
        ctx = dict(context or {})
        ctx.setdefault("session", {}).setdefault("channel", "voice" if source == "voice" else "app")
        svc = get_service()
        decision = svc.authorize(subject=actor, action=cap, resource=resource,
                                 context=ctx, correlation_id=f"cmd:{source}")
        result.update(
            evaluated=True, allowed=decision.allowed, reason=decision.reason,
            obligations=[o.to_json() for o in decision.obligations],
        )
        if m == "enforce" and not decision.allowed:
            result["would_block"] = True
    except Exception as e:  # pragma: no cover - never let policy break control
        result["reason"] = f"shadow eval error (ignored): {e}"
    return result
