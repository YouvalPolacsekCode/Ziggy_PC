"""Founder support session endpoint (Prompt 10 chunk 3).

Implements Option 1 from the audit (manual SSH, audit-only):

  POST /api/admin/homes/{home_id}/support-session
    Body: { reason?: str }  // free-text, ends up in audit detail
    Returns: {
      home_id, tunnel_url, cf_tunnel_id,
      ssh_snippet: "<runbook command>",
      ts: "<iso8601>",
      audit_id: <int>
    }

What this does:
  1. Validates founder is relay_admin.
  2. Writes a `support_session_opened` row to audit_log so every
     customer-side SSH session is traceable later.
  3. Returns a templated SSH command the founder copy-pastes into
     their terminal. The actual SSH happens manually — Prompt 5
     (full automation) is post-launch deferred.

What it intentionally does NOT do:
  * No customer push notification — the per-home tunnel is the
    delivery path and that's an OTA-following backend change. The
    audit row is the durable record; docs/RUNBOOK_SUPPORT_TUNNEL.md
    explains the customer-visible flow.
  * No SSH key provisioning. Founder is assumed to already hold an
    authorized key against the home's Cloudflare Access policy.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..audit import log_event
from ..auth import current_user, require_role
from ..database import get_db

router = APIRouter()

# Domain under which per-home Cloudflare Access hostnames are created.
# Override via env at deploy time so the same code works in staging.
# The hostname pattern is `ssh-<home_id>.<SSH_DOMAIN>` per
# docs/RUNBOOK_SUPPORT_TUNNEL.md (see chunk 3 commit).
SSH_DOMAIN = os.getenv("ZIGGY_SSH_DOMAIN", "ssh.ziggy.app")
# Linux user the founder lands on inside the per-home VM. CPX21 runbook
# provisions Hetzner servers with this user pre-created.
SSH_USER = os.getenv("ZIGGY_SSH_USER", "ziggy")


class SupportSessionBody(BaseModel):
    reason: Optional[str] = None


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


def _ssh_snippet(home_id: str) -> str:
    """Template the founder-runnable SSH command for a home.

    cloudflared access ssh routes through the home's Cloudflare Tunnel
    using the founder's local cloudflared client + their previously
    enrolled Cloudflare Access identity. See RUNBOOK_SUPPORT_TUNNEL.md
    for the one-time founder setup steps.
    """
    hostname = f"ssh-{home_id}.{SSH_DOMAIN}"
    return f"cloudflared access ssh --hostname {hostname} --user {SSH_USER}"


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
    detail_parts = [f"by={user.get('email','?')}"]
    if body.reason:
        # Truncate to keep the audit detail one-line-greppable.
        detail_parts.append(f"reason={body.reason[:120]}")
    await log_event(
        "support_session_opened", home_id=home_id, source_ip=src_ip,
        ok=True, detail=" ".join(detail_parts),
    )

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
        "ssh_snippet":  _ssh_snippet(home_id),
        "ts":           now_iso,
        "audit_id":     audit_id,
    }
