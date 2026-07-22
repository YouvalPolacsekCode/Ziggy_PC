"""PermissionService — the façade the rest of Ziggy talks to.

Wires the event store, the read-model, the resolver, the engine and the audit
log into two things:

* **typed mutators** (``add_space``, ``bind_role``, ``issue_grant``,
  ``delegate`` …) that append policy events; and
* **``authorize``** — the Policy Enforcement Point entry: expand the subject to
  its principals, load their grants, decide, and record an audit event.

The read-model is cached and only rebuilt when the event log grows (``latest_seq``
changes), so steady-state authorize calls don't replay the log every time.
"""
from __future__ import annotations

from typing import Optional

from .audit import AuditLog
from .capabilities import CapabilityRegistry, build_default_registry
from .context import Context
from .delegation import validate_delegation
from .engine import Engine
from .grants import Grant
from .groups import Group, PrincipalResolver, default_groups
from .roles import expand_role
from .store import PolicyState, PolicyStore, build_state
from .types import ActorKind, Decision, Principal, RiskTier


class PermissionService:
    def __init__(self, store: PolicyStore | None = None, audit: AuditLog | None = None,
                 capabilities: CapabilityRegistry | None = None) -> None:
        self.store = store or PolicyStore()
        self.audit = audit or AuditLog()
        self.capabilities = capabilities or build_default_registry()
        self._cache_seq = -1
        self._state: PolicyState | None = None
        self._engine: Engine | None = None
        self._resolver: PrincipalResolver | None = None

    # ------------------------------------------------------------------
    # Read-model (cached; rebuilt only when the log grows)
    # ------------------------------------------------------------------
    def _ensure(self) -> tuple[PolicyState, Engine, PrincipalResolver]:
        seq = self.store.latest_seq()
        if seq != self._cache_seq or self._state is None:
            state = build_state(self.store)
            engine = Engine(self.capabilities, state.to_resource_graph())
            # Custom groups override built-ins of the same id.
            merged: dict[str, Group] = {g.id: g for g in default_groups()}
            for g in state.groups_list():
                merged[g.id] = g
            resolver = PrincipalResolver(list(merged.values()), state.relationships)
            self._state, self._engine, self._resolver = state, engine, resolver
            self._cache_seq = seq
        return self._state, self._engine, self._resolver

    def state(self) -> PolicyState:
        return self._ensure()[0]

    # ------------------------------------------------------------------
    # Authorization (the PEP entry point)
    # ------------------------------------------------------------------
    def authorize(self, *, subject, action: str, resource: str,
                  context: Context | dict | None = None, now: Optional[float] = None,
                  record: bool = True, correlation_id: str | None = None) -> Decision:
        state, engine, resolver = self._ensure()
        subject_p = subject if isinstance(subject, Principal) else Principal.parse(subject)
        ctx = self._build_context(subject_p, context, state)
        principals = resolver.expand(subject_p, ctx)
        grants = state.grants_for({p.ref for p in principals})
        decision = engine.decide(
            subject_principals=principals, action=action, resource=resource,
            grants=grants, context=ctx, now=now)
        if record:
            self._maybe_audit(subject_p, action, resource, ctx, decision, correlation_id)
        return decision

    def _maybe_audit(self, subject, action, resource, ctx, decision, correlation_id):
        cap = self.capabilities.resolve(action)
        # Record protected actions (risk >= MEDIUM), any denial-by-grant, and
        # anything carrying obligations. Benign LOW allows are not logged.
        interesting = (
            cap.risk_tier.rank >= RiskTier.MEDIUM.rank
            or decision.obligations
            or (not decision.allowed and decision.matched_grant_ids)
        )
        if not interesting:
            return
        self.audit.record(
            subject=subject.ref, action=action, resource=resource,
            effect=decision.effect.value,
            channel=ctx.resolve("channel"),
            actor_kind=ctx.resolve("context.actor_kind"),
            obligations=[o.to_json() for o in decision.obligations],
            reason=decision.reason, correlation_id=correlation_id,
        )

    def _build_context(self, subject: Principal, context, state: PolicyState) -> Context:
        if isinstance(context, Context):
            data = dict(context.data)
        elif isinstance(context, dict):
            data = dict(context)
        else:
            data = {}
        # Fold stored principal attributes (age, etc.) into subject so dynamic
        # groups work even if the caller didn't pass them explicitly. Caller-
        # supplied values win (they reflect live state).
        stored = state.principal_attrs(subject.ref)
        subj = dict(stored)
        subj.update(data.get("subject") or {})
        subj.setdefault("ref", subject.ref)
        data["subject"] = subj
        data.setdefault("context", {"actor_kind": ActorKind.HUMAN.value})
        # Canonicalize channel/trust to top-level so conditions authored against
        # {"var": "channel"} / {"var": "session.trust_level"} work no matter how
        # the caller nested them (ContextBuilder sets the alias; raw API dicts
        # may only carry session.channel).
        session = data.get("session") or {}
        if "channel" not in data and session.get("channel"):
            data["channel"] = session["channel"]
        return Context(data)

    # ------------------------------------------------------------------
    # Query API
    # ------------------------------------------------------------------
    def capabilities_of(self, subject, resource: str,
                        context: Context | dict | None = None,
                        now: Optional[float] = None) -> list[str]:
        """Which capabilities can ``subject`` currently exercise on ``resource``?"""
        allowed = []
        for cap in self.capabilities.all():
            d = self.authorize(subject=subject, action=cap.key, resource=resource,
                               context=context, now=now, record=False)
            if d.allowed:
                allowed.append(cap.key)
        return allowed

    def who_can(self, action: str, resource: str,
                context: Context | dict | None = None,
                now: Optional[float] = None) -> list[str]:
        """Which principals can perform ``action`` on ``resource`` right now?

        Enumerates known person/agent/kiosk/service principals (not groups —
        groups are answered through their members)."""
        state = self.state()
        out = []
        for ref, meta in state.principals.items():
            d = self.authorize(subject=ref, action=action, resource=resource,
                               context=context, now=now, record=False)
            if d.allowed:
                out.append(ref)
        return out

    # ------------------------------------------------------------------
    # Mutators (append policy events)
    # ------------------------------------------------------------------
    def add_space(self, id: str, type: str, parent_ids=None, tags=None, attrs=None,
                  actor=None) -> int:
        return self.store.append("space_added", {
            "id": id, "type": type, "parent_ids": list(parent_ids or []),
            "tags": list(tags or []), "attrs": dict(attrs or {})}, actor=actor)

    def remove_space(self, id: str, actor=None) -> int:
        return self.store.append("space_removed", {"id": id}, actor=actor)

    def add_device(self, id: str, device_class: str, space_id=None, tags=None,
                   attrs=None, actor=None) -> int:
        return self.store.append("device_added", {
            "id": id, "device_class": device_class, "space_id": space_id,
            "tags": list(tags or []), "attrs": dict(attrs or {})}, actor=actor)

    def remove_device(self, id: str, actor=None) -> int:
        return self.store.append("device_removed", {"id": id}, actor=actor)

    def add_principal(self, ref: str, attrs=None, actor=None) -> int:
        return self.store.append("principal_added", {
            "ref": ref, "attrs": dict(attrs or {}), "status": "active"}, actor=actor)

    def remove_principal(self, ref: str, actor=None) -> int:
        return self.store.append("principal_removed", {"ref": ref}, actor=actor)

    def add_identity(self, id: str, person_ref: str, kind: str, trust_level: int = 1,
                     actor=None) -> int:
        return self.store.append("identity_added", {
            "id": id, "person_ref": person_ref, "kind": kind,
            "trust_level": trust_level}, actor=actor)

    def revoke_identity(self, id: str, actor=None) -> int:
        return self.store.append("identity_revoked", {"id": id}, actor=actor)

    def upsert_group(self, id: str, kind: str, label="", members=None,
                     predicate=None, actor=None) -> int:
        return self.store.append("group_upserted", {
            "id": id, "kind": kind, "label": label,
            "members": list(members or []), "predicate": predicate}, actor=actor)

    def remove_group(self, id: str, actor=None) -> int:
        return self.store.append("group_removed", {"id": id}, actor=actor)

    def add_relationship(self, from_ref: str, type: str, to_ref: str, actor=None) -> int:
        return self.store.append("relationship_added", {
            "from_ref": from_ref, "type": type, "to_ref": to_ref}, actor=actor)

    def remove_relationship(self, from_ref: str, type: str, to_ref: str, actor=None) -> int:
        return self.store.append("relationship_removed", {
            "from_ref": from_ref, "type": type, "to_ref": to_ref}, actor=actor)

    def bind_role(self, binding_id: str, principal: str, scope: str, role,
                  condition=None, expires_at=None, actor=None) -> int:
        # Validate the expansion up front so a bad role/scope is rejected at
        # write time, not silently mis-applied on replay.
        expand_role(role, principal=Principal.parse(principal), scope_ref=scope,
                    binding_id=binding_id, condition=condition, expires_at=expires_at)
        # "Access Level" is singular per person per scope: a new binding REPLACES
        # any prior binding for the same (principal, scope) so an old preset's
        # grants (e.g. the kid deny-security) can't linger and shadow the new one.
        state, _, _ = self._ensure()
        for bid, meta in list(state.bindings.items()):
            if bid == binding_id:
                continue
            if meta.get("principal") == principal and meta.get("scope") == scope:
                self.unbind_role(bid, actor=actor)
        return self.store.append("role_bound", {
            "binding_id": binding_id, "principal": principal, "scope": scope,
            "role": role, "condition": condition, "expires_at": expires_at}, actor=actor)

    def unbind_role(self, binding_id: str, actor=None) -> int:
        return self.store.append("role_unbound", {"binding_id": binding_id}, actor=actor)

    def issue_grant(self, grant: Grant, actor=None) -> int:
        grant.validate()
        return self.store.append("grant_issued", grant.to_json(), actor=actor)

    def revoke_grant(self, grant_id: str | None = None, revoke_root: str | None = None,
                     actor=None) -> int:
        return self.store.append("grant_revoked", {
            "id": grant_id, "revoke_root": revoke_root}, actor=actor)

    def delegate(self, parent_id: str, child: Grant, actor=None) -> int:
        """Issue ``child`` as an attenuated delegation of grant ``parent_id``.

        Validates attenuation against the parent before writing; raises
        DelegationError on violation. Stamps issuer + revoke_root so revoking
        the parent later cascades to this child."""
        state, engine, _ = self._ensure()
        parent = state.grants.get(parent_id)
        if parent is None:
            raise ValueError(f"unknown parent grant {parent_id!r}")
        child.issued_by = parent.principal
        child.depth = parent.depth + 1
        child.revoke_root = parent.revoke_root or parent.id
        validate_delegation(parent, child, engine)
        child.validate()
        return self.store.append("grant_issued", child.to_json(), actor=actor)
