from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from core.logger_module import log_info
from core.settings_loader import save_settings, settings
from services import auth_db
from services.auth_hashing import hash_password_bcrypt, verify_password
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


def _ensure_user_in_db(yaml_user: dict) -> Optional[int]:
    """Lazily migrate a yaml-only user into auth.db on first successful login.
    Returns the user_id, or None if migration was skipped (no password_hash).
    """
    username = (yaml_user.get("username") or "").strip()
    if not username:
        return None
    existing = auth_db.get_user_by_username(username)
    if existing:
        return existing["id"]
    if not yaml_user.get("password_hash"):
        return None
    return auth_db.create_user(
        username,
        yaml_user["password_hash"],
        yaml_user.get("salt", ""),
        yaml_user.get("role", "user"),
        "hmac_sha256",
    )


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
    # DB is the source of truth post-migration; yaml fallback covers a fresh
    # boot where the migration hasn't run yet.
    db_users = auth_db.list_users()
    yaml_users = _get_users()
    configured = bool(db_users) or any(u.get("password_hash") for u in yaml_users)
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    user = find_user_by_token(token)
    if token and not user and configured:
        raise HTTPException(status_code=401, detail="Session expired. Please log in again.")
    fallback_username = (
        db_users[0]["username"] if db_users
        else (yaml_users[0].get("username") if yaml_users else None)
    )
    return {
        "configured": configured,
        "username": user.get("username") if user else fallback_username,
        "role": user.get("role") if user else None,
    }


@router.post("/api/auth/setup")
async def setup(body: SetupBody):
    """First-time account setup — creates the super_admin owner account."""
    if auth_db.has_any_user() or any(u.get("password_hash") for u in _get_users()):
        raise HTTPException(status_code=409, detail="Account already exists.")
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username required.")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    token = secrets.token_hex(32)
    user_id = auth_db.create_user(
        username=body.username.strip(),
        password_hash=hash_password_bcrypt(body.password),
        salt="",
        role="super_admin",
        hash_algo="bcrypt",
    )
    auth_db.add_session(user_id, token)
    log_info(f"[Auth] Account created for '{body.username}' (super_admin).")
    return {"token": token, "role": "super_admin"}


@router.post("/api/auth/login")
async def login(body: LoginBody):
    # Empty-fleet first-boot UX: return a placeholder token so the FE can
    # immediately call /api/auth/setup without a separate prompt.
    if not auth_db.has_any_user() and not _get_users():
        token = secrets.token_hex(32)
        return {"token": token, "role": "super_admin"}

    # Find user: DB first (post-migration source of truth), yaml fallback.
    db_user = auth_db.get_user_by_username(body.username)
    yaml_user = None if db_user else _find_user(body.username)
    user = db_user or yaml_user
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    algo = user.get("hash_algo") or "hmac_sha256"
    if not verify_password(body.password, user["password_hash"], user.get("salt", ""), algo):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    # Lazy-migrate any yaml-only user so subsequent sessions live in DB.
    user_id = user.get("id")
    if user_id is None:
        user_id = _ensure_user_in_db(user)

    token = secrets.token_hex(32)
    if user_id is not None:
        auth_db.add_session(user_id, token)
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
    target_name = body.username.strip()
    if current["username"].lower() != target_name.lower():
        if ROLE_ORDER.get(current.get("role", "user"), 0) < ROLE_ORDER["super_admin"]:
            raise HTTPException(status_code=403, detail="Cannot change another user's password.")

    target = auth_db.get_user_by_username(target_name) or _find_user(target_name)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    # Lazy-migrate yaml-only target so the new password lives in DB.
    user_id = target.get("id")
    if user_id is None:
        user_id = _ensure_user_in_db(target)

    new_hash = hash_password_bcrypt(body.password)
    token = secrets.token_hex(32)

    if user_id is not None:
        auth_db.update_user_password(target_name, new_hash, "", "bcrypt")
        auth_db.add_session(user_id, token)
    log_info(f"[Auth] Password changed for '{target_name}'.")
    return {"token": token}


@router.post("/api/auth/logout")
async def logout(request: Request):
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if token:
        auth_db.remove_session(token)
    return {"ok": True}


# ---------------------------------------------------------------------------
# User management — super_admin only
# ---------------------------------------------------------------------------

@router.get("/api/auth/users")
async def list_users(_: dict = Depends(require_role("super_admin"))):
    db_rows = auth_db.list_users()
    if db_rows:
        return [{"username": r["username"], "role": r.get("role", "user")} for r in db_rows]
    # Pre-migration fallback only.
    return [
        {"username": u["username"], "role": u.get("role", "user")}
        for u in _get_users()
    ]


@router.post("/api/auth/users")
async def create_user(body: CreateUserBody, current: dict = Depends(require_role("super_admin"))):
    if auth_db.get_user_by_username(body.username) or _find_user(body.username):
        raise HTTPException(status_code=409, detail="Username already exists.")
    if not body.username.strip():
        raise HTTPException(status_code=400, detail="Username required.")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    if body.role not in ROLE_ORDER:
        raise HTTPException(status_code=400, detail=f"Invalid role. Choose from: {list(ROLE_ORDER)}")
    if body.role == "super_admin" and current.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only super_admin can create super_admin accounts.")
    auth_db.create_user(
        username=body.username.strip(),
        password_hash=hash_password_bcrypt(body.password),
        salt="",
        role=body.role,
        hash_algo="bcrypt",
    )
    log_info(f"[Auth] User created: '{body.username}' role={body.role}")
    return {"username": body.username.strip(), "role": body.role}


@router.patch("/api/auth/users/{username}")
async def update_user(
    username: str,
    body: UpdateUserBody,
    current: dict = Depends(require_role("super_admin")),
):
    target = auth_db.get_user_by_username(username) or _find_user(username)
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    # Lazy-migrate yaml-only target so changes land in DB.
    user_id = target.get("id")
    if user_id is None:
        user_id = _ensure_user_in_db(target)

    if body.role is not None:
        if body.role not in ROLE_ORDER:
            raise HTTPException(status_code=400, detail=f"Invalid role.")
        if target["username"].lower() == current["username"].lower():
            raise HTTPException(status_code=400, detail="Cannot change your own role.")
        if user_id is not None:
            auth_db.update_user_role(target["username"], body.role)
    if body.password is not None:
        if len(body.password) < 4:
            raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
        new_hash = hash_password_bcrypt(body.password)
        if user_id is not None:
            auth_db.update_user_password(target["username"], new_hash, "", "bcrypt")
    # Return the final state.
    refreshed = auth_db.get_user_by_username(target["username"]) or {}
    return {
        "username": refreshed.get("username", target["username"]),
        "role":     refreshed.get("role", body.role or target.get("role")),
    }


@router.delete("/api/auth/users/{username}")
async def delete_user(username: str, current: dict = Depends(require_role("super_admin"))):
    if current["username"].lower() == username.lower():
        raise HTTPException(status_code=400, detail="Cannot delete your own account.")
    deleted = auth_db.delete_user(username)
    if not deleted:
        # Fall back: was the user only in yaml? Treat as not-found to match prior
        # 404 behavior — yaml-only writes are no longer supported here.
        if not _find_user(username):
            raise HTTPException(status_code=404, detail="User not found.")
    log_info(f"[Auth] User deleted: '{username}'")
    return {"ok": True}
