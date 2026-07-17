# backend/server.py — FastAPI app wiring only.
# Business logic lives in backend/routers/*.py.
from __future__ import annotations

import asyncio
import socket as _socket
import time as _time

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
from backend.routers.auth_deps import get_current_user, find_user_by_token
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
from backend.routers.deploy_router import router as deploy_router
from backend.routers.ui_prefs_router import router as ui_prefs_router
from backend.routers.mobile_router import router as mobile_router
from backend.routers.edge_health_router import router as edge_health_router
from backend.routers.first_boot_router import router as first_boot_router
from backend.routers.onboarding_sensors_router import router as onboarding_sensors_router
from backend.routers.push_action_router import router as push_action_router
from backend.routers.media_router import router as media_router
from backend.routers.tts_router import router as tts_router
from backend.routers.alerts_router import router as alerts_router
from backend.routers.lifecycle_router import router as lifecycle_router
from backend.routers.onboarding_router import router as onboarding_router
from backend.routers.consent_router import router as consent_router

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

    # Install the mobile bridge — wraps the PWA callback so allowlisted
    # event types also fan out to paired mobile devices via mobile_ws_manager.
    # Additive: PWA broadcasts are unchanged; mobile gets a filtered subset.
    from services.mobile_ws_bridge import install as install_mobile_bridge
    install_mobile_bridge()

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
    asyncio.create_task(_ensure_ha_location())
    # Warm the HA service catalog so the first call to /api/devices/X/commands
    # returns instantly. Without this, the catalog stays empty until the
    # first request triggers it, and that request blocks while the WS round-
    # trip happens — making the device-detail page feel slow on cold start.
    asyncio.create_task(_warm_ha_catalog())
    _phase("background tasks scheduled")
    log_info(f"[Startup] ready to accept requests in {(_t.perf_counter() - _t0) * 1000:.0f} ms")


async def _warm_ha_catalog():
    # Cap the startup warm-up so a slow/unreachable HA can't hold the catalog
    # task open indefinitely. The first user call will retry if needed.
    try:
        from services.ha_capabilities import ensure_catalog_async
        await asyncio.wait_for(ensure_catalog_async(), timeout=10.0)
    except asyncio.TimeoutError:
        log_info("[HACapabilities] startup warm timed out after 10s (will fetch on demand)")
    except Exception as e:
        log_info(f"[HACapabilities] startup warm failed: {e}")


async def _run_update_checker():
    """Run the HA update check once in the background after startup."""
    from services.ha_update_checker import background_check
    await background_check()


async def _ensure_ha_location():
    """Set HA's home location to a default if it's still unset (0,0).

    Freshly-imaged hubs onboard HA without a location, breaking every sun-based
    automation. This self-heals it on startup (and covers imaging, since Ziggy
    starts after ha-seed). Never overrides a real location the user/onboarding
    already set.
    """
    try:
        from services.ha_config import ensure_home_location
        await ensure_home_location()
    except Exception as e:
        log_info(f"[HAConfig] ensure location error: {e}")


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


async def _register_with_relay():
    """Register this hub with the relay on startup. No-op if relay not configured.

    Signed with the HMAC scheme in core/relay_signing. On first run of the
    patched agent against a still-pre-Task-2 relay, the request would have
    been auto-accepted; against the patched relay, the signature is required.

    Pre-patch hubs hold the legacy shared secret; this function detects that
    on the way in and rotates to a per-home secret before signing the
    register-hub request.
    """
    import os, asyncio, json
    from core.settings_loader import save_secrets
    from core.relay_signing import sign, LEGACY_SHARED_SECRET

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

    # Step 1: if we're still holding the legacy shared secret, try to rotate
    # to a per-home secret. The /rotate-hub-secret endpoint only exists on
    # Task-2-or-newer relays; against an older deployed relay this returns
    # 405 and we just continue with the legacy secret — register-hub still
    # works via the backwards-compat body field below.
    if relay_secret == LEGACY_SHARED_SECRET:
        new_secret = await _rotate_relay_secret(relay_url, relay_secret, home_id)
        if new_secret:
            try:
                save_secrets({"relay": {"secret": new_secret}})
            except Exception as e:
                log_info(f"[Relay] save_secrets after rotation failed: {e}")
            settings.setdefault("relay", {})["secret"] = new_secret
            relay_secret = new_secret
            log_info(f"[Relay] Rotated legacy secret for '{home_id}'")
        else:
            log_info(
                f"[Relay] Rotation endpoint unavailable — staying on legacy "
                f"secret. Will rotate once the relay is upgraded."
            )

    # Step 2: sign + post register-hub.
    #
    # The body intentionally carries BOTH the new-style fields and the
    # legacy `relay_secret` field. A Task-2-or-newer relay ignores the
    # extra field and authenticates via X-Ziggy-Signature; an older
    # relay validates relay_secret in the body and ignores the unknown
    # header. Once every deployed relay has been upgraded, the
    # relay_secret field here can be removed.
    #
    # Serialize once so the bytes we hash equal the bytes httpx posts.
    try:
        import httpx
        body = json.dumps({
            "home_id":      home_id,
            "name":         home_name,
            "tunnel_url":   tunnel_url,
            "relay_secret": relay_secret,
        }).encode("utf-8")
        signature = sign(relay_secret, body)
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(
                f"{relay_url}/api/homes/register-hub",
                content=body,
                headers={
                    "Content-Type":      "application/json",
                    "X-Ziggy-Signature": signature,
                },
            )
            if r.is_success:
                log_info(f"[Relay] Registered hub '{home_id}' with relay at {relay_url}")
            else:
                log_info(f"[Relay] Registration failed: {r.status_code} {r.text[:200]}")
    except Exception as e:
        log_info(f"[Relay] Registration skipped (relay may be sleeping): {type(e).__name__}")


