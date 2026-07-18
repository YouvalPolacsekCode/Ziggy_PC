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
import ipaddress as _ipaddress
import os as _os
import zipfile as _zipfile
from pathlib import Path as _PathLib
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.routers.auth_deps import get_current_user
from backend.middleware.rate_limit import (
    SlidingWindowLimiter, peer_key,
    pair_limiter, pair_fail_limiter,
)
from core.debug_bus import bus as _dbus, BASIC, VERBOSE
from core.logger_module import log_info
from services import auth_db, mobile_app
from services.mobile_ws_manager import mobile_ws

router = APIRouter(prefix="/api/mobile", tags=["mobile"])


def _client_ip(request: Request) -> str:
    """Best-effort client IP for **audit events only**.

    Prefers X-Forwarded-For (relay-proxied requests) then the direct peer.
    Returns empty string when neither is available — emit callers must
    tolerate that, the bus accepts any string.

    SECURITY: X-Forwarded-For is attacker-controllable, so this value must
    NEVER be used for an authorization decision. LAN-origin gating uses
    `_peer_ip()` (the direct socket peer) instead — see `is_lan_request`.
    """
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def _peer_ip(request: Request) -> str:
    """The DIRECT socket peer address — never a forwarded header.

    This is the only address a remote party cannot spoof, so it is what
    LAN-origin gating and per-IP rate-limiting key on.
    """
    return request.client.host if request.client else ""


def _is_private_host(host: str) -> bool:
    """True when `host` is a loopback / RFC1918 / link-local address."""
    if not host:
        return False
    try:
        ip = _ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local


# Header names whose presence proves the request traversed a proxy/relay and
# therefore did NOT originate on the local network, regardless of peer IP
# (the relay/tunnel egresses into the container from a private docker address).
_PROXY_MARKER_HEADERS = (
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "forwarded",
    "cf-connecting-ip",
    "cf-ray",
)


def is_lan_request(request: Request) -> bool:
    """True only when the request genuinely originated on the local network.

    Both conditions are required:
      1. The direct socket peer (`_peer_ip`) is loopback or RFC1918/link-local
         private. A public source IP is never LAN.
      2. No proxy/relay markers on the request: no X-Relay-* header (cloud
         relay via RelayAuthMiddleware) and none of the reverse-proxy /
         Cloudflare-Tunnel forwarding headers. The relay/tunnel egress into
         the container is itself a private address, so (1) alone would let a
         remote party through — (2) is what closes that hole.

    A real customer phone talking straight to the edge box over Wi-Fi sets
    neither marker and has a private peer IP, so it passes.
    """
    if not _is_private_host(_peer_ip(request)):
        return False
    for name in request.headers.keys():
        n = name.lower()
        if n.startswith("x-relay-") or n in _PROXY_MARKER_HEADERS:
            return False
    return True


def require_lan(request: Request) -> None:
    """Reject (403) any request that is not LAN-local. Guards the no-auth
    first-boot endpoints so the claim code / ownership grant is never
    reachable through the Cloudflare Tunnel or cloud relay."""
    if not is_lan_request(request):
        _dbus.emit("mobile_auth", BASIC, "first_boot_remote_blocked",
                   path=request.url.path,
                   source_ip=_client_ip(request),
                   peer_ip=_peer_ip(request))
        raise HTTPException(
            status_code=403,
            detail="First-boot pairing is only available on the local network.",
        )


def _short_code(code: str) -> str:
    """Last 2 chars of a pair code — enough to correlate without exposing it.

    Pair codes have low entropy (6 chars), so we never log the full value.
    """
    if not isinstance(code, str):
        return ""
    return code[-2:] if len(code) >= 2 else code


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
    # True only for first-boot claim-tier pairs (kit-out-of-box flow). User-
    # tier pairs (PWA owner mints a code for their second phone) always set
    # this False so the mobile app skips the sensor-wizard + starter-pack
    # onboarding steps. Optional + default False keeps existing mobile-app
    # builds backward-compatible. See docs/ONBOARDING_AUDIT.md §4.
    is_first_pair: bool = False


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
        # Audit-log the rejection so brute-force / stale-token patterns
        # are visible in /api/debug/events. Token itself never logged.
        _dbus.emit("mobile_auth", BASIC, "mobile_device_auth_failed",
                   path=request.url.path,
                   source_ip=_client_ip(request),
                   provided=bool(token))
        raise HTTPException(status_code=401, detail="Invalid device token.")
    return device


