from __future__ import annotations

"""
Relay auth middleware — pure ASGI implementation.

DO NOT use BaseHTTPMiddleware here. It buffers the entire response body,
causes event loop stalls under concurrency, and has known deadlock risks
with anyio on Starlette 1.x. Pure ASGI middleware has none of these issues.

When a request arrives from the relay, it carries:
  X-Relay-Secret: <home_relay_secret>
  X-Relay-User:   user@email.com
  X-Relay-Role:   user
  X-Relay-Home:   home-abc123

If the secret matches settings.relay.secret, we inject a synthetic user
into scope["state"] so downstream get_current_user() works without a
local session token.

Local requests continue to use Bearer tokens as before.
"""

import os
from starlette.datastructures import State
from starlette.types import ASGIApp, Receive, Scope, Send

from core.settings_loader import settings


def _relay_secret() -> str | None:
    return (
        os.getenv("RELAY_SECRET")
        or settings.get("relay", {}).get("secret")
    )


class RelayAuthMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            # Headers in ASGI scope are bytes tuples
            headers = {k.lower(): v for k, v in scope.get("headers", [])}
            relay_secret_hdr = headers.get(b"x-relay-secret", b"").decode("latin-1")

            if relay_secret_hdr:
                expected = _relay_secret()
                if expected and relay_secret_hdr == expected:
                    # Ensure scope["state"] is a Starlette State object
                    if "state" not in scope:
                        scope["state"] = State()
                    scope["state"].relay_user = {
                        "username": headers.get(b"x-relay-user", b"relay").decode("latin-1"),
                        "role":     headers.get(b"x-relay-role", b"user").decode("latin-1"),
                        "home_id":  headers.get(b"x-relay-home", b"").decode("latin-1"),
                        "_via_relay": True,
                    }

        await self.app(scope, receive, send)
