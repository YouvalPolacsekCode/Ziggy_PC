from __future__ import annotations

"""
Home provisioning endpoint — relay_admin only.
Creates a new home: Docker stack + Cloudflare tunnel + DB record.
"""

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from ..auth import require_role, current_user, new_id, ROLE_ORDER
from ..database import get_db
from ..provisioner import provision_home, provision_hub, deprovision_home

router = APIRouter(prefix="/provision")

RELAY_URL = os.getenv("RELAY_PUBLIC_URL", "")


class ProvisionBody(BaseModel):
    home_name:      str
    owner_email:    Optional[str] = None
    invite_token:   Optional[str] = None
    admin_email:    Optional[str] = None   # initial Ziggy admin login
    admin_password: Optional[str] = None  # plaintext, set as Fly secret, never stored here


@router.post("/home")
async def provision(body: ProvisionBody, bg: BackgroundTasks, request: Request):
    """Provision a new home on Fly.io. Runs in background; returns home_id immediately."""
    require_role("relay_admin")(request)

    home_id = f"home-{new_id()}"
    now = datetime.now(timezone.utc).isoformat()

    async with get_db() as db:
        await db.execute(
            """INSERT INTO homes (id, name, type, tunnel_url, status, relay_secret, created_at, owner_email)
               VALUES (?,?,?,NULL,'provisioning','pending',?,?)""",
            (home_id, body.home_name, "cloud", now, body.owner_email or body.admin_email),
        )
        rows = await db.execute_fetchall("SELECT COUNT(*) as c FROM homes")
        index = dict(rows[0])["c"]
        await db.commit()

    bg.add_task(_provision_background, home_id, body.home_name, index,
                body.admin_email or "", body.admin_password or "")
    return {"home_id": home_id, "status": "provisioning"}


async def _provision_background(home_id: str, home_name: str, index: int,
                                admin_email: str = "", admin_password: str = ""):
    try:
        result = await provision_home(
            home_id        = home_id,
            home_name      = home_name,
            relay_url      = RELAY_URL,
            index          = index,
            admin_email    = admin_email,
            admin_password = admin_password,
        )
        async with get_db() as db:
            await db.execute(
                """UPDATE homes
                   SET tunnel_url=?, relay_secret=?, cf_tunnel_id=?, status='active'
                   WHERE id=?""",
                (result.tunnel_url, result.relay_secret, result.tunnel_id, home_id),
            )
            await db.commit()
        # Email the owner their home URL
        if admin_email:
            await _send_ready_email(admin_email, home_name, result.tunnel_url)
    except Exception as e:
        async with get_db() as db:
            await db.execute(
                "UPDATE homes SET status=? WHERE id=?",
                (f"failed: {str(e)[:200]}", home_id),
            )
            await db.commit()


async def _send_ready_email(to: str, home_name: str, home_url: str) -> None:
    try:
        import smtplib, ssl, os as _os
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        smtp_host = _os.getenv("SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(_os.getenv("SMTP_PORT", "587"))
        smtp_user = _os.getenv("SMTP_USER", "")
        smtp_pass = _os.getenv("SMTP_PASS", "")
        from_name = _os.getenv("SMTP_FROM_NAME", "Ziggy")
        if not smtp_user or not smtp_pass:
            return
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Your Ziggy home '{home_name}' is ready!"
        msg["From"]    = f"{from_name} <{smtp_user}>"
        msg["To"]      = to
        body_html = f"""<p>Hi!</p>
<p>Your new Ziggy smart home <strong>{home_name}</strong> is ready to use.</p>
<p><a href="{home_url}" style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Open my home</a></p>
<p style="font-size:12px;color:#888">Log in with the email and password you set when accepting the invite.<br>
Then go to Settings → Home Assistant to connect your HA instance.</p>"""
        msg.attach(MIMEText(body_html, "html"))
        ctx = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as s:
            s.ehlo(); s.starttls(context=ctx); s.login(smtp_user, smtp_pass)
            s.sendmail(smtp_user, to, msg.as_string())
    except Exception:
        pass


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
    bg.add_task(deprovision_home, home_id, cf_id)
    return {"ok": True, "status": "deprovisioning"}


async def _provision_hub_background(home_id: str, home_name: str):
    """Background task for invite-accepted hub homes (Phase 4.5).

    Register endpoint inserted the DB row synchronously (so the accepter
    gets a home_id immediately) but the Cloudflare Tunnel call is deferred
    here so the /auth/register response isn't blocked on CF API latency.
    The frontend polls /provision/home/{id}/status to detect completion.
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


@router.get("/home/{home_id}/status")
async def provision_status(home_id: str, request: Request):
    """Poll a home's provisioning status.

    Accepts either relay_admin (for CloudAdmin) or the home's own owner
    (so AcceptInvite.jsx can poll the status of the home it just created
    with the JWT it got back from /auth/register).
    """
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


# ---------------------------------------------------------------------------
# Mini-PC hub provisioning (Phase 1 of Oracle→mini-PC transition)
# ---------------------------------------------------------------------------
#
# Synchronous — no SSH, no long-running work. Creates a Cloudflare Tunnel
# and a home DB record, then returns the bundle for scripts/claim-home.ps1
# to write onto the mini PC. Status stays 'awaiting_claim' until the mini
# PC boots up in the customer's home and hits POST /api/homes/register-hub.

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