# ── Endpoints ────────────────────────────────────────────────────────────────

# PUBLIC ENDPOINT — reviewed in PROMPT_SECURITY_HARDENING_V2 on 2026-05-28.
# Justification: mobile-app liveness ping. Returns version + service tag,
# no state. Used by the app at launch to confirm hub reachability before
# attempting a pair flow.
@router.get("/health")
async def health():
    return {"ok": True, "service": "mobile", "version": "0.1.0"}


@router.post("/pair-code")
async def mint_pair_code(request: Request, user: dict = Depends(get_current_user)):
    """PWA endpoint: logged-in user requests a code to type into / scan from
    their phone. Returns the 6-char code + expiry.
    """
    user_id = user.get("id") or user.get("username") or user.get("email")
    if not user_id:
        raise HTTPException(status_code=400, detail="User missing id.")
    result = mobile_app.create_pair_code(user_id=str(user_id))
    _dbus.emit("mobile_auth", BASIC, "mobile_pair_code_minted",
               user_id=str(user_id),
               source_ip=_client_ip(request))
    return result


# PUBLIC ENDPOINT — reviewed in PROMPT_SECURITY_HARDENING_V2 on 2026-05-28.
# Justification: phone redeems a pair code. The 6-char pair-code IS the
# credential, minted by /api/mobile/pair-code (user-bearer-authed) or by
# the first-boot QR. Single-use: consume_pair_code 400s on invalid/expired
# codes, and the audit bus tags the rejection so brute-force attempts on
# pair codes are visible in /api/debug/events.
@router.post("/pair", response_model=PairResponse)
async def pair(req: PairRequest, request: Request):
    """Phone redeems a pair code → receives a device-scoped auth token.

    Two redemption modes (distinguished by `match["kind"]`):

    USER-tier (legacy + PWA-owner-pairs-second-phone):
        match has user_id. Device record is created bound to that user.
        is_first_pair=False — the home is already onboarded.

    CLAIM-tier (kit-out-of-box first boot, Prompt 7):
        match has device_id (edge box id) but no user_id. Device record
        is created with claim_pending=True; /api/onboarding/claim
        (Chunk 3) will later bind a freshly-minted owner. is_first_pair=True
        so the mobile app drives CLAIM_OWNER + SENSORS + STARTER_PACK steps.
    """
    # H2: throttle the ownership-gating pair endpoint per direct peer IP. Pair
    # codes are ~30 bits with a 30-day TTL, so an unthrottled sprayer could
    # brute a claim code. This generic budget blunts request storms; the
    # tighter `pair_fail_limiter` below locks out repeated invalid attempts.
    pair_limiter.check(peer_key(request, "pair"))

    match = mobile_app.consume_pair_code(req.pair_code.upper())
    if not match:
        # Pair codes have low entropy by design (6 chars). An attacker
        # spraying codes is exactly the pattern we want visible in
        # /api/debug/events. Last-2 chars only so post-hoc analysis can
        # cluster bursts without exposing the full code.
        _dbus.emit("mobile_auth", BASIC, "mobile_pair_failed",
                   reason="invalid_or_expired_code",
                   code_suffix=_short_code(req.pair_code),
                   platform=req.device.platform,
                   source_ip=_client_ip(request))
        # Record the failure; once too many land inside the window this raises
        # 429 (a much tighter lockout than the generic pair budget) so online
        # brute-forcing of the claim code becomes infeasible.
        pair_fail_limiter.check(peer_key(request, "pairfail"))
        raise HTTPException(status_code=400, detail="Invalid or expired pair code.")

    kind = match.get("kind", "user")
    if kind == "claim":
        # C2 + L1: the claim-tier (no-owner-yet) redemption is a first-boot
        # ownership grant. It must be reachable only from the LAN, never
        # through the tunnel/relay where a remote party who read the code off
        # qr.json could seize super_admin. User-tier pairs are NOT gated —
        # an owner may legitimately pair a second phone from anywhere.
        require_lan(request)

        # H1: once ANY owner exists this hub is already owned. A stale claim
        # code (up to 30-day TTL, or one minted out-of-band) must not be
        # honored to spin up another claim-pending device.
        if auth_db.has_any_user():
            _dbus.emit("mobile_auth", BASIC, "mobile_pair_failed",
                       reason="owner_already_exists",
                       code_suffix=_short_code(req.pair_code),
                       platform=req.device.platform,
                       source_ip=_client_ip(request))
            raise HTTPException(status_code=409, detail="This hub is already claimed.")

        # M1: the first claim-pending device closes the window. Refusing a
        # SECOND claim-pending device stops a second phone from minting its
        # own claim token and racing the first through /api/onboarding/claim.
        if mobile_app.has_claim_pending_device():
            _dbus.emit("mobile_auth", BASIC, "mobile_pair_failed",
                       reason="claim_already_in_progress",
                       code_suffix=_short_code(req.pair_code),
                       platform=req.device.platform,
                       source_ip=_client_ip(request))
            raise HTTPException(status_code=409, detail="A claim is already in progress on this hub.")

        record = mobile_app.register_device(
            user_id=None,
            device_info=req.device.model_dump(),
            claim_pending=True,
            claim_device_id=match.get("device_id"),
        )
        is_first_pair = True
        audit_user_id = None
    else:
        record = mobile_app.register_device(
            user_id=match["user_id"],
            device_info=req.device.model_dump(),
        )
        is_first_pair = False
        audit_user_id = match["user_id"]

    # Build URLs the app should use from this point. The Host the request came
    # in on is the per-home backend (or the cloud relay), so we mirror it back.
    base = str(request.base_url).rstrip("/")
    ws_base = base.replace("http://", "ws://").replace("https://", "wss://")
    _dbus.emit("mobile_auth", BASIC, "mobile_pair_succeeded",
               device_id=record["device_id"],
               user_id=audit_user_id,
               kind=kind,
               is_first_pair=is_first_pair,
               platform=req.device.platform,
               source_ip=_client_ip(request))
    return PairResponse(
        device_id=record["device_id"],
        webhook_id=record["webhook_id"],
        webhook_url=f"{base}/mobile/webhook/{record['webhook_id']}",
        ws_url=f"{ws_base}/mobile/ws",
        auth_token=record["auth_token"],
        person_id=record.get("person_id"),
        home_id=None,  # populated in Phase 2 when multi-home is real
        is_first_pair=is_first_pair,
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
    request: Request,
    webhook_id: str = Path(..., min_length=4),
    payload: dict = Body(...),
    device: dict = Depends(get_current_device),
):
    """Sensor + location + event ingest from the mobile app."""
    if device.get("webhook_id") != webhook_id:
        # A device with a valid token whose webhook id doesn't match the
        # path is either a code bug or a token reuse across devices. Either
        # way it deserves a visible signal — not just a silent 403.
        _dbus.emit("mobile_auth", BASIC, "mobile_webhook_id_mismatch",
                   device_id=device.get("device_id"),
                   url_webhook_id=webhook_id,
                   source_ip=_client_ip(request))
        raise HTTPException(status_code=403, detail="Webhook id mismatch.")
    return mobile_app.handle_webhook(device, payload)


