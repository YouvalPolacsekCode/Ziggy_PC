"""Admin audit log reader (Prompt 10 chunk 3).

The audit_log table is written from many code paths
(register_hub, telemetry_posted, ota_*, home_cohort_updated, backup_*,
support_session_opened, etc — see relay/app/audit.py log_event callers).
Until this prompt, there was no HTTP read surface, so the dashboard
couldn't expose the audit trail.

Public surface (founder JWT, relay_admin role):

  GET /api/admin/audit-log
    Query params:
      event      substring match on the event column (e.g. "ota_")
      home_id    exact match on home_id
      ok         "true" / "false" — match the boolean column
      since      ISO timestamp (inclusive lower bound on ts)
      until      ISO timestamp (exclusive upper bound on ts)
      limit      default 100, max 500
      offset     default 0
    Returns:
      {
        rows: [{id, ts, event, home_id, source_ip, ok, detail}, ...],
        count: N,          # rows returned (== limit unless tail page)
        has_more: bool,    # true if there are additional rows past offset+count
      }

Indexes that cover the query:
  idx_audit_event(event, ts) — for event-substring + sort scenarios
  idx_audit_home(home_id, ts) — for home_id filter

For a substring event match SQLite still falls back to a scan, but the
table is bounded in practice (a few thousand rows per active home per
day) and the LIMIT keeps the response cheap.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from ..auth import require_role
from ..database import get_db

router = APIRouter()

MAX_LIMIT = 500
DEFAULT_LIMIT = 100


@router.get("/api/admin/audit-log")
async def list_audit_log(
    request: Request,
    event:   Optional[str] = None,
    home_id: Optional[str] = None,
    ok:      Optional[str] = None,
    since:   Optional[str] = None,
    until:   Optional[str] = None,
    limit:   int = DEFAULT_LIMIT,
    offset:  int = 0,
):
    require_role("relay_admin")(request)

    if limit < 1: limit = 1
    if limit > MAX_LIMIT: limit = MAX_LIMIT
    if offset < 0: offset = 0

    where_parts: list[str] = []
    params: list = []

    if event:
        # Substring match — admin typically wants "show me all ota_*" or
        # "show me all backup_*" prefixes. LIKE on event with both sides
        # wildcarded covers both prefix and substring use.
        where_parts.append("event LIKE ?")
        params.append(f"%{event}%")
    if home_id:
        where_parts.append("home_id = ?")
        params.append(home_id)
    if ok is not None and ok != "":
        # Accept the URL-friendly boolean encodings the dashboard might send.
        truthy = ok.strip().lower() in ("1", "true", "yes")
        where_parts.append("ok = ?")
        params.append(1 if truthy else 0)
    if since:
        where_parts.append("ts >= ?")
        params.append(since)
    if until:
        where_parts.append("ts < ?")
        params.append(until)

    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    # Fetch one extra row to determine has_more without a second COUNT
    # query. The trade-off: we transfer one extra row's bytes per page.
    # That's cheaper than a separate COUNT(*) scan over the same predicate.
    sql = (
        f"SELECT id, ts, event, home_id, source_ip, ok, detail "
        f"FROM audit_log {where_sql} "
        f"ORDER BY id DESC LIMIT ? OFFSET ?"
    )

    async with get_db() as db:
        rows = await db.execute_fetchall(sql, (*params, limit + 1, offset))

    has_more = len(rows) > limit
    page = rows[:limit]
    return {
        "rows": [
            {
                "id":        r["id"],
                "ts":        r["ts"],
                "event":     r["event"],
                "home_id":   r["home_id"],
                "source_ip": r["source_ip"],
                "ok":        bool(r["ok"]),
                "detail":    r["detail"],
            }
            for r in page
        ],
        "count":    len(page),
        "has_more": has_more,
    }
