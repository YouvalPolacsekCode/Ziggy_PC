"""The loop: notice a broken home, fix the fixable, write down what happened.

Why it lives in the relay
-------------------------
Detection is worthless if acting on it depends on someone being awake. The
incident that produced this module — 23 devices falsely reported as removed
from a customer's hub — was detectable from the first telemetry post and stayed
unnoticed for 19 hours, because the only thing that could have noticed was a
laptop that happened to be closed.

The relay is the one component that is always up, already holds every home's
credentials, and already has the rules (fleet_health.py). So the loop lives
here. `scripts/fleet-health.py --fix` does the same thing on demand from a
terminal; this is that, on a timer, forever.

What it is allowed to do
------------------------
Only the verbs in fleet_health._REMEDY, which map to idempotent, non-destructive
hub endpoints (backend/routers/ops_router.py). Nothing here can delete a device,
unpair a radio, roll back a deploy, or touch a customer's automations. An issue
with no mapped verb is simply reported — "a human decides" is the correct
default, and silence about what it can't fix is worse than useless.

Guardrails
----------
* **Cooldown per (home, verb).** A repair that didn't work must not become a
  retry storm against a struggling hub.
* **Attempt cap per issue.** If the same problem returns three times, stop
  trying and escalate — repeated automated repair of a recurring fault hides
  the fault.
* **Every action is written to audit_log**, successes and failures alike, so
  "the robot fixed it" is checkable rather than assumed.
* **Disabled by env** (ZIGGY_AUTO_REMEDIATE=0) without a redeploy.
"""

from __future__ import annotations

import asyncio
import json as _json
import os
import time
from typing import Any

import httpx

from . import fleet_health
from .audit import log_event
from .database import get_db

# How often to sweep. Hubs post telemetry every 5 min, so sweeping faster only
# re-reads the same row; slower delays every repair by the difference.
SWEEP_INTERVAL_S = int(os.environ.get("ZIGGY_REMEDIATE_INTERVAL_S", "300"))

# Don't repeat the same verb on the same home inside this window. Long enough
# that a hub gets a full telemetry cycle (plus slack) to show whether the last
# attempt worked.
COOLDOWN_S = int(os.environ.get("ZIGGY_REMEDIATE_COOLDOWN_S", "1800"))

# After this many attempts at the same (home, verb) without the issue clearing,
# stop and leave it for a human. A fault that survives three automated repairs
# is not the kind of fault automation should keep papering over.
MAX_ATTEMPTS = int(os.environ.get("ZIGGY_REMEDIATE_MAX_ATTEMPTS", "3"))

ENABLED = os.environ.get("ZIGGY_AUTO_REMEDIATE", "1").strip().lower() not in ("0", "false", "no")

HUB_TIMEOUT_S = 45.0

_VERB_PATHS = {
    "reconcile":  "/api/ops/reconcile",
    "recover-ha": "/api/ops/recover-ha",
}

# (home_id, verb) → {"last_at": epoch, "attempts": int}
_state: dict[tuple[str, str], dict[str, Any]] = {}

_client = httpx.AsyncClient(timeout=HUB_TIMEOUT_S, follow_redirects=False)


async def _load_fleet(now: float) -> list[dict]:
    """Every home's verdict, plus what we need to reach its hub."""
    async with get_db() as db:
        homes = await db.execute_fetchall(
            """SELECT id, name, status, subscription_state, tunnel_url,
                      public_hostname, relay_secret
               FROM homes ORDER BY created_at ASC"""
        )
        latest = await db.execute_fetchall(
            """SELECT t.home_id, t.ts, t.payload
               FROM telemetry_raw t
               JOIN (SELECT home_id, MAX(id) AS mid
                     FROM telemetry_raw GROUP BY home_id) m
                 ON t.id = m.mid"""
        )

    by_home: dict[str, tuple[str, dict | None]] = {}
    for r in latest:
        row = dict(r)
        try:
            payload = _json.loads(row["payload"])
        except (TypeError, ValueError):
            payload = None
        by_home[row["home_id"]] = (row.get("ts"), payload if isinstance(payload, dict) else None)

    out = []
    for h in homes:
        home = dict(h)
        ts, payload = by_home.get(home["id"], (None, None))
        verdict = fleet_health.evaluate(home, payload, ts, now=now)
        verdict["_home"] = home
        out.append(verdict)
    return out


