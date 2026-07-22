"""The Policy Decision Point (PDP).

``Engine.decide`` is the single function the whole product funnels through. It
takes the *expanded* subject principals (self + groups — expansion happens one
layer up, in the resolver), the action, the resource, the candidate grants, and
the runtime context; it returns an allow/deny plus obligations plus a full
explain-trace.

Evaluation pipeline (mirrors the architecture doc)::

    1. resolve resource (+ancestors) and capability def
    2. gather grants for this subject that match resource AND capability
    3. filter by condition(context) and temporal validity
    4. combine: deny-overrides, weighted by specificity
       (a device-level deny beats a room-level allow; equal specificity ⇒ deny)
    5. emergency break-glass may override a deny — but only under emergency
       context and only while carrying mandatory audit obligations
    6. collect obligations (winning grants' own + risk-tier defaults)
    7. return Decision with a trace explaining every considered grant

Fail-safe throughout: unknown resource ⇒ deny; no matching grant ⇒ deny;
a condition that can't be satisfied ⇒ that grant simply doesn't apply.
"""
from __future__ import annotations

from typing import Iterable, Optional

from .capabilities import CapabilityDef, CapabilityRegistry
from .conditions import evaluate as eval_condition
from .grants import Grant
from .resources import ResourceGraph
from .selectors import NO_MATCH, match_capability, match_resource
from .types import (
    Decision,
    Effect,
    Obligation,
    ObligationKind,
    Principal,
    RiskTier,
    merge_obligations,
)

# Risk tier → default obligations attached to an ALLOW. This is the ONE place
# "protected actions" live, and it is a data table, not a fork in code. A new
# CRITICAL-tier capability (gun safe, insulin pump) inherits two-person +
# record-reason automatically.
_RISK_OBLIGATIONS: dict[RiskTier, list[Obligation]] = {
    RiskTier.LOW: [],
    RiskTier.MEDIUM: [Obligation.make(ObligationKind.LOG_VERBOSE)],
    RiskTier.HIGH: [
        Obligation.make(ObligationKind.STEP_UP, min_trust=2),
        Obligation.make(ObligationKind.LOG_VERBOSE),
    ],
    RiskTier.CRITICAL: [
        Obligation.make(ObligationKind.STEP_UP, min_trust=3),
        Obligation.make(ObligationKind.TWO_PERSON),
        Obligation.make(ObligationKind.RECORD_REASON),
        Obligation.make(ObligationKind.LOG_VERBOSE),
    ],
}

# Obligations forced onto any break-glass emergency override. Non-negotiable:
# using the emergency door override is always loudly audited + notified.
_EMERGENCY_OBLIGATIONS = [
    Obligation.make(ObligationKind.RECORD_REASON),
    Obligation.make(ObligationKind.LOG_VERBOSE),
    Obligation.make(ObligationKind.NOTIFY, targets=("owners", "emergency_contacts")),
]


class _Candidate:
    __slots__ = ("grant", "res_spec", "cap_spec")

    def __init__(self, grant: Grant, res_spec: int, cap_spec: int) -> None:
        self.grant = grant
        self.res_spec = res_spec
        self.cap_spec = cap_spec

    @property
    def spec_key(self) -> tuple:
        # Resource specificity dominates capability specificity.
        return (self.res_spec, self.cap_spec)


