from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.params import Depends
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user, require_role, ROLE_ORDER
from core.logger_module import log_info
from core.settings_loader import settings, save_settings

router = APIRouter()

_STORE = Path(__file__).resolve().parents[2] / "user_files" / "invites.json"
_INVITE_TTL_HOURS = 72


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _load() -> list[dict]:
    try:
        return json.loads(_STORE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except Exception:
        return []


def _save(invites: list[dict]) -> None:
    _STORE.parent.mkdir(parents=True, exist_ok=True)
    _STORE.write_text(json.dumps(invites, indent=2, ensure_ascii=False), encoding="utf-8")


def _find(token: str) -> dict | None:
    return next((i for i in _load() if i["token"] == token), None)


def _is_expired(invite: dict) -> bool:
    try:
        exp = datetime.fromisoformat(invite["expires_at"])
        return datetime.now(timezone.utc) > exp
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class CreateInviteBody(BaseModel):
    email: Optional[str] = None
    role: str = "user"
    type: str = "user"          # "user" | "home"
    note: Optional[str] = None  # optional display label for home invites
    public_url: Optional[str] = None  # frontend passes window.location.origin


class AcceptInviteBody(BaseModel):
    email: str
    password: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _home_meta() -> dict:
    h = settings.get("home", {})
    return {
        "id":   h.get("id", "home-ziggy-primary"),
        "name": h.get("name", "Home"),
        "type": h.get("type", "hub"),
    }


def _get_users() -> list[dict]:
    return settings.get("users", [])


def _save_users(users: list[dict]) -> None:
    settings["users"] = users
    save_settings(settings)


# ---------------------------------------------------------------------------
# Protected endpoints (super_admin)
# ---------------------------------------------------------------------------

@router.post("/api/auth/invites")
async def create_invite(body: CreateInviteBody, current: dict = Depends(require_role("super_admin"))):
    if body.type not in ("user", "home"):
        raise HTTPException(400, "type must be 'user' or 'home'")
    if body.role not in ROLE_ORDER:
        raise HTTPException(400, f"Invalid role. Choose from: {list(ROLE_ORDER)}")
    if body.type == "home" and body.role not in ("super_admin", "admin"):
        raise HTTPException(400, "Home invites must use 'admin' or 'super_admin' role.")

    home = _home_meta()
    now  = datetime.now(timezone.utc)
    inv  = {
        "token":       secrets.token_urlsafe(32),
        "type":        body.type,
        "email":       (body.email or "").strip().lower() or None,
        "role":        body.role,
        "home_id":     home["id"],
        "home_name":   body.note or home["name"],
        "invited_by":  current["username"],
        "created_at":  now.isoformat(),
        "expires_at":  (now + timedelta(hours=_INVITE_TTL_HOURS)).isoformat(),
        "accepted":    False,
        "accepted_at": None,
        "accepted_by": None,
    }
    invites = _load()
    invites.append(inv)
    _save(invites)
    log_info(f"[Invite] Created {body.type} invite for {body.email or '(open)'} by {current['username']}")

    token_path = f"/invite/{inv['token']}"
    # Use the public_url supplied by the frontend (window.location.origin) so the
    # email contains a clickable absolute URL, not a bare path.
    base = (body.public_url or "").rstrip("/")
    invite_url = f"{base}{token_path}" if base else token_path
    email_sent = False
    email_error = None

    # Try to send email if an address was provided
    if inv["email"]:
        try:
            from services.email_sender import send_user_invite, send_home_invite, is_configured
            if is_configured():
                if body.type == "home":
                    ok, err = send_home_invite(
                        to=inv["email"],
                        home_label=inv["home_name"],
                        invited_by=current["username"],
                        invite_url=invite_url,
                    )
                else:
                    ok, err = send_user_invite(
                        to=inv["email"],
                        home_name=inv["home_name"],
                        invited_by=current["username"],
                        invite_url=invite_url,
                        role=inv["role"],
                    )
                email_sent = ok
                email_error = err
            else:
                email_error = "Email not configured — share the link manually."
        except Exception as e:
            email_error = str(e)

    return {**inv, "invite_url": token_path, "email_sent": email_sent, "email_error": email_error}


@router.get("/api/auth/invites")
async def list_invites(_: dict = Depends(require_role("super_admin"))):
    now = datetime.now(timezone.utc)
    result = []
    for inv in _load():
        try:
            exp = datetime.fromisoformat(inv["expires_at"])
            status = "accepted" if inv["accepted"] else ("expired" if now > exp else "pending")
        except Exception:
            status = "unknown"
        result.append({**inv, "status": status})
    return result


@router.delete("/api/auth/invites/{token}")
async def revoke_invite(token: str, _: dict = Depends(require_role("super_admin"))):
    invites = _load()
    new_list = [i for i in invites if i["token"] != token]
    if len(new_list) == len(invites):
        raise HTTPException(404, "Invite not found.")
    _save(new_list)
    log_info(f"[Invite] Revoked invite {token[:12]}…")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Public endpoints (no auth — used from the accept page)
# ---------------------------------------------------------------------------

@router.get("/api/auth/invite/{token}")
async def get_invite(token: str):
    inv = _find(token)
    if not inv:
        raise HTTPException(404, "Invite not found or already used.")
    if inv["accepted"]:
        raise HTTPException(410, "This invite has already been accepted.")
    if _is_expired(inv):
        raise HTTPException(410, "This invite has expired.")
    return {
        "type":       inv["type"],
        "email":      inv["email"],
        "role":       inv["role"],
        "home_name":  inv["home_name"],
        "invited_by": inv["invited_by"],
        "expires_at": inv["expires_at"],
    }


@router.post("/api/auth/invite/{token}/accept")
async def accept_invite(token: str, body: AcceptInviteBody):
    invites = _load()
    inv = next((i for i in invites if i["token"] == token), None)
    if not inv:
        raise HTTPException(404, "Invite not found.")
    if inv["accepted"]:
        raise HTTPException(410, "This invite has already been accepted.")
    if _is_expired(inv):
        raise HTTPException(410, "This invite has expired.")

    email = body.email.strip().lower()
    if not email:
        raise HTTPException(400, "Email is required.")
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")

    # Check email not already taken
    users = _get_users()
    if any(u.get("username", "").lower() == email for u in users):
        raise HTTPException(409, "An account with this email already exists.")

    import hashlib
    import hmac
    salt  = secrets.token_hex(16)
    phash = hmac.new(salt.encode(), body.password.encode(), hashlib.sha256).hexdigest()
    tok   = secrets.token_hex(32)

    new_user = {
        "username":      email,
        "password_hash": phash,
        "salt":          salt,
        "session_token": tok,
        "role":          inv["role"],
    }
    users.append(new_user)
    _save_users(users)

    # Mark invite consumed
    inv["accepted"]    = True
    inv["accepted_at"] = datetime.now(timezone.utc).isoformat()
    inv["accepted_by"] = email
    _save(invites)

    log_info(f"[Invite] Accepted by {email} (role={inv['role']}, type={inv['type']})")
    return {"token": tok, "role": inv["role"], "username": email}
