"""AI agent authorization — envelope ∩ delegator, gated by an autonomy ladder.

An AI agent (Ziggy itself) is just another principal, but acting through it is
constrained three ways, stacked:

1. **Envelope** — the agent's own grants (what it may ever touch). Product policy
   never grants an agent CRITICAL capabilities autonomously.
2. **Delegation** — when acting *on behalf of* a person, the effective authority
   is the *intersection* of the agent's grants and that person's grants. The AI
   can never exceed the human it acts for.
3. **Autonomy ladder** — per capability *scope tag*, how the agent may act:

       observe < suggest < ask < confirm < act

   ``act`` = autonomous; ``confirm`` = act but notify + undo window; ``ask`` =
   only after an explicit human yes; ``suggest``/``observe`` = never execute.
   A CRITICAL-risk action is never executed autonomously regardless of tag —
   it is forced down to ``ask``.

"Learn" is modeled as a separate capability scope (``observe``), so revoking
learning never revokes acting and vice-versa.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .context import Context
from .types import (
    ActorKind,
    Decision,
    Effect,
    Obligation,
    ObligationKind,
    Principal,
    RiskTier,
)

AUTONOMY_ORDER = {"observe": 0, "suggest": 1, "ask": 2, "confirm": 3, "act": 4}
_DEFAULT_AUTONOMY = "suggest"


@dataclass
class AgentVerdict:
    may_act: bool                 # may the agent execute right now, unattended?
    mode: str                     # observe | suggest | ask | confirm | act | deny
    decision: Decision            # the underlying effective PDP decision
    obligations: list = field(default_factory=list)
    reason: str = ""

    def to_json(self) -> dict:
        return {
            "may_act": self.may_act, "mode": self.mode,
            "allowed": self.decision.allowed,
            "obligations": [o.to_json() for o in self.obligations],
            "reason": self.reason,
        }


def evaluate_agent_action(service, *, agent: str, action: str, resource: str,
                          on_behalf_of: str | None = None,
                          context: Context | dict | None = None,
                          explicit_confirm: bool = False, now=None) -> AgentVerdict:
    """Decide whether/how an AI agent may perform ``action`` on ``resource``."""
    ctx = _agent_context(context)

    # (1) Envelope — the agent's own authority.
    agent_dec = service.authorize(subject=agent, action=action, resource=resource,
                                  context=ctx, now=now, record=False)
    if not agent_dec.allowed:
        return AgentVerdict(False, "deny", agent_dec,
                            reason="outside the agent's permission envelope")

    effective = agent_dec

    # (2) Delegation — cannot exceed the human being acted for.
    if on_behalf_of:
        user_dec = service.authorize(subject=on_behalf_of, action=action,
                                     resource=resource, context=ctx, now=now, record=False)
        if not user_dec.allowed:
            return AgentVerdict(False, "deny", user_dec,
                                reason=f"{on_behalf_of} is not permitted this action")
        # Effective obligations = union of both sides' obligations.
        from .types import merge_obligations
        effective = Decision(
            Effect.ALLOW,
            obligations=merge_obligations(agent_dec.obligations + user_dec.obligations),
            reason="agent ∩ delegator",
            matched_grant_ids=agent_dec.matched_grant_ids + user_dec.matched_grant_ids,
        )

    # (3) Autonomy ladder.
    cap = service.capabilities.resolve(action)
    mode = _autonomy_for(service, agent, cap)
    # CRITICAL never runs unattended, whatever the tag says.
    if cap.risk_tier == RiskTier.CRITICAL and AUTONOMY_ORDER[mode] > AUTONOMY_ORDER["ask"]:
        mode = "ask"

    obligations = list(effective.obligations)
    if mode in ("observe", "suggest"):
        return AgentVerdict(False, mode, effective, obligations,
                            reason=f"autonomy '{mode}': may not execute")
    if mode == "ask":
        if not explicit_confirm:
            return AgentVerdict(False, "ask", effective, obligations,
                                reason="autonomy 'ask': needs an explicit human yes")
        # confirmed this time → allowed to act
        return AgentVerdict(True, "ask", effective, obligations,
                            reason="human confirmed")
    if mode == "confirm":
        obligations = _merge(obligations, [
            Obligation.make(ObligationKind.UNDO_WINDOW, seconds=30),
            Obligation.make(ObligationKind.NOTIFY, targets=("owners",)),
        ])
        return AgentVerdict(True, "confirm", effective, obligations,
                            reason="autonomy 'confirm': acting with notify + undo")
    # mode == "act"
    return AgentVerdict(True, "act", effective, obligations,
                        reason="autonomy 'act': autonomous within envelope")


def _autonomy_for(service, agent_ref: str, cap) -> str:
    """Most-restrictive autonomy across the capability's scope tags."""
    attrs = service.state().principal_attrs(agent_ref)
    table = attrs.get("autonomy", {}) or {}
    default = attrs.get("default_autonomy", _DEFAULT_AUTONOMY)
    if not cap.scope_tags:
        return table.get("*", default)
    levels = [AUTONOMY_ORDER.get(table.get(tag, default), AUTONOMY_ORDER[default])
              for tag in cap.scope_tags]
    # Most restrictive (minimum) wins — a security tag drags an energy tag down.
    min_level = min(levels)
    inv = {v: k for k, v in AUTONOMY_ORDER.items()}
    return inv[min_level]


def _agent_context(context) -> Context:
    if isinstance(context, Context):
        data = dict(context.data)
    elif isinstance(context, dict):
        data = dict(context)
    else:
        data = {}
    c = dict(data.get("context") or {})
    c["actor_kind"] = ActorKind.AGENT.value
    data["context"] = c
    return Context(data)


def _merge(a: list, b: list) -> list:
    from .types import merge_obligations
    return merge_obligations(a + b)
