from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from ..auth import require_role, current_user, new_token
from ..database import get_db

router = APIRouter(prefix="/invites")

INVITE_TTL_HOURS = 72
RELAY_PUBLIC_URL = os.getenv("RELAY_PUBLIC_URL", "")  # set via env var; derived from request.base_url if empty


def _expired(inv: dict) -> bool:
    try:
        return datetime.now(timezone.utc) > datetime.fromisoformat(inv["expires_at"])
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Create invite
# ---------------------------------------------------------------------------

class CreateInviteBody(BaseModel):
    type:       str = "user"       # "user" | "home"
    email:      Optional[str] = None
    role:       str = "user"
    home_id:    Optional[str] = None  # required for type="user"
    home_name:  Optional[str] = None  # optional label for home invites
    public_url: Optional[str] = None  # Ziggy frontend URL — relay embeds it in the invite link


@router.post("/")
async def create_invite(body: CreateInviteBody, bg: BackgroundTasks, request: Request):
    user = current_user(request)
    role_level = {"guest": 0, "user": 1, "admin": 2, "super_admin": 3, "relay_admin": 9}

    if body.type == "home":
        if role_level.get(user.get("role", "user"), 0) < role_level["relay_admin"]:
            raise HTTPException(403, "Only relay admins can create home invites.")
        invite_role = body.role if body.role in ("super_admin", "admin") else "super_admin"
    else:
        if role_level.get(user.get("role", "user"), 0) < role_level["super_admin"]:
            raise HTTPException(403, "Only super admins can invite users.")
        home_id = body.home_id or user.get("home_id")
        if not home_id:
            raise HTTPException(400, "home_id required.")
        invite_role = body.role

    now  = datetime.now(timezone.utc)
    tok  = new_token()
    home_id_for_invite = None if body.type == "home" else (body.home_id or user.get("home_id"))

    async with get_db() as db:
        home_name = body.home_name
        if not home_name and home_id_for_invite:
            rows = await db.execute_fetchall(
                "SELECT name FROM homes WHERE id=?", (home_id_for_invite,)
            )
            home_name = dict(rows[0])["name"] if rows else "Ziggy Home"

        await db.execute(
            """INSERT INTO invites
               (token, type, email, role, home_id, home_name, invited_by, created_at, expires_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (tok, body.type, (body.email or "").strip().lower() or None,
             invite_role, home_id_for_invite, home_name or "Ziggy Home",
             user.get("email"), now.isoformat(),
             (now + timedelta(hours=INVITE_TTL_HOURS)).isoformat()),
        )
        await db.commit()

    # Determine the relay's own public URL.
    # Use RELAY_PUBLIC_URL env var if set; otherwise derive from the request's
    # base_url so it works on Fly.io without any extra secrets.
    relay_api = (RELAY_PUBLIC_URL.rstrip("/") if RELAY_PUBLIC_URL else
                 str(request.base_url).rstrip("/"))

    if body.public_url:
        # Invite link → Ziggy frontend, relay URL encoded as query param.
        # AcceptInvite reads ?relay= to know it should call the relay API.
        invite_url = f"{body.public_url.rstrip('/')}/invite/{tok}?relay={relay_api}"
    else:
        invite_url = f"{relay_api}/invite/{tok}"

    # Send email in background if address given
    if body.email:
        bg.add_task(_send_invite_email, body.email, body.type, home_name or "Ziggy Home",
                    user.get("email", "Ziggy"), invite_url, invite_role)

    return {
        "token":      tok,
        "invite_url": invite_url,
        "type":       body.type,
        "email":      body.email,
        "role":       invite_role,
        "expires_at": (now + timedelta(hours=INVITE_TTL_HOURS)).isoformat(),
    }


async def _send_invite_email(to: str, inv_type: str, home_name: str, invited_by: str,
                              invite_url: str, role: str):
    try:
        import smtplib, ssl
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText

        smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(os.getenv("SMTP_PORT", "587"))
        smtp_user = os.getenv("SMTP_USER", "")
        smtp_pass = os.getenv("SMTP_PASS", "")
        from_name = os.getenv("SMTP_FROM_NAME", "Ziggy")
        if not smtp_user or not smtp_pass:
            return

        role_label = {"super_admin": "Owner", "admin": "Admin", "user": "Member", "guest": "Guest"}.get(role, role)

        if inv_type == "home":
            subject = "Your Ziggy smart home is ready to set up"
            body_text = f"Set up your Ziggy home here: {invite_url}"
            body_html = f"""<p>Hi,</p><p><strong>{invited_by}</strong> has set up a Ziggy smart home for you — <strong>{home_name}</strong>.</p>
<p><a href="{invite_url}" style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Set up my home</a></p>
<p style="font-size:11px;color:#888">Link expires in 72 hours.</p>"""
        else:
            subject = f"You've been invited to {home_name} on Ziggy"
            body_text = f"Accept your invite to {home_name}: {invite_url}"
            body_html = f"""<p>Hi,</p><p><strong>{invited_by}</strong> has invited you to join <strong>{home_name}</strong> as <strong>{role_label}</strong>.</p>
<p><a href="{invite_url}" style="background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Accept invite</a></p>
<p style="font-size:11px;color:#888">Link expires in 72 hours.</p>"""

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{smtp_user}>"
        msg["To"] = to
        msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))

        ctx = ssl.create_default_context()
        with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as s:
            s.ehlo(); s.starttls(context=ctx); s.login(smtp_user, smtp_pass)
            s.sendmail(smtp_user, to, msg.as_string())
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Public endpoints — no auth
# ---------------------------------------------------------------------------

@router.get("/{token}/info")
async def get_invite_info(token: str):
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT type, email, role, home_name, invited_by, expires_at, accepted FROM invites WHERE token=?",
            (token,)
        )
        if not rows:
            raise HTTPException(404, "Invite not found.")
        inv = dict(rows[0])
        if inv["accepted"]:
            raise HTTPException(410, "Invite already used.")
        if _expired(inv):
            raise HTTPException(410, "Invite expired.")
        return inv


# ---------------------------------------------------------------------------
# Admin list + revoke
# ---------------------------------------------------------------------------

@router.get("/")
async def list_invites(request: Request):
    user = current_user(request)
    async with get_db() as db:
        if user.get("role") == "relay_admin":
            rows = await db.execute_fetchall(
                "SELECT token, type, email, role, home_name, invited_by, created_at, expires_at, accepted, accepted_by FROM invites ORDER BY created_at DESC"
            )
        else:
            rows = await db.execute_fetchall(
                """SELECT token, type, email, role, home_name, invited_by, created_at, expires_at, accepted, accepted_by
                   FROM invites WHERE home_id=? ORDER BY created_at DESC""",
                (user.get("home_id"),)
            )
        now = datetime.now(timezone.utc)
        result = []
        for r in rows:
            inv = dict(r)
            try:
                inv["status"] = "accepted" if inv["accepted"] else (
                    "expired" if now > datetime.fromisoformat(inv["expires_at"]) else "pending"
                )
            except Exception:
                inv["status"] = "unknown"
            result.append(inv)
        return result


@router.delete("/{token}")
async def revoke_invite(token: str, request: Request):
    user = current_user(request)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT home_id FROM invites WHERE token=?", (token,)
        )
        if not rows:
            raise HTTPException(404, "Invite not found.")
        inv_home = dict(rows[0])["home_id"]
        if user.get("role") != "relay_admin" and user.get("home_id") != inv_home:
            raise HTTPException(403, "Access denied.")
        await db.execute("DELETE FROM invites WHERE token=?", (token,))
        await db.commit()
    return {"ok": True}
