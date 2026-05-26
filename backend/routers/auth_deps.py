from __future__ import annotations

import hmac

from fastapi import Depends, HTTPException, Request

from core.settings_loader import settings

ROLE_ORDER: dict[str, int] = {"guest": 0, "user": 1, "admin": 2, "super_admin": 3}


def find_user_by_token(token: str) -> dict | None:
    if not token:
        return None
    # Primary: SQLite auth.db (post-migration, every user lives here).
    try:
        from services.auth_db import get_user_by_session_token
        u = get_user_by_session_token(token)
        if u:
            return u
    except Exception:
        # Defensive: if the DB is unreadable for any reason, fall through to
        # yaml so existing sessions never lock out the user mid-incident.
        pass
    # Fallback: legacy settings.yaml users[] block. Kept during the transition
    # so any pre-migration session token still resolves.
    for user in settings.get("users", []):
        # Check multi-session list first, fall back to legacy single token
        for stored in user.get("session_tokens", []):
            if stored and hmac.compare_digest(token, stored):
                return user
        stored = user.get("session_token", "")
        if stored and hmac.compare_digest(token, stored):
            return user
    return None


async def get_current_user(request: Request) -> dict:
    # Relay-authenticated request — trust injected user from middleware
    relay_user = getattr(request.state, "relay_user", None)
    if relay_user:
        # Mirror to request.state.user so the global error handler can read
        # role/permissions without needing to re-resolve the dependency.
        request.state.user = relay_user
        return relay_user

    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    user = find_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    # Stash on request.state so the error handler can gate admin-debug detail
    # without re-running token lookup.
    request.state.user = user
    return user


def require_role(min_role: str):
    min_level = ROLE_ORDER.get(min_role, 999)

    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if ROLE_ORDER.get(user.get("role", "user"), 0) < min_level:
            raise HTTPException(status_code=403, detail="Insufficient permissions.")
        return user

    return dep
