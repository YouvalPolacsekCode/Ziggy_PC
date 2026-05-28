"""Concrete BillingProvider implementation backed by the Stripe SDK.

Tested against stripe==11.1.0.

Stripe's Python SDK is synchronous. Network calls are wrapped in
asyncio.to_thread() so they don't block the FastAPI event loop.
Webhook signature verification is HMAC-only and stays sync.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

import stripe as _stripe

from .plans import get_plan
from .provider import (
    BillingProvider,
    CheckoutSession,
    Invoice,
    Subscription,
    WebhookEvent,
    WebhookSignatureError,
)


# Stripe Checkout sessions auto-expire 24h after creation. The
# founder_slots release-on-abandon path subscribes to the matching
# checkout.session.expired webhook, so this constant + Stripe's
# server-side expiry must agree.
_CHECKOUT_SESSION_TTL_S = 86_400


class StripeProvider:
    """Stripe-backed BillingProvider.

    Required env:
        STRIPE_SECRET_KEY      sk_live_... or sk_test_...
        STRIPE_WEBHOOK_SECRET  whsec_...

    Missing keys are tolerated at construction time and only raise on
    the first network/verification call, so the relay can boot even
    if Fly secrets haven't been wired yet (matches the rest of the
    codebase's lazy-creds pattern).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        webhook_secret: Optional[str] = None,
    ):
        self._api_key = api_key if api_key is not None else os.getenv("STRIPE_SECRET_KEY", "")
        self._webhook_secret = (
            webhook_secret if webhook_secret is not None else os.getenv("STRIPE_WEBHOOK_SECRET", "")
        )
        # Per Stripe SDK convention, api_key is a module global. Setting
        # per-call requires constructing a stripe.Client which is awkward
        # from asyncio.to_thread closures. A second StripeProvider with a
        # different key would clobber the first; that's a non-issue in
        # production but worth knowing for multi-tenant tests.
        if self._api_key:
            _stripe.api_key = self._api_key

    # ----- checkout ---------------------------------------------------------

    async def create_checkout(
        self,
        *,
        home_id: str,
        plan_id: str,
        customer_email: str,
        success_url: str,
        cancel_url: str,
    ) -> CheckoutSession:
        plan = get_plan(plan_id)
        expires_at = int(time.time()) + _CHECKOUT_SESSION_TTL_S

        def _create() -> object:
            return _stripe.checkout.Session.create(
                mode="subscription",
                line_items=[{"price": plan.stripe_price_id, "quantity": 1}],
                customer_email=customer_email,
                client_reference_id=home_id,
                expires_at=expires_at,
                metadata={"home_id": home_id, "plan_id": plan_id},
                subscription_data={
                    "metadata": {"home_id": home_id, "plan_id": plan_id},
                },
                success_url=success_url,
                cancel_url=cancel_url,
            )

        session = await asyncio.to_thread(_create)
        return CheckoutSession(
            session_id=session.id,
            url=session.url,
            expires_at=expires_at,
        )

    # ----- subscription -----------------------------------------------------

    async def get_subscription(self, subscription_id: str) -> Optional[Subscription]:
        def _fetch():
            try:
                return _stripe.Subscription.retrieve(subscription_id)
            except _stripe.InvalidRequestError:
                return None

        sub = await asyncio.to_thread(_fetch)
        if sub is None:
            return None
        return Subscription(
            id=sub.id,
            customer_id=sub.customer,
            status=sub.status,
            current_period_end=int(sub.current_period_end),
        )

    async def cancel_subscription(
        self, subscription_id: str, *, at_period_end: bool = True
    ) -> None:
        if at_period_end:
            def _action():
                _stripe.Subscription.modify(subscription_id, cancel_at_period_end=True)
        else:
            def _action():
                # Stripe v9+ renamed Subscription.delete → Subscription.cancel
                _stripe.Subscription.cancel(subscription_id)

        await asyncio.to_thread(_action)

    # ----- webhook ----------------------------------------------------------

    def verify_webhook(
        self, *, payload: bytes, signature_header: str
    ) -> WebhookEvent:
        if not signature_header:
            raise WebhookSignatureError("missing_signature_header")
        if not self._webhook_secret:
            raise WebhookSignatureError("no_webhook_secret_configured")
        try:
            event = _stripe.Webhook.construct_event(
                payload=payload,
                sig_header=signature_header,
                secret=self._webhook_secret,
            )
        except ValueError as e:
            raise WebhookSignatureError(f"malformed_payload: {e}") from e
        except _stripe.SignatureVerificationError as e:
            raise WebhookSignatureError(f"signature_mismatch: {e}") from e

        return WebhookEvent(
            id=event["id"],
            type=event["type"],
            data=event["data"]["object"],
            raw=event,
        )

    # ----- invoice ----------------------------------------------------------

    async def get_invoice(self, invoice_id: str) -> Optional[Invoice]:
        def _fetch():
            try:
                return _stripe.Invoice.retrieve(invoice_id)
            except _stripe.InvalidRequestError:
                return None

        inv = await asyncio.to_thread(_fetch)
        if inv is None:
            return None
        paid_at: Optional[int] = None
        st = getattr(inv, "status_transitions", None)
        if st is not None:
            raw = getattr(st, "paid_at", None)
            if raw is not None:
                paid_at = int(raw)
        return Invoice(
            id=inv.id,
            amount_paid_minor=int(inv.amount_paid),
            currency=str(inv.currency).upper(),
            paid_at=paid_at,
        )


# Module-level lazy singleton accessor. Used by the webhook router +
# admin checkout endpoint. Lazy construction means missing env vars
# only blow up at first use, not at relay boot.
_instance: Optional[StripeProvider] = None


def get_provider() -> BillingProvider:
    global _instance
    if _instance is None:
        _instance = StripeProvider()
    return _instance


def reset_provider_for_tests() -> None:
    """Drop the cached singleton. Tests use this when they monkey-patch
    env vars between cases."""
    global _instance
    _instance = None
