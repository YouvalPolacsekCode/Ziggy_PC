"""PDP engine tests — inheritance, conflict resolution, obligations, emergency."""
from __future__ import annotations

import pytest

from services.permissions.capabilities import build_default_registry
from services.permissions.context import ContextBuilder
from services.permissions.engine import Engine
from services.permissions.grants import Grant
from services.permissions.resources import Device, ResourceGraph, Space
from services.permissions.types import (
    Effect,
    Obligation,
    ObligationKind,
    Principal,
)


# --------------------------------------------------------------------------
# Fixtures: a small but realistic home graph
# --------------------------------------------------------------------------

@pytest.fixture
def graph():
    g = ResourceGraph()
    g.add_space(Space("home", "home"))
    g.add_space(Space("living", "room", parent_ids=["home"], tags={"common_area"}))
    g.add_space(Space("kids_room", "room", parent_ids=["home"]))
    g.add_device(Device("lr_light", "light", space_id="living"))
    g.add_device(Device("kr_light", "light", space_id="kids_room"))
    g.add_device(Device("kr_heater", "climate", space_id="kids_room", tags={"dangerous"}))
    g.add_device(Device("front_lock", "lock", space_id="home"))
    g.add_device(Device("porch_cam", "camera", space_id="home", tags={"outdoor"}))
    return g


@pytest.fixture
def engine(graph):
    return Engine(build_default_registry(), graph)


def _ctx(**kw):
    b = ContextBuilder().time(local_hhmm=kw.get("time", "12:00")).session(
        channel=kw.get("channel", "app"), trust_level=kw.get("trust", 3))
    if kw.get("emergency"):
        b.emergency()
    if "age" in kw:
        b.subject(age=kw["age"])
    if "mode" in kw:
        b.home(mode=kw["mode"])
    return b.build()


EMMA = Principal.person("emma")
KIDS = Principal.group("kids")


# --------------------------------------------------------------------------
# Default deny
# --------------------------------------------------------------------------

def test_default_deny_when_no_grants(engine):
    d = engine.decide(subject_principals=[EMMA], action="light.onoff",
                      resource="device:lr_light", grants=[], context=_ctx())
    assert not d.allowed
    assert "default deny" in d.reason


def test_unknown_resource_is_denied(engine):
    d = engine.decide(subject_principals=[EMMA], action="light.onoff",
                      resource="device:ghost", grants=[], context=_ctx())
    assert not d.allowed
    assert "unknown resource" in d.reason


# --------------------------------------------------------------------------
# Downward inheritance: a grant on the home applies to a device inside it
# --------------------------------------------------------------------------

def test_grant_on_home_inherits_to_device(engine):
    g = Grant("g1", EMMA, Effect.ALLOW, {"node": "space:home"}, {"key": "light.onoff"})
    d = engine.decide(subject_principals=[EMMA], action="light.onoff",
                      resource="device:lr_light", grants=[g], context=_ctx())
    assert d.allowed


def test_grant_on_room_does_not_leak_to_sibling(engine):
    g = Grant("g1", EMMA, Effect.ALLOW, {"node": "space:kids_room"}, {"key": "light.onoff"})
    # living-room light is NOT under kids_room
    d = engine.decide(subject_principals=[EMMA], action="light.onoff",
                      resource="device:lr_light", grants=[g], context=_ctx())
    assert not d.allowed


# --------------------------------------------------------------------------
# The signature case: "everything in the room EXCEPT the heater"
# device-level deny beats room-level allow
# --------------------------------------------------------------------------

def test_device_deny_overrides_room_allow(engine):
    allow_room = Grant("allow_room", KIDS, Effect.ALLOW,
                       {"node": "space:kids_room"}, "*")
    deny_heater = Grant("deny_heater", KIDS, Effect.DENY,
                        {"resource": "device:kr_heater"}, "*")
    grants = [allow_room, deny_heater]
    # kid can use the room light
    light = engine.decide(subject_principals=[KIDS], action="light.onoff",
                          resource="device:kr_light", grants=grants, context=_ctx())
    assert light.allowed
    # ...but not the heater
    heater = engine.decide(subject_principals=[KIDS], action="climate.setpoint",
                           resource="device:kr_heater", grants=grants, context=_ctx())
    assert not heater.allowed
    assert heater.matched_grant_ids == ["deny_heater"]


