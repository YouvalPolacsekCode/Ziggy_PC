from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.logger_module import log_info
from core.settings_loader import save_settings, settings
from .auth_deps import ROLE_ORDER, find_user_by_token, get_current_user, require_role

router = APIRouter()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_users() -> list[dict]:
    return settings.get("users", [])


def _save_users(users: list[dict]) -> None:
    settings["users"] = users
    save_settings(settings)


def _find_user(username: str) -> dict | None:
    for u in _get_users():
        if u.get("username", "").lower() == username.strip().lower():
            return u
    return None


def _hash_password(password: str, salt: str) -> str:
    return hmac.new(salt.encode(), password.encode(), hashlib.sha256).hexdigest()


def _migrate_legacy() -> None:
    """One-time migration: old single-user auth dict → users list."""
    if settings.get("users") is not None:
        return
    old = settings.get("auth", {})
    if not old.get("password_hash"):
        return
    salt = old.get("salt") or secrets.token_hex(16)
    user = {
        "username": old.get("username", "admin"),
        "password_hash": old.get("password_hash"),
        "salt": salt,
        "session_token": old.get("session_token") or secrets.token_hex(32),
        "role": "super_admin",
    }
    settings["users"] = [user]
    save_settings(settings)
    log_info("[Auth] Migrated legacy single-user auth to multi-user model.")


_migrate_legacy()

# ---------------------------------------------------------------------------
# Request bodies
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


class CreateUserBody(BaseModel):
    username: str
    password: str
    role: str = "user"


class UpdateUserBody(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

@router.get("/api/auth/status")
async def auth_status(request: Request):
    users = _get_users()
    configured = any(u.get("password_hash") for u in users)
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    user = find_user_by_token(token)
    return {
        "configured": configured,
        "username": user.get("username") if user else (users[0].get("username") if users else None),
        "role": user.get("role") if user else None,
    }


@router.post("/api/auth/setup")
async def setup(body: SetupBody):
    """First-time account setup — creates the super_admin owner account."""
    users = _get_users()
    if any(u.get("password_hash") for u in users):
        raise HTTPException(status_code=409, detail="Account already exists.")
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username required.")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    salt = secrets.token_hex(16)
    token = secrets.token_hex(32)
    user = {
        "username": body.username.strip(),
        "password_hash": _hash_password(body.password, salt),
        "salt": salt,
        "session_token": token,
        "role": "super_admin",
    }
    _save_users([user])
    log_info(f"[Auth] Account created for '{body.username}' (super_admin).")
    return {"token": token, "role": "super_admin"}


@router.post("/api/auth/login")
async def login(body: LoginBody):
    users = _get_users()
    if not users:
        token = secrets.token_hex(32)
        return {"token": token, "role": "super_admin"}

    user = _find_user(body.username)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    expected = _hash_password(body.password, user.get("salt", ""))
    if not hmac.compare_digest(expected, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    token = secrets.token_hex(32)
    user["session_token"] = token
    _save_users(users)
    role = user.get("role", "user")
    log_info(f"[Auth] Login: {body.username} ({role})")
    return {"token": token, "role": role}


# ---------------------------------------------------------------------------
# Authenticated endpoints
# ---------------------------------------------------------------------------

@router.post("/api/auth/change-password")
async def change_password(body: ChangePasswordBody, current: dict = Depends(get_current_user)):
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    users = _get_users()
    target_name = body.username.strip()
    if current["username"].lower() != target_name.lower():
        if ROLE_ORDER.get(current.get("role", "user"), 0) < ROLE_ORDER["super_admin"]:
            raise HTTPException(status_code=403, detail="Cannot change another user's password.")
    target = _find_user(target_name)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    salt = target.get("salt") or secrets.token_hex(16)
    target["salt"] = salt
    target["password_hash"] = _hash_password(body.password, salt)
    token = secrets.token_hex(32)
    target["session_token"] = token
    _save_users(users)
    log_info(f"[Auth] Password changed for '{target_name}'.")
    return {"token": token}


@router.post("/api/auth/logout")
async def logout(request: Request):
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    user = find_user_by_token(token)
    if user:
        users = _get_users()
        user["session_token"] = secrets.token_hex(32)
        _save_users(users)
    return {"ok": True}


# ---------------------------------------------------------------------------
# User management — super_admin only
# ---------------------------------------------------------------------------

@router.get("/api/auth/users")
async def list_users(_: dict = Depends(require_role("super_admin"))):
    return [
        {"username": u["username"], "role": u.get("role", "user")}
        for u in _get_users()
    ]


@router.post("/api/auth/users")
async def create_user(body: CreateUserBody, current: dict = Depends(require_role("super_admin"))):
    users = _get_users()
    if _find_user(body.username):
        raise HTTPException(status_code=409, detail="Username already exists.")
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username required.")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    if body.role not in ROLE_ORDER:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {list(ROLE_ORDER)}")
    if body.role == "super_admin" and current.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only super_admin can create super_admin accounts.")
    salt = secrets.token_hex(16)
    user = {
        "username": body.username.strip(),
        "password_hash": _hash_password(body.password, salt),
        "salt": salt,
        "session_token": secrets.token_hex(32),
        "role": body.role,
    }
    users.append(user)
    _save_users(users)
    log_info(f"[Auth] User created: '{body.username}' role={body.role}")
    return {"username": user["username"], "role": user["role"]}


@router.patch("/api/auth/users/{username}")
async def update_user(
    username: str,
    body: UpdateUserBody,
    current: dict = Depends(require_role("super_admin")),
):
    users = _get_users()
    target = _find_user(username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if body.role is not None:
        if body.role not in ROLE_ORDER:
            raise HTTPException(status_code=400, detail=f"Invalid role.")
        if target["username"].lower() == current["username"].lower():
            raise HTTPException(status_code=400, detail="Cannot change your own role.")
        target["role"] = body.role
    if body.password is not None:
        if len(body.password) < 4:
            raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
        salt = target.get("salt") or secrets.token_hex(16)
        target["salt"] = salt
        target["password_hash"] = _hash_password(body.password, salt)
        target["session_token"] = secrets.token_hex(32)
    _save_users(users)
    return {"username": target["username"], "role": target.get("role")}


@router.delete("/api/auth/users/{username}")
async def delete_user(username: str, current: dict = Depends(require_role("super_admin"))):
    users = _get_users()
    if current["username"].lower() == username.lower():
        raise HTTPException(status_code=400, detail="Cannot delete your own account.")
    new_users = [u for u in users if u.get("username", "").lower() != username.lower()]
    if len(new_users) == len(users):
        raise HTTPException(status_code=404, detail="User not found.")
    _save_users(new_users)
    log_info(f"[Auth] User deleted: '{username}'")
    return {"ok": True}
