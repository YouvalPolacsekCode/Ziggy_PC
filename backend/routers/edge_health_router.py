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
    "last_telemetry_post_at": iso8601 | null,
    "coordinator_status":     "ok" | "loading" | "failed" | "unknown",
    "manual_action":          null | {"code": str, "title_key": str, "body_key": str}
  }

Status rubric:
  ok        — HA WebSocket connected AND a telemetry post has succeeded
              within the last 15 minutes (3× the 5-min cadence — allows
              one missed tick without flapping) AND Zigbee coordinator is
              loaded (when one is configured).
  degraded  — HA WebSocket connected but telemetry never posted or last
              post is older than 15 minutes, OR HA disconnected briefly,
              OR Zigbee coordinator is loading.
  down      — HA WebSocket has never connected since process start, OR
              Zigbee coordinator is in a failed state.

`coordinator_status` + `manual_action` let an external pinger (e.g.
UptimeRobot) keyword-match on "failed" or "replug_zigbee_dongle" without
needing a session token — the auth-gated /api/health surface is still the
canonical source for the dashboard banner.

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


async def _build_health_snapshot() -> dict:
    """Read in-memory state from sibling modules. All reads tolerate
    missing modules — local-dev hubs may not have every service running.

    Async because fetch_coordinator_state opens a short-lived HA WebSocket
    (the REST `/api/config/config_entries` endpoint returns 404 on modern
    HA, see ha_health.fetch_coordinator_state for the full story).
    """
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

    # System health: maps the structured ha_health failure model into the
    # public payload. Best-effort — any failure here degrades to "unknown"
    # rather than 500ing the liveness endpoint. compute_system_health has
    # side effects (schedules recovery via asyncio.create_task gated by the
    # 5-min cooldown), which is desirable: even an UptimeRobot poll drives
    # auto-recovery when the dashboard tab is closed.
    coordinator_status = "unknown"
    manual_action = None
    sh_level: str | None = None
    try:
        from services import ha_health
        from services.ha_subscriber import state_cache as _state_cache
        from services.entity_filter import _should_hide
        offline_ids = {
            eid for eid, e in _state_cache.items()
            if not _should_hide(eid) and (e.get("state") in ("unavailable", "unknown"))
        }
        total = sum(1 for eid in _state_cache if not _should_hide(eid))
        coord = (await ha_health.fetch_coordinator_state()) if ha_reachable else None
        sh = ha_health.compute_system_health(
            ha_connected=ha_reachable,
            offline_primary_ids=offline_ids,
            total_devices=total,
            coordinator=coord,
        )
        sh_level = sh.get("level")
        coord_state = (sh.get("zigbee") or {}).get("coordinator_state") or "unknown"
        if coord_state == "loaded":
            coordinator_status = "ok"
        elif coord_state == "setup_in_progress":
            coordinator_status = "loading"
        elif coord_state in (
            "setup_retry", "setup_error", "migration_error",
            "failed_unload", "not_loaded",
        ):
            coordinator_status = "failed"
        elif coord is None:
            coordinator_status = "unknown"
        else:
            coordinator_status = coord_state
        manual_action = (sh.get("recovery") or {}).get("manual_action")
    except Exception:
        pass

    fresh = _last_post_is_fresh(last_post)
    # Status escalation rubric: hardest signal wins. coordinator_status=failed
    # and sh_level=down both promote to "down" even when HA WS is technically
    # reachable, because from the user's perspective the home is broken.
    if not ha_reachable or sh_level == "down" or coordinator_status == "failed":
        status = "down"
    elif not fresh or sh_level == "degraded" or coordinator_status == "loading":
        status = "degraded"
    else:
        status = "ok"

    return {
        "status":                 status,
        "ha_reachable":           ha_reachable,
        "ziggy_version":          ziggy_version,
        "ha_version":             ha_version,
        "last_telemetry_post_at": last_post,
        "coordinator_status":     coordinator_status,
        "manual_action":          manual_action,
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
        return await _build_health_snapshot()
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
            "coordinator_status":     "unknown",
            "manual_action":          None,
        }
