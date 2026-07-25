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

# A Zigbee bulb often reports its new brightness/colour back MORE than 5s after
# the command (round-trip + fade), especially several at once. The 5s window
# above then misses it and the change looks "manual" — so the Smart Light
# Schedule kept marking its OWN writes manual and backing off (bug 2026-07-25).
# Fix: remember what value Ziggy commanded for longer, and when the light finally
# reports (approximately) that value, treat it as Ziggy's write settling — never
# manual. A genuine hand change reports a DIFFERENT value → still marked manual.
_SETTLE_TTL = 150.0          # how long to expect the light to confirm our write
_BRIGHTNESS_TOL = 16         # 0-255 scale: pct→255 rounding + gamma slack
_KELVIN_TOL = 150            # K: lights snap color_temp to supported values
_ziggy_expected: dict[str, tuple] = {}       # entity_id → (expires_at, expected_attrs)

_overrides: dict[str, float] = {}            # entity_id → expires_at (epoch)
_recent_ziggy_calls: dict[str, float] = {}   # entity_id → expires_at (epoch)
_lock = threading.Lock()


def register_ziggy_call(entity_id: str, expected: dict | None = None) -> None:
    """Mark that Ziggy just issued a service call on entity_id.

    Call this immediately before invoking HA so that the resulting
    state_changed event is not misclassified as a manual override.

    `expected` (optional): the value Ziggy commanded, e.g.
    {"brightness_pct": 44, "color_temp_kelvin": 2700}. Stored for a longer
    window (`_SETTLE_TTL`) so a slow Zigbee confirmation that lands after the
    5s window can still be recognised as ours via `ziggy_write_settling`.
    """
    if not entity_id:
        return
    now = time.time()
    with _lock:
        _recent_ziggy_calls[entity_id] = now + _ZIGGY_CALL_TTL
        if expected:
            _ziggy_expected[entity_id] = (now + _SETTLE_TTL, dict(expected))


def ziggy_write_settling(entity_id: str, attrs: dict | None) -> bool:
    """True if `attrs` (a light's just-reported state) matches the value Ziggy
    last commanded for this entity, within tolerance — i.e. it's our own write
    confirming late, NOT a hand change. Consumes the record on a match.

    Returns False when there's no pending Ziggy write, the record has expired,
    or the reported value clearly differs from what we commanded (a real manual
    change, even one made moments after our write).
    """
    if not entity_id or not attrs:
        return False
    now = time.time()
    with _lock:
        rec = _ziggy_expected.get(entity_id)
        if not rec:
            return False
        exp_at, expected = rec
        if exp_at < now:
            _ziggy_expected.pop(entity_id, None)
            return False
        # Brightness: Ziggy commands pct (0-100); lights report brightness (0-255).
        want_pct = expected.get("brightness_pct")
        got_bri = attrs.get("brightness")
        if want_pct is not None and got_bri is not None:
            want_bri = round(float(want_pct) * 255 / 100)
            if abs(int(got_bri) - want_bri) > _BRIGHTNESS_TOL:
                return False   # reported brightness ≠ what we set → a real change
        want_k = expected.get("color_temp_kelvin")
        got_k = attrs.get("color_temp_kelvin")
        if want_k is not None and got_k is not None:
            if abs(int(got_k) - int(want_k)) > _KELVIN_TOL:
                return False
        # Matches (or the light didn't report a contradicting attr) → it's ours.
        _ziggy_expected.pop(entity_id, None)
        return True


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
