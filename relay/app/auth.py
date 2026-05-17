from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone, timedelta

import jwt
from fastapi import HTTPException, Request

JWT_SECRET  = os.getenv("RELAY_JWT_SECRET", secrets.token_hex(32))
JWT_ALG     = "HS256"
JWT_EXPIRE_HOURS = 720  # 30 days


def hash_password(password: str, salt: str) -> str:
    return hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()


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
