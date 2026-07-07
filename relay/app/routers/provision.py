from __future__ import annotations

"""
Home provisioning endpoints — relay_admin creates a home for a mini-PC hub
(scripts/claim-home.ps1 then writes the returned bundle onto the mini PC
before shipping). Home owners can poll their own home's status once
they've accepted an invite (frontend AcceptInvite.jsx polls this).

The pre-Phase-5 Oracle-VM SSH path (`POST /provision/home` +
`_provision_background` + `provision_home()` + on-VM docker-compose
template + admin-email SMTP) has been removed. See docs/PHASE-1-4-hub.md
for the full story of the transition, or `git log --grep='Phase [1-5]'`.
"""

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from ..auth import require_role, current_user, new_id, ROLE_ORDER
from ..database import get_db
from ..provisioner import provision_hub, deprovision_hub

router = APIRouter(prefix="/provision")

RELAY_URL = os.getenv("RELAY_PUBLIC_URL", "")


# ---------------------------------------------------------------------------
# Mini-PC hub provisioning — synchronous, no SSH
# ---------------------------------------------------------------------------

class HubProvisionBody(BaseModel):
    home_name:   str
    owner_email: Optional[str] = None


class HubProvisionBundle(BaseModel):
    home_id:      str
    home_name:    str
    relay_url:    str
    relay_secret: str
    tunnel_id:    str
    tunnel_url:   str
    tunnel_token: str


@router.post("/hub", response_model=HubProvisionBundle)
async def provision_hub_endpoint(body: HubProvisionBody, request: Request) -> HubProvisionBundle:
    """Create a home DB row + Cloudflare Tunnel and return the bundle that
    scripts/claim-home.ps1 writes onto the mini PC before shipping."""
    require_role("relay_admin")(request)

    home_id = f"home-{new_id()}"
    now = datetime.now(timezone.utc).isoformat()

    async with get_db() as db:
        await db.execute(
            """INSERT INTO homes (id, name, type, tunnel_url, status, relay_secret, created_at, owner_email)
               VALUES (?,?,?,NULL,'provisioning','pending',?,?)""",
            (home_id, body.home_name, "hub", now, body.owner_email),
        )
        await db.commit()

    try:
        result = await provision_hub(
            home_id   = home_id,
            home_name = body.home_name,
            relay_url = RELAY_URL,
        )
    except Exception as e:
        async with get_db() as db:
            await db.execute(
                "UPDATE homes SET status=? WHERE id=?",
                (f"failed: {str(e)[:200]}", home_id),
            )
            await db.commit()
        raise HTTPException(500, f"Hub provisioning failed: {e}")

    async with get_db() as db:
        await db.execute(
            """UPDATE homes
               SET tunnel_url=?, relay_secret=?, cf_tunnel_id=?, status='awaiting_claim'
               WHERE id=?""",
            (result.tunnel_url, result.relay_secret, result.tunnel_id, home_id),
        )
        await db.commit()

    return HubProvisionBundle(
        home_id      = result.home_id,
        home_name    = result.home_name,
        relay_url    = result.relay_url,
        relay_secret = result.relay_secret,
        tunnel_id    = result.tunnel_id,
        tunnel_url   = result.tunnel_url,
        tunnel_token = result.tunnel_token,
    )


async def _provision_hub_background(home_id: str, home_name: str):
    """Background helper called from register() in routers/auth.py.

    Register inserts the DB row synchronously so the invite-accepter gets a
    home_id in the response, then this task creates the Cloudflare Tunnel
    out-of-band so the /auth/register response isn't blocked on CF API
    latency. The frontend polls /provision/home/{id}/status to detect the
    transition to 'awaiting_claim'.
    """
    try:
        result = await provision_hub(
            home_id   = home_id,
            home_name = home_name,
            relay_url = RELAY_URL,
        )
        async with get_db() as db:
            await db.execute(
                """UPDATE homes
                   SET tunnel_url=?, relay_secret=?, cf_tunnel_id=?, status='awaiting_claim'
                   WHERE id=?""",
                (result.tunnel_url, result.relay_secret, result.tunnel_id, home_id),
            )
            await db.commit()
    except Exception as e:
        async with get_db() as db:
            await db.execute(
                "UPDATE homes SET status=? WHERE id=?",
                (f"failed: {str(e)[:200]}", home_id),
            )
            await db.commit()


# ---------------------------------------------------------------------------
# Deprovision — delete the CF tunnel and the DB row (CloudAdmin only)
# ---------------------------------------------------------------------------

@router.delete("/home/{home_id}")
async def deprovision(home_id: str, bg: BackgroundTasks, request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT cf_tunnel_id FROM homes WHERE id=?", (home_id,)
        )
        if not rows:
            raise HTTPException(404, "Home not found.")
        cf_id = dict(rows[0])["cf_tunnel_id"]
        await db.execute(
            "UPDATE homes SET status='deprovisioning' WHERE id=?", (home_id,)
        )
        await db.commit()
    bg.add_task(deprovision_hub, cf_id)
    return {"ok": True, "status": "deprovisioning"}


# ---------------------------------------------------------------------------
# Status polling — CloudAdmin or the home's own owner (post-invite-accept)
# ---------------------------------------------------------------------------

@router.get("/home/{home_id}/status")
async def provision_status(home_id: str, request: Request):
    """Accepts either relay_admin (for CloudAdmin) or the home's own owner
    (so AcceptInvite.jsx can poll the status of the home it just created
    with the JWT it got back from /auth/register)."""
    user = current_user(request)
    role = user.get("role", "user")
    if ROLE_ORDER.get(role, 0) < ROLE_ORDER["relay_admin"]:
        if user.get("home_id") != home_id:
            raise HTTPException(403, "Insufficient permissions.")
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, name, type, status, tunnel_url FROM homes WHERE id=?", (home_id,)
        )
        if not rows:
            raise HTTPException(404, "Home not found.")
        return dict(rows[0])
