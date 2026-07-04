from __future__ import annotations

"""Fleet-admin endpoints — DB-backed home registry (Phase 4).

Lets operator tooling (scripts/fleet-status.sh) fetch the current home
list from the relay instead of maintaining a static scripts/fleet.yml
that requires a git commit every time a new customer is onboarded.
"""

from fastapi import APIRouter, Request

from ..auth import require_role
from ..database import get_db

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
