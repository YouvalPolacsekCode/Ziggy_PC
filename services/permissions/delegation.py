"""Delegation — object-capability re-granting with enforced attenuation.

A holder of a grant may issue a *child* grant to someone else ("give my sister
access while I'm away", a property manager handing an installer a 3-day window),
but ONLY a subset of what they hold — never a superset. This module validates
that attenuation at issue-time (the write path), which is the real security
boundary: once a delegated grant exists the engine treats it like any other.

Attenuation is checked structurally + decidably against the concrete resource
and capability sets of the home:

* **resource subset** — every resource ref the child could match, the parent
  matches too.
* **capability subset** — likewise for capabilities.
* **condition subsumption** — if the parent carries a condition, the child must
  carry it too (child may add *more* restrictions, never drop the parent's).
* **delegatable / depth / expiry** — the parent must permit delegation, the
  child sits one level deeper within ``max_depth``, and cannot outlive the
  parent.

Rejecting here is fail-closed: any uncertainty ⇒ not delegatable.
"""
from __future__ import annotations

from .engine import Engine
from .grants import Grant
from .selectors import NO_MATCH, match_capability, match_resource
from .types import Effect


class DelegationError(ValueError):
    pass


def validate_delegation(parent: Grant, child: Grant, engine: Engine) -> None:
    """Raise :class:`DelegationError` unless ``child`` is a valid attenuation
    of ``parent``. Returns None on success."""
    # A delegated DENY only ever *removes* power — always safe, skip subset math.
    if child.effect == Effect.DENY:
        _check_mechanics(parent, child)
        return

    if parent.effect != Effect.ALLOW:
        raise DelegationError("cannot delegate an ALLOW from a non-ALLOW parent")

    _check_mechanics(parent, child)

    # Resource subset.
    child_res = _matched_resources(child.resource, engine)
    parent_res = _matched_resources(parent.resource, engine)
    extra = child_res - parent_res
    if extra:
        raise DelegationError(
            f"attenuation violated: child reaches resources the parent does not: "
            f"{sorted(extra)[:5]}")

    # Capability subset.
    child_caps = _matched_caps(child.capability, engine)
    parent_caps = _matched_caps(parent.capability, engine)
    extra_caps = child_caps - parent_caps
    if extra_caps:
        raise DelegationError(
            f"attenuation violated: child reaches capabilities the parent does not: "
            f"{sorted(extra_caps)[:5]}")

    # Condition subsumption — child must retain the parent's condition (if any).
    if parent.condition is not None and not _condition_retained(parent.condition, child.condition):
        raise DelegationError(
            "attenuation violated: child drops a condition the parent imposes")


def _check_mechanics(parent: Grant, child: Grant) -> None:
    if not parent.delegatable:
        raise DelegationError("parent grant is not delegatable")
    if child.depth != parent.depth + 1:
        raise DelegationError(
            f"child depth must be parent.depth+1 ({parent.depth + 1}), got {child.depth}")
    if parent.max_depth is not None and child.depth > parent.max_depth:
        raise DelegationError(
            f"delegation depth {child.depth} exceeds max_depth {parent.max_depth}")
    if parent.expires_at is not None:
        if child.expires_at is None or child.expires_at > parent.expires_at:
            raise DelegationError("child cannot outlive the parent grant")


def _matched_resources(selector, engine: Engine) -> set[str]:
    out = set()
    for ref in engine.resources.all_resource_refs():
        resolved = engine.resources.resolve(ref)
        if resolved is not None and match_resource(selector, resolved) != NO_MATCH:
            out.add(ref)
    return out


def _matched_caps(selector, engine: Engine) -> set[str]:
    return {c.key for c in engine.capabilities.all()
            if match_capability(selector, c) != NO_MATCH}


def _condition_retained(parent_cond, child_cond) -> bool:
    """True if the parent's condition is structurally present in the child's.

    Conservative: exact equality, or the parent condition appears as a conjunct
    of a top-level ``{"all": [...]}`` in the child. Anything fancier is treated
    as "not retained" (fail-closed)."""
    if child_cond == parent_cond:
        return True
    if isinstance(child_cond, dict) and set(child_cond) == {"all"}:
        return parent_cond in child_cond["all"]
    return False
