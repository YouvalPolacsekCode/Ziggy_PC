from __future__ import annotations

"""
Request proxy — forwards authenticated requests to the right home hub.

Flow:
  Browser → relay /proxy/{home_id}/api/... + JWT
  Relay validates JWT, checks home_id matches user's home
  Relay forwards to hub's tunnel_url with X-Relay-Secret + user context headers
  Returns hub's response verbatim
"""

import asyncio

import httpx
from fastapi import APIRouter, HTTPException, Request, Response, WebSocket
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import WebSocketException

from ..auth import current_user, decode_jwt
from ..billing import is_subscription_active
from ..database import get_db

router = APIRouter(prefix="/proxy")

PROXY_TIMEOUT = 30

# Module-level client → keeps TCP/TLS connections to each hub tunnel hot.
# Previously every request opened a fresh AsyncClient, costing one TLS
# handshake per proxied call. With keepalive at 20 connections per host
# and a 5 s idle window, repeated calls reuse the same socket.
_proxy_client = httpx.AsyncClient(
    timeout=PROXY_TIMEOUT,
    limits=httpx.Limits(max_keepalive_connections=20, max_connections=100,
                        keepalive_expiry=5.0),
)

# Hop-by-hop headers (RFC 7230 §6.1) plus body-framing headers that no longer
# describe the response after httpx has decoded the body. Forwarding these
# verbatim causes Fly's edge to disagree with the actual byte length and
# return 502 Bad Gateway.
_STRIP_RESPONSE_HEADERS = {
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "upgrade",
}


async def _authorize_home(user: dict, home_id: str) -> dict:
    """Shared authorization + hub-target resolution for BOTH the HTTP and the
    WebSocket proxy paths, so the two transports enforce byte-identical rules.

    Rules (unchanged from the original HTTP proxy):
      * Ownership — a user may only reach their own home; role 'relay_admin'
        (the founder) may reach any home.
      * The home row must exist.
      * Hub target — prefer the per-home public hostname (DNS-CNAME'd to the
        tunnel; a bare {tunnel_id}.cfargotunnel.com URL is NOT publicly
        routable), falling back to tunnel_url for pre-Stream-3 rows.
      * Founder support bypass (Prompt 9 decision 8) — 'relay_admin' skips the
        operational + subscription gate so the founder can always reach a
        customer's hub for support.
      * Subscription / operational kill-switch via is_subscription_active().

    Returns {"hub_base", "relay_secret", "home"}. Raises HTTPException with the
    exact status codes the HTTP path has always returned — the HTTP handler
    propagates them unchanged, and the WS handler translates them to close
    codes.
    """
    # Users can only proxy to their own home; relay_admin can proxy to any
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied to this home.")

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT tunnel_url, public_hostname, relay_secret, status, subscription_state "
            "FROM homes WHERE id=?", (home_id,)
        )
        if not rows:
            raise HTTPException(404, "Home not found.")
        home = dict(rows[0])

    hub_base = (home.get("public_hostname") or "").strip() or home["tunnel_url"]
    is_founder_support = user.get("role") == "relay_admin"

    if not hub_base:
        raise HTTPException(503, "Home hub not yet connected.")
    if not is_founder_support and not is_subscription_active(
        home_status=home["status"],
        subscription_state=home["subscription_state"],
    ):
        # Differentiate operational suspension from billing gate so the
        # mobile app can render the right user-facing message. Audit log
        # still carries the precise gate=status/sub detail elsewhere.
        if home["status"] == "suspended":
            raise HTTPException(403, "This home is currently locked. Please contact support.")
        raise HTTPException(
            403,
            "Subscription required for remote access — your home still works locally.",
        )

    return {"hub_base": hub_base, "relay_secret": home["relay_secret"], "home": home}


