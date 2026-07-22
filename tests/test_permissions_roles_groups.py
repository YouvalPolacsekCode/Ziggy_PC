"""Tests for role expansion, group/relationship resolution, and delegation."""
from __future__ import annotations

import pytest

from services.permissions.capabilities import build_default_registry
from services.permissions.context import ContextBuilder
from services.permissions.delegation import DelegationError, validate_delegation
from services.permissions.engine import Engine
from services.permissions.grants import Grant
from services.permissions.groups import (
    PrincipalResolver,
    RelationshipGraph,
    default_groups,
)
from services.permissions.resources import Device, ResourceGraph, Space
from services.permissions.roles import expand_role
from services.permissions.types import Effect, Principal


@pytest.fixture
def graph():
    g = ResourceGraph()
    g.add_space(Space("home", "home"))
    g.add_space(Space("kids_room", "room", parent_ids=["home"]))
    g.add_device(Device("kr_light", "light", space_id="kids_room"))
    g.add_device(Device("front_lock", "lock", space_id="home"))
    g.add_device(Device("porch_cam", "camera", space_id="home"))
    return g


@pytest.fixture
def engine(graph):
    return Engine(build_default_registry(), graph)


# --------------------------------------------------------------------------
# Role expansion
# --------------------------------------------------------------------------

def test_owner_role_grants_everything(engine):
    emma = Principal.person("emma")
    grants = expand_role("owner", principal=emma, scope_ref="space:home",
                         binding_id="b_owner")
    ctx = ContextBuilder().session(channel="app", trust_level=3).build()
    d = engine.decide(subject_principals=[emma], action="lock.unlock",
                      resource="device:front_lock", grants=grants, context=ctx)
    assert d.allowed


def test_kid_role_is_default_deny_but_denies_security(engine):
    noam = Principal.person("noam")
    grants = expand_role("kid", principal=noam, scope_ref="space:home",
                         binding_id="b_kid")
    ctx = ContextBuilder().session(channel="app", trust_level=3).subject(age=9).build()
    # kid preset grants nothing affirmatively → default deny on a light
    light = engine.decide(subject_principals=[noam], action="light.onoff",
                          resource="device:kr_light", grants=grants, context=ctx)
    assert not light.allowed
    # ...and explicitly denies the camera
    cam = engine.decide(subject_principals=[noam], action="camera.live",
                        resource="device:porch_cam", grants=grants, context=ctx)
    assert not cam.allowed


def test_kid_allowlist_grant_layers_over_role(engine):
    """Parent allowlists one device — it should win over the empty kid role."""
    noam = Principal.person("noam")
    grants = expand_role("kid", principal=noam, scope_ref="space:home",
                         binding_id="b_kid")
    # device-level allow for the kids-room light
    grants.append(Grant("allow_kr_light", noam, Effect.ALLOW,
                        {"resource": "device:kr_light"}, {"scope_tag": "lighting"}))
    ctx = ContextBuilder().session(channel="app", trust_level=3).subject(age=9).build()
    d = engine.decide(subject_principals=[noam], action="light.onoff",
                      resource="device:kr_light", grants=grants, context=ctx)
    assert d.allowed


def test_temp_guest_binding_expiry_is_stamped(engine):
    guest = Principal.person("airbnb1")
    grants = expand_role("temp_guest", principal=guest, scope_ref="space:home",
                         binding_id="b_tg", expires_at=1000.0)
    assert all(g.expires_at == 1000.0 for g in grants)
    ctx = ContextBuilder().session(channel="app", trust_level=2).build()
    # before expiry: light allowed
    live = engine.decide(subject_principals=[guest], action="light.onoff",
                         resource="device:kr_light", grants=grants, context=ctx, now=500.0)
    assert live.allowed
    # after expiry: denied
    dead = engine.decide(subject_principals=[guest], action="light.onoff",
                         resource="device:kr_light", grants=grants, context=ctx, now=2000.0)
    assert not dead.allowed


def test_binding_condition_is_anded_in(engine):
    guest = Principal.person("cleaner")
    window = {"between": [{"var": "time.local"}, "09:00", "12:00"]}
    grants = expand_role("guest", principal=guest, scope_ref="space:home",
                         binding_id="b_clean", condition=window)
    inside = ContextBuilder().time(local_hhmm="10:00").session(channel="app").build()
    outside = ContextBuilder().time(local_hhmm="15:00").session(channel="app").build()
    assert engine.decide(subject_principals=[guest], action="light.onoff",
                         resource="device:kr_light", grants=grants, context=inside).allowed
    assert not engine.decide(subject_principals=[guest], action="light.onoff",
                             resource="device:kr_light", grants=grants, context=outside).allowed


# --------------------------------------------------------------------------
# Groups + relationships
# --------------------------------------------------------------------------

def test_dynamic_group_by_age():
    resolver = PrincipalResolver(default_groups(), RelationshipGraph())
    ctx = ContextBuilder().subject(age=15).build()
    principals = resolver.expand(Principal.person("noam"), ctx)
    refs = {p.ref for p in principals}
    assert "group:teens" in refs
    assert "group:adults" not in refs
    assert "group:kids" not in refs
    assert "group:everyone" in refs


