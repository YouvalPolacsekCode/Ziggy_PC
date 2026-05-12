from __future__ import annotations

import hashlib
import hmac
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from core.logger_module import log_info
from core.settings_loader import settings, save_settings

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash_password(password: str) -> str:
    salt = _get_salt()
    return hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()

def _get_salt() -> str:
    salt = settings.get("auth", {}).get("salt")
    if not salt:
        salt = secrets.token_hex(16)
        _patch("salt", salt)
    return salt

def _get_stored_hash() -> str | None:
    return settings.get("auth", {}).get("password_hash")

def _get_username() -> str | None:
    return settings.get("auth", {}).get("username")

def _get_token() -> str | None:
    return settings.get("auth", {}).get("session_token")

def _patch(key: str, value: str) -> None:
    if "auth" not in settings:
        settings["auth"] = {}
    settings["auth"][key] = value
    try:
        save_settings(settings)
    except Exception:
        pass

def verify_token(token: str) -> bool:
    stored = _get_token()
    if not stored:
        return False
    return hmac.compare_digest(token, stored)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class SetupBody(BaseModel):
    username: str
    password: str

class LoginBody(BaseModel):
    username: str
    password: str

class ChangePasswordBody(BaseModel):
    username: str
    password: str


@router.get("/api/auth/status")
async def auth_status():
    return {
        "configured": _get_stored_hash() is not None,
        "username": _get_username(),
    }


@router.post("/api/auth/setup")
async def setup(body: SetupBody):
    """First-time account setup. Only works when no account exists."""
    if _get_stored_hash():
        raise HTTPException(status_code=409, detail="Account already exists.")
    if len(body.username.strip()) < 1:
        raise HTTPException(status_code=400, detail="Username required.")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    _patch("username", body.username.strip())
    _patch("password_hash", _hash_password(body.password))
    token = secrets.token_hex(32)
    _patch("session_token", token)
    log_info(f"[Auth] Account created for '{body.username}'.")
    return {"token": token}


@router.post("/api/auth/login")
async def login(body: LoginBody):
    stored_hash = _get_stored_hash()
    if not stored_hash:
        # No account yet — auto-login so the app loads normally
        token = _get_token() or secrets.token_hex(32)
        _patch("session_token", token)
        return {"token": token}
    stored_user = _get_username() or ""
    if body.username.strip().lower() != stored_user.lower():
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    if not hmac.compare_digest(_hash_password(body.password), stored_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    token = secrets.token_hex(32)
    _patch("session_token", token)
    log_info(f"[Auth] Login: {body.username}")
    return {"token": token}


@router.post("/api/auth/change-password")
async def change_password(request: Request, body: ChangePasswordBody):
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if not verify_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated.")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    _patch("username", body.username.strip())
    _patch("password_hash", _hash_password(body.password))
    new_token = secrets.token_hex(32)
    _patch("session_token", new_token)
    log_info("[Auth] Password changed.")
    return {"token": new_token}


@router.post("/api/auth/logout")
async def logout(request: Request):
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if verify_token(token):
        _patch("session_token", secrets.token_hex(32))
    return {"ok": True}
