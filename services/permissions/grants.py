"""Grant — the atom of policy.

A grant says: *this principal* is *allowed/denied* *these capabilities* on
*these resources*, optionally *only when this condition holds*, carrying *these
obligations*, with optional *delegation* metadata (who issued it, whether it can
be re-delegated, when it expires, how many uses remain).

Roles compile into grants; presets compile into grants; a property manager's API
call writes grants. There is exactly one policy primitive, and this is it.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from . import conditions as _cond
from . import selectors as _sel
from .types import Effect, Obligation, ObligationKind, Principal


@dataclass
class Grant:
    id: str
    principal: Principal
    effect: Effect
    resource: Any                 # resource selector (see selectors.py)
    capability: Any               # capability selector
    condition: Any = None         # condition AST (None ⇒ always applies)
    obligations: list = field(default_factory=list)  # list[Obligation]
    priority: int = 0             # tie-break WITHIN an effect only
    emergency_override: bool = False  # may beat a deny, but only under emergency

    # -- delegation metadata (object-capability semantics) ----------------
    issued_by: Optional[Principal] = None
    delegatable: bool = False
    max_depth: int = 0            # how many further re-delegations allowed
    depth: int = 0               # this grant's depth from the delegation root
    revoke_root: Optional[str] = None  # id of the root grant; revoking it cascades
    expires_at: Optional[float] = None   # epoch seconds; None ⇒ no expiry
    max_uses: Optional[int] = None
    uses: int = 0

    status: str = "active"        # active | suspended | expired | revoked

    # ------------------------------------------------------------------
    def validate(self) -> None:
        """Reject a malformed grant at author time (store/API write path)."""
        _sel.validate_resource_selector(self.resource)
        _sel.validate_capability_selector(self.capability)
        _cond.validate(self.condition)
        if self.effect not in (Effect.ALLOW, Effect.DENY):
            raise ValueError(f"bad effect {self.effect!r}")
        if self.max_uses is not None and self.max_uses < 0:
            raise ValueError("max_uses must be >= 0")

    def is_temporally_valid(self, now: Optional[float]) -> bool:
        """Active, not expired, uses remaining. ``now=None`` skips time checks
        (used by pure unit tests that don't exercise expiry)."""
        if self.status != "active":
            return False
        if self.max_uses is not None and self.uses >= self.max_uses:
            return False
        if now is not None and self.expires_at is not None and now >= self.expires_at:
            return False
        return True

    # ------------------------------------------------------------------
    def to_json(self) -> dict:
        return {
            "id": self.id,
            "principal": self.principal.ref,
            "effect": self.effect.value,
            "resource": self.resource,
            "capability": self.capability,
            "condition": self.condition,
            "obligations": [o.to_json() for o in self.obligations],
            "priority": self.priority,
            "emergency_override": self.emergency_override,
            "issued_by": self.issued_by.ref if self.issued_by else None,
            "delegatable": self.delegatable,
            "max_depth": self.max_depth,
            "depth": self.depth,
            "revoke_root": self.revoke_root,
            "expires_at": self.expires_at,
            "max_uses": self.max_uses,
            "uses": self.uses,
            "status": self.status,
        }

    @classmethod
    def from_json(cls, d: dict) -> "Grant":
        obs = [
            Obligation.make(ObligationKind(o["kind"]), **(o.get("params") or {}))
            for o in (d.get("obligations") or [])
        ]
        return cls(
            id=d["id"],
            principal=Principal.parse(d["principal"]),
            effect=Effect(d["effect"]),
            resource=d.get("resource"),
            capability=d.get("capability"),
            condition=d.get("condition"),
            obligations=obs,
            priority=d.get("priority", 0),
            emergency_override=d.get("emergency_override", False),
            issued_by=Principal.parse(d["issued_by"]) if d.get("issued_by") else None,
            delegatable=d.get("delegatable", False),
            max_depth=d.get("max_depth", 0),
            depth=d.get("depth", 0),
            revoke_root=d.get("revoke_root"),
            expires_at=d.get("expires_at"),
            max_uses=d.get("max_uses"),
            uses=d.get("uses", 0),
            status=d.get("status", "active"),
        )
