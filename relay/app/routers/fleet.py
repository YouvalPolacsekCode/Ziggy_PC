from __future__ import annotations

"""Fleet-admin endpoints — DB-backed home registry (Phase 4).

Lets operator tooling (scripts/fleet-status.sh) fetch the current home
list from the relay instead of maintaining a static scripts/fleet.yml
that requires a git commit every time a new customer is onboarded.
"""

import json as _json
import time as _time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..audit import log_event
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
        v["owner_email"] = home.get("owner_email")
        v["vitals"] = fleet_health.vitals(payload)
        verdicts.append(v)

    # Worst first, so the thing needing attention is row one.
    rank = {"down": 0, "degraded": 1, "unknown": 2, "ok": 3}
    verdicts.sort(key=lambda v: (rank.get(v["level"], 9), v.get("name") or ""))

    return {
        "generated_at": now,
        "summary": fleet_health.summarize(verdicts),
        "versions": fleet_health.version_rollup(verdicts),
        "homes": verdicts,
    }


# Audit events worth showing a human. `telemetry_posted` and
# `ota_manifest_served` fire every few minutes per home and would bury
# everything else — 357 of the last 400 rows were telemetry alone.
_ACTIVITY_EVENTS = (
    "home_version_changed",
    "fleet_auto_repair",
    "fleet_home_deleted",
    "register_hub",
    "home_provisioned",
    "support_session_opened",
    "backup_restored",
)


@router.get("/activity")
async def fleet_activity(request: Request, limit: int = 40):
    """What has actually happened across the fleet, newest first.

    Answers the operator's second question — after "is anything broken", the
    next one is always "what changed?". Deploys, automatic repairs, new homes,
    removals: the events that explain today's state.
    """
    require_role("relay_admin")(request)
    limit = max(1, min(int(limit), 200))
    placeholders = ",".join("?" for _ in _ACTIVITY_EVENTS)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            f"""SELECT a.ts, a.event, a.home_id, a.ok, a.detail, h.name
                FROM audit_log a LEFT JOIN homes h ON h.id = a.home_id
                WHERE a.event IN ({placeholders})
                ORDER BY a.id DESC LIMIT ?""",
            (*_ACTIVITY_EVENTS, limit),
        )
    return {"activity": [dict(r) for r in rows]}


# Tables that carry a home_id. SQLite only honours `ON DELETE CASCADE` when
# `PRAGMA foreign_keys=ON`, which is OFF by default and not set here — and
# telemetry_raw / telemetry_daily / audit_log have no foreign key at all. So the
# cascade is done explicitly; otherwise "removing" a home leaves its telemetry
# behind to be re-counted forever.
_HOME_CHILD_TABLES = (
    "telemetry_raw", "telemetry_daily", "home_cohorts",
    "home_backup_keys", "founder_slots", "invites",
)

# A home that reported this recently is a LIVE home, whatever its label says.
# Removal refuses on that basis unless explicitly forced, because the cost of
# wrongly deleting a customer's home is not symmetric with the cost of asking.
RECENT_TELEMETRY_GUARD_S = 24 * 3600


