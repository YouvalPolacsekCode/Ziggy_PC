from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone, timedelta

import jwt
from fastapi import HTTPException, Request
from passlib.context import CryptContext

JWT_SECRET  = os.getenv("RELAY_JWT_SECRET", secrets.token_hex(32))
JWT_ALG     = "HS256"
JWT_EXPIRE_HOURS = 720  # 30 days

# Single bcrypt context for new/rotated passwords. Cost 12 is the OWASP-2023
# baseline — ~250 ms per hash on a modest VPS, slow enough that the leaked
# DB doesn't yield to a single GPU-day, fast enough not to add visible
# login latency. Schemes list contains only bcrypt; legacy HMAC verification
# stays in this module under its own helper so it can be removed later.
_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)


def hash_password(password: str, salt: str) -> str:
    """Legacy HMAC-SHA256 hash, kept for backward-compat verification only.

    DO NOT use for new passwords — call hash_password_bcrypt() instead. The
    /login path verifies a legacy row with this function and immediately
    re-hashes it with bcrypt on success (transparent migration).
    """
    return hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()


def hash_password_bcrypt(password: str) -> str:
    """Bcrypt hash for new/rotated passwords. Cost 12; embedded salt."""
    return _pwd_ctx.hash(password)


def verify_password(
    password: str,
    stored_hash: str,
    salt: str,
    hash_algo: str,
) -> bool:
    """Constant-time verification across both algorithms.

    Returns True iff `password` matches the stored hash under the given
    algorithm. Unknown algorithms return False — never raise into the
    request handler.
    """
    if not stored_hash:
        return False
    if hash_algo == "bcrypt":
        try:
            return _pwd_ctx.verify(password, stored_hash)
        except Exception:
            return False
    # Legacy HMAC-SHA256. Same as hash_password() above but defensive against
    # missing salt rows.
    if not salt:
        return False
    expected = hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, stored_hash)


def new_salt() -> str:
    return secrets.token_hex(16)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def new_id() -> str:
    return secrets.token_hex(8)


def issue_jwt(user_id: str, email: str, role: str, home_id: str | None) -> str:
    payload = {
        "sub":     user_id,
        "email":   email,
        "role":    role,
        "home_id": home_id,
        "exp":     datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired.")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token.")


def bearer_token(request: Request) -> str:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing Bearer token.")
    return auth.removeprefix("Bearer ").strip()


def current_user(request: Request) -> dict:
    return decode_jwt(bearer_token(request))


ROLE_ORDER = {"guest": 0, "user": 1, "admin": 2, "super_admin": 3, "relay_admin": 9}


def require_role(min_role: str):
    min_level = ROLE_ORDER.get(min_role, 999)

    def dep(request: Request) -> dict:
        user = current_user(request)
        if ROLE_ORDER.get(user.get("role", "user"), 0) < min_level:
            raise HTTPException(403, "Insufficient permissions.")
        return user

    return dep