class Engine:
    def __init__(self, capabilities: CapabilityRegistry, resources: ResourceGraph) -> None:
        self.capabilities = capabilities
        self.resources = resources

    def decide(
        self,
        *,
        subject_principals: Iterable[Principal],
        action: str,
        resource: str,
        grants: Iterable[Grant],
        context,
        now: Optional[float] = None,
    ) -> Decision:
        subjects = set(subject_principals)
        trace: list[dict] = []

        resolved = self.resources.resolve(resource)
        if resolved is None:
            return Decision.deny(
                f"unknown resource {resource!r}",
                trace=[{"stage": "resolve", "resource": resource, "result": "unknown"}],
            )
        cap: CapabilityDef = self.capabilities.resolve(action)

        candidates: list[_Candidate] = []
        for g in grants:
            if g.principal not in subjects:
                continue  # not about this subject — silently skip (avoids noise)
            if not g.is_temporally_valid(now):
                trace.append(_t(g, "skipped", "expired/inactive"))
                continue
            res_spec = match_resource(g.resource, resolved)
            if res_spec == NO_MATCH:
                trace.append(_t(g, "skipped", "resource selector miss"))
                continue
            cap_spec = match_capability(g.capability, cap)
            if cap_spec == NO_MATCH:
                trace.append(_t(g, "skipped", "capability selector miss"))
                continue
            if not eval_condition(g.condition, context):
                trace.append(_t(g, "skipped", "condition false"))
                continue
            candidates.append(_Candidate(g, res_spec, cap_spec))
            trace.append(_t(g, "candidate", f"{g.effect.value} spec={res_spec},{cap_spec}"))

        decision = self._combine(candidates, cap, context, trace)
        return decision

    # ------------------------------------------------------------------
    def _combine(self, candidates, cap, context, trace) -> Decision:
        allows = [c for c in candidates if c.grant.effect == Effect.ALLOW]
        denies = [c for c in candidates if c.grant.effect == Effect.DENY]

        best_allow = _best(allows)
        best_deny = _best(denies)

        emergency = bool(context.resolve("emergency"))

        # -- normal deny-overrides resolution ----------------------------
        if best_deny is not None and (
            best_allow is None or best_deny.spec_key >= best_allow.spec_key
        ):
            # Deny wins at equal-or-higher specificity. Consider break-glass.
            if emergency:
                override = _best([
                    c for c in allows if c.grant.emergency_override
                ])
                if override is not None:
                    obligations = self._obligations_for(
                        [override], cap, extra=_EMERGENCY_OBLIGATIONS)
                    trace.append({"stage": "combine", "result": "emergency_override",
                                  "grant": override.grant.id,
                                  "over_deny": best_deny.grant.id})
                    return Decision(
                        Effect.ALLOW, obligations=obligations,
                        reason=f"emergency override by grant {override.grant.id} "
                               f"over deny {best_deny.grant.id}",
                        matched_grant_ids=[override.grant.id, best_deny.grant.id],
                        trace=trace,
                    )
            trace.append({"stage": "combine", "result": "deny",
                          "grant": best_deny.grant.id})
            return Decision(
                Effect.DENY,
                reason=f"denied by grant {best_deny.grant.id}",
                matched_grant_ids=[best_deny.grant.id],
                trace=trace,
            )

        # -- allow path --------------------------------------------------
        if best_allow is not None:
            # Union obligations across every allow tied at the winning tier.
            winners = [c for c in allows if c.spec_key == best_allow.spec_key]
            obligations = self._obligations_for(winners, cap)
            trace.append({"stage": "combine", "result": "allow",
                          "grants": [c.grant.id for c in winners]})
            return Decision(
                Effect.ALLOW, obligations=obligations,
                reason=f"allowed by grant(s) {[c.grant.id for c in winners]}",
                matched_grant_ids=[c.grant.id for c in winners],
                trace=trace,
            )

        # -- default deny ------------------------------------------------
        trace.append({"stage": "combine", "result": "default_deny"})
        return Decision(
            Effect.DENY, reason="no matching allow grant (default deny)", trace=trace)

    def _obligations_for(self, winners, cap, extra=None) -> list[Obligation]:
        obs: list[Obligation] = []
        for c in winners:
            obs.extend(c.grant.obligations)
        obs.extend(_RISK_OBLIGATIONS.get(cap.risk_tier, []))
        if extra:
            obs.extend(extra)
        return merge_obligations(obs)


def _best(cands: list[_Candidate]) -> Optional[_Candidate]:
    """Most-specific candidate; priority breaks ties WITHIN the same effect."""
    if not cands:
        return None
    return max(cands, key=lambda c: (c.res_spec, c.cap_spec, c.grant.priority))


def _t(g: Grant, stage: str, note: str) -> dict:
    return {"stage": stage, "grant": g.id, "principal": g.principal.ref,
            "effect": g.effect.value, "note": note}
