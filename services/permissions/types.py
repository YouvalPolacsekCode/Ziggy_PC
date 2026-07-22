"""Core value types for the Ziggy permission engine.

This module is the shared vocabulary every other permission module speaks. It
holds ZERO business logic and ZERO I/O so it can be imported from anywhere
(engine, store, API, tests) without creating cycles or dragging in FastAPI /
SQLite. Everything here is a small, hashable, JSON-round-trippable value object.

Design notes
------------
* ``Principal`` is the abstract "who" — a person, a group, an AI agent, a
  kiosk, or a service account. Grants target principals; sessions *act as* one.
  Permissions belong to the person, never to a device (see ``Identity`` in the
  store layer).
* ``Effect`` is deliberately just ALLOW/DENY. Everything nuanced (step-up auth,
  notify, two-person) is expressed as an ``Obligation`` attached to an ALLOW,
  never as a third effect. This keeps conflict resolution a two-valued lattice.
* ``RiskTier`` is an *attribute of a capability*, not a hardcoded list of
  "protected actions". A new dangerous device declares its tier in its manifest
  and inherits the right obligations with no engine change.
* ``Channel`` + ``trust_level`` are what let "lights by voice yes, unlock by
  voice no" and step-up auth be pure policy instead of special cases.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field
from typing import Any


# ---------------------------------------------------------------------------
# Effect — the two-valued core of every decision
# ---------------------------------------------------------------------------

class Effect(str, enum.Enum):
    ALLOW = "allow"
    DENY = "deny"


# ---------------------------------------------------------------------------
# Risk — a capability attribute that drives obligations (not a fixed list)
# ---------------------------------------------------------------------------

class RiskTier(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @property
    def rank(self) -> int:
        return _RISK_RANK[self]


_RISK_RANK = {
    RiskTier.LOW: 0,
    RiskTier.MEDIUM: 1,
    RiskTier.HIGH: 2,
    RiskTier.CRITICAL: 3,
}


# ---------------------------------------------------------------------------
# Channel + actor — request provenance
# ---------------------------------------------------------------------------

class Channel(str, enum.Enum):
    """How a request physically arrived. Read by conditions/obligations.

    NB: trust is a *separate* numeric axis (0..3) carried on the session, not
    baked into the channel — a phone (app) can be trust 3 with biometrics or
    trust 1 when merely unlocked.
    """
    APP = "app"
    VOICE = "voice"
    FACE = "face"
    NFC = "nfc"
    FOB = "fob"
    CAR = "car"
    KIOSK = "kiosk"
    API = "api"
    AUTOMATION = "automation"
    AGENT = "agent"
    SYSTEM = "system"


class ActorKind(str, enum.Enum):
    """Who/what is really driving the action — feeds ``context.actor_kind``
    so AI/automation policies (autonomy ladder) can gate on it."""
    HUMAN = "human"
    AUTOMATION = "automation"
    AGENT = "agent"
    SYSTEM = "system"


# ---------------------------------------------------------------------------
# Principal — the abstract "who"
# ---------------------------------------------------------------------------

class PrincipalType(str, enum.Enum):
    PERSON = "person"
    GROUP = "group"
    AGENT = "agent"
    KIOSK = "kiosk"
    SERVICE = "service"


@dataclass(frozen=True)
class Principal:
    """A stable, hashable reference to a subject a grant can be about.

    ``ref`` gives the canonical "type:id" string used as a dict/set key and as
    the on-the-wire identifier in the API and audit log.
    """
    type: PrincipalType
    id: str

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("Principal.id must be non-empty")

    @property
    def ref(self) -> str:
        return f"{self.type.value}:{self.id}"

    @classmethod
    def parse(cls, ref: str) -> "Principal":
        typ, _, pid = ref.partition(":")
        if not _:
            raise ValueError(f"malformed principal ref: {ref!r}")
        return cls(PrincipalType(typ), pid)

    # Convenience constructors — read better at call sites than Principal(...).
    @classmethod
    def person(cls, pid: str) -> "Principal":
        return cls(PrincipalType.PERSON, pid)

    @classmethod
    def group(cls, gid: str) -> "Principal":
        return cls(PrincipalType.GROUP, gid)

    @classmethod
    def agent(cls, aid: str) -> "Principal":
        return cls(PrincipalType.AGENT, aid)

    @classmethod
    def kiosk(cls, kid: str) -> "Principal":
        return cls(PrincipalType.KIOSK, kid)

    @classmethod
    def service(cls, sid: str) -> "Principal":
        return cls(PrincipalType.SERVICE, sid)


# ---------------------------------------------------------------------------
# Obligations — strings attached to an ALLOW
# ---------------------------------------------------------------------------

class ObligationKind(str, enum.Enum):
    STEP_UP = "step_up"            # require trust_level >= params["min_trust"]
    CONFIRM = "confirm"            # require an explicit user confirm this time
    NOTIFY = "notify"             # notify params["targets"] after the fact
    TWO_PERSON = "two_person"      # a second authorized principal must approve
    UNDO_WINDOW = "undo_window"    # allow, but keep an undo open for N seconds
    RECORD_REASON = "record_reason"  # actor must record a reason
    RATE_LIMIT = "rate_limit"      # cap frequency
    LOG_VERBOSE = "log_verbose"    # write a full audit event even if normally quiet


@dataclass(frozen=True)
class Obligation:
    kind: ObligationKind
    params: tuple = ()  # frozen (key, value) pairs so Obligation stays hashable

    @classmethod
    def make(cls, kind: ObligationKind, **params: Any) -> "Obligation":
        # Coerce list values to tuples so the frozen dataclass stays hashable
        # even after a JSON round-trip (e.g. notify targets deserialize as a list).
        coerced = {k: (tuple(v) if isinstance(v, list) else v) for k, v in params.items()}
        return cls(kind, tuple(sorted(coerced.items())))

    @property
    def param_dict(self) -> dict:
        return dict(self.params)

    def to_json(self) -> dict:
        return {"kind": self.kind.value, "params": self.param_dict}


def merge_obligations(obligations: list[Obligation]) -> list[Obligation]:
    """De-dupe obligations, keeping the STRICTEST of each kind.

    Security-biased: when two grants both demand step-up, we keep the higher
    ``min_trust``; two undo windows keep the longer; notify targets union.
    Anything else falls back to "first wins after de-dupe by kind+params".
    """
    by_kind: dict[ObligationKind, Obligation] = {}
    notify_targets: set = set()
    for ob in obligations:
        if ob.kind == ObligationKind.NOTIFY:
            notify_targets.update(ob.param_dict.get("targets", ()) or ())
            continue
        cur = by_kind.get(ob.kind)
        if cur is None:
            by_kind[ob.kind] = ob
            continue
        if ob.kind == ObligationKind.STEP_UP:
            if ob.param_dict.get("min_trust", 0) > cur.param_dict.get("min_trust", 0):
                by_kind[ob.kind] = ob
        elif ob.kind in (ObligationKind.UNDO_WINDOW, ObligationKind.RATE_LIMIT):
            # Longer undo window / tighter rate limit = keep the larger seconds.
            if ob.param_dict.get("seconds", 0) > cur.param_dict.get("seconds", 0):
                by_kind[ob.kind] = ob
        # else keep the existing one (identical kind, treat as satisfied once)
    out = list(by_kind.values())
    if notify_targets:
        out.append(Obligation.make(
            ObligationKind.NOTIFY, targets=tuple(sorted(notify_targets))))
    # Stable order so decisions are deterministic + comparable in tests.
    out.sort(key=lambda o: o.kind.value)
    return out


# ---------------------------------------------------------------------------
# Decision — the PDP's output
# ---------------------------------------------------------------------------

@dataclass
class Decision:
    """The result of ``Engine.decide``.

    ``allowed`` is the headline boolean. ``obligations`` MUST be satisfied by
    the enforcement point (PEP) before the action proceeds. ``trace`` is the
    full, human-readable "why" — every grant that was considered and what
    happened to it — so ``/explain`` and audit can reconstruct the reasoning.
    """
    effect: Effect
    obligations: list[Obligation] = field(default_factory=list)
    reason: str = ""
    matched_grant_ids: list[str] = field(default_factory=list)
    trace: list[dict] = field(default_factory=list)

    @property
    def allowed(self) -> bool:
        return self.effect == Effect.ALLOW

    def to_json(self) -> dict:
        return {
            "effect": self.effect.value,
            "allowed": self.allowed,
            "obligations": [o.to_json() for o in self.obligations],
            "reason": self.reason,
            "matched_grant_ids": list(self.matched_grant_ids),
            "trace": list(self.trace),
        }

    @classmethod
    def deny(cls, reason: str, trace: list[dict] | None = None) -> "Decision":
        return cls(Effect.DENY, reason=reason, trace=trace or [])
