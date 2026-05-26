# backend/server.py — FastAPI app wiring only.
# Business logic lives in backend/routers/*.py.
from __future__ import annotations

import uvicorn
from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.ws_manager import manager
from backend.middleware.relay_auth import RelayAuthMiddleware
from backend.middleware.request_logger import RequestLoggerMiddleware
from backend.middleware.error_handler import install_error_handlers
from core.logger_module import log_info, apply_log_level
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
from backend.routers.ui_prefs_router import router as ui_prefs_router
from backend.routers.mobile_router import router as mobile_router

app = FastAPI(title="Ziggy API", version="1.0")

# Single source of truth for error responses. Every exception now flows
# through the handlers in backend/middleware/error_handler.py, which return
# the unified `{"error": {"code", "message", "request_id"}}` envelope defined
# in core/errors.py. This MUST be installed before include_router so legacy
# HTTPException(500, str(e)) raises from existing routers are wrapped too.
install_error_handlers(app)


@app.on_event("startup")
async def _startup():
    import asyncio
    import time as _t
    from services.ziggy_scheduler import run_scheduler
    from services.ha_subscriber import run_subscriber
    from services.device_registry import init as dr_init, sync_rooms_to_ha, reconcile_with_ha
    from core.debug_bus import bus
    from core.settings_loader import settings as _settings

    _t0 = _t.perf_counter()

    def _phase(label: str) -> None:
        # Single source of truth for startup timing. perf_counter is
        # monotonic so subtraction is safe across the boot window. We log
        # both the cumulative ms-since-start and the wall-clock delta of
        # the current phase, so a single grep on `[Startup]` gives you a
        # ready-to-paste before/after table.
        nonlocal _last
        now = _t.perf_counter()
        log_info(f"[Startup] {label} +{(now - _last) * 1000:.0f} ms (total {(now - _t0) * 1000:.0f} ms)")
        _last = now

    _last = _t0

    # Wire the debug bus to the WebSocket broadcast function.
    # This must happen before any service starts emitting events.
    bus.register_ws_callback(manager.broadcast)

    # Restore debug level from settings so it persists across restarts.
    # The bus level governs in-memory events; apply_log_level also re-tunes
    # the on-disk log file so "trace" actually writes trace lines to disk.
    _debug_cfg = _settings.get("debug", {})
    _saved_level = _debug_cfg.get("level", "off")
    bus.set_level(_saved_level)
    apply_log_level(_saved_level)
    _saved_scopes = _debug_cfg.get("scopes", [])
    bus.set_scopes(_saved_scopes)
    _phase("debug bus + log level")

    _bootstrap_cloud_admin()
    _phase("cloud-admin bootstrap")

    _migrate_users_to_db()
    _phase("auth.db migration")

    # dr_init is now phase-1 only: persistent JSON + IR merge. The HA-REST
    # reconciliation that used to run inline (two synchronous /api/states
    # round-trips that could add 200-600 ms to startup on a healthy LAN and
    # several seconds on a slow tunnel) is deferred to a background task
    # below. The registry is fully readable from JSON immediately; the
    # status field for entries with stale rows updates within seconds.
    dr_init()
    _phase("device registry phase 1 (JSON+IR)")

    asyncio.create_task(reconcile_with_ha())
    asyncio.create_task(sync_rooms_to_ha())
    asyncio.create_task(run_scheduler())
    asyncio.create_task(run_subscriber())
    asyncio.create_task(_register_with_relay())
    asyncio.create_task(_start_ir_listener())
    asyncio.create_task(_run_update_checker())
    # Warm the HA service catalog so the first call to /api/devices/X/commands
    # returns instantly. Without this, the catalog stays empty until the
    # first request triggers it, and that request blocks while the WS round-
    # trip happens — making the device-detail page feel slow on cold start.
    asyncio.create_task(_warm_ha_catalog())
    _phase("background tasks scheduled")
    log_info(f"[Startup] ready to accept requests in {(_t.perf_counter() - _t0) * 1000:.0f} ms")


async def _warm_ha_catalog():
    try:
        from services.ha_capabilities import ensure_catalog_async
        await ensure_catalog_async()
    except Exception as e:
        log_info(f"[HACapabilities] startup warm failed: {e}")


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


def _migrate_users_to_db():
    """Copy settings.yaml users[] into user_files/auth.db (idempotent).

    Designed to be safe at every boot — on the first run after the upgrade
    it actually moves the rows; on every subsequent run it short-circuits
    because each user already exists in the DB.
    """
    try:
        from services.auth_db import migrate_from_yaml
        result = migrate_from_yaml(settings.get("users") or [])
        if result["migrated_users"] or result["migrated_sessions"]:
            log_info(
                f"[Auth] Migrated to auth.db: "
                f"{result['migrated_users']} users, "
                f"{result['migrated_sessions']} sessions, "
                f"{result['skipped_users']} skipped."
            )
    except Exception as e:
        log_info(f"[Auth] auth.db migration error: {e}")


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
# RequestLoggerMiddleware is added LAST so it wraps every other middleware
# and sees the real client-visible request/response, including auth rejections.
# Starlette runs middleware bottom-up, so the outer-most call wraps the rest.
app.add_middleware(RequestLoggerMiddleware)
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
    from core.debug_bus import bus as _bus, BASIC as _BASIC
    client_id = await manager.connect(websocket)
    log_info(f"[API] WebSocket connected. client_id={client_id} total={manager.count}")
    _bus.emit("ws", _BASIC, "ws_client_connected",
              client_id=client_id, total=manager.count)
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
        _bus.emit("ws", _BASIC, "ws_client_disconnected",
                  client_id=client_id, total=manager.count)


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
app.include_router(ui_prefs_router,      dependencies=_auth)
app.include_router(mobile_router)  # mobile endpoints handle their own auth per-route

# ---------------------------------------------------------------------------
# Static frontend — cloud/production mode only.
# Mount AFTER all API routes so /api/* and /ws are never shadowed.
# html=True enables SPA fallback: unknown paths → index.html.
# ---------------------------------------------------------------------------

import os as _os
from fastapi.staticfiles import StaticFiles as _StaticFiles
from fastapi.responses import HTMLResponse as _HTMLResponse


# ---------------------------------------------------------------------------
# One-shot client recovery — visit /reset on any device that's stuck on a
# stale service worker (broken cached HTML pointing at a deleted asset hash).
# Returns a tiny page that:
#   1. Sets `Clear-Site-Data: "storage"` — the browser unregisters every
#      service worker for this origin and wipes caches/IndexedDB/etc.
#      (localStorage is also wiped, so the user will log back in once.)
#   2. Auto-redirects to `/` after the header is processed.
# Defined BEFORE the StaticFiles mount so it isn't shadowed by index.html.
# ---------------------------------------------------------------------------
@app.get("/reset")
async def reset_client():
    html = (
        "<!doctype html><meta charset=utf-8>"
        "<title>Ziggy — resetting</title>"
        "<meta http-equiv='refresh' content='1; url=/'>"
        "<style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;"
        "padding:48px 20px;text-align:center;color:#333}</style>"
        "<p>Clearing cached app data…</p>"
        "<p>Redirecting to Ziggy in 1 second.</p>"
        "<script>setTimeout(function(){location.replace('/')},700)</script>"
    )
    return _HTMLResponse(
        content=html,
        headers={"Clear-Site-Data": '"storage", "cache"'},
    )


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
