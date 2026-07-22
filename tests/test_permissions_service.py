"""Integration tests: event store, service façade, AI authz, legacy compat."""
from __future__ import annotations

import pytest

from services.permissions.ai import evaluate_agent_action
from services.permissions.audit import AuditLog
from services.permissions.compat import (
    legacy_role_satisfies,
    legacy_role_to_preset,
    seed_legacy_user,
)
from services.permissions.context import ContextBuilder
from services.permissions.grants import Grant
from services.permissions.service import PermissionService
from services.permissions.store import PolicyStore, build_state
from services.permissions.types import Effect, ObligationKind, Principal


@pytest.fixture
def svc(tmp_path):
    store = PolicyStore(str(tmp_path / "perm.db"))
    audit = AuditLog(str(tmp_path / "audit.db"))
    service = PermissionService(store=store, audit=audit)
    # A small home.
    service.add_space("home", "home")
    service.add_space("kids_room", "room", parent_ids=["home"])
    service.add_device("kr_light", "light", space_id="kids_room")
    service.add_device("kr_heater", "climate", space_id="kids_room", tags=["dangerous"])
    service.add_device("front_lock", "lock", space_id="home")
    service.add_device("porch_cam", "camera", space_id="home")
    return service


def _ctx(**kw):
    b = ContextBuilder().session(channel=kw.get("channel", "app"),
                                 trust_level=kw.get("trust", 3))
    if "time" in kw:
        b.time(local_hhmm=kw["time"])
    if kw.get("emergency"):
        b.emergency()
    return b.build()


# --------------------------------------------------------------------------
# Event store + replay
# --------------------------------------------------------------------------

def test_store_replay_rebuilds_state(svc):
    state = svc.state()
    assert "home" in state.spaces
    assert "kr_light" in state.devices
    # Rebuild independently from the same log → identical shape.
    rebuilt = build_state(svc.store)
    assert set(rebuilt.spaces) == set(state.spaces)
    assert set(rebuilt.devices) == set(state.devices)


# --------------------------------------------------------------------------
# End-to-end authorize via role binding
# --------------------------------------------------------------------------

def test_owner_binding_authorizes_everything(svc):
    svc.add_principal("person:emma", attrs={"age": 40})
    svc.bind_role("b_owner", "person:emma", "space:home", "owner")
    d = svc.authorize(subject="person:emma", action="lock.unlock",
                      resource="device:front_lock", context=_ctx())
    assert d.allowed


def test_kid_one_screen_scenario(svc):
    """The whole kid flow: empty kid role + parent allowlist + heater hidden."""
    svc.add_principal("person:noam", attrs={"age": 9})
    svc.bind_role("b_kid", "person:noam", "space:home", "kid")
    # Parent allowlists the kids-room light and the heater, then blocks heater.
    svc.issue_grant(Grant("noam_allow_room", Principal.person("noam"), Effect.ALLOW,
                          {"node": "space:kids_room"}, {"scope_tag": "lighting"}))
    ctx = _ctx()
    # light: allowed
    assert svc.authorize(subject="person:noam", action="light.onoff",
                         resource="device:kr_light", context=ctx).allowed
    # camera: denied (kid role denies security/cameras)
    assert not svc.authorize(subject="person:noam", action="camera.live",
                             resource="device:porch_cam", context=ctx).allowed
    # front lock: denied
    assert not svc.authorize(subject="person:noam", action="lock.unlock",
                             resource="device:front_lock", context=ctx).allowed


def test_dynamic_group_grant_reaches_kid(svc):
    """A grant on group:kids reaches Noam purely via his age attribute."""
    svc.add_principal("person:noam", attrs={"age": 9})
    svc.issue_grant(Grant("kids_lights", Principal.group("kids"), Effect.ALLOW,
                          {"node": "space:kids_room"}, {"scope_tag": "lighting"}))
    d = svc.authorize(subject="person:noam", action="light.onoff",
                      resource="device:kr_light", context=_ctx())
    assert d.allowed


