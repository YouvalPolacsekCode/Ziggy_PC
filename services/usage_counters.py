"""Feature-usage counters — the hub's only product analytics.

Ziggy runs inside a customer's home, and what happens there is theirs. So the
product signal we allow ourselves is deliberately thin: *how many times* a
feature was used in a 5-minute window, aggregated for the whole home. No user,
no room, no device, no message text, no timestamps per event. The snapshot
rides the existing HMAC-signed telemetry post (`services/telemetry_client.py`)
as `usage_counters`, and the relay forwards each counter to PostHog with
`distinct_id = home_id`. Canonical shape: docs/company-os/TRACKING_SPEC.md §4
"Product"; how to read it: docs/company-os/HUB_USAGE_COUNTERS.md.

    {"window_s": 300,
     "counters": {"chat_message": 3, ..., "error_5xx": 0},
     "features_enabled": ["smart_home", "voice"],
     "errors": {"count": 0, "top": []}}

Call sites do one thing: `bump("chat_message")`. Everything here is best-effort
and must never raise into a request path — a broken counter is not worth a
broken light switch.
"""
from __future__ import annotations

import threading
import time
from collections import Counter
from typing import Iterable, Optional

COUNTER_NAMES: tuple[str, ...] = (
    "chat_message",          # /api/chat and /api/intent turns
    "voice_command",         # /api/voice turns (audio in → action)
    "automation_created",    # a NEW automation saved (updates are not counted)
    "automation_triggered",  # an automation fired (HA-backed or Ziggy-run)
    "routine_run",           # an on-demand routine executed
    "device_toggled",        # a successful HA service call on a device domain
    "scene_applied",         # a successful scene.* service call
    "app_open",              # a client WebSocket connected (app/PWA opened)
    "onboarding_step",       # an onboarding step completed or skipped
    "error_5xx",             # an API request ended in a 5xx
)

# HA domains whose service calls mean "someone changed a device". Service
# calls on other domains (automation.trigger, script.turn_on, notify.*,
# persistent_notification.*) are plumbing, not a device toggle.
DEVICE_DOMAINS: frozenset[str] = frozenset({
    "light", "switch", "fan", "climate", "cover", "media_player", "lock",
    "vacuum", "humidifier", "water_heater", "remote", "input_boolean",
    "button", "number", "select", "siren", "valve",
})

ERROR_TOP_N = 3

_lock = threading.Lock()
_counts: dict[str, int] = {name: 0 for name in COUNTER_NAMES}
_window_start: float = time.monotonic()


def bump(name: str, n: int = 1) -> None:
    """Increment one counter. Unknown names are dropped, never raised on."""
    if name not in _counts or n <= 0:
        return
    with _lock:
        _counts[name] += int(n)


def counter_for_service(domain: str) -> Optional[str]:
    """Which counter (if any) a successful HA service call maps to."""
    if domain == "scene":
        return "scene_applied"
    if domain in DEVICE_DOMAINS:
        return "device_toggled"
    return None


def features_enabled(settings: Optional[dict] = None) -> list[str]:
    """Sorted feature-flag names that are truthy in settings.yaml › features."""
    try:
        if settings is None:
            from core.settings_loader import settings as _settings
            settings = _settings
        feats = settings.get("features") if isinstance(settings, dict) else None
        if not isinstance(feats, dict):
            return []
        return sorted(str(k) for k, v in feats.items() if v)
    except Exception:
        return []


def _summarize_errors(names: Iterable[Optional[str]]) -> dict:
    names = list(names)
    typed = Counter(n for n in names if n)
    return {
        "count": len(names),
        "top": [t for t, _ in typed.most_common(ERROR_TOP_N)],
    }


def errors_since(t0: float) -> dict:
    """{count, top} for ERROR-level records logged since monotonic t0.

    Reads the ring handler in core.logger_module. The ring keeps at most 512
    entries, so a hub logging faster than that inside one window reports a
    floor, not a lie — 512 errors in 5 minutes is already a burst.
    """
    try:
        from core.logger_module import error_ring
        return _summarize_errors(error_ring.since(t0))
    except Exception:
        return {"count": 0, "top": []}


def peek() -> dict[str, int]:
    """Current counts without resetting (diagnostics only)."""
    with _lock:
        return dict(_counts)


def snapshot_and_reset(*, settings: Optional[dict] = None,
                       now: Optional[float] = None) -> dict:
    """Return the window's snapshot and start a new window.

    Called by the telemetry payload builder. A one-shot telemetry post
    (onboarding complete, self-heal) also drains the counters — that is
    fine: windows stay disjoint, `window_s` is the real elapsed time, and
    the relay sums per home.
    """
    global _window_start
    now = time.monotonic() if now is None else now
    with _lock:
        counters = dict(_counts)
        for k in _counts:
            _counts[k] = 0
        t0 = _window_start
        _window_start = now
    window_s = max(0, int(round(now - t0)))
    return {
        "window_s": window_s,
        "counters": counters,
        "features_enabled": features_enabled(settings),
        "errors": errors_since(t0),
    }


def _reset_for_tests() -> None:
    """Zero every counter and restart the window. Tests only."""
    global _window_start
    with _lock:
        for k in _counts:
            _counts[k] = 0
        _window_start = time.monotonic()
