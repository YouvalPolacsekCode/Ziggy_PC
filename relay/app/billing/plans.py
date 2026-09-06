"""Plan catalog (Prompt 9 chunk 2).

A "plan" is the customer-facing concept ("Founder Lifetime"). A "price"
is the merchant-side concept (a specific Stripe Price object: amount +
currency + interval). One plan maps to one CURRENT Stripe Price ID, but
the same plan can rotate through multiple price IDs over its lifetime
— old subscriptions keep their old price, new checkouts use the new
one. Per founder decision: never hardcode a single price per plan;
design so price changes are env-var swaps without code edits.

Plan ID slug convention:
  founder_lifetime_v1         — first founder lifetime offer
  standard_monthly_2026       — year suffix for the standard plans
  standard_annual_2026
A fresh price tier (e.g. mid-2027 launch) gets a new slug
('standard_monthly_2027') and a new env var; the old slug stays around
indefinitely so existing subscriptions keep resolving.

Price IDs are read from env at *call time*, not at module import, so
test fixtures and Fly secret rotations take effect without a relay
restart.

Entitlements (v3 brain, spec §3.8):
  Each plan carries a `features` set. The relay copies the home's plan
  and its entitlements into the signed OTA manifest so a hub can gate
  tier-bound features (diagnostics, auto-repair, explain-changes)
  without ever holding billing state itself. `entitlements_for` is the
  single resolver; it FAILS OPEN — a home with no plan_id (founder
  homes provisioned before billing existed) or an unrecognised plan_id
  gets everything, because a billing hiccup must never strip a paying
  home of features it already relies on.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional


class PlanMisconfiguredError(RuntimeError):
    """Raised when a plan's Stripe Price env var is unset at call time."""


# Every feature a hub can gate on. Today every plan gets all of them;
# the set exists so a future restricted tier is a one-line change here
# and zero changes on the hub, which only reads the manifest list.
ALL_FEATURES: frozenset[str] = frozenset({
    "diagnostics",      # Fixer may diagnose (read-only investigation)
    "auto_repair",      # Fixer may apply PDP-gated repairs
    "explain_changes",  # brain narrates what changed and why
})


@dataclass(frozen=True)
class Plan:
    id: str
    display_name: str
    stripe_price_env: str  # Name of env var holding the Stripe Price ID
    is_founder: bool       # If True, checkout creation must reserve a founder slot
    has_trial: bool        # If True, the 14-day kit_received_at trial applies
    interval: str          # 'month' | 'year' — display hint, source of truth is Stripe
    # Hub-gateable features this plan unlocks (subset of ALL_FEATURES).
    # Default empty so a plan added without thinking about entitlements
    # is visibly locked down in tests rather than silently over-granting.
    features: frozenset[str] = field(default_factory=frozenset)

    @property
    def stripe_price_id(self) -> str:
        value = os.getenv(self.stripe_price_env, "")
        if not value:
            raise PlanMisconfiguredError(
                f"Plan {self.id!r} needs env {self.stripe_price_env}"
            )
        return value


PLANS: dict[str, Plan] = {
    "founder_lifetime_v1": Plan(
        id="founder_lifetime_v1",
        display_name="Founder Lifetime",
        stripe_price_env="STRIPE_PRICE_FOUNDER_LIFETIME_V1",
        is_founder=True,
        has_trial=False,  # the price IS the offer — no separate trial
        interval="month",
        features=ALL_FEATURES,
    ),
    "standard_monthly_2026": Plan(
        id="standard_monthly_2026",
        display_name="Standard Monthly",
        stripe_price_env="STRIPE_PRICE_STANDARD_MONTHLY_2026",
        is_founder=False,
        has_trial=True,
        interval="month",
        features=ALL_FEATURES,
    ),
    "standard_annual_2026": Plan(
        id="standard_annual_2026",
        display_name="Standard Annual",
        stripe_price_env="STRIPE_PRICE_STANDARD_ANNUAL_2026",
        is_founder=False,
        has_trial=True,
        interval="year",
        features=ALL_FEATURES,
    ),
}


def get_plan(plan_id: str) -> Plan:
    if plan_id not in PLANS:
        raise KeyError(f"Unknown plan: {plan_id!r}. Known: {sorted(PLANS)}")
    return PLANS[plan_id]


def entitlements_for(plan_id: Optional[str]) -> list[str]:
    """Resolve the feature list a hub should be told it is entitled to.

    Fails OPEN by design:
      * plan_id None/"" — founder homes provisioned before billing existed
        have plan_id NULL in `homes`; they must get everything.
      * unknown plan_id — a slug this relay build doesn't know (e.g. a
        newer relay wrote it, or a typo in an admin edit). Locking a
        home out because of a catalog mismatch is the wrong failure
        mode; the audit trail, not the hub, is where that gets noticed.
    Sorted so the manifest bytes — and therefore its HMAC — are stable
    across calls.
    """
    if not plan_id:
        return sorted(ALL_FEATURES)
    plan = PLANS.get(plan_id)
    if plan is None:
        return sorted(ALL_FEATURES)
    return sorted(plan.features)


def plan_for_stripe_price(stripe_price_id: str) -> Optional[Plan]:
    """Reverse lookup: given a Stripe Price ID, find the plan it belongs to.

    Used by webhook handlers when Stripe gives us a price reference but
    not a plan_id metadata field (defensive — checkout creation does
    set metadata, but webhooks from older subscriptions may not have it).
    Returns None if no plan currently maps to this price.
    """
    for plan in PLANS.values():
        try:
            if plan.stripe_price_id == stripe_price_id:
                return plan
        except PlanMisconfiguredError:
            continue
    return None
