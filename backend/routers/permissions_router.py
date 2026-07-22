"""Permission platform HTTP surface (API-first).

Everything the consumer UI, the property-manager console, and external
integrations do is a client of these endpoints — there is no UI-only path into
the model.

Endpoint groups
---------------
* **Decision** — ``POST /api/permissions/authorize`` (+ ``/explain``): the PDP.
  A user may always ask about *themselves*; asking about another subject
  requires admin.
* **Query** — "what can this principal do?" / "who can do this?".
* **Admin (super_admin)** — CRUD for spaces, devices, principals, groups,
  relationships, grants, role bindings, delegation; plus a one-shot
  ``/bootstrap`` that seeds existing legacy users into the model.
* **Audit** — read the decision ledger (admin).

Legacy ``require_role`` gates are untouched elsewhere; this router is additive.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user, require_role
from services.permissions.ai import evaluate_agent_action
from services.permissions.compat import seed_legacy_user
from services.permissions.grants import Grant
from services.permissions.runtime import get_service
from services.permissions.types import Effect, Principal

router = APIRouter()

DEFAULT_HOME_SCOPE = "space:home"


def _self_ref(user: dict) -> str:
    return f"person:{user.get('username', '?')}"


# ---------------------------------------------------------------------------
# Decision
# ---------------------------------------------------------------------------

class AuthorizeBody(BaseModel):
    action: str
    resource: str
    subject: Optional[str] = None       # defaults to the caller
    context: Optional[dict] = None
    now: Optional[float] = None


@router.post("/api/permissions/authorize")
async def authorize(body: AuthorizeBody, user: dict = Depends(get_current_user)):
    subject = body.subject or _self_ref(user)
    _guard_subject(subject, user)
    d = get_service().authorize(
        subject=subject, action=body.action, resource=body.resource,
        context=body.context, now=body.now)
    out = d.to_json()
    out.pop("trace", None)  # trace is only returned by /explain
    return out


@router.post("/api/permissions/authorize/explain")
async def authorize_explain(body: AuthorizeBody, user: dict = Depends(get_current_user)):
    subject = body.subject or _self_ref(user)
    _guard_subject(subject, user)
    d = get_service().authorize(
        subject=subject, action=body.action, resource=body.resource,
        context=body.context, now=body.now, record=False)
    return d.to_json()


class AgentAuthorizeBody(BaseModel):
    agent: str
    action: str
    resource: str
    on_behalf_of: Optional[str] = None
    context: Optional[dict] = None
    explicit_confirm: bool = False


@router.post("/api/permissions/authorize/agent")
async def authorize_agent(body: AgentAuthorizeBody,
                          user: dict = Depends(require_role("admin"))):
    v = evaluate_agent_action(
        get_service(), agent=body.agent, action=body.action, resource=body.resource,
        on_behalf_of=body.on_behalf_of, context=body.context,
        explicit_confirm=body.explicit_confirm)
    return v.to_json()


def _guard_subject(subject: str, user: dict) -> None:
    """A user may authorize themselves; authorizing another subject is admin."""
    from backend.routers.auth_deps import ROLE_ORDER
    if subject == _self_ref(user):
        return
    if ROLE_ORDER.get(user.get("role", "user"), 0) < ROLE_ORDER["admin"]:
        raise HTTPException(status_code=403, detail="Cannot authorize another subject.")


# ---------------------------------------------------------------------------
# Query
# ---------------------------------------------------------------------------

@router.get("/api/permissions/principals/{ref:path}/capabilities")
async def principal_capabilities(ref: str, resource: str = Query(...),
                                 user: dict = Depends(get_current_user)):
    _guard_subject(ref, user)
    return {"principal": ref, "resource": resource,
            "capabilities": get_service().capabilities_of(ref, resource)}


@router.get("/api/permissions/resources/{ref:path}/principals")
async def resource_principals(ref: str, action: str = Query(...),
                              user: dict = Depends(require_role("admin"))):
    return {"resource": ref, "action": action,
            "principals": get_service().who_can(action, ref)}


# ---------------------------------------------------------------------------
# Admin: structural mutators (super_admin)
# ---------------------------------------------------------------------------

_admin = Depends(require_role("super_admin"))


class SpaceBody(BaseModel):
    id: str
    type: str
    parent_ids: list[str] = []
    tags: list[str] = []
    attrs: dict = {}


@router.post("/api/permissions/spaces")
async def add_space(body: SpaceBody, user: dict = _admin):
    seq = get_service().add_space(body.id, body.type, body.parent_ids, body.tags,
                                  body.attrs, actor=_self_ref(user))
    return {"status": "ok", "seq": seq}


class DeviceBody(BaseModel):
    id: str
    device_class: str
    space_id: Optional[str] = None
    tags: list[str] = []
    attrs: dict = {}


@router.post("/api/permissions/devices")
async def add_device(body: DeviceBody, user: dict = _admin):
    seq = get_service().add_device(body.id, body.device_class, body.space_id,
                                   body.tags, body.attrs, actor=_self_ref(user))
    return {"status": "ok", "seq": seq}


class PrincipalBody(BaseModel):
    ref: str
    attrs: dict = {}


@router.post("/api/permissions/principals")
async def add_principal(body: PrincipalBody, user: dict = _admin):
    seq = get_service().add_principal(body.ref, body.attrs, actor=_self_ref(user))
    return {"status": "ok", "seq": seq}


class GroupBody(BaseModel):
    id: str
    kind: str
    label: str = ""
    members: list[str] = []
    predicate: Optional[dict] = None


@router.post("/api/permissions/groups")
async def upsert_group(body: GroupBody, user: dict = _admin):
    seq = get_service().upsert_group(body.id, body.kind, body.label, body.members,
                                     body.predicate, actor=_self_ref(user))
    return {"status": "ok", "seq": seq}


class RelationshipBody(BaseModel):
    from_ref: str
    type: str
    to_ref: str


@router.post("/api/permissions/relationships")
async def add_relationship(body: RelationshipBody, user: dict = _admin):
    seq = get_service().add_relationship(body.from_ref, body.type, body.to_ref,
                                         actor=_self_ref(user))
    return {"status": "ok", "seq": seq}


class BindRoleBody(BaseModel):
    binding_id: str
    principal: str
    scope: str
    role: Any                          # preset name or inline role def
    condition: Optional[dict] = None
    expires_at: Optional[float] = None


@router.post("/api/permissions/role-bindings")
async def bind_role(body: BindRoleBody, user: dict = _admin):
    try:
        seq = get_service().bind_role(
            body.binding_id, body.principal, body.scope, body.role,
            body.condition, body.expires_at, actor=_self_ref(user))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "seq": seq}


@router.delete("/api/permissions/role-bindings/{binding_id}")
async def unbind_role(binding_id: str, user: dict = _admin):
    return {"status": "ok", "seq": get_service().unbind_role(binding_id, actor=_self_ref(user))}


class GrantBody(BaseModel):
    id: str
    principal: str
    effect: str = "allow"
    resource: Any
    capability: Any
    condition: Optional[dict] = None
    priority: int = 0
    emergency_override: bool = False
    delegatable: bool = False
    max_depth: int = 0
    expires_at: Optional[float] = None
    max_uses: Optional[int] = None


@router.post("/api/permissions/grants")
async def issue_grant(body: GrantBody, user: dict = _admin):
    g = Grant(
        id=body.id, principal=Principal.parse(body.principal), effect=Effect(body.effect),
        resource=body.resource, capability=body.capability, condition=body.condition,
        priority=body.priority, emergency_override=body.emergency_override,
        delegatable=body.delegatable, max_depth=body.max_depth,
        expires_at=body.expires_at, max_uses=body.max_uses)
    try:
        seq = get_service().issue_grant(g, actor=_self_ref(user))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "seq": seq}


@router.delete("/api/permissions/grants/{grant_id}")
async def revoke_grant(grant_id: str, cascade: bool = False, user: dict = _admin):
    svc = get_service()
    seq = svc.revoke_grant(grant_id=None if cascade else grant_id,
                           revoke_root=grant_id if cascade else None,
                           actor=_self_ref(user))
    return {"status": "ok", "seq": seq}


class DelegateBody(BaseModel):
    parent_id: str
    child: GrantBody


@router.post("/api/permissions/delegate")
async def delegate(body: DelegateBody, user: dict = Depends(get_current_user)):
    c = body.child
    child = Grant(
        id=c.id, principal=Principal.parse(c.principal), effect=Effect(c.effect),
        resource=c.resource, capability=c.capability, condition=c.condition,
        expires_at=c.expires_at, max_uses=c.max_uses)
    try:
        seq = get_service().delegate(body.parent_id, child, actor=_self_ref(user))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "ok", "seq": seq}


# ---------------------------------------------------------------------------
# Bootstrap + audit
# ---------------------------------------------------------------------------

@router.post("/api/permissions/bootstrap")
async def bootstrap(user: dict = _admin):
    """Seed the model from existing legacy users + a default home space.

    Idempotent-safe to re-run; appends events so re-binding overwrites on
    replay. Lets an existing deployment start using the engine without a
    separate migration script."""
    from services import auth_db
    svc = get_service()
    svc.add_space("home", "home", actor=_self_ref(user))
    seeded = []
    for u in auth_db.list_users():
        seed_legacy_user(svc, username=u["username"], role=u.get("role", "user"),
                         home_scope=DEFAULT_HOME_SCOPE, actor=_self_ref(user))
        seeded.append(u["username"])
    return {"status": "ok", "seeded": seeded, "scope": DEFAULT_HOME_SCOPE}


@router.get("/api/permissions/overview")
async def overview(user: dict = Depends(get_current_user)):
    """Everything the People/permissions UI needs in one call: principals (with
    their preset role if seeded via a legacy binding), spaces, and devices."""
    svc = get_service()
    st = svc.state()
    people = []
    for ref, meta in st.principals.items():
        if not ref.startswith("person:"):
            continue
        # Infer the bound preset from the person's legacy binding, if any.
        role = None
        for b in st.bindings.values():
            if b.get("principal") == ref:
                role = b.get("role")
                break
        people.append({"ref": ref, "name": ref.split(":", 1)[1],
                       "attrs": meta.get("attrs", {}), "role": role})
    spaces = [{"id": s.id, "type": s.type, "parent_ids": s.parent_ids}
              for s in st.spaces.values()]
    devices = [{"ref": d.ref, "id": d.id, "class": d.device_class,
                "space_id": d.space_id, "tags": sorted(d.tags),
                "name": d.attrs.get("name", d.id)} for d in st.devices.values()]
    return {"people": people, "spaces": spaces, "devices": devices,
            "capabilities": [c.key for c in svc.capabilities.all()],
            "presets": ["owner", "admin", "adult", "teen", "kid", "guest"]}


@router.get("/api/permissions/audit")
async def read_audit(subject: Optional[str] = None, resource: Optional[str] = None,
                     limit: int = 100, user: dict = Depends(require_role("admin"))):
    return {"events": get_service().audit.query(subject=subject, resource=resource,
                                                 limit=limit)}
