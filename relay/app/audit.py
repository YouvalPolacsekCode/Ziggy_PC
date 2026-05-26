"""Audit log writer + HMAC signature verification for hub ↔ relay traffic.

Schema lives in database.py (audit_log table).
Signature scheme matches Slack/Stripe shape:

    X-Ziggy-Signature: t=<unix_ts>,v1=<hex(hmac_sha256(secret, t.body))>

A 5-minute clock skew window is enforced (timestamp must be within 300 s of
server now). All comparisons use constant-time hmac.compare_digest.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from datetime import datetime, timezone
from typing import Optional

from .database import get_db


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

async def log_event(
    event: str,
    *,
    home_id: Optional[str] = None,
    source_ip: Optional[str] = None,
    ok: bool = True,
    detail: Optional[str] = None,
) -> None:
    """Insert one row into audit_log. Best-effort; never raises."""
    try:
        async with get_db() as db:
            await db.execute(
                """INSERT INTO audit_log (ts, event, home_id, source_ip, ok, detail)
                   VALUES (?,?,?,?,?,?)""",
                (
                    datetime.now(timezone.utc).isoformat(),
                    event,
                    home_id,
                    source_ip,
                    1 if ok else 0,
                    detail,
                ),
            )
            await db.commit()
    except Exception:
        # Audit logging must never break the request path.
        pass


# ---------------------------------------------------------------------------
# HMAC signing / verification
# ---------------------------------------------------------------------------

SIGNATURE_WINDOW_S = 300  # 5 minutes; matches Slack and Stripe conventions.


def _parse_signature_header(header: str) -> tuple[Optional[int], Optional[str]]:
    """Parse `t=<ts>,v1=<hex>`. Returns (ts, v1_hex) or (None, None)."""
    if not header:
        return None, None
    ts: Optional[int] = None
    v1: Optional[str] = None
    for piece in header.split(","):
        piece = piece.strip()
        if piece.startswith("t="):
            try:
                ts = int(piece[2:])
            except ValueError:
                return None, None
        elif piece.startswith("v1="):
            v1 = piece[3:].strip()
    return ts, v1


def sign(secret: str, body: bytes, ts: Optional[int] = None) -> str:
    """Produce a signature header value for outgoing requests.

    Used by the edge-agent side; included here so the verify routine and
    its mirror image live in one file and can't drift.
    """
    if ts is None:
        ts = int(time.time())
    payload = f"{ts}.".encode("utf-8") + (body or b"")
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={digest}"


def verify(secret: str, body: bytes, header: str) -> tuple[bool, str]:
    """Verify an X-Ziggy-Signature header. Returns (ok, reason_if_not_ok)."""
    if not secret:
        return False, "no_secret_on_record"
    ts, v1 = _parse_signature_header(header)
    if ts is None or v1 is None:
        return False, "missing_or_malformed_signature"
    now = int(time.time())
    if abs(now - ts) > SIGNATURE_WINDOW_S:
        return False, "timestamp_outside_window"
    payload = f"{ts}.".encode("utf-8") + (body or b"")
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, v1):
        return False, "signature_mismatch"
    return True, ""
