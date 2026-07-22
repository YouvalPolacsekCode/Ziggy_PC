"""Policy Enforcement Point helpers for internal call sites.

Anywhere in the backend that is about to perform a sensitive action can call
``require(...)`` to get a hard allow/deny + obligations, attributed in the audit
log. This is the additive integration path: existing ``require_role`` gates keep
working, and new fine-grained checks layer on top through here.
"""
from __future__ import annotations

from typing import Optional

from .runtime import get_service
from .types import Decision


class PermissionDenied(Exception):
    def __init__(self, decision: Decision) -> None:
        super().__init__(decision.reason or "permission denied")
        self.decision = decision


def check(*, subject, action: str, resource: str, context=None,
          now: Optional[float] = None, correlation_id: str | None = None) -> Decision:
    """Return the Decision without raising (caller inspects .allowed)."""
    return get_service().authorize(
        subject=subject, action=action, resource=resource, context=context,
        now=now, correlation_id=correlation_id)


def require(*, subject, action: str, resource: str, context=None,
            now: Optional[float] = None, correlation_id: str | None = None) -> Decision:
    """Raise :class:`PermissionDenied` unless allowed; else return the Decision
    (so the caller can honour its obligations)."""
    d = check(subject=subject, action=action, resource=resource, context=context,
              now=now, correlation_id=correlation_id)
    if not d.allowed:
        raise PermissionDenied(d)
    return d
