"""AI-agent authorization gate for the fixer.

Every remediation the agent wants to take is routed through the permission PDP's
AI-autonomy ladder (services/permissions/ai.py), enforced BELOW the LLM so a
hijacked prompt cannot talk past it:

  · diagnostics (read/refresh)  → act      autonomous, do it and tell them
  · connectivity (reconnect)    → confirm  auto + notify + 30s undo window
  · shell/config/maintenance/pairing → ask needs an explicit human yes
  · host / CRITICAL (exec_privileged) → denied to the agent's envelope entirely

The agent is the principal ``agent:ziggy``. When acting for a chat user it passes
``on_behalf_of='person:<username>'`` so it can never exceed that human's own
authority (delegation intersection).
"""
from __future__ import annotations

from services.permissions.reconcile import HOME_SCOPE

AGENT_REF = "agent:ziggy"

# scope_tag → how the agent may act. Most-restrictive tag wins in the PDP, so a
# capability carrying both {diagnostics, shell} resolves to shell's 'ask'.
_AUTONOMY: dict[str, str] = {
    "diagnostics":  "act",       # read-only + already-auto refreshes → autonomous
    "connectivity": "confirm",   # reconnect → auto + notify + undo (matches today)
    "maintenance":  "ask",
    "shell":        "ask",
    "config":       "ask",
    "pairing":      "ask",
    "host":         "ask",       # + envelope deny below; CRITICAL also clamps to ask
}
_DEFAULT_AUTONOMY = "ask"

# Everything the agent may EVER touch (with a human yes for the risky tiers).
# host is deliberately excluded and explicitly denied so no shell can reach the OS.
_ENVELOPE_TAGS = ("diagnostics", "connectivity", "maintenance", "shell", "config", "pairing")

_ALLOW_GRANT_ID = "grant:agent-ziggy:system"
_DENY_HOST_GRANT_ID = "grant:agent-ziggy:host-deny"


def seed_agent_principal(service) -> None:
    """Idempotently register agent:ziggy with its autonomy table + envelope grants.

    Safe to call every boot: adds the principal only if absent, and issues each
    grant only if its stable id isn't already present.
    """
    from services.permissions.types import Effect, Principal
    from services.permissions.grants import Grant

    state = service.state()
    if AGENT_REF not in state.principals:
        service.add_principal(
            AGENT_REF,
            attrs={"autonomy": dict(_AUTONOMY), "default_autonomy": _DEFAULT_AUTONOMY},
            actor="system:fixer",
        )

    existing = {g.id for g in service.state().grants_for({AGENT_REF})}
    principal = Principal.parse(AGENT_REF)
    if _ALLOW_GRANT_ID not in existing:
        service.issue_grant(Grant(
            id=_ALLOW_GRANT_ID,
            principal=principal,
            effect=Effect.ALLOW,
            resource={"resource": HOME_SCOPE},
            capability={"any_of": [{"scope_tag": t} for t in _ENVELOPE_TAGS]},
        ), actor="system:fixer")
    if _DENY_HOST_GRANT_ID not in existing:
        service.issue_grant(Grant(
            id=_DENY_HOST_GRANT_ID,
            principal=principal,
            effect=Effect.DENY,
            resource={"resource": HOME_SCOPE},
            capability={"any_of": [{"scope_tag": "host"}]},
        ), actor="system:fixer")


def gate(action: str, resource: str = HOME_SCOPE, *,
         on_behalf_of: str | None = None, explicit_confirm: bool = False,
         context=None):
    """Ask the PDP whether/how the agent may perform ``action`` right now.

    Returns an AgentVerdict: ``may_act`` (execute now unattended?), ``mode``
    (act|confirm|ask|deny), and any obligations (undo/notify) to honour.
    """
    from services.permissions.runtime import get_service
    from services.permissions.ai import evaluate_agent_action
    return evaluate_agent_action(
        get_service(), agent=AGENT_REF, action=action, resource=resource,
        on_behalf_of=on_behalf_of, explicit_confirm=explicit_confirm, context=context,
    )
