"""
Mobile app HTTP surface (Ziggy Home — iOS + Android Capacitor app).

Endpoints:
  POST /mobile/pair-code       (auth: user)   PWA mints a code for their phone
  POST /mobile/pair            (no auth)      Phone redeems pair code → token
  POST /mobile/register        (auth: device) Phone reports push token + perms
  POST /mobile/webhook/{id}    (auth: device) Sensor + location updates
  GET  /mobile/health          (no auth)      Liveness

The router is intentionally a thin HTTP shell. All translation logic lives in
services/mobile_app.py; all presence math lives in services/presence_engine.py;
all auth user lookup uses backend/routers/auth_deps.get_current_user.

This file does NOT edit any existing router or service. The only change in
backend/server.py is one additive `app.include_router(mobile_router)` line.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from backend.routers.auth_deps import get_current_user
from core.logger_module import log_info
from services import mobile_app
from services.mobile_ws_manager import mobile_ws

router = APIRouter(prefix="/api/mobile", tags=["mobile"])


# ── Models ───────────────────────────────────────────────────────────────────

class DeviceInfo(BaseModel):
    platform: str = Field(..., pattern="^(ios|android)$")
    model: Optional[str] = None
    os_version: Optional[str] = None
    app_version: Optional[str] = None


class PairRequest(BaseModel):
    pair_code: str = Field(..., min_length=4, max_length=12)
    device: DeviceInfo


class PairResponse(BaseModel):
    device_id: str
    webhook_id: str
    webhook_url: str
    ws_url: str
    auth_token: str
    person_id: Optional[str]
    home_id: Optional[str] = None


class RegisterRequest(BaseModel):
    push_token: Optional[str] = None
    push_provider: Optional[str] = Field(None, pattern="^(apns|fcm)$")
    person_id: Optional[str] = None
    permissions: Optional[dict] = None
    capabilities: Optional[dict] = None


# ── Device-auth dependency ───────────────────────────────────────────────────

async def get_current_device(request: Request) -> dict:
    """Resolve the mobile device record from the bearer token.

    Mobile tokens are prefixed `zgy_mb_` to distinguish them from web-session
    tokens at a glance; we don't enforce that prefix, the lookup is by full
    string match.
    """
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    device = mobile_app.find_device_by_token(token)
    if not device:
        raise HTTPException(status_code=401, detail="Invalid device token.")
    return device


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/health")
async def health():
    return {"ok": True, "service": "mobile", "version": "0.1.0"}


@router.post("/pair-code")
async def mint_pair_code(user: dict = Depends(get_current_user)):
    """PWA endpoint: logged-in user requests a code to type into / scan from
    their phone. Returns the 6-char code + expiry.
    """
    user_id = user.get("id") or user.get("username") or user.get("email")
    if not user_id:
        raise HTTPException(status_code=400, detail="User missing id.")
    return mobile_app.create_pair_code(user_id=str(user_id))


@router.post("/pair", response_model=PairResponse)
async def pair(req: PairRequest, request: Request):
    """Phone redeems a pair code → receives a device-scoped auth token."""
    match = mobile_app.consume_pair_code(req.pair_code.upper())
    if not match:
        raise HTTPException(status_code=400, detail="Invalid or expired pair code.")

    record = mobile_app.register_device(
        user_id=match["user_id"],
        device_info=req.device.model_dump(),
    )

    # Build URLs the app should use from this point. The Host the request came
    # in on is the per-home backend (or the cloud relay), so we mirror it back.
    base = str(request.base_url).rstrip("/")
    ws_base = base.replace("http://", "ws://").replace("https://", "wss://")
    return PairResponse(
        device_id=record["device_id"],
        webhook_id=record["webhook_id"],
        webhook_url=f"{base}/mobile/webhook/{record['webhook_id']}",
        ws_url=f"{ws_base}/mobile/ws",
        auth_token=record["auth_token"],
        person_id=record.get("person_id"),
        home_id=None,  # populated in Phase 2 when multi-home is real
    )


@router.post("/register")
async def register(req: RegisterRequest, device: dict = Depends(get_current_device)):
    """Device registers/updates push token + permissions + person binding."""
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if fields:
        mobile_app.update_device(device["device_id"], fields)
    return {"ok": True}


@router.post("/webhook/{webhook_id}")
async def webhook(
    webhook_id: str = Path(..., min_length=4),
    payload: dict = Body(...),
    device: dict = Depends(get_current_device),
):
    """Sensor + location + event ingest from the mobile app."""
    if device.get("webhook_id") != webhook_id:
        raise HTTPException(status_code=403, detail="Webhook id mismatch.")
    return mobile_app.handle_webhook(device, payload)


# ── Device management (PWA-facing) ───────────────────────────────────────────

def _user_id_of(user: dict) -> str:
    return str(user.get("id") or user.get("username") or user.get("email") or "")


@router.get("/devices")
async def list_my_devices(user: dict = Depends(get_current_user)):
    """List mobile devices paired to the current user, with live connection
    status (whether each has an active /api/mobile/ws connection)."""
    uid = _user_id_of(user)
    devices = mobile_app.list_devices_for_user(uid)
    for d in devices:
        d["ws_connected"] = mobile_ws.is_connected(d["device_id"])
    return {"devices": devices}


@router.delete("/devices/{device_id}")
async def revoke_device(device_id: str, user: dict = Depends(get_current_user)):
    """Revoke a paired device — invalidates its auth token immediately by
    deleting the record. Any in-flight WS is dropped on next send attempt."""
    uid = _user_id_of(user)
    ok = mobile_app.delete_device(device_id, user_id=uid)
    if not ok:
        raise HTTPException(status_code=404, detail="Device not found or not yours.")
    # If the device was currently connected, push them off the WS now.
    asyncio.create_task(_kick(device_id))
    return {"ok": True}


# ── WebSocket: backend → mobile realtime ─────────────────────────────────────
#
# Phase 1: an authenticated WS that holds the connection open and pings every
# 30 s. The actual fan-out of state_changed / command / state_update events
# will be wired through ws_manager in Phase 2 so PWA and mobile clients
# receive the same broadcasts uniformly.

@router.websocket("/ws")
async def mobile_ws_endpoint(ws: WebSocket, token: str = ""):
    """Mobile WebSocket. The app connects with `?token=<auth_token>` because
    browsers (and the WebView host) don't let JS set Authorization on
    `new WebSocket()` URLs.

    Registers the connection with the mobile_ws_manager so the rest of the
    backend can address it (`mobile_ws.send_to_device(device_id, payload)`).
    """
    device = mobile_app.find_device_by_token(token)
    if not device:
        await ws.close(code=4401)
        return

    await ws.accept()
    await mobile_ws.connect(ws, device["device_id"])
    try:
        await ws.send_json({"type": "hello", "device_id": device["device_id"]})
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text("pong")
            # Other inbound message types (acks, telemetry) handled in Phase 3.
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log_info(f"[mobile_ws] device {device['device_id']} errored: {e}")
    finally:
        mobile_ws.disconnect(ws)


async def _kick(device_id: str) -> None:
    """Close any active WS for a device — used after revoke."""
    # mobile_ws.send_to_device returns False if not connected; that's fine.
    await mobile_ws.send_to_device(device_id, {"type": "revoked"})
