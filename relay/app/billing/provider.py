"""BillingProvider abstraction — the swap point.

Everything else in the relay calls BillingProvider methods. Provider
swap (Lemon Squeezy, Paddle, ...) is one new sibling module that
implements this Protocol + one construction-line change in main.py.

Webhook payloads are normalized to a small WebhookEvent dataclass so
handler code never reaches into provider-specific shapes. The provider's
raw event object is preserved on WebhookEvent.raw for handlers that
need provider-specific detail (refund amount, invoice line items).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional, Protocol, runtime_checkable


@dataclass(frozen=True)
class CheckoutSession:
    session_id: str
    url: str
    expires_at: int  # unix ts; founder_slots release-on-expire keys off this


@dataclass(frozen=True)
class Subscription:
    id: str
    customer_id: str
    status: str              # provider-native (Stripe: active|past_due|...)
    current_period_end: int  # unix ts


@dataclass(frozen=True)
class Invoice:
    id: str
    amount_paid_minor: int   # agorot for ILS, cents for USD
    currency: str            # ISO 4217 upper
    paid_at: Optional[int]   # unix ts; None if unpaid


@dataclass(frozen=True)
class WebhookEvent:
    id: str
    type: str
    data: dict[str, Any]
    raw: Any = field(default=None, repr=False)


class WebhookSignatureError(ValueError):
    """Raised by verify_webhook on missing / malformed / mismatched signature."""


@runtime_checkable
class BillingProvider(Protocol):
    """Provider-agnostic billing interface.

    Network-touching methods are async; signature verification is sync
    (HMAC-only, no I/O).
    """

    async def create_checkout(
        self,
        *,
        home_id: str,
        plan_id: str,
        customer_email: str,
        success_url: str,
        cancel_url: str,
    ) -> CheckoutSession: ...

    async def get_subscription(self, subscription_id: str) -> Optional[Subscription]: ...

    async def cancel_subscription(
        self, subscription_id: str, *, at_period_end: bool = True
    ) -> None: ...

    def verify_webhook(
        self, *, payload: bytes, signature_header: str
    ) -> WebhookEvent: ...

    async def get_invoice(self, invoice_id: str) -> Optional[Invoice]: ...