def test_equal_specificity_deny_wins(engine):
    allow = Grant("a", EMMA, Effect.ALLOW, {"resource": "device:front_lock"}, {"key": "lock.unlock"})
    deny = Grant("d", EMMA, Effect.DENY, {"resource": "device:front_lock"}, {"key": "lock.unlock"})
    d = engine.decide(subject_principals=[EMMA], action="lock.unlock",
                      resource="device:front_lock", grants=[allow, deny], context=_ctx())
    assert not d.allowed


# --------------------------------------------------------------------------
# Group membership
# --------------------------------------------------------------------------

def test_group_grant_applies_to_member(engine):
    g = Grant("g", KIDS, Effect.ALLOW, {"node": "space:kids_room"}, {"key": "light.onoff"})
    # subject is expanded to include the group they belong to
    d = engine.decide(subject_principals=[EMMA, KIDS], action="light.onoff",
                      resource="device:kr_light", grants=[g], context=_ctx())
    assert d.allowed


def test_grant_for_other_principal_ignored(engine):
    g = Grant("g", Principal.person("david"), Effect.ALLOW,
              {"node": "space:home"}, "*")
    d = engine.decide(subject_principals=[EMMA], action="light.onoff",
                      resource="device:lr_light", grants=[g], context=_ctx())
    assert not d.allowed


# --------------------------------------------------------------------------
# Conditions: channel + time + age
# --------------------------------------------------------------------------

def test_voice_cannot_unlock_but_can_light(engine):
    lights = Grant("lights", EMMA, Effect.ALLOW, {"node": "space:home"},
                   {"scope_tag": "lighting"},
                   condition={"in": [{"var": "channel"}, ["app", "voice"]]})
    unlock = Grant("unlock", EMMA, Effect.ALLOW, {"node": "space:home"},
                   {"key": "lock.unlock"},
                   condition={"==": [{"var": "channel"}, "app"]})
    grants = [lights, unlock]
    # by voice: light yes
    d1 = engine.decide(subject_principals=[EMMA], action="light.onoff",
                       resource="device:lr_light", grants=grants,
                       context=_ctx(channel="voice"))
    assert d1.allowed
    # by voice: unlock no
    d2 = engine.decide(subject_principals=[EMMA], action="lock.unlock",
                       resource="device:front_lock", grants=grants,
                       context=_ctx(channel="voice"))
    assert not d2.allowed
    # by app: unlock yes
    d3 = engine.decide(subject_principals=[EMMA], action="lock.unlock",
                       resource="device:front_lock", grants=grants,
                       context=_ctx(channel="app"))
    assert d3.allowed


def test_allowed_hours_condition(engine):
    g = Grant("g", KIDS, Effect.ALLOW, {"node": "space:kids_room"}, "*",
              condition={"between": [{"var": "time.local"}, "07:00", "20:00"]})
    ok = engine.decide(subject_principals=[KIDS], action="light.onoff",
                       resource="device:kr_light", grants=[g], context=_ctx(time="10:00"))
    assert ok.allowed
    blocked = engine.decide(subject_principals=[KIDS], action="light.onoff",
                            resource="device:kr_light", grants=[g], context=_ctx(time="22:00"))
    assert not blocked.allowed


# --------------------------------------------------------------------------
# Obligations derived from risk tier
# --------------------------------------------------------------------------

