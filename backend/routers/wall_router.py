"""Wall dashboard API.

ADDITIVE: every endpoint here is new and lives under /api/wall, /api/lists, or
/api/agenda. None of the existing /api/dashboard/* endpoints that back the
older /hub route are touched, and no existing storage file is read or written.

Note on pairing: `backend/routers/dashboard_router.py` exists in the tree but
is never registered in `backend/server.py`, so every /api/dashboard/* path is
a 404 today and the older /hub page cannot pair, heartbeat, or load a layout.
Rather than modify that router (which would change existing behaviour), the
wall exposes its own pairing endpoints here that call the same well-built
`services/dashboard_tablets` functions — one-shot 6-digit codes, 5-minute TTL,
per-client rate limiting, constant-time compare — with that service unchanged.

Endpoints:
    GET    /api/wall/layout                     resolve this tablet's layout
    PUT    /api/wall/layout                     save it (edit mode "Done")
    GET    /api/wall/tablets                    admin: list paired tablets
    POST   /api/wall/tablets/pair-code          admin: mint a one-shot code
    POST   /api/wall/tablets/claim              tablet: redeem code -> tablet_id
    PATCH  /api/wall/tablets/{tablet_id}        admin: rename / move
    DELETE /api/wall/tablets/{tablet_id}        admin: un-pair
    POST   /api/wall/tablets/{tablet_id}/heartbeat
    GET    /api/wall/policy                     this tablet's capability policy
    PUT    /api/wall/policy                     admin: set capabilities
    POST   /api/wall/policy/pin                 admin: set / clear the PIN
    POST   /api/wall/pin/verify                 tablet: redeem a PIN for elevation
    POST   /api/wall/idle                       tablet: went idle -> drop elevation

    GET    /api/lists                           all household lists
    POST   /api/lists                           create a list
    DELETE /api/lists/{list_id}
    POST   /api/lists/{list_id}/items           add item        -> ws list_changed
    PATCH  /api/lists/{list_id}/items/{item_id} toggle / rename -> ws list_changed
    DELETE /api/lists/{list_id}/items/{item_id}                 -> ws list_changed
    POST   /api/lists/{list_id}/clear-done                      -> ws list_changed

    GET    /api/agenda                          events for the next N days
    POST   /api/agenda                          create          -> ws agenda_changed
    PATCH  /api/agenda/{event_id}                               -> ws agenda_changed
    DELETE /api/agenda/{event_id}                               -> ws agenda_changed

Every mutation broadcasts, so the wall tablet, both phones and any other
browser tab converge without polling. That is the whole point of putting these
lists on the hub instead of in a tablet's local storage.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user, require_role
from backend.ws_manager import manager
from services import dashboard_tablets as tablets
from services import wall_layouts as layouts
from services import wall_lists as lists
from services import wall_policy as policy

router = APIRouter()


async def _broadcast(payload: dict) -> None:
    """Fire-and-forget fan-out. A broadcast failure must never fail the write
    that already succeeded — the client's own response is its confirmation."""
    try:
        await manager.broadcast(payload)
    except Exception:
        pass


def _actor(user: dict) -> str:
    return str(user.get("username") or user.get("name") or "")


# ---------------------------------------------------------------------------
# Layout
# ---------------------------------------------------------------------------

class LayoutBody(BaseModel):
    tablet_id: Optional[str] = None
    layout: dict


@router.get("/api/wall/layout")
async def get_wall_layout(tablet_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    return {"layout": await layouts.get_layout(tablet_id)}


@router.put("/api/wall/layout")
async def put_wall_layout(body: LayoutBody, user: dict = Depends(get_current_user)):
    if not body.tablet_id:
        raise HTTPException(status_code=400, detail="This tablet isn’t paired yet, so its layout can’t be saved.")
    try:
        saved = await layouts.save_layout(body.tablet_id, body.layout)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"layout": saved}


# ---------------------------------------------------------------------------
# Tablet pairing
# ---------------------------------------------------------------------------
# Thin wrappers over services/dashboard_tablets, which is left untouched.

class PairCodeBody(BaseModel):
    display_name_hint: Optional[str] = ""


class ClaimBody(BaseModel):
    code: str
    display_name: str
    room: Optional[str] = None


class TabletPatchBody(BaseModel):
    display_name: Optional[str] = None
    room: Optional[str] = None


