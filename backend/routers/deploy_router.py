"""GET /api/admin/deploy/health — is the canary's update loop alive?

scripts/update.ps1 writes user_files/update.heartbeat on every poll (even
no-ops). The file's mtime + content answers two questions that used to
need filesystem access to the mini-PC:

  1. Is the Windows scheduled task firing at all?  (mtime within ~5 min)
  2. What did the last poll do?                    (status string in file)

Plus we surface the last few entries from deploy_log so the dashboard /
ops console can show "last deployed SHA, last attempt outcome" without
SSHing into the canary.

super_admin only — this is observability for the operator, not for end
users.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from fastapi import APIRouter, Depends

from .auth_deps import require_role


router = APIRouter()


# Resolve once at import time. /app is the WORKDIR in the container; the
# scheduled task runs from the repo on the host, so absolute paths land in
# /app/user_files/ when mounted by docker compose.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_HEARTBEAT = _REPO_ROOT / "user_files" / "update.heartbeat"
_DEPLOY_LOG = _REPO_ROOT / "user_files" / "deploy_log"


def _read_heartbeat() -> dict:
    """Read the heartbeat file written by update.ps1 on every poll.

    Returns {present, ts, status, age_seconds} so the caller can render
    'last seen N minutes ago, status=<...>' without parsing dates."""
    if not _HEARTBEAT.exists():
        return {"present": False}
    try:
        raw = _HEARTBEAT.read_text(encoding="ascii").strip()
        mtime = _HEARTBEAT.stat().st_mtime
    except OSError as e:
        return {"present": True, "error": f"read failed: {e}"}
    # Format: "<utc-ts> <status...>" — keep the parse lenient so a
    # malformed heartbeat doesn't break the endpoint.
    parts = raw.split(" ", 1)
    ts = parts[0] if parts else ""
    status = parts[1] if len(parts) > 1 else ""
    return {
        "present": True,
        "ts": ts,
        "status": status,
        # age_seconds is what the dashboard renders red/green on. Heartbeat
        # should refresh every ~5 minutes — anything past ~10 means the
        # scheduled task isn't firing.
        "age_seconds": int(time.time() - mtime),
    }


def _read_recent_deploys(n: int = 5) -> list[dict]:
    """Tail the deploy_log and return the last `n` entries newest-first.

    deploy_log entry format (multi-line per entry, separated by '---'):
        ts:        2026-06-22T...
        cohort:    canary
        target:    origin/main
        old:       <sha>
        new:       <sha>
        verified:  True
        [optional kind: rollback]
    """
    if not _DEPLOY_LOG.exists():
        return []
    try:
        text = _DEPLOY_LOG.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return []
    # Split on the '---' separator update.ps1 writes between entries.
    chunks = [c.strip() for c in text.split("\n---\n") if c.strip()]
    # First chunk may start with '---'; trim if so.
    if chunks and chunks[0].startswith("---"):
        chunks[0] = chunks[0].lstrip("-").strip()
    entries = []
    for chunk in chunks[-n:][::-1]:
        entry: dict = {}
        for line in chunk.splitlines():
            line = line.strip()
            if ":" not in line:
                continue
            k, _, v = line.partition(":")
            entry[k.strip()] = v.strip()
        if entry:
            entries.append(entry)
    return entries


@router.get("/api/admin/deploy/health")
async def deploy_health(_: dict = Depends(require_role("super_admin"))):
    """Heartbeat + recent deploy attempts. Use this to debug 'why didn't
    my push deploy' without filesystem access to the mini-PC."""
    container_sha = os.environ.get("ZIGGY_GIT_SHA", "unknown")
    return {
        "container_sha": container_sha,
        "heartbeat": _read_heartbeat(),
        "recent_deploys": _read_recent_deploys(),
    }
