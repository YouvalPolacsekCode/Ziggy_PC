"""Fleet-ops surface: read a hub's true state, and repair the safe things.

Why this exists
---------------
Remediating a hub used to mean an SSH session from one specific Mac holding a
`cloudflared` cert. That couples "can we fix it" to "is Youval at his desk",
which is how a customer home sat 19 h with every device falsely marked
"Removed from hub" after a power cut.

These endpoints are reachable through the relay proxy
(`/api/proxy/{home_id}/api/ops/...`, relay_admin only), so ANY operator —
a scheduled agent, a local Claude Code session, the ops console — can both see
and fix. Ad-hoc/host-level work still goes over SSH; this is the autonomous tier.

Safety model
------------
Only IDEMPOTENT, NON-DESTRUCTIVE verbs live here. Every action is safe to run
twice, on a healthy home, by a robot, at 3am:

    POST /api/ops/reconcile   re-read HA and refresh device statuses
    POST /api/ops/recover-ha  ask the HA/Zigbee recovery state machine to try

Anything that can lose state — deleting devices, factory reset, un-pairing,
rolling back a deploy — is deliberately NOT here. Those stay behind
lifecycle_router's explicit-intent flow and a human.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.routers.auth_deps import require_role
from core.logger_module import log_error, log_info

router = APIRouter(prefix="/api/ops")


# ── Who may use the ops console ────────────────────────────────────────────
# `super_admin` is NOT restrictive enough here: every customer is super_admin of
# their OWN hub, so David and Tslil would each reach this console on their own
# box. The fleet data itself is behind a separate relay login, but the surface
# should not be there at all for them.
#
# So the ops endpoints require a founder identity — an explicit allow-list —
# or a request arriving through the relay as relay_admin, which is how the
# fleet console and the autonomous remediator reach a hub.
_DEFAULT_FOUNDERS = ("silentyouval@gmail.com",)


def _founder_emails() -> set[str]:
    raw = os.getenv("ZIGGY_FOUNDER_EMAILS", "")
    listed = [e.strip().lower() for e in raw.split(",") if e.strip()]
    return set(listed or [e.lower() for e in _DEFAULT_FOUNDERS])


def _identities(user: dict) -> set[str]:
    """Every string that could name this user, lowercased."""
    out = set()
    for key in ("email", "username", "user", "name", "id"):
        v = user.get(key)
        if isinstance(v, str) and v.strip():
            out.add(v.strip().lower())
    return out


async def require_founder(user: dict = Depends(require_role("super_admin"))) -> dict:
    """super_admin AND a founder identity — or the relay acting as relay_admin."""
    if str(user.get("role", "")).lower() == "relay_admin":
        return user
    if _identities(user) & _founder_emails():
        return user
    raise HTTPException(
        status_code=403,
        detail="The ops console is limited to Ziggy staff.",
    )


def _registry_snapshot() -> dict[str, Any]:
    from services import device_registry
    rows = device_registry.get_all() or []
    counts: dict[str, int] = {}
    for r in rows:
        counts[str(r.get("status") or "unknown")] = counts.get(str(r.get("status") or "unknown"), 0) + 1
    return {
        "total": len(rows),
        "lost": counts.get(device_registry.LOST, 0),
        "connected": counts.get(device_registry.CONNECTED, 0),
        "by_status": counts,
    }


# Background services that must be running in a shipped hub, and what breaks if
# they are not. Keyed by the thread name each is started with in
# backend/server.py.
#
# This list exists because four of these were found NOT running in production:
# they were started only from core/ziggy_main.py, which the container never
# executes. The failure was invisible — the features simply never happened, and
# no surface anywhere said so. Now it is one call to check.
_EXPECTED_SERVICES = {
    "Reminder":     "task due-date reminders never fire",
    "SensorAlerts": "door/motion alerts never notify (skipped when disabled in settings)",
    "PatternEngine": "pattern learning never runs, so Suggestions stay empty",
    "Circadian":    "the smart light ramp never moves",
    "SmartClimate": "per-room thermostat control stops",
}


def _running_services() -> dict[str, Any]:
    """Which background threads are alive in THIS process.

    Note for anyone verifying by hand: `docker exec … python3 -c` starts a NEW
    interpreter with one thread and proves nothing. It has to be asked of the
    running server, which is what this endpoint does.
    """
    import threading

    from core.settings_loader import load_settings
    settings = load_settings() or {}

    # Services the operator can legitimately switch off. "Off because you said
    # so" must never look like "broken", or the check becomes noise and stops
    # being read — the same trap as an always-on drift alert.
    gates = {
        "SensorAlerts":  bool((settings.get("sensor_alerts") or {}).get("enabled", True)),
        "PatternEngine": bool((settings.get("pattern_learning") or {}).get("enabled", True)),
    }

    alive = {t.name for t in threading.enumerate() if t.is_alive()}
    services = {}
    for name, consequence in _EXPECTED_SERVICES.items():
        enabled = gates.get(name, True)
        running = name in alive
        services[name] = {
            "running": running,
            "enabled_in_settings": enabled,
            "state": ("running" if running else
                      "disabled_in_settings" if not enabled else "NOT RUNNING"),
            "if_missing": consequence,
        }
    return {
        "services": services,
        "all_threads": sorted(alive),
        # Only services that SHOULD be running and are not. This is the list
        # that means something is wrong.
        "missing": [n for n, v in services.items()
                    if not v["running"] and v["enabled_in_settings"]],
    }


@router.get("/whoami")
async def ops_whoami(user: dict = Depends(require_role("super_admin"))):
    """May the caller use the ops console?

    Deliberately NOT founder-gated: the router needs an answer for people who
    are not founders, so it can send them away cleanly instead of rendering a
    console that 403s on every call. Returns a boolean and nothing else — it
    must not become a way to enumerate who the founders are.
    """
    is_founder = (
        str(user.get("role", "")).lower() == "relay_admin"
        or bool(_identities(user) & _founder_emails())
    )
    return {"status": "ok", "data": {"founder": is_founder}}


@router.get("/status")
async def ops_status(_: dict = Depends(require_founder)):
    """Everything an operator needs about this hub in one call.

    Deliberately merges the two views that disagreed during the incident:
    `health` (what HA says) and `registry` (what Ziggy believes, which is what
    the user's "needs attention" banner renders).
    """
    from services import ha_health
    from services.deploy_state import collect_deploy_state

    out: dict[str, Any] = {
        "at": time.time(),
        "registry": _registry_snapshot(),
        "deploy": collect_deploy_state(),
        "health": ha_health.get_last_health(),
        "background": _running_services(),
    }
    try:
        from services.telemetry_client import LAST_POST_AT_UTC
        out["last_telemetry_post_at"] = LAST_POST_AT_UTC
    except Exception:
        out["last_telemetry_post_at"] = None
    return {"status": "ok", "data": out}


@router.get("/relay")
async def ops_relay_config(_: dict = Depends(require_founder)):
    """Where this hub's relay lives.

    The ops console used to require the operator to TYPE the relay URL into
    every browser they opened, because nothing ever populated it: `relayUrl()`
    reads `window.__RELAY_URL__` (never set by anything) or a localStorage key
    written only by that form. Until someone did, `isRelayConfigured()` was
    false and the console silently hid every fleet feature — so a working
    system looked like an empty, broken page.

    The hub has always known its own relay URL. Handing it to the UI removes
    the step entirely; all the operator supplies is who they are.
    """
    import os
    from core.settings_loader import load_settings

    settings = load_settings() or {}
    relay = settings.get("relay") or {}
    relay_url = os.getenv("RELAY_URL") or relay.get("url") or ""
    home = settings.get("home") or {}
    return {
        "status": "ok",
        "data": {
            "relay_url": relay_url.rstrip("/"),
            "home_id": os.getenv("HOME_ID") or home.get("id") or "",
            "configured": bool(relay_url),
        },
    }


@router.post("/reconcile")
async def ops_reconcile(_: dict = Depends(require_founder)):
    """Re-read HA and refresh every device status. THE fix for false 'lost'.

    Idempotent: on a healthy home it changes nothing. Returns before/after so
    the caller can tell whether it actually repaired anything — an automated
    remediator needs to know if its action mattered.
    """
    from services import device_registry

    before = _registry_snapshot()
    try:
        await asyncio.to_thread(device_registry.refresh)
    except Exception as exc:
        log_error(f"[Ops] reconcile failed: {exc}")
        return {"status": "error", "message": f"reconcile failed: {exc}", "data": {"before": before}}
    after = _registry_snapshot()
    repaired = max(0, before["lost"] - after["lost"])
    log_info(f"[Ops] reconcile: lost {before['lost']} -> {after['lost']} (repaired {repaired})")
    return {
        "status": "ok",
        "message": (
            f"Recovered {repaired} device(s) from 'lost'." if repaired
            else "Nothing to repair."
        ),
        "data": {"before": before, "after": after, "repaired": repaired},
    }


@router.post("/recover-ha")
async def ops_recover_ha(_: dict = Depends(require_founder)):
    """Nudge the HA / Zigbee-coordinator auto-recovery state machine.

    compute_system_health owns recovery (cooldown-gated inside ha_health), so
    this recomputes rather than reaching into HA directly — one owner for the
    recovery decision, no double-fire.
    """
    from services import ha_health
    from services.ha_subscriber import ha_connected, state_cache
    from services.entity_filter import _should_hide

    try:
        offline_ids = {
            eid for eid, e in state_cache.items()
            if not _should_hide(eid) and (e.get("state") in ("unavailable", "unknown"))
        }
        total = sum(1 for eid in state_cache if not _should_hide(eid))
        coord = (await ha_health.fetch_coordinator_state()) if ha_connected else None
        health = ha_health.compute_system_health(
            ha_connected=ha_connected,
            offline_primary_ids=offline_ids,
            total_devices=total,
            coordinator=coord,
        )
    except Exception as exc:
        log_error(f"[Ops] recover-ha failed: {exc}")
        return {"status": "error", "message": f"recover failed: {exc}"}

    recovery = health.get("recovery") or {}
    return {
        "status": "ok",
        "message": (
            "Recovery already in progress." if recovery.get("in_progress")
            else f"Health is {health.get('level')} ({health.get('primary')})."
        ),
        "data": {"health": health},
    }
