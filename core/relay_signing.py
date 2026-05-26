"""Edge-agent side of the X-Ziggy-Signature scheme.

Mirror of relay/app/audit.py::sign — kept as a separate module so the
edge agent doesn't import from the relay package (different deploy
unit, different requirements). The wire format must stay identical to
the verifier on the relay or signatures will silently mismatch:

    X-Ziggy-Signature: t=<unix_ts>,v1=<hex(hmac_sha256(secret, "<ts>.<body>"))>

The body bytes used for signing MUST be the exact bytes posted on the
wire. Callers should serialize once and reuse the bytes for both the
hash and the POST content — let httpx send `content=<bytes>` rather
than re-encoding `json=<dict>`.
"""

from __future__ import annotations

import hashlib
import hmac
import time

# The single shared value that all pre-Task-2 hubs were configured with.
# An edge agent holding this value at startup is expected to call
# /api/homes/rotate-hub-secret once and persist the returned per-home
# secret to its secrets.yaml.
LEGACY_SHARED_SECRET = "ziggy-hub-primary-secret-2026"


def sign(secret: str, body: bytes, ts: int | None = None) -> str:
    if ts is None:
        ts = int(time.time())
    payload = f"{ts}.".encode("utf-8") + (body or b"")
    digest = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={digest}"
