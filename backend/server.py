# backend/server.py — FastAPI app wiring only.
# Business logic lives in backend/routers/*.py.
from __future__ import annotations

import uvicorn
from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.ws_manager import manager
from backend.middleware.relay_auth import RelayAuthMiddleware
from core.logger_module import log_info
from core.settings_loader import settings

from backend.routers.intent_router import router as intent_router
from backend.routers.device_router import router as device_router
from backend.routers.ha_router import router as ha_router
from backend.routers.pairing_router import router as pairing_router
from backend.routers.task_router import router as task_router
from backend.routers.automation_router import router as automation_router
from backend.routers.routine_router import router as routine_router
from backend.routers.event_router import router as event_router
from backend.routers.capability_router import router as capability_router
from backend.routers.virtual_device_router import router as virtual_device_router
from backend.routers.ir_router import router as ir_router
from backend.routers.suggestion_router import router as suggestion_router
from backend.routers.quick_ask_router import router as quick_ask_router
from backend.routers.status_router import router as status_router
from backend.routers.auth_router import router as auth_router
from backend.routers.auth_deps import get_current_user
from backend.routers.invite_router import router as invite_router
from backend.routers.map_router import router as map_router
from backend.routers.admin_router import router as admin_router
from backend.routers.activity_router import router as activity_router
from backend.routers.health_router import router as health_router
from backend.routers.presence_router import router as presence_router
from backend.routers.camera_router import router as camera_router
from backend.routers.push_router import router as push_router
from backend.routers.debug_router import router as debug_router
from backend.routers.update_router import router as update_router

app = FastAPI(title="Ziggy API", version="1.0")


@app.on_event("startup")
async def _startup():
    import asyncio
    from services.ziggy_scheduler import run_scheduler
    from services.ha_subscriber import run_subscriber
    from services.device_registry import init as dr_init, sync_rooms_to_ha
    from core.debug_bus import bus
    from core.settings_loader import settings as _settings

    # Wire the debug bus to the WebSocket broadcast function.
    # This must happen before any service starts emitting events.
    bus.register_ws_callback(manager.broadcast)

    # Restore debug level from settings so it persists across restarts.
    _debug_cfg = _settings.get("debug", {})
    _saved_level = _debug_cfg.get("level", "off")
    bus.set_level(_saved_level)
    _saved_scopes = _debug_cfg.get("scopes", [])
    bus.set_scopes(_saved_scopes)

    _bootstrap_cloud_admin()

    dr_init()
    asyncio.create_task(sync_rooms_to_ha())
    asyncio.create_task(run_scheduler())
    asyncio.create_task(run_subscriber())
    asyncio.create_task(_register_with_relay())
    asyncio.create_task(_start_ir_listener())
    asyncio.create_task(_run_update_checker())


async def _run_update_checker():
    """Run the HA update check once in the background after startup."""
    from services.ha_update_checker import background_check
    await background_check()


async def _start_ir_listener():
    """Start the IR receive listener for any devices with blaster_host configured."""
    try:
        from services.ir_listener import start_listener
        await start_listener()
    except ImportError:
        log_info("[IR] python-broadlink not installed — IR receive disabled. pip install broadlink to enable.")
    except Exception as e:
        log_info(f"[IR] Listener startup error: {e}")


def _bootstrap_cloud_admin():
    """On first boot of a provisioned cloud home, create the initial admin user."""
    import os, hashlib, hmac, secrets as _secrets
    email = os.getenv("INITIAL_ADMIN_EMAIL", "").strip().lower()
    password = os.getenv("INITIAL_ADMIN_PASSWORD", "").strip()
    if not email or not password:
        return
    users = settings.get("users", [])
    if any(u.get("username", "").lower() == email for u in users):
        return  # already set up
    salt = _secrets.token_hex(16)
    pw_hash = hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()
    settings.setdefault("users", []).append({
        "username":    email,
        "password_hash": pw_hash,
        "salt":        salt,
        "role":        "super_admin",
        "session_tokens": [],
    })
    from core.settings_loader import save_settings
    save_settings(settings)
    log_info(f"[Cloud] Initial admin created for {email}")


