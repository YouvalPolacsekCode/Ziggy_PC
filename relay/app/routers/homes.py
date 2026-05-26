from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel

from ..audit import log_event, verify as verify_signature
from ..auth import require_role, current_user, new_id, new_token
from ..database import get_db

router = APIRouter(prefix="/homes")

ROLE_ADMIN = require_role("relay_admin")


# ---------------------------------------------------------------------------
# Hub self-registration — called by a Ziggy hub on startup
# ---------------------------------------------------------------------------

class RegisterHubBody(BaseModel):
    home_id:    str
    name:       str
    tunnel_url: str


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


@router.post("/register-hub")
async def register_hub(request: Request):
    """Ziggy hub calls this on startup to register or update its tunnel URL.

    Authenticated by HMAC-SHA256 signature over the raw body, verified against
    the per-home relay_secret stored at provisioning time. Pre-existing hubs
    that still hold the legacy shared secret can rotate via /rotate-hub-secret
    before calling this endpoint.
    """
    raw = await request.body()
    src_ip = _client_ip(request)
    sig_header = request.headers.get("X-Ziggy-Signature", "")

    # Parse body manually so we have raw bytes for the signature *and* the
    # decoded fields. FastAPI's BaseModel-as-arg path would consume the body
    # internally and re-encode it for our hash, which is fragile.
    import json as _json
    try:
        payload = _json.loads(raw.decode("utf-8")) if raw else {}
        body = RegisterHubBody(**payload)
    except Exception as e:
        await log_event(
            "register_hub", source_ip=src_ip, ok=False,
            detail=f"bad_body: {type(e).__name__}",
        )
        raise HTTPException(400, "Malformed register-hub body.")

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, relay_secret FROM homes WHERE id=?", (body.home_id,)
        )
        if not rows:
            await log_event(
                "register_hub", home_id=body.home_id, source_ip=src_ip,
                ok=False, detail="unknown_home_id",
            )
            raise HTTPException(404, "Home not provisioned.")

        stored_secret = rows[0]["relay_secret"]
        ok, reason = verify_signature(stored_secret, raw, sig_header)
        if not ok:
            await log_event(
                "register_hub", home_id=body.home_id, source_ip=src_ip,
                ok=False, detail=f"signature: {reason}",
            )
            raise HTTPException(401, "Invalid signature.")

        await db.execute(
            "UPDATE homes SET tunnel_url=?, status='active' WHERE id=?",
            (body.tunnel_url.rstrip("/"), body.home_id),
        )
        await db.commit()

    await log_event(
        "register_hub", home_id=body.home_id, source_ip=src_ip, ok=True,
        detail=f"tunnel_url_updated",
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

@router.get("/")
async def list_homes(request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """SELECT h.id, h.name, h.type, h.tunnel_url, h.status, h.created_at, h.owner_email,
                      COUNT(u.id) as user_count
               FROM homes h
               LEFT JOIN users u ON u.home_id = h.id
               GROUP BY h.id ORDER BY h.created_at DESC"""
        )
        return [dict(r) for r in rows]


@router.get("/{home_id}")
async def get_home(home_id: str, request: Request):
    user = current_user(request)
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied.")
    async with get_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM homes WHERE id=?", (home_id,))
        if not rows:
            raise HTTPException(404, "Home not found.")
        home = dict(rows[0])
        home.pop("relay_secret", None)
        users = await db.execute_fetchall(
            "SELECT id, email, role, created_at FROM users WHERE home_id=?", (home_id,)
        )
        home["users"] = [dict(u) for u in users]
        return home


class UpdateHomeBody(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


@router.patch("/{home_id}")
async def update_home(home_id: str, body: UpdateHomeBody, request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        if body.name:
            await db.execute("UPDATE homes SET name=? WHERE id=?", (body.name, home_id))
        if body.status:
            await db.execute("UPDATE homes SET status=? WHERE id=?", (body.status, home_id))
        await db.commit()
    return {"ok": True}


@router.delete("/{home_id}")
async def delete_home(home_id: str, request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        await db.execute("DELETE FROM homes WHERE id=?", (home_id,))
        await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Health check passthrough — relay polls each hub
# ---------------------------------------------------------------------------

@router.get("/{home_id}/health")
async def home_health(home_id: str, request: Request):
    user = current_user(request)
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied.")
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT tunnel_url, relay_secret, status FROM homes WHERE id=?", (home_id,)
        )
        if not rows:
            raise HTTPException(404, "Home not found.")
        h = dict(rows[0])
    if not h["tunnel_url"]:
        return {"ok": False, "reason": "No tunnel URL registered."}
    import httpx
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                f"{h['tunnel_url']}/api/health",
                headers={"X-Relay-Secret": h["relay_secret"]},
            )
            return {"ok": r.is_success, "status": h["status"], "hub_status": r.json() if r.is_success else None}
    except Exception as e:
        return {"ok": False, "reason": str(e), "status": h["status"]}