@router.api_route("/{home_id}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy(home_id: str, path: str, request: Request):
    user = current_user(request)
    resolved = await _authorize_home(user, home_id)
    hub_base = resolved["hub_base"]

    # Build target URL
    target = f"{hub_base.rstrip('/')}/{path}"
    if request.query_params:
        target += f"?{request.url.query}"

    # Forward headers, injecting relay context. Client-supplied x-relay-*
    # headers are dropped explicitly so a caller can never spoof the relay
    # context we set below — defense-in-depth; our own X-Relay-* still win
    # because we set them after this filter.
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "authorization", "content-length")
        and not k.lower().startswith("x-relay-")
    }
    headers["X-Relay-Secret"] = resolved["relay_secret"]
    headers["X-Relay-User"]   = user.get("email", "")
    headers["X-Relay-Role"]   = user.get("role", "user")
    headers["X-Relay-Home"]   = home_id

    body = await request.body()

    try:
        resp = await _proxy_client.request(
            method  = request.method,
            url     = target,
            headers = headers,
            content = body,
        )
        safe_headers = {
            k: v for k, v in resp.headers.items()
            if k.lower() not in _STRIP_RESPONSE_HEADERS
        }
        return Response(
            content     = resp.content,
            status_code = resp.status_code,
            headers     = safe_headers,
        )
    except httpx.ConnectError:
        raise HTTPException(503, "Cannot reach home hub. Tunnel may be down.")
    except httpx.TimeoutException:
        raise HTTPException(504, "Home hub timed out.")
    except Exception as e:
        raise HTTPException(502, f"Proxy error: {e}")


# ---------------------------------------------------------------------------
# WebSocket proxy — forwards realtime upgrades to the home hub's /ws endpoint.
#
# The HTTP proxy above only speaks request/response and deliberately strips the
# `upgrade` header (see _STRIP_RESPONSE_HEADERS), so the mobile app's per-home
# realtime socket (/api/proxy/{home_id}/ws) previously had no path to the hub.
# This handler authenticates the client, dials the hub as a WebSocket *client*,
# and pumps frames (text + binary) in both directions until either side closes.
#
# Auth reuses _authorize_home() — the exact ownership + subscription +
# founder-bypass rules as the HTTP path — with the JWT taken from the ?token=
# query param (the browser/mobile transport, since a WS handshake can't carry
# an Authorization header from a browser) or a Bearer header as a fallback.
#
# The hub itself authenticates the relay via the injected X-Relay-Secret header
# (backend/middleware/relay_auth.py promotes it to a synthetic user for both
# http and websocket scopes), identical to the HTTP path. We still forward the
# original query string (?token=...) so a hub reached over a bare tunnel can
# also fall back to its ?token= auth branch.
# ---------------------------------------------------------------------------

# Application close codes in the private-use range (4000-4999) so they never
# collide with protocol-reserved codes. 4401 mirrors the hub's own
# unauthenticated close (backend/server.py); 4403/4404/4503 mirror HTTP 4xx/503.
WS_CLOSE_UNAUTHENTICATED = 4401
WS_CLOSE_FORBIDDEN       = 4403
WS_CLOSE_NOT_FOUND       = 4404
WS_CLOSE_HUB_UNAVAILABLE = 4503

# Close codes the WebSocket protocol forbids an endpoint from *sending* — they
# are set locally by the implementation and never appear on the wire. If the
# hub or the client hands us one of these we substitute a normal 1000 so our
# own close() call doesn't raise.
_UNSENDABLE_CLOSE_CODES = {1004, 1005, 1006, 1015}


def _status_to_ws_close(status_code: int) -> int:
    return {
        401: WS_CLOSE_UNAUTHENTICATED,
        403: WS_CLOSE_FORBIDDEN,
        404: WS_CLOSE_NOT_FOUND,
        503: WS_CLOSE_HUB_UNAVAILABLE,
    }.get(status_code, WS_CLOSE_FORBIDDEN)


def _sanitize_close_code(code) -> int:
    try:
        code = int(code)
    except (TypeError, ValueError):
        return 1000
    if code in _UNSENDABLE_CLOSE_CODES or code < 1000 or code > 4999:
        return 1000
    return code


def _ws_token(websocket: WebSocket) -> str | None:
    tok = websocket.query_params.get("token")
    if tok:
        return tok.strip()
    auth = websocket.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth.removeprefix("Bearer ").strip()
    return None