async def _rotate_relay_secret(relay_url: str, current_secret: str, home_id: str) -> str | None:
    """Call /api/homes/rotate-hub-secret signed with the current (legacy) secret.

    Returns the new secret string on success, None on any failure.
    """
    try:
        import httpx, json
        from core.relay_signing import sign
        body = json.dumps({"home_id": home_id}).encode("utf-8")
        signature = sign(current_secret, body)
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                f"{relay_url}/api/homes/rotate-hub-secret",
                content=body,
                headers={
                    "Content-Type":      "application/json",
                    "X-Ziggy-Signature": signature,
                },
            )
            if r.is_success:
                data = r.json()
                return data.get("relay_secret")
            log_info(f"[Relay] Rotate failed: {r.status_code} {r.text[:200]}")
    except Exception as e:
        log_info(f"[Relay] Rotate error: {type(e).__name__}: {e}")
    return None


app.add_middleware(RelayAuthMiddleware)
# RequestLoggerMiddleware is added LAST so it wraps every other middleware
# and sees the real client-visible request/response, including auth rejections.
# Starlette runs middleware bottom-up, so the outer-most call wraps the rest.
app.add_middleware(RequestLoggerMiddleware)
# Tightened from allow_origins=["*"]. Same-origin requests (the prod PWA at
# app.ziggy-home.com hitting itself, or the dev frontend at localhost:3000
# proxying via Vite) never trigger CORS — they just won't be blocked. The
# allowlist matters for:
#   - Native Capacitor app (origin capacitor://localhost on iOS,
#     https://localhost on Android because capacitor.config.ts sets
#     androidScheme:'https'; http://localhost left in for older builds)
#   - Cross-origin XHR from other web tools (now blocked by default,
#     which is the security win)
# Override via env var ZIGGY_CORS_ORIGINS="https://a.com,https://b.com" if
# you need to add hosts without a code change.
import os as _cors_os
_cors_env = _cors_os.getenv("ZIGGY_CORS_ORIGINS", "").strip()
if _cors_env:
    _cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
