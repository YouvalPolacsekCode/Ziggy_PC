"""Regression test for the relay_admin ROLE_ORDER fix (Prompt 2 chunk 3.1).

Before the fix, backend.routers.auth_deps.ROLE_ORDER lacked a relay_admin
entry. A relay-proxied request injected `role='relay_admin'`, which
`ROLE_ORDER.get('relay_admin', 0)` resolved to 0, blocking the founder
against every require_role('admin'|'super_admin') route on the hub.

After the fix, relay_admin is ranked 9 — above super_admin (3) — matching
relay/app/auth.py's hierarchy. The founder can now act on a customer's
hub via the proxy.

These tests call the dep directly (no FastAPI request needed). The
kwarg form `await dep(user={...})` bypasses Depends and exercises the
permission check in isolation.
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from backend.routers.auth_deps import ROLE_ORDER, require_role


def test_role_order_has_relay_admin():
    assert "relay_admin" in ROLE_ORDER
    assert ROLE_ORDER["relay_admin"] > ROLE_ORDER["super_admin"]


def test_role_order_matches_relay_hierarchy():
    """Backend's ROLE_ORDER must match relay/app/auth.py's so the two
    sides agree on precedence when a relay_admin proxies through."""
    from relay.app.auth import ROLE_ORDER as relay_order
    # Only check the keys backend cares about — relay may have extras
    # in the future (e.g. service accounts) without breaking this test.
    for role in ("guest", "user", "admin", "super_admin", "relay_admin"):
        assert ROLE_ORDER[role] == relay_order[role], (
            f"rank drift on {role}: backend={ROLE_ORDER[role]} "
            f"vs relay={relay_order[role]}"
        )


@pytest.mark.parametrize("min_role", ["guest", "user", "admin", "super_admin"])
async def test_relay_admin_satisfies_every_lower_role(min_role):
    """relay_admin must pass require_role at every defined rank below itself."""
    dep = require_role(min_role)
    user = {"username": "founder@example.com", "role": "relay_admin"}
    result = await dep(user=user)
    assert result == user


async def test_relay_admin_passes_super_admin_gate():
    """The exact scenario the fix exists for — explicit test for clarity."""
    dep = require_role("super_admin")
    relay_admin_user = {
        "username": "founder@example.com",
        "role":     "relay_admin",
        "_via_relay": True,
    }
    assert await dep(user=relay_admin_user) == relay_admin_user


async def test_super_admin_does_not_satisfy_relay_admin_gate():
    """The hierarchy is one-way: super_admin (home owner) cannot escalate
    to relay_admin (founder)."""
    dep = require_role("relay_admin")
    super_admin_user = {"username": "owner@example.com", "role": "super_admin"}
    with pytest.raises(HTTPException) as exc:
        await dep(user=super_admin_user)
    assert exc.value.status_code == 403


async def test_admin_still_blocked_from_super_admin():
    """The fix must not weaken existing role gates — confirm admin still
    can't reach super_admin routes."""
    dep = require_role("super_admin")
    admin_user = {"username": "house_admin@example.com", "role": "admin"}
    with pytest.raises(HTTPException) as exc:
        await dep(user=admin_user)
    assert exc.value.status_code == 403


async def test_unknown_role_treated_as_rank_zero():
    """An unrecognized role string falls through to rank 0 — must NOT
    inadvertently satisfy any non-guest gate."""
    dep = require_role("user")
    bogus = {"username": "x", "role": "fake_role_does_not_exist"}
    with pytest.raises(HTTPException) as exc:
        await dep(user=bogus)
    assert exc.value.status_code == 403
