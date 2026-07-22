"""Roles — named bundles of grant-specs that compile to grants at bind time.

A *role* is data (see ``seeds.PRESET_ROLES``): a list of grant-specs using the
``@scope`` sentinel for "the space this role is bound at". A *role binding*
attaches a role to a (principal, scope) pair, optionally with a validity window
or expiry. Expansion substitutes the real scope ref and produces concrete
:class:`Grant`s — the engine never knows a role existed.

Because expansion happens against the bound scope, ONE "Kid" role means the
right thing in every home with zero per-home authoring — bind it at
``space:home_a`` or ``space:home_b`` and the grants root themselves correctly.
Custom/enterprise roles are just more dicts of the same shape; nothing in the
engine changes to support them.
"""
from __future__ import annotations

from typing import Optional

from .grants import Grant
from .seeds import PRESET_ROLES, SCOPE
from .types import Effect, Obligation, ObligationKind, Principal


class RoleError(ValueError):
    pass


def get_preset_role(name: str) -> dict:
    role = PRESET_ROLES.get(name)
    if role is None:
        raise RoleError(f"unknown preset role {name!r}")
    return role


def expand_role(
    role_name_or_def,
    *,
    principal: Principal,
    scope_ref: str,
    binding_id: str,
    condition=None,
    expires_at: Optional[float] = None,
    status: str = "active",
) -> list[Grant]:
    """Compile a role (name or inline def) into concrete grants.

    ``condition`` is a binding-level condition ANDed into every grant — this is
    how a temporary-guest binding stamps its access window onto an otherwise
    identical guest role. ``expires_at`` is stamped onto every grant so the
    whole binding self-revokes.
    """
    role_def = (get_preset_role(role_name_or_def)
                if isinstance(role_name_or_def, str) else role_name_or_def)
    specs = role_def.get("grants", [])
    grants: list[Grant] = []
    for i, spec in enumerate(specs):
        grants.append(_grant_from_spec(
            spec, i, principal=principal, scope_ref=scope_ref,
            binding_id=binding_id, binding_condition=condition,
            expires_at=expires_at, status=status,
        ))
    return grants


def _grant_from_spec(spec, index, *, principal, scope_ref, binding_id,
                     binding_condition, expires_at, status) -> Grant:
    resource = _sub_scope(spec.get("resource"), scope_ref)
    capability = spec.get("capability", "*")
    cond = _and_conditions(spec.get("condition"), binding_condition)
    obligations = [_obligation_from_json(o) for o in spec.get("obligations", [])]
    g = Grant(
        id=f"{binding_id}#{index}",
        principal=principal,
        effect=Effect(spec.get("effect", "allow")),
        resource=resource,
        capability=capability,
        condition=cond,
        obligations=obligations,
        priority=spec.get("priority", 0),
        emergency_override=spec.get("emergency_override", False),
        expires_at=expires_at,
        status=status,
    )
    g.validate()
    return g


def _sub_scope(resource, scope_ref):
    """Replace the ``@scope`` sentinel with a node selector rooted at scope."""
    if resource == SCOPE:
        return {"node": scope_ref}
    return resource


def _and_conditions(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return {"all": [a, b]}


def _obligation_from_json(o: dict) -> Obligation:
    return Obligation.make(ObligationKind(o["kind"]), **(o.get("params") or {}))
