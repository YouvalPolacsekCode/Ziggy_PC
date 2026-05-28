from __future__ import annotations

"""
Request proxy — forwards authenticated requests to the right home hub.

Flow:
  Browser → relay /proxy/{home_id}/api/... + JWT
  Relay validates JWT, checks home_id matches user's home
  Relay forwards to hub's tunnel_url with X-Relay-Secret + user context headers
  Returns hub's response verbatim
"""

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse

from ..auth import current_user
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


@router.api_route("/{home_id}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy(home_id: str, path: str, request: Request):
    user = current_user(request)

    # Users can only proxy to their own home; relay_admin can proxy to any
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied to this home.")

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT tunnel_url, relay_secret, status, subscription_state "
            "FROM homes WHERE id=?", (home_id,)
        )
        if not rows:
            raise HTTPException(404, "Home not found.")
        home = dict(rows[0])

    # Founder support bypass (Prompt 9 decision 8). The founder must
    # always reach a customer's hub for support, regardless of gating
    # — both the 'suspended' operational status and the subscription
    # billing gate. role 'relay_admin' is already the founder's
    # authenticated role across every other admin endpoint, so reusing
    # it keeps the surface small and audit-traceable (the proxy still
    # records the caller via existing X-Relay-User/Role headers below).
    is_founder_support = user.get("role") == "relay_admin"

    if not home["tunnel_url"]:
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

    # Build target URL
    target = f"{home['tunnel_url']}/{path}"
    if request.query_params:
        target += f"?{request.url.query}"

    # Forward headers, injecting relay context
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "authorization", "content-length")
    }
    headers["X-Relay-Secret"] = home["relay_secret"]
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