# ── Device management (PWA-facing) ───────────────────────────────────────────

def _user_id_of(user: dict) -> str:
    return str(user.get("id") or user.get("username") or user.get("email") or "")


@router.get("/devices")
async def list_my_devices(user: dict = Depends(get_current_user)):
    """List mobile devices paired to the current user, with live connection
    status (whether each has an active /api/mobile/ws connection).

    Admin escape hatch: callers whose role is `relay_admin` (founder via
    the relay's admin proxy) or local `super_admin` see ALL devices in
    this home, not just their own. This is what the operator dashboard's
    HomeCard "Mobile" tab consumes via the relay's
    /api/admin/homes/{id}/mobile-devices endpoint. Customer-facing
    behaviour is unchanged.
    """
    role = user.get("role")
    if role in ("relay_admin", "super_admin"):
        devices = mobile_app.list_all_devices()
    else:
        uid = _user_id_of(user)
        devices = mobile_app.list_devices_for_user(uid)
    for d in devices:
        d["ws_connected"] = mobile_ws.is_connected(d["device_id"])
    return {"devices": devices}


@router.delete("/devices/{device_id}")
async def revoke_device(device_id: str, request: Request,
                          user: dict = Depends(get_current_user)):
    """Revoke a paired device — invalidates its auth token immediately by
    deleting the record. Any in-flight WS is dropped on next send attempt."""
    uid = _user_id_of(user)
    ok = mobile_app.delete_device(device_id, user_id=uid)
    if not ok:
        raise HTTPException(status_code=404, detail="Device not found or not yours.")
    _dbus.emit("mobile_auth", BASIC, "mobile_device_revoked",
               device_id=device_id,
               revoked_by=uid,
               source_ip=_client_ip(request))
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
        # WS path can't read X-Forwarded-For easily; use the peer address
        # which works in local dev and reveals the relay's egress in prod.
        peer = ws.client.host if ws.client else ""
        # ws_auth namespace (not mobile_auth) so a single grep —
        #   /api/debug/events?event=ws_auth_failed
        # — surfaces every WS auth rejection across /ws AND /api/mobile/ws.
        # relay_user_attempted is always False here: mobile clients don't
        # come through RelayAuthMiddleware, but the field stays for query
        # symmetry with the /ws event in backend/server.py.
        _dbus.emit("ws_auth", BASIC, "ws_auth_failed",
                   path="/api/mobile/ws",
                   provided=bool(token),
                   source_ip=peer,
                   relay_user_attempted=False)
        # Accept-then-close so the mobile client receives a real WebSocket
        # close frame with code 4401. Closing pre-accept causes
        # Starlette/uvicorn to reply HTTP 403 on the upgrade — the WebView
        # / mobile WS lib surfaces that as code=1006 (abnormal closure),
        # indistinguishable from a network drop. See the matching fix on
        # /ws in backend/server.py (88bd9c8).
        await ws.accept()
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


