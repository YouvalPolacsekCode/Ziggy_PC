"""Unified error contract between the backend and any client (PWA, mobile).

Why this exists
---------------
Before this module every router raised exceptions in a different shape:
``HTTPException(500, str(e))``, ``{"ok": False, "error": ...}``,
``{"detail": "raw Python exception"}``, etc. The frontend had to guess which
shape was coming back, and raw ``str(e)`` text — including HA internals, Python
exception class names, and stack traces — leaked straight to end users.

Contract
--------
Every API error response now has this exact shape:

    {
      "error": {
        "code": "machine_readable_code",
        "message": "Human-friendly text the client may show as-is",
        "request_id": "uuid-from-X-Request-Id",
        "details": { ... }   # ONLY present when admin + X-Ziggy-Debug header
      }
    }

Routers raise :class:`ZiggyError` (or any subclass) with a machine code from
:class:`ErrorCode`. The global handler in
``backend.middleware.error_handler`` turns it into the envelope above and logs
the full technical detail server-side.

Routers should never call ``HTTPException(500, str(e))`` — that pattern is the
exact thing this module replaces. The handler still gracefully wraps any
HTTPException that slips through, but new code should use ZiggyError.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class ErrorCode:
    """Machine-readable error codes. Keep keys snake_case, stable, and
    enumerated here so the frontend's ERROR_CODE_TO_KEY map can stay in sync.

    Adding a code: pick the narrowest category that fits. The frontend may map
    several codes to the same user-facing string, but the code itself stays
    precise so logs and analytics keep their resolution.
    """

    # Fallback when nothing more specific applies
    INTERNAL_ERROR = "internal_error"

    # Auth / authorization
    NOT_AUTHENTICATED = "not_authenticated"
    INSUFFICIENT_PERMISSIONS = "insufficient_permissions"

    # Input validation
    VALIDATION_ERROR = "validation_error"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"

    # Upstream connectivity (HA, relay, IR blaster, etc.)
    UPSTREAM_UNAVAILABLE = "upstream_unavailable"
    UPSTREAM_TIMEOUT = "upstream_timeout"

    # Home Assistant specific
    HA_UNAVAILABLE = "ha_unavailable"
    HA_ENTITY_NOT_FOUND = "ha_entity_not_found"
    HA_SERVICE_FAILED = "ha_service_failed"
    HA_SERVICE_BLOCKED = "ha_service_blocked"

    # Device control (covers HA-backed and Ziggy-native)
    DEVICE_UNAVAILABLE = "device_unavailable"
    DEVICE_COMMAND_FAILED = "device_command_failed"

    # IR (Broadlink) specific
    IR_BLASTER_UNREACHABLE = "ir_blaster_unreachable"
    IR_LEARN_TIMEOUT = "ir_learn_timeout"
    IR_NOT_CONFIGURED = "ir_not_configured"

    # Pairing flows (ZHA, Z-Wave, Matter, Switcher)
    PAIRING_FAILED = "pairing_failed"
    PAIRING_TIMEOUT = "pairing_timeout"

    # Feature/config gaps
    NOT_CONFIGURED = "not_configured"
    FEATURE_DISABLED = "feature_disabled"


# Map every code to a default human-friendly fallback message. The handler
# uses this when the caller didn't pass an explicit message. Strings here are
# English — the frontend re-translates via its i18n layer (it keys off the
# machine code), so these only appear when:
#   1. The client is a non-PWA consumer (mobile shell) that hasn't translated
#      the code yet, OR
#   2. Something failed so early the i18n bundle never loaded.
DEFAULT_MESSAGES: dict[str, str] = {
    ErrorCode.INTERNAL_ERROR:           "Something went wrong on our end.",
    ErrorCode.NOT_AUTHENTICATED:        "Please sign in again.",
    ErrorCode.INSUFFICIENT_PERMISSIONS: "You don't have access to that.",
    ErrorCode.VALIDATION_ERROR:         "That value isn't quite right.",
    ErrorCode.NOT_FOUND:                "We couldn't find that.",
    ErrorCode.CONFLICT:                 "That conflicts with something already there.",
    ErrorCode.UPSTREAM_UNAVAILABLE:     "A service Ziggy depends on is unavailable.",
    ErrorCode.UPSTREAM_TIMEOUT:         "That took too long. Please try again.",
    ErrorCode.HA_UNAVAILABLE:           "Ziggy can't reach the home hub right now.",
    ErrorCode.HA_ENTITY_NOT_FOUND:      "That device isn't recognized.",
    ErrorCode.HA_SERVICE_FAILED:        "The home hub couldn't complete that action.",
    ErrorCode.HA_SERVICE_BLOCKED:       "That action isn't allowed from the app.",
    ErrorCode.DEVICE_UNAVAILABLE:       "That device is temporarily unavailable.",
    ErrorCode.DEVICE_COMMAND_FAILED:    "That action didn't go through.",
    ErrorCode.IR_BLASTER_UNREACHABLE:   "The remote blaster isn't responding.",
    ErrorCode.IR_LEARN_TIMEOUT:         "No remote signal was detected in time.",
    ErrorCode.IR_NOT_CONFIGURED:        "This remote isn't set up yet.",
    ErrorCode.PAIRING_FAILED:           "We couldn't finish pairing. Try again.",
    ErrorCode.PAIRING_TIMEOUT:          "Pairing timed out before the device joined.",
    ErrorCode.NOT_CONFIGURED:           "That feature isn't configured yet.",
    ErrorCode.FEATURE_DISABLED:         "That feature is turned off.",
}

# Default HTTP status per code. Routers can override per-raise when they
# truly need to. The defaults follow conventional REST mapping (4xx for
# client-correctable, 5xx for server-side / upstream).
DEFAULT_HTTP_STATUS: dict[str, int] = {
    ErrorCode.INTERNAL_ERROR:           500,
    ErrorCode.NOT_AUTHENTICATED:        401,
    ErrorCode.INSUFFICIENT_PERMISSIONS: 403,
    ErrorCode.VALIDATION_ERROR:         400,
    ErrorCode.NOT_FOUND:                404,
    ErrorCode.CONFLICT:                 409,
    ErrorCode.UPSTREAM_UNAVAILABLE:     502,
    ErrorCode.UPSTREAM_TIMEOUT:         504,
    ErrorCode.HA_UNAVAILABLE:           502,
    ErrorCode.HA_ENTITY_NOT_FOUND:      404,
    ErrorCode.HA_SERVICE_FAILED:        502,
    ErrorCode.HA_SERVICE_BLOCKED:       403,
    ErrorCode.DEVICE_UNAVAILABLE:       503,
    ErrorCode.DEVICE_COMMAND_FAILED:    502,
    ErrorCode.IR_BLASTER_UNREACHABLE:   503,
    ErrorCode.IR_LEARN_TIMEOUT:         504,
    ErrorCode.IR_NOT_CONFIGURED:        409,
    ErrorCode.PAIRING_FAILED:           502,
    ErrorCode.PAIRING_TIMEOUT:          504,
    ErrorCode.NOT_CONFIGURED:           409,
    ErrorCode.FEATURE_DISABLED:         409,
}


@dataclass
class ZiggyError(Exception):
    """The one exception type backend code should raise for expected failures.

    Fields
    ------
    code
        One of :class:`ErrorCode` — the machine identifier the frontend uses
        to look up a localized string and decide whether to retry.
    message
        Optional explicit user-facing override. If None, the handler falls
        back to :data:`DEFAULT_MESSAGES` for the code. Pass a string here only
        when the default isn't precise enough for the context (e.g. naming
        the specific device that failed). Never include raw exception text,
        Python class names, or stack info here — that goes in ``log_message``
        and ``details``.
    http_status
        Override the default HTTP status for this code. Rare — defaults are
        almost always right.
    log_message
        The full technical detail to write to logs. Include the exception's
        ``repr`` here; it never leaks to clients.
    details
        Structured data attached to the error. Returned to the client ONLY
        when the request is authenticated as admin AND carries the
        ``X-Ziggy-Debug: 1`` header (gating happens in the handler). Safe
        place to put exception class names, raw upstream text, traceback
        lines, etc.
    cause
        The original exception that triggered this error (if any). Stored on
        the instance so the handler can include its type in logs without the
        router having to format it manually.
    """

    code: str
    message: str | None = None
    http_status: int | None = None
    log_message: str | None = None
    details: dict[str, Any] = field(default_factory=dict)
    cause: BaseException | None = None

    def __post_init__(self) -> None:
        # Exception requires a string args tuple to render usefully in tracebacks.
        # Use the log_message when present (operator-facing) so `repr(err)` in a
        # log line includes the diagnostic context, not just the code.
        Exception.__init__(self, self.log_message or self.message or self.code)

    @property
    def public_message(self) -> str:
        return self.message or DEFAULT_MESSAGES.get(self.code, DEFAULT_MESSAGES[ErrorCode.INTERNAL_ERROR])

    @property
    def status_code(self) -> int:
        if self.http_status is not None:
            return self.http_status
        return DEFAULT_HTTP_STATUS.get(self.code, 500)


# ── Convenience constructors for the most common cases ─────────────────────

def ha_unavailable(cause: BaseException | None = None, *, details: dict[str, Any] | None = None) -> ZiggyError:
    return ZiggyError(
        code=ErrorCode.HA_UNAVAILABLE,
        log_message=f"HA unreachable: {type(cause).__name__}: {cause}" if cause else "HA unreachable",
        details=details or ({"cause": repr(cause)} if cause else {}),
        cause=cause,
    )


def entity_not_found(entity_id: str, *, cause: BaseException | None = None) -> ZiggyError:
    return ZiggyError(
        code=ErrorCode.HA_ENTITY_NOT_FOUND,
        message="We couldn't find that device.",
        log_message=f"Entity not found: {entity_id}",
        details={"entity_id": entity_id, "cause": repr(cause) if cause else None},
        cause=cause,
    )


def device_command_failed(entity_id: str, action: str, *, cause: BaseException | None = None,
                          message: str | None = None) -> ZiggyError:
    return ZiggyError(
        code=ErrorCode.DEVICE_COMMAND_FAILED,
        message=message,
        log_message=f"Device command failed: {entity_id} action={action}: {type(cause).__name__ if cause else ''}: {cause or ''}",
        details={"entity_id": entity_id, "action": action, "cause": repr(cause) if cause else None},
        cause=cause,
    )


def ir_blaster_unreachable(blaster_host: str | None = None, *, cause: BaseException | None = None) -> ZiggyError:
    return ZiggyError(
        code=ErrorCode.IR_BLASTER_UNREACHABLE,
        log_message=f"IR blaster unreachable host={blaster_host}: {cause}" if cause else f"IR blaster unreachable host={blaster_host}",
        details={"blaster_host": blaster_host, "cause": repr(cause) if cause else None},
        cause=cause,
    )


def pairing_failed(protocol: str, *, message: str | None = None,
                   cause: BaseException | None = None,
                   upstream_detail: str | None = None) -> ZiggyError:
    return ZiggyError(
        code=ErrorCode.PAIRING_FAILED,
        message=message,
        log_message=f"Pairing failed protocol={protocol}: {upstream_detail or cause or ''}",
        details={
            "protocol": protocol,
            "upstream_detail": upstream_detail,
            "cause": repr(cause) if cause else None,
        },
        cause=cause,
    )