@router.delete("/homes/{home_id}")
async def delete_home_record(home_id: str, request: Request, force: bool = False):
    """Hard-delete a home record and everything hanging off it.

    Distinct from `DELETE /api/provision/home/{id}` (deprovision), which tears
    down Cloudflare resources and sets `status='deprovisioning'` but LEAVES THE
    ROW — which is why dead smoke-test homes have lingered in the fleet list for
    months, diluting the signal the list exists to give.

    Refuses to delete a home that has reported telemetry in the last 24 h unless
    forced. The whole point of the fleet view is to notice live homes; deleting
    one by accident would be the worst possible failure of this endpoint.
    """
    require_role("relay_admin")(request)

    async with get_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM homes WHERE id=?", (home_id,))
        if not rows:
            raise HTTPException(404, "Home not found.")
        home = dict(rows[0])

        seen = await db.execute_fetchall(
            "SELECT MAX(ts) AS last_ts FROM telemetry_raw WHERE home_id=?", (home_id,)
        )
    last_ts = dict(seen[0]).get("last_ts") if seen else None

    if last_ts and not force:
        import time as _t
        from ..fleet_health import _iso_to_epoch
        epoch = _iso_to_epoch(last_ts)
        if epoch and (_t.time() - epoch) < RECENT_TELEMETRY_GUARD_S:
            raise HTTPException(
                409,
                f"'{home.get('name')}' reported telemetry at {last_ts} — it looks "
                f"alive. Pass ?force=true if you really mean to delete it.",
            )

    # Snapshot the row into the audit trail before it stops existing.
    await log_event(
        "fleet_home_deleted", home_id=home_id, ok=True,
        detail=_json.dumps({
            "name": home.get("name"), "owner_email": home.get("owner_email"),
            "status": home.get("status"), "tunnel_url": home.get("tunnel_url"),
            "cf_tunnel_id": home.get("cf_tunnel_id"), "created_at": home.get("created_at"),
            "last_telemetry_ts": last_ts, "forced": bool(force),
        }, separators=(",", ":")),
    )

    deleted: dict[str, int] = {}
    async with get_db() as db:
        for table in _HOME_CHILD_TABLES:
            try:
                cur = await db.execute(f"DELETE FROM {table} WHERE home_id=?", (home_id,))
                deleted[table] = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
            except Exception:
                # A table that doesn't exist on this deployment must not block
                # the removal of the home itself.
                deleted[table] = 0
        # Users are detached rather than deleted — an account may be a person,
        # and people outlive their hardware.
        try:
            await db.execute("UPDATE users SET home_id=NULL WHERE home_id=?", (home_id,))
        except Exception:
            pass
        await db.execute("DELETE FROM homes WHERE id=?", (home_id,))
        await db.commit()

    return {"ok": True, "deleted": {"home": home.get("name"), "children": deleted}}


class HostnameBody(BaseModel):
    public_hostname: Optional[str] = None


@router.put("/homes/{home_id}/hostname")
async def set_home_hostname(home_id: str, body: HostnameBody, request: Request):
    """Set the address the relay uses to reach a hub.

    The relay talks to a hub over `public_hostname`, falling back to
    `tunnel_url`. Homes provisioned before the per-home DNS work only have a raw
    `*.cfargotunnel.com` tunnel_url, which is routable from inside Cloudflare's
    network but NOT from Fly — so every proxied call to them times out. The
    Canary hub was in exactly that state: reachable by the whole world at
    app.ziggy-home.com, unreachable by its own control plane, which meant
    automatic repair worked for customers but not for the founder's own home.

    Pass null to clear it and fall back to tunnel_url.
    """
    require_role("relay_admin")(request)

    value = (body.public_hostname or "").strip() or None
    if value:
        if not value.startswith(("http://", "https://")):
            value = f"https://{value.lstrip('/')}"
        value = value.rstrip("/")

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT name, public_hostname FROM homes WHERE id=?", (home_id,))
        if not rows:
            raise HTTPException(404, "Home not found.")
        before = dict(rows[0]).get("public_hostname")
        await db.execute(
            "UPDATE homes SET public_hostname=? WHERE id=?", (value, home_id))
        await db.commit()

    await log_event(
        "home_hostname_set", home_id=home_id, ok=True,
        detail=f"{before or '(none)'} → {value or '(none)'}",
    )
    return {"ok": True, "home_id": home_id, "public_hostname": value}


@router.get("/repairs")
async def fleet_repairs(request: Request, limit: int = 50):
    """What the auto-remediator has actually done.

    Automated repair is only trustworthy if it is auditable: an operator must be
    able to ask "what did the robot touch, and did it work?" and get an answer
    that isn't a shrug. Every attempt — success or failure — is an audit_log row.
    """
    require_role("relay_admin")(request)
    limit = max(1, min(int(limit), 500))
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """SELECT a.ts, a.home_id, a.ok, a.detail, h.name
               FROM audit_log a LEFT JOIN homes h ON h.id = a.home_id
               WHERE a.event = 'fleet_auto_repair'
               ORDER BY a.id DESC LIMIT ?""",
            (limit,),
        )
    return {"repairs": [dict(r) for r in rows]}


@router.post("/sweep")
async def fleet_sweep_now(request: Request):
    """Run a remediation sweep immediately instead of waiting for the timer.

    Exists so an operator (or an agent following up on an alert) never has to
    sit through the interval to confirm a fix landed.
    """
    require_role("relay_admin")(request)
    from ..remediator import sweep_once
    return await sweep_once()
