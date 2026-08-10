from __future__ import annotations

"""Fleet-admin endpoints — DB-backed home registry (Phase 4).

Lets operator tooling (scripts/fleet-status.sh) fetch the current home
list from the relay instead of maintaining a static scripts/fleet.yml
that requires a git commit every time a new customer is onboarded.
"""

import json as _json
import time as _time

from fastapi import APIRouter, Request

from ..auth import require_role
from ..database import get_db
from .. import fleet_health

router = APIRouter(prefix="/admin/fleet")


@router.get("/homes")
async def list_fleet_homes(request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """SELECT id, name, type, tunnel_url, status, subscription_state
               FROM homes
               WHERE tunnel_url IS NOT NULL
               ORDER BY created_at ASC"""
        )
    return {"homes": [dict(r) for r in rows]}


@router.get("/health")
async def fleet_health_report(request: Request):
    """Every home's health in ONE call — the fleet's actual status page.

    `/admin/fleet/homes` reports `status`, which is the *provisioning
    lifecycle* column: a home reads "active" whether it is perfectly healthy,
    silently degraded, or unplugged. That gap is why a customer home spent 19 h
    with every device falsely marked "Removed from hub" while the fleet view
    showed nothing wrong.

    Health is derived from PUSHED telemetry (hub → relay, every 5 min). The
    relay never fetches the hub: most homes register raw `*.cfargotunnel.com`
    URLs that aren't routable from Fly, which is exactly how the old direct
    check came to return "unhealthy" for every home and got ignored.

    Silence is evaluated as its own signal — a hub that is off, crashed, or
    cut off from the internet says nothing at all, so absence of telemetry is
    the only evidence there will ever be.
    """
    require_role("relay_admin")(request)
    now = _time.time()

    async with get_db() as db:
        homes = await db.execute_fetchall(
            """SELECT id, name, type, tunnel_url, status, subscription_state
               FROM homes ORDER BY created_at ASC"""
        )
        # Latest telemetry row per home in one pass — no N+1 over the fleet.
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

    verdicts = []
    for h in homes:
        home = dict(h)
        ts, payload = by_home.get(home["id"], (None, None))
        v = fleet_health.evaluate(home, payload, ts, now=now)
        v["tunnel_url"] = home.get("tunnel_url")
        v["subscription_state"] = home.get("subscription_state")
        v["status"] = home.get("status")
        verdicts.append(v)

    # Worst first, so the thing needing attention is row one.
    rank = {"down": 0, "degraded": 1, "unknown": 2, "ok": 3}
    verdicts.sort(key=lambda v: (rank.get(v["level"], 9), v.get("name") or ""))

    return {
        "generated_at": now,
        "summary": fleet_health.summarize(verdicts),
        "homes": verdicts,
    }