async def _register_with_relay():
    """Register this hub with the relay on startup. No-op if relay not configured."""
    import os, asyncio
    relay_url    = os.getenv("RELAY_URL") or settings.get("relay", {}).get("url")
    relay_secret = os.getenv("RELAY_SECRET") or settings.get("relay", {}).get("secret")
    tunnel_url   = os.getenv("TUNNEL_URL") or settings.get("relay", {}).get("tunnel_url")
    home         = settings.get("home", {})
    home_id      = home.get("id", "home-ziggy-primary")
    home_name    = home.get("name", "Home")

    if not relay_url or not relay_secret or not tunnel_url:
        return

    # Short delay so HA subscriber starts first, but don't block for long.
    # Use 5s timeout — Fly.io cold starts can be slow but we won't wait forever.
    await asyncio.sleep(2)
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(
                f"{relay_url}/api/homes/register-hub",
                json={
                    "home_id":      home_id,
                    "name":         home_name,
                    "tunnel_url":   tunnel_url,
                    "relay_secret": relay_secret,
                },
            )
            if r.is_success:
                log_info(f"[Relay] Registered hub '{home_id}' with relay at {relay_url}")
            else:
                log_info(f"[Relay] Registration failed: {r.status_code}")
    except Exception as e:
        log_info(f"[Relay] Registration skipped (relay may be sleeping): {type(e).__name__}")


app.add_middleware(RelayAuthMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# WebSocket  /ws  — core infrastructure, lives here not in a router
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    import json as _json
    client_id = await manager.connect(websocket)
    log_info(f"[API] WebSocket connected. client_id={client_id} total={manager.count}")
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = _json.loads(raw)
            except Exception:
                continue

            msg_type = msg.get("type")

            if msg_type == "display_hello":
                # Browser display tab announces itself with its name/room
                from services.display_registry import registry
                registry.register(
                    ws_id=client_id,
                    name=msg.get("name", "unknown display"),
                    room=msg.get("room", ""),
                    aliases=msg.get("aliases", []),
                )
                log_info(f"[WS] display registered: '{msg.get('name')}' room='{msg.get('room')}'")

            elif msg_type == "display_heartbeat":
                from services.display_registry import registry
                registry.heartbeat(client_id)

            elif msg_type == "ping":
                # Keepalive ping from the frontend — reply with pong.
                # Prevents Cloudflare Tunnel from closing idle connections.
                await websocket.send_text('{"type":"pong"}')

    except WebSocketDisconnect:
        manager.disconnect(websocket)
        log_info(f"[API] WebSocket disconnected. client_id={client_id} total={manager.count}")


# ---------------------------------------------------------------------------
# Include routers
# ---------------------------------------------------------------------------

# auth_router + invite_router are intentionally unprotected:
# auth_router: login, setup, status
# invite_router: public GET/POST accept endpoints (no auth); protected list/create/delete
#   enforce their own role checks internally
app.include_router(auth_router)
app.include_router(invite_router)

_auth = [Depends(get_current_user)]
app.include_router(intent_router,        dependencies=_auth)
app.include_router(device_router,        dependencies=_auth)
app.include_router(ha_router,            dependencies=_auth)
app.include_router(pairing_router,       dependencies=_auth)
app.include_router(task_router,          dependencies=_auth)
app.include_router(automation_router,    dependencies=_auth)
app.include_router(routine_router,       dependencies=_auth)
app.include_router(event_router,         dependencies=_auth)
app.include_router(capability_router,    dependencies=_auth)
app.include_router(virtual_device_router, dependencies=_auth)
app.include_router(ir_router,            dependencies=_auth)
app.include_router(suggestion_router,    dependencies=_auth)
app.include_router(quick_ask_router,     dependencies=_auth)
app.include_router(status_router,        dependencies=_auth)
app.include_router(map_router,           dependencies=_auth)
app.include_router(admin_router,         dependencies=_auth)
app.include_router(activity_router,      dependencies=_auth)
app.include_router(health_router,        dependencies=_auth)
# presence_router registers WITHOUT global _auth — its public routes (/ping, /join,
# /manifest.json) are token-secured at the handler level; protected read/write routes
# carry their own Depends(get_current_user) or Depends(require_role) directly.
app.include_router(presence_router)
app.include_router(camera_router,        dependencies=_auth)
app.include_router(push_router,          dependencies=_auth)
app.include_router(debug_router,         dependencies=_auth)
app.include_router(update_router,        dependencies=_auth)

# ---------------------------------------------------------------------------
# Static frontend — cloud/production mode only.
# Mount AFTER all API routes so /api/* and /ws are never shadowed.
# html=True enables SPA fallback: unknown paths → index.html.
# ---------------------------------------------------------------------------

import os as _os
from fastapi.staticfiles import StaticFiles as _StaticFiles

_FRONTEND_DIST = _os.path.join(_os.path.dirname(__file__), '..', 'frontend', 'dist')
if _os.path.isdir(_FRONTEND_DIST):
    app.mount("/", _StaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")


# ---------------------------------------------------------------------------
# Entry point (called from ziggy_main.py)
# ---------------------------------------------------------------------------

def start_api_server():
    port = settings.get("web_interface", {}).get("backend_port", 8001)
    log_info(f"[API] Ziggy API server starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
