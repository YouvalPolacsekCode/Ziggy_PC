"""Founder support session endpoint — Ubuntu mini-PC hub model.

  POST   /api/admin/homes/{home_id}/support-session          → open
  POST   /api/admin/homes/{home_id}/support-session/revoke   → close/revoke
    Body: { reason?: str }  // free-text, ends up in audit detail
    open Returns: {
      home_id, tunnel_url, cf_tunnel_id,
      ssh_hostname, ssh_snippet: "<cloudflared access ssh ...>",
      ts: "<iso8601>", audit_id: <int>
    }

What open does:
  1. Validates the caller is a founder (relay_admin — the highest role;
     ordinary super_admin/admin/user roles are rejected 403).
  2. Writes a `support_session_opened` row to audit_log so every
     customer-side SSH session is traceable later. This audit row is the
     durable, mandatory transparency record — it does NOT depend on the
     optional customer-notification webhook.
  3. Fires the OPTIONAL customer notification hook (best-effort; a no-op when
     ZIGGY_CUSTOMER_NOTIFY_URL is unset).
  4. Returns the WORKING `cloudflared access ssh` command for the Linux
     hub. The hostname is the SAME one the per-home Cloudflare Tunnel is
     bound to at provision time (relay/app/provisioner.py) and the target
     user is the locked-down `ziggy-support` login that
     scripts/linux/ziggy-support-access.sh enables for the session.

What revoke does:
  1. Writes `support_session_revoked` to audit_log (the durable record).
  2. Fires the OPTIONAL customer notification hook (no-op unless
     ZIGGY_CUSTOMER_NOTIFY_URL is set).
  The relay cannot SSH, so it does NOT itself end host access. The founder
  pubkey removal happens host-side (the host script's --disable, run over the
  session or by its auto-revoke TTL timer). Because of that, this endpoint is
  audit-only: it returns `audit_only: true` + `host_revoke_required: true`
  rather than falsely claiming host access was revoked.

The relay never establishes the SSH session itself — it writes the audit
row and returns the command for the founder to run locally. Access to the
SSH hostname is gated by the per-home Cloudflare Access policy created at
provision time (ZIGGY_SUPPORT_ALLOWED_EMAILS).
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..audit import log_event
from ..auth import current_user, require_role
from ..database import get_db
from ..provisioner import ssh_hostname_for

logger = logging.getLogger("ziggy.relay.support_session")

router = APIRouter()

# Linux user the founder lands on inside the mini PC. This is the locked-down
# login that scripts/linux/ziggy-support-access.sh provisions on demand — NOT
# a standing account. Override via env only if the host script's SSH_SUPPORT_USER
# is changed to match.
SSH_USER = os.getenv("ZIGGY_SSH_USER", "ziggy-support")

# Optional customer-notification webhook. When set, open/revoke POST a small
# JSON body so the customer's Ziggy app (or an email relay) can surface the
# support session in real time. Best-effort — never blocks or fails the request.
CUSTOMER_NOTIFY_URL = os.getenv("ZIGGY_CUSTOMER_NOTIFY_URL", "")


class SupportSessionBody(BaseModel):
    reason: Optional[str] = None


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


def _ssh_snippet(home_id: str) -> str:
    """Template the founder-runnable SSH command for a home.

    `cloudflared access ssh` routes through the home's Cloudflare Tunnel using
    the founder's local cloudflared client + their enrolled Cloudflare Access
    identity. The hostname is produced by the shared provisioner helper so it
    always matches what the tunnel is actually bound to. See
    docs/RUNBOOK_SUPPORT_TUNNEL.md for the one-time founder setup steps.
    """
    hostname = ssh_hostname_for(home_id)
    return f"cloudflared access ssh --hostname {hostname} --user {SSH_USER}"


async def notify_customer(home_id: str, event: str, detail: str) -> None:
    """Best-effort customer notification hook for support-session lifecycle.

    Kept intentionally small and monkeypatch-friendly for tests. Never raises —
    a notification failure must not fail the founder's support request. When
    ZIGGY_CUSTOMER_NOTIFY_URL is unset this is a no-op (the audit row is the
    durable record either way).
    """
    if not CUSTOMER_NOTIFY_URL:
        return
    payload = {
        "home_id": home_id,
        "event":   event,
        "detail":  detail,
        "ts":      datetime.now(timezone.utc).isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            await c.post(CUSTOMER_NOTIFY_URL, json=payload)
    except Exception:
        logger.warning("customer notify failed for %s (%s)", home_id, event)


@router.post("/api/admin/homes/{home_id}/support-session")
async def open_support_session(home_id: str, body: SupportSessionBody, request: Request):
    require_role("relay_admin")(request)
    user = current_user(request)
    src_ip = _client_ip(request)

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, tunnel_url, cf_tunnel_id FROM homes WHERE id=?",
            (home_id,),
        )
    if not rows:
        # Still write a failed audit row so probing attempts are visible.
        await log_event(
            "support_session_opened", home_id=home_id, source_ip=src_ip,
            ok=False, detail=f"unknown_home_id by={user.get('email','?')}",
        )
        raise HTTPException(404, "Home not found.")
    home = dict(rows[0])

    now_iso = datetime.now(timezone.utc).isoformat()
    detail = _detail(user, body.reason)
    await log_event(
        "support_session_opened", home_id=home_id, source_ip=src_ip,
        ok=True, detail=detail,
    )
    await notify_customer(home_id, "support_session_opened", detail)

    # Pull the audit id we just wrote so the dashboard can deep-link to
    # the audit-log viewer row. audit_log.id is AUTOINCREMENT so
    # MAX(id) on the very fresh write is safe for one process; the audit
    # writer never gaps ids.
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT MAX(id) AS id FROM audit_log WHERE home_id=? AND event='support_session_opened'",
            (home_id,),
        )
        audit_id = rows[0]["id"] if rows else None

    return {
        "home_id":      home_id,
        "tunnel_url":   home["tunnel_url"],
        "cf_tunnel_id": home["cf_tunnel_id"],
        "ssh_hostname": ssh_hostname_for(home_id),
        "ssh_snippet":  _ssh_snippet(home_id),
        "ts":           now_iso,
        "audit_id":     audit_id,
    }


@router.post("/api/admin/homes/{home_id}/support-session/revoke")
async def revoke_support_session(home_id: str, body: SupportSessionBody, request: Request):
    """Close/revoke an open support session (audit-only on the relay side).

    Writes the durable `support_session_revoked` audit row and fires the
    optional customer notification. The relay canNOT end host access itself —
    the founder's key is removed host-side by
    scripts/linux/ziggy-support-access.sh --disable (run in-session or by its
    auto-revoke TTL timer). To stay honest this returns `audit_only: true` +
    `host_revoke_required: true` instead of claiming host access was revoked.
    """
    require_role("relay_admin")(request)
    user = current_user(request)
    src_ip = _client_ip(request)

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id FROM homes WHERE id=?", (home_id,),
        )
    if not rows:
        await log_event(
            "support_session_revoked", home_id=home_id, source_ip=src_ip,
            ok=False, detail=f"unknown_home_id by={user.get('email','?')}",
        )
        raise HTTPException(404, "Home not found.")

    now_iso = datetime.now(timezone.utc).isoformat()
    detail = _detail(user, body.reason)
    await log_event(
        "support_session_revoked", home_id=home_id, source_ip=src_ip,
        ok=True, detail=detail,
    )
    await notify_customer(home_id, "support_session_revoked", detail)

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT MAX(id) AS id FROM audit_log WHERE home_id=? AND event='support_session_revoked'",
            (home_id,),
        )
        audit_id = rows[0]["id"] if rows else None

    # Honest status: the relay logged the revoke intent but did NOT end host
    # access. Host access stays live until ziggy-support-access.sh --disable
    # runs (in-session or via the auto-revoke TTL timer). Do not return
    # `revoked: true` for a step that does not actually revoke host access.
    return {
        "home_id":              home_id,
        "audit_only":           True,
        "host_revoke_required": True,
        "detail": (
            "Relay logged the revoke intent. Host SSH access remains live until "
            "ziggy-support-access.sh --disable runs on the hub (in-session or via "
            "the auto-revoke TTL timer)."
        ),
        "ts":       now_iso,
        "audit_id": audit_id,
    }


def _detail(user: dict, reason: Optional[str]) -> str:
    parts = [f"by={user.get('email','?')}"]
    if reason:
        # Truncate to keep the audit detail one-line-greppable.
        parts.append(f"reason={reason[:120]}")
    return " ".join(parts)