else:
    _cors_origins = [
        "https://app.ziggy-home.com",
        "http://localhost:3000",      # vite dev server
        "capacitor://localhost",      # iOS native app
        "https://localhost",          # Android native app (androidScheme:'https')
        "http://localhost",           # Android native app (legacy)
    ]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# WebSocket  /ws  — core infrastructure, lives here not in a router
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = ""):
    """Core PWA broadcast socket.

    Auth model — accepts EITHER:
      (a) RelayAuthMiddleware-injected synthetic user on websocket.state.relay_user
          (cloud relay path; only present when X-Relay-Secret matched in the
          middleware, see backend/middleware/relay_auth.py).
      (b) ?token=<bearer> query param matching an active session token
          (direct LAN / per-home Cloudflare Tunnel path).

    Anything else is closed with code 4401 and an audit event before the
    socket is even accepted by the manager. WebSocket endpoints can't use
    FastAPI's Depends(get_current_user) cleanly, so we reuse the same
    underlying find_user_by_token() that get_current_user delegates to.
    """
    import json as _json
    from core.debug_bus import bus as _bus, BASIC as _BASIC

    relay_user = getattr(websocket.state, "relay_user", None)
    user = relay_user or find_user_by_token(token)
    if not user:
        peer = websocket.client.host if websocket.client else ""
        _bus.emit("ws_auth", _BASIC, "ws_auth_failed",
                  path="/ws",
                  provided=bool(token),
                  source_ip=peer,
                  relay_user_attempted=bool(relay_user))
        log_info(f"[API] WebSocket rejected (unauthenticated) from {peer}")
        # Accept-then-close so the client receives a real WebSocket close
        # frame with code 4401. Closing pre-accept causes Starlette/uvicorn
        # to reply with HTTP 403 on the upgrade — the browser surfaces that
        # as code=1006 and the frontend can't distinguish unauthenticated
        # from a generic network drop (would busy-loop reconnect).
        await websocket.accept()
        await websocket.close(code=4401)
        return

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

            elif msg_type in ("subscribe", "unsubscribe"):
                # Per-client broadcast filter. Default (no subscribe ever
                # sent) is the legacy firehose, so existing clients are
                # unaffected. Clients can narrow to specific message types
                # and/or entity_ids via a `subscribe` message.
                manager.handle_client_message(
                    websocket,
                    {"action": msg_type, **{k: v for k, v in msg.items() if k != "type"}},
                )

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
# Alerts inbox for the Hub widget. Was implemented but never mounted, so the
# live /api/alerts call 404'd. Its single route declares its own
# Depends(get_current_user); the global _auth here is belt-and-suspenders.
app.include_router(alerts_router,        dependencies=_auth)
# Host lifecycle control (factory reset / safe mode / customer reset). Every
# route is gated by require_role("super_admin") internally; global _auth keeps
# it consistent with the rest of the admin surface.
app.include_router(lifecycle_router,     dependencies=_auth)
# Consent capture/gating (voice transcript, support tunnel, background location).
# Reads authenticated; record is owner-gated at the handler level.
app.include_router(consent_router,       dependencies=_auth)
# presence_router registers WITHOUT global _auth — its public routes (/ping, /join,
# /manifest.json) are token-secured at the handler level; protected read/write routes
# carry their own Depends(get_current_user) or Depends(require_role) directly.
app.include_router(presence_router)
app.include_router(camera_router,        dependencies=_auth)
app.include_router(push_router,          dependencies=_auth)
app.include_router(debug_router,         dependencies=_auth)
app.include_router(update_router,        dependencies=_auth)
app.include_router(deploy_router,        dependencies=_auth)
app.include_router(ui_prefs_router,      dependencies=_auth)
# TTS picker + audition + selection persistence. All routes touch ElevenLabs
# or settings, so they require auth.
app.include_router(tts_router,           dependencies=_auth)
# media_router intentionally registered WITHOUT global _auth: every route
# declares its own Depends(get_current_user) or Depends(require_role), AND
# the Spotify OAuth callback (/api/media/spotify/callback) is reachable
# unauthenticated because Spotify's redirect cannot carry a Ziggy session
# cookie — the unforgeable state token is the handle.
app.include_router(media_router)
app.include_router(mobile_router)  # mobile endpoints handle their own auth per-route
# Edge /health (Prompt 4 chunk 2.G) — LAN-reachable, NO auth dependency
# so the PWA / mobile app can ping it during onboarding before the user
# has a session. Lives at /health (not /api/health) so it can't collide
# with the existing auth-gated route in health_router.
app.include_router(edge_health_router)
# First-boot LAN /pair page + /api/onboarding/first-boot/qr.json
# (Prompt 7 chunk 2.6). Same no-auth posture as edge_health — the
# customer hasn't created an owner account yet when they hit these.
app.include_router(first_boot_router)
# Onboarding sensor list (Prompt 7 chunk 2.7) — auth is device-token,
# enforced via the get_current_device dep imported from mobile_router.
app.include_router(onboarding_sensors_router)
# Onboarding state + language/timezone prefs. Routes self-guard: /state is
# public read-only, /prefs is open during the first-boot window else device-authed.
app.include_router(onboarding_router)
# Push action callback (PROMPT_SECURITY_HARDENING_V2). Service-worker-driven,
# token-in-URL IS the credential — must NOT be under `_auth` because the SW
# cannot attach an Authorization header. See push_action_router.py.
app.include_router(push_action_router)

# ---------------------------------------------------------------------------
# Static frontend — cloud/production mode only.
# Mount AFTER all API routes so /api/* and /ws are never shadowed.
# html=True enables SPA fallback: unknown paths → index.html.
# ---------------------------------------------------------------------------

import os as _os
from fastapi.staticfiles import StaticFiles as _StaticFiles
from fastapi.responses import HTMLResponse as _HTMLResponse
from starlette.exceptions import HTTPException as _StarletteHTTPException