# --------------------------------------------------------------------------
# Point-in-time: "who could unlock the door on <date>?"
# --------------------------------------------------------------------------

def test_point_in_time_query(svc):
    svc.add_principal("person:sister", attrs={"age": 35})
    seq_before = svc.store.latest_seq()
    svc.bind_role("b_sis", "person:sister", "space:home", "owner")
    seq_after = svc.store.latest_seq()

    # Replaying up to *before* the binding: sister has no grants.
    early = build_state(svc.store, up_to_seq=seq_before)
    assert not early.grants_for({"person:sister"})
    # Replaying the full log: she does.
    late = build_state(svc.store, up_to_seq=seq_after)
    assert late.grants_for({"person:sister"})


# --------------------------------------------------------------------------
# Delegation + revoke cascade
# --------------------------------------------------------------------------

def test_delegation_and_revoke_cascade(svc):
    svc.add_principal("person:emma", attrs={"age": 40})
    svc.add_principal("person:sister", attrs={"age": 35})
    # Emma holds a delegatable grant over the whole home.
    parent = Grant("emma_all", Principal.person("emma"), Effect.ALLOW,
                   {"node": "space:home"}, "*", delegatable=True, max_depth=1, depth=0)
    svc.issue_grant(parent)
    # Delegate lighting to sister.
    child = Grant("sis_lights", Principal.person("sister"), Effect.ALLOW,
                  {"node": "space:home"}, {"scope_tag": "lighting"})
    svc.delegate("emma_all", child)
    assert svc.authorize(subject="person:sister", action="light.onoff",
                         resource="device:kr_light", context=_ctx()).allowed
    # Revoke the root → cascade removes the delegated child.
    svc.revoke_grant(revoke_root="emma_all")
    assert not svc.authorize(subject="person:sister", action="light.onoff",
                             resource="device:kr_light", context=_ctx()).allowed


# --------------------------------------------------------------------------
# Audit
# --------------------------------------------------------------------------

def test_protected_action_is_audited(svc):
    svc.add_principal("person:emma", attrs={"age": 40})
    svc.bind_role("b_owner", "person:emma", "space:home", "owner")
    svc.authorize(subject="person:emma", action="lock.unlock",
                  resource="device:front_lock", context=_ctx())
    rows = svc.audit.query(resource="device:front_lock")
    assert rows and rows[0]["subject"] == "person:emma"
    assert rows[0]["effect"] == "allow"


def test_low_risk_action_not_audited(svc):
    svc.add_principal("person:emma", attrs={"age": 40})
    svc.bind_role("b_owner", "person:emma", "space:home", "owner")
    svc.authorize(subject="person:emma", action="light.onoff",
                  resource="device:kr_light", context=_ctx())
    assert svc.audit.query(resource="device:kr_light") == []


# --------------------------------------------------------------------------
# Query API
# --------------------------------------------------------------------------

def test_who_can_and_capabilities_of(svc):
    svc.add_principal("person:emma", attrs={"age": 40})
    svc.add_principal("person:noam", attrs={"age": 9})
    svc.bind_role("b_owner", "person:emma", "space:home", "owner")
    svc.bind_role("b_kid", "person:noam", "space:home", "kid")
    can = svc.who_can("lock.unlock", "device:front_lock", context=_ctx())
    assert "person:emma" in can
    assert "person:noam" not in can
    caps = svc.capabilities_of("person:emma", "device:front_lock", context=_ctx())
    assert "lock.unlock" in caps and "lock.lock" in caps


# --------------------------------------------------------------------------
# AI authorization
# --------------------------------------------------------------------------

