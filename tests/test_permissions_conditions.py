"""Tests for the condition expression language + core value types."""
from __future__ import annotations

import pytest

from services.permissions.conditions import (
    ConditionError,
    evaluate,
    referenced_vars,
    validate,
)
from services.permissions.context import Context, ContextBuilder
from services.permissions.types import (
    Effect,
    Obligation,
    ObligationKind,
    Principal,
    PrincipalType,
    RiskTier,
    merge_obligations,
)


# --------------------------------------------------------------------------
# Context resolution
# --------------------------------------------------------------------------

def test_context_dotted_resolution_and_missing():
    ctx = Context({"subject": {"age": 15}, "home": {"mode": "night"}})
    assert ctx.resolve("subject.age") == 15
    assert ctx.resolve("home.mode") == "night"
    assert ctx.resolve("subject.missing") is None
    assert ctx.resolve("nope.at.all") is None
    # Traversing through a non-dict must not crash.
    assert ctx.resolve("subject.age.deeper") is None


# --------------------------------------------------------------------------
# Boolean logic
# --------------------------------------------------------------------------

def test_null_condition_is_always_true():
    assert evaluate(None, Context({})) is True


def test_all_any_not():
    ctx = Context({"x": 5})
    assert evaluate({"all": [{"==": [{"var": "x"}, 5]}, {">": [{"var": "x"}, 1]}]}, ctx)
    assert not evaluate({"all": [{"==": [{"var": "x"}, 5]}, {">": [{"var": "x"}, 9]}]}, ctx)
    assert evaluate({"any": [{"==": [{"var": "x"}, 0]}, {"==": [{"var": "x"}, 5]}]}, ctx)
    assert evaluate({"not": {"==": [{"var": "x"}, 0]}}, ctx)
    # Vacuous truth / falsity.
    assert evaluate({"all": []}, ctx) is True
    assert evaluate({"any": []}, ctx) is False


def test_comparisons_and_membership():
    ctx = Context({"age": 15, "role": "kid", "roles": ["kid", "resident"]})
    assert evaluate({">=": [{"var": "age"}, 13]}, ctx)
    assert not evaluate({">=": [{"var": "age"}, 18]}, ctx)
    assert evaluate({"in": [{"var": "role"}, ["kid", "teen"]]}, ctx)
    assert evaluate({"in": ["resident", {"var": "roles"}]}, ctx)
    assert evaluate({"matches": [{"var": "role"}, "k*"]}, ctx)


def test_none_is_failsafe_for_ordered_comparisons():
    # Missing presence must never satisfy a restrictive numeric gate.
    ctx = Context({})
    assert evaluate({">=": [{"var": "session.trust_level"}, 3]}, ctx) is False
    assert evaluate({"<": [{"var": "x"}, 5]}, ctx) is False
    # But == with a missing var is a legitimate False, and != is True.
    assert evaluate({"==": [{"var": "x"}, None]}, ctx) is True
    assert evaluate({"!=": [{"var": "x"}, "y"]}, ctx) is True


def test_mismatched_types_do_not_raise():
    ctx = Context({"x": "hello"})
    assert evaluate({">": [{"var": "x"}, 5]}, ctx) is False


# --------------------------------------------------------------------------
# Time-of-day between, including midnight wrap
# --------------------------------------------------------------------------

@pytest.mark.parametrize("now,expected", [
    ("08:00", True), ("07:00", True), ("22:00", True), ("06:59", False), ("22:01", False),
])
def test_between_allowed_hours(now, expected):
    ctx = Context({"time": {"local": now}})
    cond = {"between": [{"var": "time.local"}, "07:00", "22:00"]}
    assert evaluate(cond, ctx) is expected


@pytest.mark.parametrize("now,expected", [
    ("23:30", True), ("00:00", True), ("06:59", True), ("07:00", True),
    ("07:01", False), ("12:00", False), ("21:59", False), ("22:00", True),
])
def test_between_quiet_hours_wraparound(now, expected):
    # Quiet hours 22:00 -> 07:00 spans midnight.
    ctx = Context({"time": {"local": now}})
    cond = {"between": [{"var": "time.local"}, "22:00", "07:00"]}
    assert evaluate(cond, ctx) is expected


def test_between_numeric():
    ctx = Context({"temp": 24})
    assert evaluate({"between": [{"var": "temp"}, 21, 25]}, ctx)
    assert not evaluate({"between": [{"var": "temp"}, 10, 20]}, ctx)


# --------------------------------------------------------------------------
# Validation
# --------------------------------------------------------------------------

