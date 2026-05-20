"""Public passthrough for Ziggy presence PWA paths.

The presence PWA needs three URLs to be reachable without a JWT — the
per-person URL token is the only auth:

  GET  /presence/join/{token}            — invite page HTML
  GET  /presence/manifest.json?token=X   — PWA manifest
  POST /api/presence/ping                — GPS ping endpoint

This router exposes those at the relay's root (and `/api/...`) without auth,
finds the home hub, and forwards the request verbatim.

────────────────────────────────────────────────────────────────────────────
Multi-tenant caveat
────────────────────────────────────────────────────────────────────────────
The per-person token is opaque to the relay — it does NOT know which home a
given token belongs to. For now we assume a single active home (the common
case for self-hosted installs) and forward there. `_resolve_home` returns
503 if more than one active home exists.

Two ways to scale this up when multi-tenant becomes needed:

  1. **token → home_id cache** — relay maintains a `presence_tokens` table
     populated by the Ziggy backend when a person is created/deleted. The
     relay looks up `home_id` by token on each request. Requires a small
     backend↔relay sync API.

  2. **home_id in the URL** — change the invite URL pattern to
     `/presence/{home_id}/join/{token}` and rewrite the embedded PWA JS so
     fetch + manifest paths also include `{home_id}`. The frontend Settings
     page would need to learn the user's home_id (via auth status) to
     generate the right link.

Option (1) keeps the URL clean and is the path I'd take.

────────────────────────────────────────────────────────────────────────────
Security
────────────────────────────────────────────────────────────────────────────
The token-in-URL is the only authentication for these endpoints. Implications:

  * The relay MUST be served over HTTPS — a token in plaintext is game over.
  * Tokens are generated with `secrets.token_urlsafe(24)` (≈ 192 bits of
    entropy) — safe against guessing.
  * Deleting a person via the admin API invalidates the token everywhere; the
    relay has no separate revocation step because it just passes through.
  * The PWA page sets `localStorage["ziggy_presence_token"]` to the URL token
    on first load. Anyone with physical access to the unlocked phone can read
    it. This is the same risk as any cookie-based session.

────────────────────────────────────────────────────────────────────────────
Why no HTML rewriting is needed
────────────────────────────────────────────────────────────────────────────
The PWA HTML served by the hub embeds absolute paths:
  * `const PING_URL = "/api/presence/ping"`
  * `<link rel="manifest" href="/presence/manifest.json?token=…">`

When the phone loads the page through the relay, `window.location.origin` is
the relay URL, so those paths resolve to the relay automatically. As long as
this router exposes those same paths at root, the page just works.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from ..database import get_db

router = APIRouter()

PROXY_TIMEOUT = 30

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


async def _resolve_home() -> dict:
    """Return the single active home, or 404 if none / 503 if ambiguous.

    Token→home routing is not yet implemented for multi-tenant installs.
    """
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, tunnel_url, relay_secret, status FROM homes "
            "WHERE status != 'suspended'"
        )
    if not rows:
        raise HTTPException(404, "No home configured.")
    if len(rows) > 1:
        raise HTTPException(503, "Multi-home presence routing not yet implemented.")
    home = dict(rows[0])
    if not home["tunnel_url"]:
        raise HTTPException(503, "Home hub not yet connected.")
    return home


async def _forward(
    home: dict,
    method: str,
    path: str,
    request: Request,
    body: bytes | None = None,
) -> Response:
    target = f"{home['tunnel_url']}/{path.lstrip('/')}"
    if request.query_params:
        target += f"?{request.url.query}"

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "authorization", "content-length")
    }
    headers["X-Relay-Secret"] = home["relay_secret"]

    try:
        async with httpx.AsyncClient(timeout=PROXY_TIMEOUT) as client:
            resp = await client.request(
                method=method, url=target, headers=headers, content=body,
            )
    except httpx.ConnectError:
        raise HTTPException(503, "Cannot reach home hub. Tunnel may be down.")
    except httpx.TimeoutException:
        raise HTTPException(504, "Home hub timed out.")
    except Exception as e:
        raise HTTPException(502, f"Proxy error: {e}")

    safe_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in _STRIP_RESPONSE_HEADERS
    }
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=safe_headers,
        media_type=resp.headers.get("content-type"),
    )


@router.get("/presence/join/{token}")
async def public_join(token: str, request: Request):
    home = await _resolve_home()
    return await _forward(home, "GET", f"/presence/join/{token}", request)


@router.get("/presence/manifest.json")
async def public_manifest(request: Request):
    home = await _resolve_home()
    return await _forward(home, "GET", "/presence/manifest.json", request)


@router.post("/api/presence/ping")
async def public_ping(request: Request):
    home = await _resolve_home()
    body = await request.body()
    return await _forward(home, "POST", "/api/presence/ping", request, body)
