"""Global exception handlers — the single place every API error becomes the
unified envelope defined in :mod:`core.errors`.

Three handlers are installed on the FastAPI app:

* :func:`handle_ziggy_error` — first-class path. Any router that raises
  :class:`core.errors.ZiggyError` (the preferred new style) lands here.
* :func:`handle_http_exception` — covers raw ``HTTPException`` (legacy routers
  that haven't migrated yet, plus FastAPI's own validation 422s). The detail
  string is sanitized before being returned to clients; the full original
  detail is logged and may be surfaced via the admin debug channel.
* :func:`handle_unhandled` — last-resort net for any ``Exception`` that wasn't
  caught upstream. The client gets a generic INTERNAL_ERROR envelope; the
  server logs the full traceback so we can diagnose without leaking it.

Debug detail gating
-------------------
The ``details`` block in the response envelope is the only place internal
information ever appears. It is omitted unless **both** conditions hold:

1. The request has an authenticated admin (``request.state.user.role`` is
   ``admin`` or ``super_admin``), and
2. The request carries the explicit opt-in header ``X-Ziggy-Debug: 1``.

This prevents admin tooling from accidentally rendering internals into normal
admin UI — admins have to ask for the detail explicitly per call.
"""
from __future__ import annotations

import traceback
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from core.errors import (
    DEFAULT_HTTP_STATUS,
    DEFAULT_MESSAGES,
    ErrorCode,
    ZiggyError,
)
from core.logger_module import log_debug, log_error


_DEBUG_HEADER = "x-ziggy-debug"
_ADMIN_ROLES = {"admin", "super_admin"}


def _get_request_id(request: Request) -> str | None:
    """Pull the correlation id set by :mod:`request_logger` middleware."""
    state = getattr(request, "state", None)
    if state is None:
        return None
    return getattr(state, "request_id", None)


def _is_debug_request(request: Request) -> bool:
    """Return True when the caller is an authenticated admin AND opted into
    debug responses via the X-Ziggy-Debug header.

    The header check is a deliberate second key: an admin browsing normal UI
    shouldn't see raw exception text just because they're an admin. They opt
    in per-request (via the debug page / curl) when they actively want it.
    """
    if request.headers.get(_DEBUG_HEADER, "").strip() != "1":
        return False
    user = getattr(getattr(request, "state", None), "user", None)
    if not isinstance(user, dict):
        return False
    return user.get("role") in _ADMIN_ROLES


def _envelope(*, code: str, message: str, status: int, request_id: str | None,
              details: dict[str, Any] | None, expose_details: bool) -> JSONResponse:
    """Assemble the canonical error response."""
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
        }
    }
    if request_id:
        body["error"]["request_id"] = request_id
    if expose_details and details:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


async def handle_ziggy_error(request: Request, exc: ZiggyError) -> JSONResponse:
    """Convert a router-raised :class:`ZiggyError` to the unified envelope.

    The log line is intentionally verbose — operators need the original cause
    even when the client gets a friendly fallback string.
    """
    request_id = _get_request_id(request)
    log_msg = exc.log_message or exc.public_message
    log_debug(
        f"[ZiggyError] {exc.code} {log_msg}",
        scope="api",
        request_id=request_id,
        code=exc.code,
        http_status=exc.status_code,
        details=exc.details or None,
    )
    return _envelope(
        code=exc.code,
        message=exc.public_message,
        status=exc.status_code,
        request_id=request_id,
        details=exc.details,
        expose_details=_is_debug_request(request),
    )


def _classify_http_exception(status: int, raw_detail: Any) -> tuple[str, str]:
    """Pick the best machine code + default user message for a raw
    ``HTTPException`` slipping through legacy routers.

    The raw ``detail`` (which often contains Python exception text) is
    sanitized away — only the status code drives the public response. The
    original detail is still preserved in the log line by the caller.
    """
    if status == 401:
        return ErrorCode.NOT_AUTHENTICATED, DEFAULT_MESSAGES[ErrorCode.NOT_AUTHENTICATED]
    if status == 403:
        return ErrorCode.INSUFFICIENT_PERMISSIONS, DEFAULT_MESSAGES[ErrorCode.INSUFFICIENT_PERMISSIONS]
    if status == 404:
        return ErrorCode.NOT_FOUND, DEFAULT_MESSAGES[ErrorCode.NOT_FOUND]
    if status == 409:
        return ErrorCode.CONFLICT, DEFAULT_MESSAGES[ErrorCode.CONFLICT]
    if status == 422:
        return ErrorCode.VALIDATION_ERROR, DEFAULT_MESSAGES[ErrorCode.VALIDATION_ERROR]
    if status == 502:
        return ErrorCode.UPSTREAM_UNAVAILABLE, DEFAULT_MESSAGES[ErrorCode.UPSTREAM_UNAVAILABLE]
    if status == 503:
        return ErrorCode.DEVICE_UNAVAILABLE, DEFAULT_MESSAGES[ErrorCode.DEVICE_UNAVAILABLE]
    if status == 504:
        return ErrorCode.UPSTREAM_TIMEOUT, DEFAULT_MESSAGES[ErrorCode.UPSTREAM_TIMEOUT]
    if 400 <= status < 500:
        return ErrorCode.VALIDATION_ERROR, DEFAULT_MESSAGES[ErrorCode.VALIDATION_ERROR]
    return ErrorCode.INTERNAL_ERROR, DEFAULT_MESSAGES[ErrorCode.INTERNAL_ERROR]