def test_validate_accepts_good_and_rejects_bad():
    validate(None)
    validate({"all": [{"==": [{"var": "a"}, 1]}]})
    with pytest.raises(ConditionError):
        validate({"bogus_op": [1, 2]})
    with pytest.raises(ConditionError):
        validate({"==": [1]})  # wrong arity
    with pytest.raises(ConditionError):
        validate({"==": [1, 2], "extra": 3})  # two keys
    with pytest.raises(ConditionError):
        validate({"in": [{"var": ""}, []]})  # empty var path


def test_referenced_vars():
    cond = {"all": [
        {"between": [{"var": "time.local"}, "07:00", "22:00"]},
        {">=": [{"var": "session.trust_level"}, 2]},
    ]}
    assert referenced_vars(cond) == {"time.local", "session.trust_level"}


# --------------------------------------------------------------------------
# ContextBuilder produces the documented well-known shape
# --------------------------------------------------------------------------

def test_context_builder_wellknown_keys():
    ctx = (ContextBuilder()
           .time(local_hhmm="21:30", dow=2)
           .subject(age=15, role="kid")
           .presence(home=True)
           .home(mode="home")
           .session(channel="voice", trust_level=1)
           .build())
    assert ctx.resolve("time.local") == "21:30"
    assert ctx.resolve("subject.age") == 15
    assert ctx.resolve("channel") == "voice"
    assert ctx.resolve("session.trust_level") == 1
    assert ctx.resolve("emergency") is False


def test_emergency_shortcut_sets_mode():
    ctx = ContextBuilder().emergency().build()
    assert ctx.resolve("emergency") is True
    assert ctx.resolve("home.mode") == "emergency"


# --------------------------------------------------------------------------
# Value types
# --------------------------------------------------------------------------

def test_principal_ref_roundtrip():
    p = Principal.person("emma")
    assert p.ref == "person:emma"
    assert Principal.parse("person:emma") == p
    assert Principal.group("kids").type == PrincipalType.GROUP
    with pytest.raises(ValueError):
        Principal.parse("garbage")
    with pytest.raises(ValueError):
        Principal(PrincipalType.PERSON, "")


def test_risk_tier_rank_is_ordered():
    assert RiskTier.LOW.rank < RiskTier.MEDIUM.rank < RiskTier.HIGH.rank < RiskTier.CRITICAL.rank


def test_merge_obligations_keeps_strictest():
    obs = [
        Obligation.make(ObligationKind.STEP_UP, min_trust=2),
        Obligation.make(ObligationKind.STEP_UP, min_trust=3),
        Obligation.make(ObligationKind.NOTIFY, targets=("owners",)),
        Obligation.make(ObligationKind.NOTIFY, targets=("guardians",)),
        Obligation.make(ObligationKind.UNDO_WINDOW, seconds=10),
        Obligation.make(ObligationKind.UNDO_WINDOW, seconds=30),
    ]
    merged = merge_obligations(obs)
    by_kind = {o.kind: o for o in merged}
    assert by_kind[ObligationKind.STEP_UP].param_dict["min_trust"] == 3
    assert by_kind[ObligationKind.UNDO_WINDOW].param_dict["seconds"] == 30
    assert set(by_kind[ObligationKind.NOTIFY].param_dict["targets"]) == {"owners", "guardians"}


def test_decision_helpers():
    from services.permissions.types import Decision
    d = Decision.deny("no matching grant")
    assert d.allowed is False
    assert d.effect == Effect.DENY
    assert d.to_json()["allowed"] is False


def test_obligation_stays_hashable_after_json_roundtrip():
    ob = Obligation.make(ObligationKind.NOTIFY, targets=["owners", "guardians"])
    # hashable (frozen dataclass) even though targets came in as a list
    assert isinstance(hash(ob), int)
    assert {ob}  # usable in a set
    # round-trip through JSON and back
    j = ob.to_json()
    ob2 = Obligation.make(ObligationKind(j["kind"]), **j["params"])
    assert ob2 == ob


def test_grant_json_roundtrip_with_obligations():
    from services.permissions.grants import Grant
    from services.permissions.types import Effect, Principal
    g = Grant("g1", Principal.person("emma"), Effect.ALLOW,
              {"node": "space:home"}, {"key": "lock.unlock"},
              obligations=[Obligation.make(ObligationKind.NOTIFY, targets=["owners"])])
    g2 = Grant.from_json(g.to_json())
    assert g2.id == g.id
    assert g2.principal == g.principal
    assert g2.obligations == g.obligations