# StaticFiles' built-in `html=True` only handles directory→index.html — it
# does NOT do SPA history-mode fallback. So a hard refresh on /rooms (or any
# React Router path) used to 404, which then got wrapped in the unified
# error envelope and shown as a JSON error page. Subclassing to fall through
# to index.html for non-API 404s is the standard fix; the client-side router
# then takes the URL from there.
class _SPAStaticFiles(_StaticFiles):
    async def get_response(self, path: str, scope):
        try:
            response = await super().get_response(path, scope)
        except _StarletteHTTPException as exc:
            if exc.status_code != 404:
                raise
            # Leave /api/* and /ws untouched — API clients need a real 404,
            # not HTML. (Both are also normally matched by FastAPI routers
            # registered before the mount; this guards the edge case where
            # an API path falls through.)
            if path.startswith(("api/", "ws")) or path == "api":
                raise
            # Asset-shaped paths (any segment with a dot) stay 404. A missing
            # /assets/foo-abc123.js must not silently become an HTML page —
            # that would mask cache-busting failures.
            last_segment = path.rsplit("/", 1)[-1]
            if "." in last_segment:
                raise
            response = await super().get_response("index.html", scope)
        # Cache strategy:
        #   - /assets/* (Vite content-hashed) → long max-age, immutable.
        #     Filename changes whenever content does, so this is safe.
        #   - everything else (index.html, manifest, SW) → no-cache so
        #     a deploy is visible the moment the user reloads. The previous
        #     blanket 4h CDN TTL was masking real deploys: even after the
        #     canary rebuilt with a fresh dist, Cloudflare kept serving the
        #     stale index.html that pointed at the old chunk names.
        if path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            response.headers["Cache-Control"] = "no-cache"
        return response


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
# PUBLIC ENDPOINT — reviewed in PROMPT_SECURITY_HARDENING_V2 on 2026-05-28.
# Justification: stateless HTML page that sets Clear-Site-Data header and
# redirects to /. No data exposure, no state mutation beyond the browser's
# own caches/localStorage (which the caller is implicitly opting into).
_ZIGGY_BOOT_TS = _time.time()


@app.get("/api/version")
async def get_version():
    """Build provenance + runtime liveness.

    PUBLIC, unauthenticated. Used by:
      - scripts/update.ps1 to verify "did my push actually deploy?"
      - a future multi-home dashboard ("which home is on which SHA?")
      - external uptime monitors

    No data exposure beyond a hex SHA, hostname, uptime seconds, and a
    boolean for HA connectivity — all derivable from a normal Ziggy
    session anyway.
    """
    # HA reachability check: cached _ha_connected if the subscriber set
    # it; otherwise infer from settings (token present and url reachable
    # is a "configured" hint, not a "connected" guarantee). Cheap, non-
    # blocking; never fail the version endpoint on this.
    ha_connected = False
    try:
        from core.settings_loader import settings as _s
        ha_url   = (_s.get("home_assistant") or {}).get("url")
        ha_token = (_s.get("home_assistant") or {}).get("token")
        ha_connected = bool(ha_url and ha_token)
    except Exception:
        pass

    return {
        "git_sha":        _os.getenv("ZIGGY_GIT_SHA",    "dev"),
        "build_time":     _os.getenv("ZIGGY_BUILD_TIME", "unknown"),
        "release_marker": "ota-test-3-unattended",
        "hostname":       _socket.gethostname(),
        "uptime_s":       int(_time.time() - _ZIGGY_BOOT_TS),
        "ha_configured":  ha_connected,
        "home_id":        (_os.getenv("HOME_ID") or "dev").strip(),
    }


@app.get("/api/__deploy__")
async def get_deploy_history(limit: int = 20):
    """Recent deploys this host has applied. Reads user_files/deploy_log.

    PUBLIC, unauthenticated. The deploy log is a flat YAML-ish ledger
    of `(ts, old_sha, new_sha, branch, verified)` tuples written by
    scripts/update.ps1 / update.sh after each successful rebuild.

    Useful for:
      - A future cross-home admin view ("which homes are behind?").
      - On-call debugging ("when did SHA X land here?").

    Caps to last `limit` entries (default 20) to keep the response small.
    Returns an empty list if the log doesn't exist yet (fresh hub).
    """
    log_path = _os.path.join(
        _os.path.dirname(__file__), "..", "user_files", "deploy_log"
    )
    if not _os.path.exists(log_path):
        return {"entries": [], "count": 0}

    try:
        with open(log_path, "r", encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        return {"entries": [], "count": 0, "error": "log_unreadable"}

    # Parse "---" separated blocks of "key: value" lines.
    entries = []
    current = {}
    for line in raw.splitlines():
        line = line.strip()
        if line == "---":
            if current:
                entries.append(current)
                current = {}
            continue
        if ":" in line:
            k, _, v = line.partition(":")
            current[k.strip()] = v.strip()
    if current:
        entries.append(current)

    # Newest first, capped.
    entries.reverse()
    if limit > 0:
        entries = entries[:limit]

    return {"entries": entries, "count": len(entries)}


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
    app.mount("/", _SPAStaticFiles(directory=_FRONTEND_DIST, html=True), name="frontend")


# ---------------------------------------------------------------------------
# Entry point (called from ziggy_main.py)
# ---------------------------------------------------------------------------

def start_api_server():
    port = settings.get("web_interface", {}).get("backend_port", 8001)
    log_info(f"[API] Ziggy API server starting on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