def test_dynamic_group_guardians_via_relationship():
    rel = RelationshipGraph()
    rel.add("person:emma", "guardian_of", "person:noam")
    resolver = PrincipalResolver(default_groups(), rel)
    ctx = ContextBuilder().subject(age=40).build()
    principals = resolver.expand(Principal.person("emma"), ctx)
    refs = {p.ref for p in principals}
    assert "group:guardians" in refs
    assert "group:adults" in refs
    # someone with no guardian edge is not a guardian
    other = resolver.expand(Principal.person("david"), ctx)
    assert "group:guardians" not in {p.ref for p in other}


def test_group_grant_reaches_member_through_resolver(engine):
    """End-to-end: a grant on group:kids reaches Noam once expanded."""
    resolver = PrincipalResolver(default_groups(), RelationshipGraph())
    ctx = ContextBuilder().subject(age=9).session(channel="app").build()
    principals = resolver.expand(Principal.person("noam"), ctx)
    grant = Grant("kids_light", Principal.group("kids"), Effect.ALLOW,
                  {"node": "space:kids_room"}, {"scope_tag": "lighting"})
    d = engine.decide(subject_principals=principals, action="light.onoff",
                      resource="device:kr_light", grants=[grant], context=ctx)
    assert d.allowed


def test_nested_static_groups():
    fam = Group_static("family", ["person:emma", "group:kids"])
    kids = Group_static("kids2", ["person:noam"])
    resolver = PrincipalResolver([fam, kids], RelationshipGraph())
    # noam is in kids2? No — construct so kids2 nests into family via ref.
    # Simpler nested check: family lists group:kids2 as a member.
    fam2 = Group_static("familyX", ["group:kids2"])
    resolver2 = PrincipalResolver([fam2, kids], RelationshipGraph())
    ctx = ContextBuilder().subject(age=9).build()
    principals = resolver2.expand(Principal.person("noam"), ctx)
    refs = {p.ref for p in principals}
    assert "group:kids2" in refs      # direct static membership
    assert "group:familyX" in refs    # nested: familyX contains kids2


def Group_static(gid, members):
    from services.permissions.groups import Group
    return Group(gid, "static", members=members)


# --------------------------------------------------------------------------
# Delegation attenuation
# --------------------------------------------------------------------------

def test_delegation_subset_ok(engine):
    parent = Grant("p", Principal.person("emma"), Effect.ALLOW,
                   {"node": "space:home"}, "*", delegatable=True, max_depth=1, depth=0)
    child = Grant("c", Principal.person("sister"), Effect.ALLOW,
                  {"node": "space:home"}, {"scope_tag": "lighting"}, depth=1)
    validate_delegation(parent, child, engine)  # should not raise


def test_delegation_superset_rejected(engine):
    # parent only holds lighting; child tries to grant locks → reject
    parent = Grant("p", Principal.person("emma"), Effect.ALLOW,
                   {"node": "space:home"}, {"scope_tag": "lighting"},
                   delegatable=True, max_depth=1, depth=0)
    child = Grant("c", Principal.person("sister"), Effect.ALLOW,
                  {"node": "space:home"}, {"key": "lock.unlock"}, depth=1)
    with pytest.raises(DelegationError):
        validate_delegation(parent, child, engine)


def test_delegation_requires_delegatable_flag(engine):
    parent = Grant("p", Principal.person("emma"), Effect.ALLOW,
                   {"node": "space:home"}, "*", delegatable=False, depth=0)
    child = Grant("c", Principal.person("sister"), Effect.ALLOW,
                  {"node": "space:home"}, {"scope_tag": "lighting"}, depth=1)
    with pytest.raises(DelegationError):
        validate_delegation(parent, child, engine)


def test_delegation_child_cannot_outlive_parent(engine):
    parent = Grant("p", Principal.person("emma"), Effect.ALLOW,
                   {"node": "space:home"}, "*", delegatable=True, max_depth=1,
                   depth=0, expires_at=1000.0)
    child = Grant("c", Principal.person("sister"), Effect.ALLOW,
                  {"node": "space:home"}, {"scope_tag": "lighting"}, depth=1,
                  expires_at=2000.0)
    with pytest.raises(DelegationError):
        validate_delegation(parent, child, engine)


def test_delegation_condition_must_be_retained(engine):
    cond = {"between": [{"var": "time.local"}, "09:00", "17:00"]}
    parent = Grant("p", Principal.person("pm"), Effect.ALLOW,
                   {"node": "space:home"}, "*", condition=cond,
                   delegatable=True, max_depth=2, depth=0)
    # child drops the time window → reject
    bad = Grant("c", Principal.person("installer"), Effect.ALLOW,
                {"node": "space:home"}, {"scope_tag": "lighting"}, depth=1)
    with pytest.raises(DelegationError):
        validate_delegation(parent, bad, engine)
    # child keeps it (ANDs more) → ok
    good = Grant("c2", Principal.person("installer"), Effect.ALLOW,
                 {"node": "space:home"}, {"scope_tag": "lighting"}, depth=1,
                 condition={"all": [cond, {"==": [{"var": "channel"}, "app"]}]})
    validate_delegation(parent, good, engine)