async def _call_hub(home: dict, verb: str) -> tuple[bool, str]:
    """Invoke a safe repair verb on one hub. Mirrors routers/proxy.py's
    forwarding contract: per-home relay_secret plus relay user context, which
    is what the hub's relay_auth middleware trusts."""
    path = _VERB_PATHS.get(verb)
    if not path:
        return False, f"unknown verb {verb}"

    hub_base = (home.get("public_hostname") or "").strip() or (home.get("tunnel_url") or "")
    if not hub_base:
        return False, "home has no reachable hub URL"
    if not hub_base.startswith("http"):
        hub_base = f"https://{hub_base}"

    try:
        resp = await _client.post(
            f"{hub_base.rstrip('/')}{path}",
            headers={
                "X-Relay-Secret": home.get("relay_secret") or "",
                "X-Relay-User": "fleet-remediator@ziggy",
                "X-Relay-Role": "relay_admin",
                "X-Relay-Home": home.get("id") or "",
                "Content-Type": "application/json",
            },
            content=b"{}",
        )
    except httpx.ConnectError:
        return False, "hub unreachable (tunnel down)"
    except httpx.TimeoutException:
        return False, "hub timed out"
    except Exception as e:  # never let one hub kill the sweep
        return False, f"error: {e}"

    if resp.status_code >= 400:
        return False, f"hub returned {resp.status_code}"
    try:
        body = resp.json()
        return True, str(body.get("message") or body.get("status") or "ok")
    except Exception:
        return True, "ok"


def _should_attempt(home_id: str, verb: str, now: float) -> tuple[bool, str]:
    key = (home_id, verb)
    st = _state.get(key)
    if st is None:
        return True, ""
    if st["attempts"] >= MAX_ATTEMPTS:
        return False, "attempt cap reached — needs a human"
    if (now - st["last_at"]) < COOLDOWN_S:
        return False, "cooling down"
    return True, ""


def _record_attempt(home_id: str, verb: str, now: float) -> int:
    key = (home_id, verb)
    st = _state.setdefault(key, {"last_at": 0.0, "attempts": 0})
    st["last_at"] = now
    st["attempts"] += 1
    return st["attempts"]


def _clear(home_id: str) -> None:
    """A healthy home forgets its history, so a future fault gets a fresh
    budget instead of inheriting an old one's exhausted cap."""
    for key in [k for k in _state if k[0] == home_id]:
        _state.pop(key, None)


async def sweep_once(*, now: float | None = None) -> dict:
    """One pass. Returns a summary — also used by tests and by /admin/fleet."""
    now = time.time() if now is None else now
    verdicts = await _load_fleet(now)
    actions: list[dict] = []

    for v in verdicts:
        home = v.pop("_home")
        home_id = home["id"]

        if v["level"] == fleet_health.LEVEL_OK:
            _clear(home_id)
            continue
        if v.get("suspended"):
            continue

        for verb in v.get("actionable") or []:
            ok_to_go, why_not = _should_attempt(home_id, verb, now)
            if not ok_to_go:
                actions.append({"home_id": home_id, "verb": verb,
                                "skipped": why_not, "ok": None})
                continue

            attempt = _record_attempt(home_id, verb, now)
            ok, message = await _call_hub(home, verb)
            actions.append({"home_id": home_id, "name": home.get("name"),
                            "verb": verb, "ok": ok, "message": message,
                            "attempt": attempt})
            await log_event(
                "fleet_auto_repair", home_id=home_id, ok=ok,
                detail=f"{verb} (attempt {attempt}/{MAX_ATTEMPTS}): {message}",
            )

    summary = fleet_health.summarize(verdicts)
    return {"at": now, "summary": summary, "actions": actions,
            "unhealthy": [v for v in verdicts if v["level"] != fleet_health.LEVEL_OK]}


async def run_remediator_loop() -> None:
    """Background task; started from main.py's lifespan."""
    if not ENABLED:
        return
    # Let the app finish booting before the first sweep.
    await asyncio.sleep(30)
    while True:
        try:
            await sweep_once()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            # A sweep must never be able to kill the loop — losing the watcher
            # is precisely the failure this module exists to prevent.
            try:
                await log_event("fleet_auto_repair", ok=False, detail=f"sweep failed: {e}")
            except Exception:
                pass
        await asyncio.sleep(SWEEP_INTERVAL_S)
