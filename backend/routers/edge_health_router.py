"""GET /health — LAN-reachable, no-auth liveness for the PWA / mobile app
during onboarding (Prompt 4 chunk 2.G).

Distinct from /api/health (backend/routers/health_router.py), which is
auth-gated and exposes a full HA-cluster view. THIS endpoint:

  - Is mounted at /health (NOT /api/health) so it cannot collide with
    the existing auth-gated route — paths differ at the prefix level.
  - Has NO Depends(get_current_user). The PWA needs to ping it BEFORE
    the user is logged in (during onboarding "is this hub reachable?").
  - Returns a small status snapshot suitable for a tablet status pill.

Wire shape:
  {
    "status":                 "ok" | "degraded" | "down",
    "ha_reachable":           bool,
    "ziggy_version":          str,
    "ha_version":             str | null,
    "last_telemetry_post_at": iso8601 | null
  }

Status rubric:
  ok        — HA WebSocket connected AND a telemetry post has succeeded
              within the last 15 minutes (3× the 5-min cadence — allows
              one missed tick without flapping).
  degraded  — HA WebSocket connected but telemetry never posted or last
              post is older than 15 minutes, OR HA disconnected briefly.
  down      — HA WebSocket has never connected since process start.

The endpoint never raises into FastAPI's exception handler — any
collector failure becomes "down" with the other fields best-effort.
This is the lowest-risk shape: a misbehaving collector can't 500 the
LAN's health-check endpoint.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter

router = APIRouter()

# A hub that hasn't posted in this window is treated as not-fresh.
# 3 × the 5-minute telemetry cadence — tolerant of one missed tick.
TELEMETRY_FRESHNESS_WINDOW_S = 15 * 60


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    """Lenient ISO-8601 parse. Accepts trailing Z and naive strings."""
    if not isinstance(ts, str) or not ts:
        return None
    try:
        s = ts.replace("Z", "+00:00") if ts.endswith("Z") else ts
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def _last_post_is_fresh(last_post_at: Optional[str], *,
                       now: Optional[datetime] = None,
                       window_s: int = TELEMETRY_FRESHNESS_WINDOW_S) -> bool:
    """True if last_post_at is within window_s of now. False otherwise."""
    parsed = _parse_iso(last_post_at)
    if parsed is None:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - parsed) <= timedelta(seconds=window_s)


def _build_health_snapshot() -> dict:
    """Read in-memory state from sibling modules. All reads tolerate
    missing modules — local-dev hubs may not have every service running."""
    # Ziggy version — telemetry_client owns the resolution logic.
    try:
        from services.telemetry_client import _get_ziggy_version, LAST_POST_AT_UTC
        from core.settings_loader import settings as _settings
        ziggy_version = _get_ziggy_version(_settings)
        last_post = LAST_POST_AT_UTC
    except Exception:
        ziggy_version = "unknown"
        last_post = None

    # HA reachability — ha_subscriber.ha_connected is the live flag.
    try:
        from services.ha_subscriber import ha_connected
        ha_reachable = bool(ha_connected)
    except Exception:
        ha_reachable = False

    # HA version — last value seen on the WebSocket auth_ok message.
    # ha_subscriber exposes it as a module-level attribute when present;
    # missing attr → None.
    ha_version: Optional[str] = None
    try:
        from services import ha_subscriber as _hs
        v = getattr(_hs, "ha_version", None)
        if isinstance(v, str) and v:
            ha_version = v
    except Exception:
        pass

    fresh = _last_post_is_fresh(last_post)
    if ha_reachable and fresh:
        status = "ok"
    elif ha_reachable or fresh:
        status = "degraded"
    else:
        status = "down"

    return {
        "status":                 status,
        "ha_reachable":           ha_reachable,
        "ziggy_version":          ziggy_version,
        "ha_version":             ha_version,
        "last_telemetry_post_at": last_post,
    }


# PUBLIC ENDPOINT — reviewed in PROMPT_SECURITY_HARDENING_V2 on 2026-05-28.
# Justification: LAN liveness during onboarding. The PWA / mobile app must
# be able to ping the hub BEFORE the user has a session, to confirm the
# hub is reachable on the customer's Wi-Fi. Path is /health (not /api/health),
# distinct from the auth-gated /api/health snapshot.
@router.get("/health")
async def edge_health() -> dict:
    """Public liveness endpoint. Always returns 200 with a status payload —
    even when the hub is "down" — so a network-level reachability probe
    can distinguish "hub not reachable on the LAN" from "hub running but
    HA is unreachable."""
    try:
        return _build_health_snapshot()
    except Exception:
        # Defense-in-depth — the snapshot helper already catches its own
        # collector failures, but if something explodes BEFORE the helper
        # returns we still want a structured "down" response.
        return {
            "status":                 "down",
            "ha_reachable":           False,
            "ziggy_version":          "unknown",
            "ha_version":             None,
            "last_telemetry_post_at": None,
        }
