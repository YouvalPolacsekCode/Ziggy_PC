"""Admin read surface for per-home mobile devices (Prompt 10 chunk 3).

The local Ziggy backend already maintains the paired-mobile-devices
list via mobile_router /api/mobile/devices. This endpoint exposes a
founder-facing version of that list to the dashboard.

  GET /api/admin/homes/{home_id}/mobile-devices
    Returns: { devices: [...], home_id, fetched_at }
    Errors:  404 home not found, 503 tunnel down, 504 hub timed out,
             502 on any other proxy failure (verbatim wrap).

Implementation reuses the relay/proxy HTTP client (_proxy_client) so
keepalive sockets are shared. The backend recognises X-Relay-Role:
relay_admin and returns ALL devices in the home rather than just the
caller's (mobile_router.py /devices was extended for this in the same
chunk-3 commit).
"""

from __future__ import annotations

from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Request

from ..audit import log_event
from ..auth import current_user, require_role
from ..database import get_db
from .proxy import _proxy_client


router = APIRouter()


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


@router.get("/api/admin/homes/{home_id}/mobile-devices")
async def list_home_mobile_devices(home_id: str, request: Request):
    require_role("relay_admin")(request)
    user = current_user(request)
    src_ip = _client_ip(request)

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT tunnel_url, relay_secret FROM homes WHERE id=?",
            (home_id,),
        )
    if not rows:
        await log_event(
            "admin_mobile_devices_read", home_id=home_id, source_ip=src_ip,
            ok=False, detail="unknown_home_id",
        )
        raise HTTPException(404, "Home not found.")
    home = dict(rows[0])
    if not home["tunnel_url"]:
        raise HTTPException(503, "Home hub not yet connected.")

    target = f"{home['tunnel_url']}/api/mobile/devices"
    headers = {
        # Backend's relay_auth middleware validates X-Relay-Secret against
        # the home's stored secret before trusting the X-Relay-Role header.
        # /api/mobile/devices then sees role=relay_admin and returns the
        # full device list instead of just the caller's.
        "X-Relay-Secret": home["relay_secret"],
        "X-Relay-User":   user.get("email", ""),
        "X-Relay-Role":   "relay_admin",
        "X-Relay-Home":   home_id,
    }

    try:
        resp = await _proxy_client.request("GET", target, headers=headers)
    except httpx.ConnectError:
        await log_event(
            "admin_mobile_devices_read", home_id=home_id, source_ip=src_ip,
            ok=False, detail="connect_error",
        )
        raise HTTPException(503, "Cannot reach home hub. Tunnel may be down.")
    except httpx.TimeoutException:
        await log_event(
            "admin_mobile_devices_read", home_id=home_id, source_ip=src_ip,
            ok=False, detail="timeout",
        )
        raise HTTPException(504, "Home hub timed out.")
    except Exception as e:
        raise HTTPException(502, f"Proxy error: {e}")

    if resp.status_code >= 500:
        await log_event(
            "admin_mobile_devices_read", home_id=home_id, source_ip=src_ip,
            ok=False, detail=f"upstream_{resp.status_code}",
        )
        raise HTTPException(502, f"Hub returned {resp.status_code}.")

    try:
        body = resp.json() if resp.content else {}
    except Exception:
        body = {}
    devices = body.get("devices") if isinstance(body, dict) else None
    if not isinstance(devices, list):
        devices = []

    await log_event(
        "admin_mobile_devices_read", home_id=home_id, source_ip=src_ip,
        ok=True, detail=f"n={len(devices)}",
    )
    return {
        "home_id":     home_id,
        "devices":     devices,
        "fetched_at":  datetime.now(timezone.utc).isoformat(),
    }