@router.get("/api/wall/tablets")
async def list_wall_tablets(user: dict = Depends(require_role("admin"))):
    recs = await tablets.list_tablets()
    # Attach each tablet's capability policy so Settings can render the whole
    # picture in one round trip.
    out = []
    for rec in recs:
        out.append({**rec, "policy": await policy.get_policy(rec["id"])})
    return {"tablets": out}


@router.post("/api/wall/tablets/pair-code")
async def mint_wall_pair_code(body: PairCodeBody, user: dict = Depends(require_role("admin"))):
    return tablets.create_pairing_code(_actor(user), body.display_name_hint or "")


@router.post("/api/wall/tablets/claim")
async def claim_wall_pair_code(body: ClaimBody, request: Request,
                               user: dict = Depends(get_current_user)):
    # Rate-limit key: prefer the authenticated user, fall back to peer IP so an
    # unauthenticated path (should one ever exist) is still bounded.
    client_key = _actor(user) or (request.client.host if request.client else "unknown")
    try:
        res = await tablets.claim_pairing_code(
            body.code, body.display_name, body.room, _actor(user), client_key,
        )
    except PermissionError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # The tablet's own credential, returned exactly once. From here the wall
    # authenticates as itself rather than riding the session of whoever paired
    # it — which is what makes its capability policy binding instead of
    # advisory. Storing only a hash means a leaked policy file cannot be
    # replayed as a login.
    res["tablet_token"] = policy.issue_token(res["tablet_id"])
    return res


@router.patch("/api/wall/tablets/{tablet_id}")
async def patch_wall_tablet(tablet_id: str, body: TabletPatchBody,
                            user: dict = Depends(require_role("admin"))):
    rec = await tablets.rename_tablet(tablet_id, body.display_name or "", body.room)
    if not rec:
        raise HTTPException(status_code=404, detail="Tablet not found.")
    return rec


