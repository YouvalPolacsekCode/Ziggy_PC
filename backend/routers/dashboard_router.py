"""Hub Dashboard API.

Scope: tablet-only `/hub` route. None of these endpoints are called by the
existing Dashboard, mobile, or web flows — they only matter to tablets that
have been paired through `/api/dashboard/tablets/pair-code` + `/claim`.

Endpoints:
    GET    /api/dashboard/layout                       — resolve active layout for a tablet
    PUT    /api/dashboard/layout                       — save a tablet-scoped layout (edit mode)
    GET    /api/dashboard/tablets                      — admin: list paired tablets
    POST   /api/dashboard/tablets/pair-code            — admin: mint a one-shot 6-digit code
    POST   /api/dashboard/tablets/claim                — tablet: redeem a code → tablet_id
    PATCH  /api/dashboard/tablets/{tablet_id}          — admin: rename / move
    DELETE /api/dashboard/tablets/{tablet_id}          — admin: un-pair (also drops layouts)
    POST   /api/dashboard/tablets/{tablet_id}/heartbeat — tablet: bump last_seen
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user, require_role
from core.debug_bus import bus as _bus, BASIC, VERBOSE
from services import dashboard_layouts as layouts
from services import dashboard_tablets as tablets

router = APIRouter()


# ---------------------------------------------------------------------------
# Layout — read by every Hub page-load, written when the user edits.
# ---------------------------------------------------------------------------

class LayoutSaveBody(BaseModel):
    tablet_id: str
    layout:    dict
    mode:      Optional[str] = None


@router.get("/api/dashboard/layout")
async def get_layout(
    tablet_id: Optional[str] = None,
    mode: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Return the active layout for this tablet.

    `tablet_id` is optional so unpaired devices visiting /hub still see the
    default layout (good for first-run / demo). Paired tablets get their
    tablet-scoped layout if one was saved, otherwise the same default.
    """
    if tablet_id:
        await tablets.touch_tablet(tablet_id)
    layout = await layouts.get_active_layout(tablet_id, mode)
    return {"layout": layout, "tablet_id": tablet_id}


@router.put("/api/dashboard/layout")
async def put_layout(body: LayoutSaveBody, user: dict = Depends(get_current_user)):
    if not body.tablet_id:
        raise HTTPException(status_code=400, detail="tablet_id is required to save a layout.")
    tab = await tablets.get_tablet(body.tablet_id)
    if not tab:
        raise HTTPException(status_code=404, detail="Unknown tablet — pair it first.")
    try:
        saved = await layouts.save_layout(body.tablet_id, body.layout)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _bus.emit("settings", VERBOSE, "dashboard_layout_saved",
              tablet_id=body.tablet_id, section_count=len(saved["sections"]))
    return {"layout": saved}


# ---------------------------------------------------------------------------
# Tablets — admin lifecycle + pairing flow.
# ---------------------------------------------------------------------------

class PairCodeBody(BaseModel):
    display_name_hint: Optional[str] = ""


class ClaimBody(BaseModel):
    code:         str
    display_name: Optional[str] = ""
    room:         Optional[str] = None


class TabletPatchBody(BaseModel):
    display_name: Optional[str] = None
    room:         Optional[str] = None


@router.get("/api/dashboard/tablets")
async def list_paired_tablets(user: dict = Depends(require_role("admin"))):
    return {"tablets": await tablets.list_tablets()}


@router.post("/api/dashboard/tablets/pair-code")
async def mint_pair_code(body: PairCodeBody, user: dict = Depends(require_role("admin"))):
    issued = tablets.create_pairing_code(
        created_by=user.get("username", "?"),
        display_name_hint=body.display_name_hint or "",
    )
    _bus.emit("settings", BASIC, "tablet_pair_code_minted",
              created_by=user.get("username", "?"),
              ttl_s=issued["ttl_s"])
    return issued


@router.post("/api/dashboard/tablets/claim")
async def claim_pair_code(
    body: ClaimBody,
    request: Request,
    user: dict = Depends(get_current_user),
):
    """Tablet redeems a one-shot code. The tablet stores the returned
    tablet_id in localStorage and uses it for every future Hub request.

    Rate-limited per client (IP fallback when username isn't useful) so the
    6-digit code can't be brute-forced — see services/dashboard_tablets.py.
    """
    client_key = f"u:{user.get('username') or 'anon'}|ip:{request.client.host if request.client else '?'}"
    try:
        result = await tablets.claim_pairing_code(
            code=body.code,
            display_name=body.display_name or "",
            room=body.room,
            claiming_user=user.get("username", "?"),
            client_key=client_key,
        )
    except PermissionError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _bus.emit("settings", BASIC, "tablet_paired",
              tablet_id=result["tablet_id"], display_name=result["display_name"],
              by=user.get("username", "?"))
    return result


@router.patch("/api/dashboard/tablets/{tablet_id}")
async def patch_tablet(
    tablet_id: str,
    body: TabletPatchBody,
    user: dict = Depends(require_role("admin")),
):
    updated = await tablets.rename_tablet(tablet_id, body.display_name or "", body.room)
    if not updated:
        raise HTTPException(status_code=404, detail="Unknown tablet.")
    return updated


@router.delete("/api/dashboard/tablets/{tablet_id}")
async def remove_tablet(tablet_id: str, user: dict = Depends(require_role("admin"))):
    """Un-pair a tablet and drop any layouts tied to it. The tablet itself
    won't know it's been un-paired until its next request returns 404."""
    ok = await tablets.delete_tablet(tablet_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Unknown tablet.")
    await layouts.delete_layouts_for_tablet(tablet_id)
    _bus.emit("settings", BASIC, "tablet_unpaired",
              tablet_id=tablet_id, by=user.get("username", "?"))
    return {"ok": True}


@router.post("/api/dashboard/tablets/{tablet_id}/heartbeat")
async def heartbeat(tablet_id: str, user: dict = Depends(get_current_user)):
    """Lightweight ping so the admin UI can show last-seen times. No body."""
    tab = await tablets.get_tablet(tablet_id)
    if not tab:
        raise HTTPException(status_code=404, detail="Unknown tablet.")
    await tablets.touch_tablet(tablet_id)
    return {"ok": True}
