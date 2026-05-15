from __future__ import annotations

import hmac

from fastapi import Depends, HTTPException, Request

from core.settings_loader import settings

ROLE_ORDER: dict[str, int] = {"guest": 0, "user": 1, "admin": 2, "super_admin": 3}


def find_user_by_token(token: str) -> dict | None:
    if not token:
        return None
    for user in settings.get("users", []):
        stored = user.get("session_token", "")
        if stored and hmac.compare_digest(token, stored):
            return user
    return None


async def get_current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    user = find_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return user


def require_role(min_role: str):
    min_level = ROLE_ORDER.get(min_role, 999)

    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if ROLE_ORDER.get(user.get("role", "user"), 0) < min_level:
            raise HTTPException(status_code=403, detail="Insufficient permissions.")
        return user

    return dep