# ─── OTA: bundled-UI update channel for the native app ──────────────────────
# The native Capacitor app ships with a bundled www/ for instant cold-start
# (Phase 1 — capacitor.config.ts no longer sets server.url). Phase 2 restores
# the push-to-main → live freshness loop by exposing the current frontend
# build as a downloadable bundle that @capgo/capacitor-updater consumes:
#
#   GET /api/mobile/version           (device-authed)
#     → { version: <git_sha>, url: "https://.../api/mobile/bundles/<sha>.zip" }
#
#   GET /api/mobile/bundles/<sha>.zip (public — SHA is the credential)
#     → zip of frontend/dist
#
# The plugin polls /version on launch, downloads the zip if the SHA differs
# from what it has, and hot-swaps next cold start. If the new bundle fails
# to render within appReadyTimeout (10s), the plugin auto-rolls back to the
# previous bundle. See project_mobile_cold_start_plan.md Phase 2.
#
# Graceful degradation: if frontend/dist is missing (rare — local dev without
# a build) /version returns null, the plugin treats it as "no update", app
# keeps using its bundled UI. No feature flag needed.

# Cached on disk so concurrent requests share the same zip and a container
# restart triggers exactly one re-zip. The SHA is fixed per image, so this
# never goes stale within a container lifetime.
_BUNDLE_CACHE_DIR = _PathLib("/tmp/ziggy_mobile_bundles")
_BUNDLE_LOCK = asyncio.Lock()


def _frontend_dist_path() -> _PathLib:
    # Matches the resolution used by the static-files mount in server.py
    # (see _FRONTEND_DIST). Re-deriving rather than importing to keep this
    # module decoupled from server.py's load-order.
    return _PathLib(_os.path.dirname(__file__)).parent.parent / "frontend" / "dist"


def _bundle_version() -> str:
    """The OTA version identifier the phone compares against.

    Normally the deploy SHA (set by the image build). But when the hub is
    runtime-patched (a new frontend/dist docker-cp'd in WITHOUT an image
    rebuild, so ZIGGY_GIT_SHA is still 'dev'), fall back to a content-derived
    id: Vite content-hashes every asset filename, so hashing the sorted asset
    list changes iff the build changed. This lets a new UI reach the phone via
    OTA without a full image rebuild. Backward compatible: once a real rebuild
    sets ZIGGY_GIT_SHA, that wins and behaviour is unchanged.

    Both /version and /bundles/{sha}.zip MUST use this (the download endpoint
    404s any sha != current), so they always agree.
    """
    sha = _os.getenv("ZIGGY_GIT_SHA", "dev")
    if sha and sha != "dev":
        return sha
    try:
        assets = _frontend_dist_path() / "assets"
        if assets.is_dir():
            names = sorted(p.name for p in assets.iterdir() if p.is_file())
            if names:
                import hashlib as _hl
                return "b-" + _hl.sha1("|".join(names).encode()).hexdigest()[:12]
    except Exception:
        pass
    return sha