def test_high_risk_action_carries_stepup_obligation(engine):
    g = Grant("g", EMMA, Effect.ALLOW, {"node": "space:home"}, {"key": "lock.unlock"})
    d = engine.decide(subject_principals=[EMMA], action="lock.unlock",
                      resource="device:front_lock", grants=[g], context=_ctx())
    assert d.allowed
    kinds = {o.kind for o in d.obligations}
    assert ObligationKind.STEP_UP in kinds
    assert ObligationKind.LOG_VERBOSE in kinds


def test_low_risk_action_has_no_obligations(engine):
    g = Grant("g", EMMA, Effect.ALLOW, {"node": "space:home"}, {"key": "light.onoff"})
    d = engine.decide(subject_principals=[EMMA], action="light.onoff",
                      resource="device:lr_light", grants=[g], context=_ctx())
    assert d.allowed
    assert d.obligations == []


def test_grant_authored_obligation_is_merged(engine):
    g = Grant("g", EMMA, Effect.ALLOW, {"node": "space:home"}, {"key": "lock.unlock"},
              obligations=[Obligation.make(ObligationKind.NOTIFY, targets=("owners",))])
    d = engine.decide(subject_principals=[EMMA], action="lock.unlock",
                      resource="device:front_lock", grants=[g], context=_ctx())
    notify = [o for o in d.obligations if o.kind == ObligationKind.NOTIFY]
    assert notify and "owners" in notify[0].param_dict["targets"]


# --------------------------------------------------------------------------
# Emergency break-glass
# --------------------------------------------------------------------------

def test_emergency_override_beats_deny_with_audit(engine):
    deny = Grant("deny", Principal.person("nanny"), Effect.DENY,
                 {"node": "space:home"}, {"key": "lock.unlock"})
    breakglass = Grant("bg", Principal.person("nanny"), Effect.ALLOW,
                       {"node": "space:home"}, {"key": "lock.unlock"},
                       emergency_override=True)
    grants = [deny, breakglass]
    P = Principal.person("nanny")
    # normal: denied
    normal = engine.decide(subject_principals=[P], action="lock.unlock",
                           resource="device:front_lock", grants=grants, context=_ctx())
    assert not normal.allowed
    # emergency: allowed, but loudly audited
    emer = engine.decide(subject_principals=[P], action="lock.unlock",
                         resource="device:front_lock", grants=grants,
                         context=_ctx(emergency=True))
    assert emer.allowed
    kinds = {o.kind for o in emer.obligations}
    assert ObligationKind.RECORD_REASON in kinds
    assert ObligationKind.NOTIFY in kinds


def test_emergency_override_requires_the_flag(engine):
    deny = Grant("deny", EMMA, Effect.DENY, {"node": "space:home"}, {"key": "lock.unlock"})
    plain_allow = Grant("a", EMMA, Effect.ALLOW, {"node": "space:home"}, {"key": "lock.unlock"})
    d = engine.decide(subject_principals=[EMMA], action="lock.unlock",
                      resource="device:front_lock", grants=[deny, plain_allow],
                      context=_ctx(emergency=True))
    # allow is not flagged emergency_override, so deny still wins
    assert not d.allowed


# --------------------------------------------------------------------------
# Temporal validity
# --------------------------------------------------------------------------

def test_expired_grant_does_not_apply(engine):
    g = Grant("g", EMMA, Effect.ALLOW, {"node": "space:home"}, "*", expires_at=1000.0)
    live = engine.decide(subject_principals=[EMMA], action="light.onoff",
                         resource="device:lr_light", grants=[g], context=_ctx(), now=500.0)
    assert live.allowed
    expired = engine.decide(subject_principals=[EMMA], action="light.onoff",
                            resource="device:lr_light", grants=[g], context=_ctx(), now=2000.0)
    assert not expired.allowed


def test_max_uses_exhausted(engine):
    g = Grant("g", EMMA, Effect.ALLOW, {"node": "space:home"}, "*", max_uses=1, uses=1)
    d = engine.decide(subject_principals=[EMMA], action="light.onoff",
                      resource="device:lr_light", grants=[g], context=_ctx(), now=1.0)
    assert not d.allowed
