"""Backward-compatibility bridge to the legacy linear role model.

Ziggy already ships a linear role ladder (``services.auth_db`` +
``backend.routers.auth_deps``): ``guest < user < admin < super_admin <
relay_admin``, enforced by ``require_role``. That path is untouched by this
platform — the new engine is strictly additive.

This module is the seam for NEW code that wants fine-grained capability checks
while still honouring the legacy roles a user already has. It maps each legacy
role onto a preset role in the new model, so a ``super_admin`` behaves like an
Owner and a ``user`` like an Adult, without anyone having to re-provision
existing accounts.

Two directions:

* :func:`legacy_role_to_preset` — which preset a legacy role expands to.
* :func:`seed_legacy_user` — mint the principal + a home-scoped role binding for
  an existing legacy user so ``PermissionService.authorize`` returns sane
  answers immediately.

The mapping is intentionally conservative (never grants MORE than the linear
ladder implied): ``relay_admin`` (founder) → owner; ``super_admin`` → owner;
``admin`` → admin; ``user`` → adult; ``guest`` → guest.
"""
from __future__ import annotations

from .service import PermissionService
from .types import Principal

# Legacy → preset role. Keep in lock-step with auth_deps.ROLE_ORDER semantics.
LEGACY_TO_PRESET: dict[str, str] = {
    "relay_admin": "owner",   # founder acting via relay → full authority
    "super_admin": "owner",   # home owner
    "admin": "admin",
    "user": "adult",
    "guest": "guest",
}


def legacy_role_to_preset(role: str) -> str:
    return LEGACY_TO_PRESET.get(role, "guest")  # unknown → least privilege


def seed_legacy_user(service: PermissionService, *, username: str, role: str,
                     home_scope: str, age: int | None = None,
                     actor: str = "system:migration") -> None:
    """Create a principal + home-scoped role binding for an existing user.

    Idempotent-ish: safe to call repeatedly; it appends events, and role
    re-binding with the same ``binding_id`` overwrites the prior expansion on
    replay. ``home_scope`` is the space ref the user's authority is rooted at
    (e.g. ``"space:home"``)."""
    ref = f"person:{username}"
    attrs = {}
    if age is not None:
        attrs["age"] = age
    service.add_principal(ref, attrs=attrs, actor=actor)
    preset = legacy_role_to_preset(role)
    service.bind_role(
        binding_id=f"legacy:{username}", principal=ref, scope=home_scope,
        role=preset, actor=actor)


def legacy_role_satisfies(role: str, min_role: str) -> bool:
    """Mirror of ``auth_deps.require_role`` semantics, re-exported so new code
    can make the same linear check without importing FastAPI. Kept so the two
    models can co-exist during the transition and be asserted equal in tests."""
    order = {"guest": 0, "user": 1, "admin": 2, "super_admin": 3, "relay_admin": 9}
    return order.get(role, 0) >= order.get(min_role, 999)
