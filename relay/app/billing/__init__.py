"""Billing subsystem (Prompt 9).

Layout:

    provider.py        Abstract BillingProvider Protocol — the swap point.
                       Stripe is the only concrete implementation today;
                       a future provider swap is a one-line construction
                       change in main.py.
    stripe_provider.py Concrete Stripe SDK implementation.
    plans.py           Plan catalog. Stripe Price IDs are read from env
                       so multiple concurrent price versions per plan
                       (founder_lifetime_v1, standard_monthly_2026, ...)
                       can coexist; old subscriptions stay on their old
                       price, new checkouts use the current price.
    slot_counter.py    Atomic founder-pricing slot reservation (cap 30).
    invoice.py         Israeli עוסק פטור sequential invoice generator
                       (NIS, 18% VAT inclusive, agorot precision).
    webhooks.py        FastAPI router. Signature verification + dispatch
                       to per-event handlers; idempotent via the
                       processed_webhooks table.

State machine for homes.subscription_state:

    pending_setup → trialing → active → cancelled
                          ↘   ↗ ↘    ↗
                           past_due
                                ↘
                                 refunded

`pending_setup` is the conceptual initial state but the schema default is
`active` (see database.py rationale). Trial start is admin-driven: the
founder records kit_received_at via the admin endpoint, which flips state
to 'trialing' and sets trial_ends_at = kit_received_at + 14 days. Webhook
handlers own every subsequent transition.

The kill-switch invariant: any subscription_state outside {'trialing',
'active'} causes _subscription_active() in relay/app/routers/ota.py to
return False, which 403s OTA + telemetry + remote-access proxy. Local
kit operation (sensors, automations, IR, local voice) is never affected.
See docs/BILLING_AUDIT.md §2.5.
"""

from __future__ import annotations

# Canonical set of subscription_state values. Used by webhook handlers
# (which one are we transitioning to?) and by _subscription_active()
# (which set counts as "cloud features on?"). Kept in one place so a
# typo in a router string literal becomes a NameError instead of a
# silent permanent kill-switch trip.
SUBSCRIPTION_STATES = (
    "pending_setup",   # home exists, no trial started, no Stripe customer yet
    "trialing",        # 14d trial running; cloud features ON
    "active",          # paid subscription in good standing; cloud features ON
    "past_due",        # payment retry failures; cloud features OFF, reversible
    "cancelled",       # subscription ended (user cancel or final retry fail); OFF
    "refunded",        # explicit refund; OFF; founder slot may release if <14d
)

ACTIVE_SUBSCRIPTION_STATES = frozenset({"trialing", "active"})
