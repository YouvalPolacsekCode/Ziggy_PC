"""Password hashing primitives for the edge-agent auth.db store.

Mirrors relay/app/auth.py so the two surfaces produce identical bcrypt
output and can verify each other's hashes if ever needed.

Two algorithms live here:

  bcrypt        — the default for all new and rotated passwords.
                  Cost 12, embedded salt, 60-char output, $2b$ prefix.
  hmac_sha256   — legacy; verification-only. Pre-S5 rows used this. The
                  /login path verifies them and immediately rehashes to
                  bcrypt on success (see auth_router.login).

verify_password() is the single entry point for login dispatch; callers
pass the row's hash_algo and let this module pick the right backend.
"""

from __future__ import annotations

import hashlib
import hmac

from passlib.context import CryptContext

# Cost 12 is OWASP-2023 baseline — ~250 ms per hash on a modest VPS,
# slow enough that a leaked DB doesn't yield to a GPU-day, fast enough
# not to add visible login latency. Identical to the relay.
_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def hash_password_bcrypt(password: str) -> str:
    """Bcrypt hash for new or rotated passwords. Embeds its own salt."""
    return _pwd_ctx.hash(password)


def hash_password_hmac(password: str, salt: str) -> str:
    """Legacy HMAC-SHA256 hash, kept for migration helpers ONLY.

    Do NOT use for new passwords. Exists so existing yaml-migration code
    paths that still produce hmac_sha256 rows (e.g. test fixtures) have a
    single canonical implementation rather than ad-hoc hmac.new() calls
    scattered through the codebase.
    """
    return hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()


def verify_password(
    password: str,
    stored_hash: str,
    salt: str,
    hash_algo: str,
) -> bool:
    """Constant-time verification dispatched by hash_algo.

    Returns True iff `password` matches `stored_hash` under `hash_algo`.
    Unknown algorithms, empty hashes, and bcrypt internal errors all
    return False — never raise into the request handler.
    """
    if not stored_hash:
        return False
    if hash_algo == "bcrypt":
        try:
            return _pwd_ctx.verify(password, stored_hash)
        except Exception:
            return False
    # Legacy HMAC-SHA256. Defensive against missing salt rows.
    if not salt:
        return False
    expected = hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, stored_hash)