def _build_bundle_zip(sha: str, dist_dir: _PathLib, out_path: _PathLib) -> None:
    """Zip the entire frontend/dist tree into out_path.

    Runs in a thread (called via asyncio.to_thread) — zipping ~2MB of static
    assets takes ~200-500ms and would otherwise pin the event loop. The
    result is written atomically by zipping into a sibling .tmp file first
    and renaming, so concurrent readers never see a partial zip.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = out_path.with_suffix(out_path.suffix + ".tmp")
    # ZIP_DEFLATED at default compression — ~50% size reduction on JS/CSS,
    # negligible CPU. Don't bother with ZIP_LZMA: marginal gain, much slower
    # decompression on the phone.
    with _zipfile.ZipFile(tmp_path, "w", compression=_zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in _os.walk(dist_dir):
            for fname in files:
                abs_path = _PathLib(root) / fname
                # capacitor-updater expects index.html at the zip root.
                rel = abs_path.relative_to(dist_dir)
                zf.write(abs_path, str(rel))
    tmp_path.replace(out_path)


async def _ensure_bundle(sha: str) -> Optional[_PathLib]:
    """Return the path to the bundle zip for `sha`, building it on demand.

    Returns None if frontend/dist doesn't exist (the local-dev case where
    the backend runs without a frontend build). Callers should treat that
    as "OTA not available right now".
    """
    dist = _frontend_dist_path()
    if not dist.is_dir():
        return None

    out = _BUNDLE_CACHE_DIR / f"{sha}.zip"
    if out.exists():
        return out

    async with _BUNDLE_LOCK:
        # Re-check inside the lock — another request may have built it
        # while we were waiting.
        if out.exists():
            return out
        await asyncio.to_thread(_build_bundle_zip, sha, dist, out)
        return out


async def _version_payload(request: Request) -> dict:
    sha = _bundle_version()
    if not _frontend_dist_path().is_dir():
        return {"version": sha, "url": None, "available": False}
    # request.base_url uses the raw scheme uvicorn saw on the socket — Cloudflare
    # Tunnel terminates HTTPS and forwards http:// to the container, so without
    # --proxy-headers the URL we hand back is http://, which Android blocks under
    # the default cleartext-traffic policy. Honor X-Forwarded-Proto / -Host
    # explicitly so the bundle download stays HTTPS.
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    host  = request.headers.get("x-forwarded-host",  request.url.netloc)
    base  = f"{proto}://{host}"
    return {
        "version": sha,
        "url": f"{base}/api/mobile/bundles/{sha}.zip",
        "available": True,
    }


# PUBLIC ENDPOINTS — reviewed in Phase 2 OTA change on 2026-06-22.
# Justification: returns only the public deployment SHA + a public bundle
# download URL. The same SHA is already exposed on /api/version (also
# public). No state, no auth-sensitive info. Made public after observing
# that @capgo/capacitor-updater calls /version BEFORE the user logs in,
# so a device-authed endpoint would deadlock the OTA flow on first install.
@router.get("/version")
@router.post("/version")
async def mobile_bundle_version(request: Request):
    """Current frontend bundle pointer for @capgo/capacitor-updater.

    The plugin POSTs device info (platform, app_id, version_*) in the body;
    we don't use it server-side but accept both GET and POST so any
    capacitor-updater version line works. Response shape matches the
    plugin's LatestVersion interface — `version` is the identifier the
    plugin compares against what it has on disk, `url` is what it
    downloads when they differ.
    """
    return await _version_payload(request)


# PUBLIC ENDPOINT — reviewed in this Phase 2 OTA change on 2026-06-22.
# Justification: the SHA in the URL is itself the credential. Paired devices
# learn it via /api/mobile/version (device-authed); an attacker who knew the
# exact SHA could only download the same JavaScript that's already public
# at https://app.ziggy-home.com/. No state, no secrets in the bundle.
@router.get("/bundles/{sha}.zip")
async def mobile_bundle_download(sha: str):
    """Serve the zipped frontend build for the given git SHA.

    Only the current build is served — historical SHAs return 404. The
    plugin's rollback path uses bundles cached on the device, not the
    server, so we don't need to keep old bundles around.
    """
    current = _bundle_version()
    if sha != current:
        # Stale request from a phone whose plugin polled before our deploy.
        # 404 makes capacitor-updater retry on next launch; no rollback fires.
        raise HTTPException(status_code=404, detail="Bundle for that SHA is not available.")

    path = await _ensure_bundle(sha)
    if path is None:
        raise HTTPException(status_code=404, detail="No frontend build available.")
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"ziggy-frontend-{sha}.zip",
        # Cache aggressively: the SHA is in the URL, so a hit on (sha) means
        # the bytes never change. Immutable lets CDNs / phones avoid revalidation.
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