def test_agent_autonomy_ladder(svc):
    svc.add_principal("person:david", attrs={"age": 40})
    svc.bind_role("b_owner", "person:david", "space:home", "owner")
    # Agent envelope: allow everything, but autonomy differs by scope tag.
    # Everything defaults to "ask"; only climate is trusted to run autonomously.
    # (lock.unlock carries both security + physical_access tags, and the most-
    # restrictive tag wins — so "ask" must be the floor for it to require asking.)
    svc.add_principal("agent:ziggy", attrs={
        "autonomy": {"climate": "act"},
        "default_autonomy": "ask",
    })
    svc.issue_grant(Grant("ziggy_env", Principal.agent("ziggy"), Effect.ALLOW,
                          {"node": "space:home"}, "*"))
    # Climate = act → may act autonomously on behalf of David.
    v1 = evaluate_agent_action(svc, agent="agent:ziggy", action="climate.setpoint",
                               resource="device:kr_heater", on_behalf_of="person:david",
                               context=_ctx())
    assert v1.may_act and v1.mode == "act"
    # Security = ask → must ask unless explicitly confirmed.
    v2 = evaluate_agent_action(svc, agent="agent:ziggy", action="lock.unlock",
                               resource="device:front_lock", on_behalf_of="person:david",
                               context=_ctx())
    assert not v2.may_act and v2.mode == "ask"
    v3 = evaluate_agent_action(svc, agent="agent:ziggy", action="lock.unlock",
                               resource="device:front_lock", on_behalf_of="person:david",
                               context=_ctx(), explicit_confirm=True)
    assert v3.may_act


def test_agent_cannot_exceed_delegator(svc):
    # Kid can't unlock; agent acting on behalf of kid can't either, even though
    # the agent's own envelope allows it.
    svc.add_principal("person:noam", attrs={"age": 9})
    svc.bind_role("b_kid", "person:noam", "space:home", "kid")
    svc.add_principal("agent:ziggy", attrs={"autonomy": {"security": "act"}})
    svc.issue_grant(Grant("ziggy_env", Principal.agent("ziggy"), Effect.ALLOW,
                          {"node": "space:home"}, "*"))
    v = evaluate_agent_action(svc, agent="agent:ziggy", action="lock.unlock",
                              resource="device:front_lock", on_behalf_of="person:noam",
                              context=_ctx())
    assert not v.may_act and v.mode == "deny"


def test_agent_critical_never_autonomous(svc):
    svc.add_principal("person:david", attrs={"age": 40})
    svc.bind_role("b_owner", "person:david", "space:home", "owner")
    # A critical device + an "act" autonomy → still forced to ask.
    svc.add_device("safe", "gunsafe", space_id="home")
    from services.permissions.capabilities import CapabilityDef
    from services.permissions.types import RiskTier
    svc.capabilities.register(CapabilityDef("gunsafe.unlock", "gunsafe",
                              RiskTier.CRITICAL, frozenset({"security"})))
    svc.add_principal("agent:ziggy", attrs={"autonomy": {"security": "act"}})
    svc.issue_grant(Grant("ziggy_env", Principal.agent("ziggy"), Effect.ALLOW,
                          {"node": "space:home"}, "*"))
    v = evaluate_agent_action(svc, agent="agent:ziggy", action="gunsafe.unlock",
                              resource="device:safe", on_behalf_of="person:david",
                              context=_ctx())
    assert v.mode == "ask" and not v.may_act


# --------------------------------------------------------------------------
# Legacy compatibility
# --------------------------------------------------------------------------

def test_legacy_role_mapping():
    assert legacy_role_to_preset("super_admin") == "owner"
    assert legacy_role_to_preset("user") == "adult"
    assert legacy_role_to_preset("guest") == "guest"
    assert legacy_role_to_preset("nonsense") == "guest"


def test_legacy_linear_check_matches_auth_deps():
    from backend.routers.auth_deps import ROLE_ORDER, require_role  # noqa
    assert legacy_role_satisfies("admin", "user") is True
    assert legacy_role_satisfies("user", "admin") is False
    assert legacy_role_satisfies("relay_admin", "super_admin") is True


def test_seed_legacy_user_authorizes(svc):
    seed_legacy_user(svc, username="owner@x.com", role="super_admin",
                     home_scope="space:home")
    d = svc.authorize(subject="person:owner@x.com", action="lock.unlock",
                      resource="device:front_lock", context=_ctx())
    assert d.allowed
