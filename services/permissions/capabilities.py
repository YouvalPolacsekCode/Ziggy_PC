"""Capability registry — the open vocabulary of "verbs on device classes".

The unit of permission is never a device; it is a *capability*: a verb a device
class exposes (``light.onoff``, ``lock.unlock``, ``ev.set_limit``). Each device
class ships a **manifest** of ``CapabilityDef``s declaring, per verb:

* ``risk_tier``  — drives obligations (step-up / two-person / notify), NOT code.
* ``scope_tags`` — drive UI grouping (Lights / Security / Energy …); derived,
  never enumerated in code.
* ``reversible`` / ``offline_default`` — how the action behaves off-grid.
* ``default_channels`` — advisory; channel enforcement itself lives in grants.

Adding a brand-new device class (EV charger, robot mower, insulin pump) is a new
manifest — the engine, obligations, audit and UI grouping all work on day one
with zero engine changes. That is the "no redesign for new device types"
guarantee, made concrete.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .types import RiskTier


@dataclass(frozen=True)
class CapabilityDef:
    key: str                       # "lock.unlock"
    applies_to_class: str          # "lock"
    risk_tier: RiskTier = RiskTier.LOW
    scope_tags: frozenset = frozenset()
    reversible: bool = True
    default_channels: frozenset = frozenset()   # empty ⇒ no channel hint
    offline_default: str = "allow"  # "allow" | "deny" when off-grid ctx missing
    description: str = ""

    @property
    def verb(self) -> str:
        return self.key.split(".", 1)[1] if "." in self.key else self.key


class CapabilityRegistry:
    """In-memory registry of capability definitions, keyed by capability key.

    Unknown actions resolve to a **fail-safe synthetic def** (tier MEDIUM, no
    scope tags) rather than raising — a mis-registered verb must never crash a
    decision, and MEDIUM ensures a stray new verb still attracts at least a
    log/notify obligation instead of sailing through as harmless.
    """

    def __init__(self) -> None:
        self._by_key: dict[str, CapabilityDef] = {}
        self._by_class: dict[str, list[CapabilityDef]] = {}

    def register(self, cap: CapabilityDef) -> None:
        self._by_key[cap.key] = cap
        self._by_class.setdefault(cap.applies_to_class, []).append(cap)

    def register_manifest(self, manifest: list[CapabilityDef]) -> None:
        for cap in manifest:
            self.register(cap)

    def get(self, key: str) -> CapabilityDef | None:
        return self._by_key.get(key)

    def resolve(self, key: str) -> CapabilityDef:
        cap = self._by_key.get(key)
        if cap is not None:
            return cap
        cls = key.split(".", 1)[0] if "." in key else key
        return CapabilityDef(
            key=key,
            applies_to_class=cls,
            risk_tier=RiskTier.MEDIUM,
            description="(unregistered capability — fail-safe default)",
        )

    def for_class(self, cls: str) -> list[CapabilityDef]:
        return list(self._by_class.get(cls, ()))

    def all(self) -> list[CapabilityDef]:
        return list(self._by_key.values())

    def scope_tags_for(self, key: str) -> frozenset:
        return self.resolve(key).scope_tags


def build_default_registry() -> CapabilityRegistry:
    """Registry seeded with today's device classes + a couple of future ones.

    The future classes (ev_charger, mower) are included deliberately as living
    proof that the model needs no changes to absorb them.
    """
    from .seeds import DEFAULT_CAPABILITY_MANIFESTS

    reg = CapabilityRegistry()
    for manifest in DEFAULT_CAPABILITY_MANIFESTS:
        reg.register_manifest(manifest)
    return reg