def _http_base_to_ws(url: str) -> str:
    """Map an http(s) hub base URL to its ws(s) equivalent. Bare hostnames and
    already-ws URLs pass through (bare → assume TLS)."""
    if url.startswith("https://"):
        return "wss://" + url[len("https://"):]
    if url.startswith("http://"):
        return "ws://" + url[len("http://"):]
    if url.startswith(("ws://", "wss://")):
        return url
    return "wss://" + url


async def _pump_client_to_hub(websocket: WebSocket, upstream) -> int:
    """Relay-side client socket → hub. Returns the close code to propagate."""
    while True:
        msg = await websocket.receive()
        if msg.get("type") == "websocket.disconnect":
            return _sanitize_close_code(msg.get("code", 1000))
        text = msg.get("text")
        if text is not None:
            await upstream.send(text)
            continue
        data = msg.get("bytes")
        if data is not None:
            await upstream.send(data)


async def _pump_hub_to_client(websocket: WebSocket, upstream) -> int:
    """Hub → relay-side client socket. Returns the close code to propagate."""
    async for message in upstream:
        if isinstance(message, (bytes, bytearray, memoryview)):
            await websocket.send_bytes(bytes(message))
        else:
            await websocket.send_text(message)
    # Upstream iterator exhausted → hub closed cleanly.
    return _sanitize_close_code(getattr(upstream, "close_code", 1000) or 1000)


async def _proxy_ws(websocket: WebSocket, home_id: str, hub_path: str) -> None:
    token = _ws_token(websocket)
    try:
        if not token:
            raise HTTPException(401, "Missing token.")
        user = decode_jwt(token)               # raises HTTPException on bad/expired
        resolved = await _authorize_home(user, home_id)
    except HTTPException as exc:
        # Accept-then-close so the client receives a real close frame with a
        # meaningful code instead of a 1006 abnormal closure — mirrors the
        # hub's own /ws behavior (backend/server.py).
        await websocket.accept()
        await websocket.close(code=_status_to_ws_close(exc.status_code))
        return

    ws_target = _http_base_to_ws(resolved["hub_base"].rstrip("/")) + "/" + hub_path
    query = websocket.url.query
    if query:
        ws_target += f"?{query}"

    upstream_headers = {
        "X-Relay-Secret": resolved["relay_secret"],
        "X-Relay-User":   user.get("email", ""),
        "X-Relay-Role":   user.get("role", "user"),
        "X-Relay-Home":   home_id,
    }

    try:
        async with ws_connect(ws_target, additional_headers=upstream_headers) as upstream:
            await websocket.accept()
            client_pump = asyncio.create_task(_pump_client_to_hub(websocket, upstream))
            hub_pump    = asyncio.create_task(_pump_hub_to_client(websocket, upstream))

            done, pending = await asyncio.wait(
                {client_pump, hub_pump}, return_when=asyncio.FIRST_COMPLETED
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass

            close_code = 1000
            for task in done:
                try:
                    close_code = task.result()
                except Exception:
                    close_code = 1011  # internal error while pumping frames

            close_code = _sanitize_close_code(close_code)
            # Close both ends — a side that already closed makes this a no-op.
            try:
                await upstream.close(code=close_code)
            except Exception:
                pass
            try:
                await websocket.close(code=close_code)
            except Exception:
                pass
    except (OSError, WebSocketException) as exc:
        # Hub tunnel down or upstream handshake rejected. Accept-then-close so
        # the client sees WS_CLOSE_HUB_UNAVAILABLE rather than a bare 1006.
        try:
            await websocket.accept()
        except Exception:
            pass
        try:
            await websocket.close(code=WS_CLOSE_HUB_UNAVAILABLE)
        except Exception:
            pass


@router.websocket("/{home_id}/ws")
async def proxy_ws(websocket: WebSocket, home_id: str):
    await _proxy_ws(websocket, home_id, "ws")


@router.websocket("/{home_id}/ws/{path:path}")
async def proxy_ws_subpath(websocket: WebSocket, home_id: str, path: str):
    # Future hub sub-paths under /ws/* (e.g. /ws/telemetry). Same auth + pump.
    await _proxy_ws(websocket, home_id, f"ws/{path}")
