"""Settings → External assistants: mint / list / revoke MCP bearer tokens.

GET    /api/external-tokens        → {"tokens": [...], "mcp_url": "<tunnel>/mcp" | null}
POST   /api/external-tokens {name} → {"id", "name", "token", "mcp_url"}  (token shown ONCE)
DELETE /api/external-tokens/{id}   → {"ok": true}   (own tokens only)

The token itself is only ever in the POST response; the list shows names,
timestamps and revocation state. See services/external_tokens.py.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user
from core.settings_loader import settings
from services import external_tokens

router = APIRouter()


class MintBody(BaseModel):
    name: str = ""


def mcp_url() -> str | None:
    """The address an outside assistant should use for /mcp.

    Precedence: an explicit `relay.public_url` in settings → the public
    address the relay sent in the OTA manifest (homes.public_hostname, cached
    by services/entitlements) → the raw tunnel url (last resort: it is not
    publicly routable, but it is honest about what exists) → None.
    """
    relay = settings.get("relay") or {}
    base = (relay.get("public_url") or "").strip()
    if not base:
        try:
            from services import entitlements
            base = entitlements.public_url() or ""
        except Exception:
            base = ""
    if not base:
        base = (relay.get("tunnel_url") or "").strip()
    if not base:
        return None
    return base.rstrip("/") + "/mcp"


def _username(user: dict) -> str:
    name = (user or {}).get("username") or ""
    if not name or str(name).startswith("tablet:"):
        # A wall tablet has no person behind it; it must not mint tokens that
        # would let an external agent act as "the tablet".
        raise HTTPException(status_code=403, detail="Sign in as a person to manage external assistants.")
    return str(name)


@router.get("/api/external-tokens")
async def list_tokens(user: dict = Depends(get_current_user)):
    username = _username(user)
    return {"tokens": external_tokens.list_for(username), "mcp_url": mcp_url()}


@router.post("/api/external-tokens")
async def mint_token(body: MintBody, user: dict = Depends(get_current_user)):
    username = _username(user)
    minted = external_tokens.mint(username, body.name)
    return {**minted, "mcp_url": mcp_url()}


@router.delete("/api/external-tokens/{token_id}")
async def revoke_token(token_id: int, user: dict = Depends(get_current_user)):
    username = _username(user)
    if not external_tokens.revoke(username, token_id):
        raise HTTPException(status_code=404, detail="No such token.")
    return {"ok": True, "id": token_id}
