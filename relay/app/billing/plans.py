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
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


class PlanMisconfiguredError(RuntimeError):
    """Raised when a plan's Stripe Price env var is unset at call time."""


@dataclass(frozen=True)
class Plan:
    id: str
    display_name: str
    stripe_price_env: str  # Name of env var holding the Stripe Price ID
    is_founder: bool       # If True, checkout creation must reserve a founder slot
    has_trial: bool        # If True, the 14-day kit_received_at trial applies
    interval: str          # 'month' | 'year' — display hint, source of truth is Stripe

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
    ),
    "standard_monthly_2026": Plan(
        id="standard_monthly_2026",
        display_name="Standard Monthly",
        stripe_price_env="STRIPE_PRICE_STANDARD_MONTHLY_2026",
        is_founder=False,
        has_trial=True,
        interval="month",
    ),
    "standard_annual_2026": Plan(
        id="standard_annual_2026",
        display_name="Standard Annual",
        stripe_price_env="STRIPE_PRICE_STANDARD_ANNUAL_2026",
        is_founder=False,
        has_trial=True,
        interval="year",
    ),
}


def get_plan(plan_id: str) -> Plan:
    if plan_id not in PLANS:
        raise KeyError(f"Unknown plan: {plan_id!r}. Known: {sorted(PLANS)}")
    return PLANS[plan_id]


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