# Detail strings that legacy routers commonly use as user-facing text. They
# look safe (short, no Python class names, no stack lines) so we forward them
# as-is to keep behavior intact while routers migrate to ZiggyError.
def _detail_looks_user_safe(detail: Any) -> bool:
    if not isinstance(detail, str):
        return False
    if len(detail) > 200:
        return False
    if detail.startswith("HTTP ") or detail.startswith("Internal Server Error"):
        return False
    # Heuristics for raw Python exception text we don't want leaking.
    bad_markers = (
        "Traceback",
        "Exception:",
        "Error:",      # "FooError: ..." style — Python repr leakage
        "  File \"",   # traceback file header
        "<class '",
        "object at 0x",
    )
    return not any(m in detail for m in bad_markers)


async def handle_http_exception(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Wrap any HTTPException (FastAPI or Starlette) in the unified envelope.

    Legacy routers raising ``HTTPException(500, str(e))`` flow through here.
    The ``str(e)`` ends up sanitized in the public response; the original is
    preserved in the log + admin debug detail.
    """
    request_id = _get_request_id(request)
    code, default_msg = _classify_http_exception(exc.status_code, exc.detail)

    if _detail_looks_user_safe(exc.detail):
        public_message = str(exc.detail)
    else:
        public_message = default_msg

    log_debug(
        f"[HTTPException] {exc.status_code} {exc.detail!r}",
        scope="api",
        request_id=request_id,
        code=code,
        http_status=exc.status_code,
    )

    details = {
        "original_detail": exc.detail,
        "source": "http_exception",
    }
    return _envelope(
        code=code,
        message=public_message,
        status=exc.status_code,
        request_id=request_id,
        details=details,
        expose_details=_is_debug_request(request),
    )


async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI request-validation failures (422). Returns the same envelope
    so the client doesn't need a special-case for validation responses.
    """
    request_id = _get_request_id(request)
    errors = exc.errors() if hasattr(exc, "errors") else []
    log_debug(
        f"[Validation] {errors!r}",
        scope="api",
        request_id=request_id,
        code=ErrorCode.VALIDATION_ERROR,
        http_status=422,
    )
    return _envelope(
        code=ErrorCode.VALIDATION_ERROR,
        message=DEFAULT_MESSAGES[ErrorCode.VALIDATION_ERROR],
        status=422,
        request_id=request_id,
        details={"validation": errors},
        expose_details=_is_debug_request(request),
    )


async def handle_unhandled(request: Request, exc: Exception) -> JSONResponse:
    """Final safety net. Any uncaught exception becomes INTERNAL_ERROR.

    The full traceback is logged at ERROR level so production incidents
    surface in logs; the client only sees the generic envelope.
    """
    request_id = _get_request_id(request)
    tb = traceback.format_exc()
    log_error(
        f"[Unhandled] {type(exc).__name__}: {exc}\nrequest_id={request_id}\n{tb}"
    )
    return _envelope(
        code=ErrorCode.INTERNAL_ERROR,
        message=DEFAULT_MESSAGES[ErrorCode.INTERNAL_ERROR],
        status=DEFAULT_HTTP_STATUS[ErrorCode.INTERNAL_ERROR],
        request_id=request_id,
        details={
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": tb.splitlines()[-30:],
        },
        expose_details=_is_debug_request(request),
    )


def install_error_handlers(app) -> None:
    """Wire the three handlers into a FastAPI app. Idempotent — safe to call
    once at startup."""
    app.add_exception_handler(ZiggyError, handle_ziggy_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    app.add_exception_handler(Exception, handle_unhandled)