@router.delete("/api/wall/tablets/{tablet_id}")
async def remove_wall_tablet(tablet_id: str, user: dict = Depends(require_role("admin"))):
    ok = await tablets.delete_tablet(tablet_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tablet not found.")
    # Un-pairing takes the tablet's layout AND its capability policy (including
    # the PIN hash) with it. Leaving either behind would silently re-apply to
    # whatever claims that id next.
    await layouts.delete_layout(tablet_id)
    await policy.delete_policy(tablet_id)
    return {"ok": True}


@router.post("/api/wall/tablets/{tablet_id}/heartbeat")
async def wall_tablet_heartbeat(tablet_id: str, user: dict = Depends(get_current_user)):
    await tablets.touch_tablet(tablet_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Capability policy
# ---------------------------------------------------------------------------

class PolicyBody(BaseModel):
    tablet_id: str
    policy: dict


class PinBody(BaseModel):
    tablet_id: str
    pin: Optional[str] = None


class VerifyPinBody(BaseModel):
    tablet_id: str
    capability: str
    pin: str


class IdleBody(BaseModel):
    tablet_id: Optional[str] = None


@router.get("/api/wall/policy")
async def get_wall_policy(tablet_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    # Readable by any signed-in client: the tablet needs its own policy to know
    # what to render, and the policy contains no secret (never the PIN hash).
    return {"policy": await policy.get_policy(tablet_id)}


@router.put("/api/wall/policy")
async def put_wall_policy(body: PolicyBody, user: dict = Depends(require_role("admin"))):
    try:
        return {"policy": await policy.set_policy(body.tablet_id, body.policy)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/wall/policy/pin")
async def set_wall_pin(body: PinBody, user: dict = Depends(require_role("admin"))):
    try:
        await policy.set_pin(body.tablet_id, body.pin)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True, "policy": await policy.get_policy(body.tablet_id)}


@router.post("/api/wall/pin/verify")
async def verify_wall_pin(body: VerifyPinBody, user: dict = Depends(get_current_user)):
    try:
        return await policy.verify_pin(body.tablet_id, body.capability, body.pin)
    except PermissionError as e:
        raise HTTPException(status_code=429, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/api/wall/idle")
async def wall_went_idle(body: IdleBody, user: dict = Depends(get_current_user)):
    # Walking away from the wall re-locks anything a PIN had opened.
    if body.tablet_id:
        policy.drop_elevation(body.tablet_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Lists
# ---------------------------------------------------------------------------

class ListCreate(BaseModel):
    name: str


class ItemCreate(BaseModel):
    text: str


class ItemPatch(BaseModel):
    text: Optional[str] = None
    done: Optional[bool] = None


@router.get("/api/lists")
async def get_all_lists(user: dict = Depends(get_current_user)):
    return {"lists": await lists.get_lists()}


@router.post("/api/lists")
async def create_list(body: ListCreate, user: dict = Depends(get_current_user)):
    try:
        rec = await lists.create_list(body.name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await _broadcast({"type": "list_changed", "list_id": rec["id"], "action": "created"})
    return rec


@router.delete("/api/lists/{list_id}")
async def remove_list(list_id: str, user: dict = Depends(get_current_user)):
    try:
        ok = await lists.delete_list(list_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not ok:
        raise HTTPException(status_code=404, detail="List not found.")
    await _broadcast({"type": "list_changed", "list_id": list_id, "action": "deleted"})
    return {"ok": True}


@router.post("/api/lists/{list_id}/items")
async def add_list_item(list_id: str, body: ItemCreate, user: dict = Depends(get_current_user)):
    try:
        item = await lists.add_item(list_id, body.text, _actor(user))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if item is None:
        raise HTTPException(status_code=404, detail="List not found.")
    await _broadcast({"type": "list_changed", "list_id": list_id, "action": "item_added", "item": item})
    return item


@router.patch("/api/lists/{list_id}/items/{item_id}")
async def patch_list_item(list_id: str, item_id: str, body: ItemPatch,
                          user: dict = Depends(get_current_user)):
    item = await lists.update_item(list_id, item_id, body.model_dump(exclude_unset=True))
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found.")
    await _broadcast({"type": "list_changed", "list_id": list_id, "action": "item_updated", "item": item})
    return item


@router.delete("/api/lists/{list_id}/items/{item_id}")
async def remove_list_item(list_id: str, item_id: str, user: dict = Depends(get_current_user)):
    ok = await lists.delete_item(list_id, item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Item not found.")
    await _broadcast({"type": "list_changed", "list_id": list_id, "action": "item_removed", "item_id": item_id})
    return {"ok": True}


@router.post("/api/lists/{list_id}/clear-done")
async def clear_list_done(list_id: str, user: dict = Depends(get_current_user)):
    removed = await lists.clear_done(list_id)
    await _broadcast({"type": "list_changed", "list_id": list_id, "action": "cleared", "removed": removed})
    return {"ok": True, "removed": removed}


# ---------------------------------------------------------------------------
# Agenda
# ---------------------------------------------------------------------------

class EventCreate(BaseModel):
    title: str
    when: Optional[str] = None      # ISO date or timestamp; defaults to today
    time: Optional[str] = None      # display time, e.g. "19:30"
    note: Optional[str] = ""
    people: Optional[list] = None


class EventPatch(BaseModel):
    title: Optional[str] = None
    time: Optional[str] = None
    note: Optional[str] = None
    done: Optional[bool] = None


@router.get("/api/agenda")
async def get_agenda(days: int = 1, user: dict = Depends(get_current_user)):
    return {"events": await lists.get_agenda(days)}


@router.post("/api/agenda")
async def create_agenda_event(body: EventCreate, user: dict = Depends(get_current_user)):
    try:
        ev = await lists.create_event(
            title=body.title, when=body.when, time_str=body.time,
            note=body.note or "", people=body.people, added_by=_actor(user),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await _broadcast({"type": "agenda_changed", "action": "created", "event": ev})
    return ev


@router.patch("/api/agenda/{event_id}")
async def patch_agenda_event(event_id: str, body: EventPatch,
                             user: dict = Depends(get_current_user)):
    ev = await lists.update_event(event_id, body.model_dump(exclude_unset=True))
    if ev is None:
        raise HTTPException(status_code=404, detail="Event not found.")
    await _broadcast({"type": "agenda_changed", "action": "updated", "event": ev})
    return ev


@router.delete("/api/agenda/{event_id}")
async def remove_agenda_event(event_id: str, user: dict = Depends(get_current_user)):
    ok = await lists.delete_event(event_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Event not found.")
    await _broadcast({"type": "agenda_changed", "action": "deleted", "event_id": event_id})
    return {"ok": True}
