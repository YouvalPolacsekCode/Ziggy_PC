"""
Manual Override Registry.

Tracks entities the user has just changed by hand (or by an out-of-band
non-Ziggy source). While an override is active, the automation executor
skips call_service / device steps targeting that entity to avoid "the
house is fighting me" behaviour.

How it works:
  1. Before Ziggy calls HA, we mark the entity in _recent_ziggy_calls with a
     short TTL (5 s). The HA subscriber checks this set when it observes a
     state change.
  2. When the HA subscriber sees a state change on a controllable domain
     that is NOT in _recent_ziggy_calls, it calls mark_manual(entity_id) —
     i.e. somebody touched the device by hand.
  3. The executor's call_service step calls is_overridden(entity_id) before
     firing; if True, the step is skipped with an explanatory result.

Storage: in-memory only. An override is a short-lived hint, not user data;
losing it on restart is acceptable.
"""
from __future__ import annotations

import threading
import time

# Domains where manual override matters (excludes sensors, binary_sensors, etc.
# which we never write to).
CONTROLLABLE_DOMAINS = frozenset({
    "light", "switch", "fan", "climate", "media_player", "cover", "lock", "valve",
    "input_boolean", "humidifier",
})

# Default override window (seconds). Hue/Lutron defaults sit between 15 and 30 minutes.
DEFAULT_OVERRIDE_SECONDS = 1800

# Window during which a state change is attributed to a Ziggy-initiated service call.
_ZIGGY_CALL_TTL = 5.0

_overrides: dict[str, float] = {}            # entity_id → expires_at (epoch)
_recent_ziggy_calls: dict[str, float] = {}   # entity_id → expires_at (epoch)
_lock = threading.Lock()


def register_ziggy_call(entity_id: str) -> None:
    """Mark that Ziggy just issued a service call on entity_id.

    Call this immediately before invoking HA so that the resulting
    state_changed event is not misclassified as a manual override.
    """
    if not entity_id:
        return
    with _lock:
        _recent_ziggy_calls[entity_id] = time.time() + _ZIGGY_CALL_TTL


def was_ziggy_initiated(entity_id: str) -> bool:
    """Return True if a Ziggy call on this entity is in the last _ZIGGY_CALL_TTL seconds."""
    if not entity_id:
        return False
    now = time.time()
    with _lock:
        exp = _recent_ziggy_calls.get(entity_id)
        if not exp:
            return False
        if exp < now:
            _recent_ziggy_calls.pop(entity_id, None)
            return False
        return True


def mark_manual(entity_id: str, duration_seconds: int = DEFAULT_OVERRIDE_SECONDS) -> None:
    """Record that a human (or external system) just changed this entity."""
    if not entity_id:
        return
    domain = entity_id.split(".", 1)[0]
    if domain not in CONTROLLABLE_DOMAINS:
        return
    expires_at = time.time() + max(1, int(duration_seconds))
    with _lock:
        _overrides[entity_id] = expires_at


def is_overridden(entity_id: str) -> bool:
    if not entity_id:
        return False
    now = time.time()
    with _lock:
        exp = _overrides.get(entity_id)
        if not exp:
            return False
        if exp < now:
            _overrides.pop(entity_id, None)
            return False
        return True


def clear_override(entity_id: str) -> bool:
    with _lock:
        return _overrides.pop(entity_id, None) is not None


def list_active() -> list[dict]:
    now = time.time()
    out: list[dict] = []
    with _lock:
        for entity_id, exp in list(_overrides.items()):
            if exp < now:
                _overrides.pop(entity_id, None)
                continue
            out.append({"entity_id": entity_id, "expires_at": exp, "remaining_s": int(exp - now)})
    return out
