"""
HTTP request logger — emits one bus event when a request lands and another
when it finishes, both stamped with the same `request_id` so the Debug page
can show a click → API → service → HA timeline as a single chain.

Pure ASGI to avoid the BaseHTTPMiddleware buffering / deadlock pitfalls (see
relay_auth.py for the same rationale).

Correlation: prefer the client-supplied `X-Request-Id` header (the frontend
logger generates one per click). Fall back to a fresh uuid4. The id ends up
on `scope["state"].request_id` so any downstream code (routers, services,
the FE-event ingest) can stamp the same id onto its bus events.

Filtering:
  • Hot polling paths (/api/debug/events, /ws) are silently skipped so the
    Debug page doesn't drown out signal with its own polling.
  • At BASIC we only emit a single "request_completed" line per request.
  • At VERBOSE we add a "request_received" line up front so you can see the
    request shape without needing to wait for the response.
  • Slow requests (≥500 ms) always emit a "request_slow" event at BASIC even
    when basic-level routing is otherwise off — a thing the user *will* want
    to see in the wild.
"""
from __future__ import annotations

import time
import uuid

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from core.debug_bus import bus, BASIC, VERBOSE


# Paths we never log a row for — they fire many times per second and would
# turn the debug feed into a self-referential firehose.
_SILENT_PREFIXES = (
    "/api/debug/events",
    "/api/debug/config",
    "/api/debug/status",
    "/ws",
)

_SLOW_THRESHOLD_MS = 500.0


def _should_skip(path: str) -> bool:
    return any(path.startswith(p) for p in _SILENT_PREFIXES)


class RequestLoggerMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "")
        method: str = scope.get("method", "GET")
        client = scope.get("client") or ("?", 0)

        # Pull or mint a request id and stash it on scope.state so routers and
        # background tasks can keep emitting under the same correlation id.
        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in scope.get("headers", [])}
        request_id = headers.get("x-request-id") or f"r_{uuid.uuid4().hex[:10]}"

        state = scope.setdefault("state", {})
        try:
            state.request_id = request_id   # works for starlette State object
        except Exception:
            state["request_id"] = request_id  # plain dict fallback

        skip = _should_skip(path)
        t0 = time.perf_counter()

        if not skip:
            bus.emit(
                "api", VERBOSE, "request_received",
                request_id=request_id,
                method=method, path=path,
                client_ip=client[0],
            )

        status_code = 500   # default unless send_wrapper observes a real start

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 500)
                # Surface the request id back to the FE so clicks-without-a-
                # FE-id (e.g. SSR or curl) can still be correlated.
                headers_out = MutableHeaders(scope=message)
                headers_out.setdefault("x-request-id", request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            duration_ms = round((time.perf_counter() - t0) * 1000, 1)
            if not skip:
                bus.emit(
                    "api", BASIC, "request_exception",
                    request_id=request_id,
                    method=method, path=path,
                    duration_ms=duration_ms,
                    error=str(exc), error_type=type(exc).__name__,
                    result="exception",
                )
            raise

        duration_ms = round((time.perf_counter() - t0) * 1000, 1)
        if skip:
            return

        result = (
            "ok" if 200 <= status_code < 400
            else "client_error" if 400 <= status_code < 500
            else "server_error"
        )
        bus.emit(
            "api", BASIC, "request_completed",
            request_id=request_id,
            method=method, path=path,
            status=status_code,
            duration_ms=duration_ms,
            result=result,
        )
        if duration_ms >= _SLOW_THRESHOLD_MS:
            bus.emit(
                "api", BASIC, "request_slow",
                request_id=request_id,
                method=method, path=path,
                duration_ms=duration_ms,
                threshold_ms=_SLOW_THRESHOLD_MS,
                suggestion=("Slow response — check downstream services "
                            "(HA, IR blaster, file I/O)."),
            )
