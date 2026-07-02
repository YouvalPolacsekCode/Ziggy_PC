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


# OTA staleness thresholds — how long since the last successful deploy
# before we escalate. The Windows scheduled task fires every 2 min, so
# on a healthy hub the deploy_log tail is refreshed by any push within
# that window. When there's nothing to deploy the log doesn't advance,
# so a real "OTA is broken" signal has to be relatively patient.
#
# 30 min → the scheduled task has skipped ~15 opportunities. Even on a
#          quiet repo we'd expect SOMETHING (a fetch heartbeat, a
#          failed-verify entry) to have appeared. Warn.
# 2 hours → the task has been silent for 60+ cycles. Screen-lock stall,
#           schtasks broken, docker daemon down — real problem, page.
_OTA_STALE_WARN_S  = 30 * 60
_OTA_STALE_DOWN_S  = 2 * 60 * 60
_DEPLOY_LOG_PATH   = "/app/user_files/deploy_log"


def _ota_snapshot() -> dict:
    """Read deploy_log (mounted from the mini PC host at /app/user_files/).

    The file is a flat log with '---' separated blocks, each carrying:
      ts:        2026-06-25T10:35:50Z
      cohort:    canary
      target:    origin/main
      old:       <sha>
      new:       <sha>
      verified:  True|False

    Returns:
      {
        "last_deploy_at":  iso8601 | null,
        "seconds_since":   int,
        "last_verified":   bool | null,
        "status":          "ok" | "stale" | "silent" | "unknown"
      }

    Never raises — a missing/unreadable log becomes status="unknown" so
    that a fresh hub without OTA still returns a clean payload.
    """
    import os
    import re
    try:
        if not os.path.exists(_DEPLOY_LOG_PATH):
            return {"last_deploy_at": None, "seconds_since": None,
                    "last_verified": None, "status": "unknown"}
        # Read last ~10KB — enough for many recent blocks without paying
        # to scan the whole file on every /health poll.
        with open(_DEPLOY_LOG_PATH, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 10240))
            tail = f.read().decode("utf-8", errors="replace")
        # Grab the last `ts:` and matching `verified:` in the tail.
        ts_matches = re.findall(r"^\s*ts:\s*(\S+)", tail, re.MULTILINE)
        verified_matches = re.findall(r"^\s*verified:\s*(\S+)", tail, re.MULTILINE)
        if not ts_matches:
            return {"last_deploy_at": None, "seconds_since": None,
                    "last_verified": None, "status": "unknown"}
        last_ts_str = ts_matches[-1]
        last_verified = None
        if verified_matches:
            v = verified_matches[-1].strip().lower()
            last_verified = v in ("true", "1", "yes")
        # Compute age
        try:
            # Log emits UTC ISO with Z suffix; datetime.fromisoformat needs +00:00.
            iso = last_ts_str.replace("Z", "+00:00")
            last_dt = datetime.fromisoformat(iso)
            now = datetime.now(timezone.utc)
            seconds_since = int((now - last_dt).total_seconds())
        except Exception:
            return {"last_deploy_at": last_ts_str, "seconds_since": None,
                    "last_verified": last_verified, "status": "unknown"}
        # Clock-skew guard: the mini PC host clock has run ahead of real time
        # (see scripts/fix-clock-skew.ps1), which stamps deploy_log in the
        # future relative to the reader — yielding a nonsensical NEGATIVE age.
        # Surface it honestly (clock_skew_suspected) and clamp to 0 for
        # classification so a just-deployed hub still reads "ok" rather than
        # flashing a confusing negative number.
        clock_skew_suspected = seconds_since < 0
        if clock_skew_suspected:
            seconds_since = 0
        # Classify
        if seconds_since >= _OTA_STALE_DOWN_S:
            status = "silent"
        elif seconds_since >= _OTA_STALE_WARN_S:
            status = "stale"
        else:
            status = "ok"
        # Even a fresh deploy that failed verification is a problem
        if last_verified is False and status == "ok":
            status = "stale"
        return {
            "last_deploy_at":       last_ts_str,
            "seconds_since":        seconds_since,
            "last_verified":        last_verified,
            "status":               status,
            "clock_skew_suspected": clock_skew_suspected,
        }
    except Exception:
        return {"last_deploy_at": None, "seconds_since": None,
                "last_verified": None, "status": "unknown"}


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
    ota = _ota_snapshot()
    # Status escalation rubric: hardest signal wins. coordinator_status=failed
    # and sh_level=down both promote to "down" even when HA WS is technically
    # reachable, because from the user's perspective the home is broken.
    # OTA "silent" (no deploy in 2h) escalates to "down" — a hub that can't
    # accept pushes is dark to operators. "stale" (30m+) → "degraded".
    if not ha_reachable or sh_level == "down" or coordinator_status == "failed" or ota["status"] == "silent":
        status = "down"
    elif not fresh or sh_level == "degraded" or coordinator_status == "loading" or ota["status"] == "stale":
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
        "ota":                    ota,
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
            "ota":                    {"last_deploy_at": None, "seconds_since": None,
                                       "last_verified": None, "status": "unknown"},
        }
