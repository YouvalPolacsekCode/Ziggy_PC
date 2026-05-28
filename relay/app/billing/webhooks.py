"""Stripe webhook router (Prompt 9 chunk 2).

Single endpoint at POST /api/billing/stripe/webhook. Verifies the
Stripe-Signature header via the BillingProvider abstraction, dedupes
duplicate deliveries against the processed_webhooks table, then
dispatches per-event handlers that update homes.subscription_state.

Idempotency strategy:
  1. Pre-check processed_webhooks for event.id — return 200 immediately
     if already seen (Stripe's retries until 2xx pattern).
  2. Run the handler. Handlers MUST be themselves idempotent; the
     stored DB operations (SET state=?, INSERT...ON CONFLICT-ish via
     stripe_invoice_id UNIQUE, DELETE slot) are all safe to replay.
  3. INSERT into processed_webhooks AFTER handler success. If the
     handler raised, we do NOT mark the event processed and Stripe
     will retry. If a duplicate arrives during in-flight processing
     the writes are still safe because of (2).

Event coverage:

  checkout.session.completed   associate Stripe customer/subscription IDs
                               with the home; first webhook of the flow.
  checkout.session.expired     24h cart abandonment — release founder slot.
  customer.subscription.created  set initial state from Stripe status
                                 (trialing | active | past_due | ...).
  customer.subscription.updated  re-sync state from Stripe status.
  customer.subscription.deleted  final cancellation → state='cancelled',
                                 cancelled_at = now. Drives the 90-day
                                 B2 retention cron (chunk 3 work).
  invoice.paid                 record invoice in Israeli sequence,
                               ensure state='active'.
  invoice.payment_failed       state='past_due'.
  charge.refunded              state='refunded'. If founder slot was
                               claimed within 14d (Israeli return law),
                               release it; otherwise keep it bound
                               (founder decision: post-14d permanent).

Audit log events written:
  stripe_webhook_received       every delivery, before signature check
  stripe_webhook_rejected       signature/parse failure (400)
  stripe_webhook_duplicate      pre-check hit (idempotent return)
  stripe_webhook_ignored        no handler for this event type
  stripe_webhook_handled        success
  stripe_webhook_handler_failed handler raised (Stripe will retry)
  subscription_state_changed    per state mutation
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, HTTPException, Request

from ..audit import log_event
from ..database import get_db
from . import SUBSCRIPTION_STATES
from . import invoice as invoice_module
from . import slot_counter
from .provider import WebhookEvent, WebhookSignatureError
from .stripe_provider import get_provider


router = APIRouter(prefix="/billing/stripe")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


async def _home_id_from_customer(customer_id: Optional[str]) -> Optional[str]:
    if not customer_id:
        return None
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id FROM homes WHERE stripe_customer_id=?", (customer_id,)
        )
    return str(rows[0]["id"]) if rows else None


async def _home_id_from_subscription(sub: dict) -> Optional[str]:
    # Prefer metadata.home_id (set by our checkout flow); fall back to the
    # stripe_customer_id lookup so we can still attribute legacy
    # subscriptions created before the metadata convention shipped.
    meta = sub.get("metadata") or {}
    home_id = meta.get("home_id")
    if home_id:
        return str(home_id)
    return await _home_id_from_customer(sub.get("customer"))


async def _set_state(
    home_id: str,
    new_state: str,
    *,
    cancelled_at: Optional[str] = None,
    stripe_subscription_id: Optional[str] = None,
    stripe_customer_id: Optional[str] = None,
    plan_id: Optional[str] = None,
) -> None:
    """Write a new subscription_state. Always idempotent (writing the
    same state again is a no-op except for the audit row + updated_at
    bump). Optional kwargs let one update statement carry several
    related fields without a fan-out of UPDATEs."""
    if new_state not in SUBSCRIPTION_STATES:
        raise ValueError(f"Unknown subscription_state: {new_state}")

    now_iso = datetime.now(timezone.utc).isoformat()
    sets = ["subscription_state=?", "subscription_updated_at=?"]
    args: list[Any] = [new_state, now_iso]
    if cancelled_at is not None:
        sets.append("cancelled_at=?")
        args.append(cancelled_at)
    if stripe_subscription_id is not None:
        sets.append("stripe_subscription_id=?")
        args.append(stripe_subscription_id)
    if stripe_customer_id is not None:
        sets.append("stripe_customer_id=?")
        args.append(stripe_customer_id)
    if plan_id is not None:
        sets.append("plan_id=?")
        args.append(plan_id)
    args.append(home_id)

    async with get_db() as db:
        await db.execute(
            f"UPDATE homes SET {', '.join(sets)} WHERE id=?", args
        )
        await db.commit()

    await log_event(
        "subscription_state_changed", home_id=home_id, ok=True,
        detail=f"new_state={new_state}",
    )


# ---------------------------------------------------------------------------
# Per-event handlers
# ---------------------------------------------------------------------------

# Stripe's subscription.status → our subscription_state. Stripe statuses:
#   trialing | active | past_due | canceled | unpaid | incomplete |
#   incomplete_expired | paused
# Mapping is conservative: anything that means "money problem" maps to
# past_due (reversible), anything terminal maps to cancelled.
_STRIPE_STATUS_MAP = {
    "trialing":           "trialing",
    "active":             "active",
    "past_due":           "past_due",
    "unpaid":             "past_due",
    "incomplete":         "past_due",
    "incomplete_expired": "cancelled",
    "canceled":           "cancelled",
    "paused":             "past_due",
}


async def _handle_checkout_completed(event: WebhookEvent) -> None:
    sess = event.data
    home_id = sess.get("client_reference_id") or (sess.get("metadata") or {}).get("home_id")
    if not home_id:
        return
    plan_id = (sess.get("metadata") or {}).get("plan_id")
    await _set_state(
        str(home_id),
        "active",  # checkout completion implies payment success; subscription.created syncs the exact state next
        stripe_customer_id=sess.get("customer"),
        stripe_subscription_id=sess.get("subscription"),
        plan_id=plan_id,
    )


async def _handle_checkout_expired(event: WebhookEvent) -> None:
    sess = event.data
    home_id = sess.get("client_reference_id") or (sess.get("metadata") or {}).get("home_id")
    if not home_id:
        return
    # Idempotent + no-op if no slot was ever held.
    await slot_counter.release(str(home_id), reason="checkout_expired")


async def _handle_subscription_created(event: WebhookEvent) -> None:
    sub = event.data
    home_id = await _home_id_from_subscription(sub)
    if not home_id:
        return
    state = _STRIPE_STATUS_MAP.get(sub.get("status"), "active")
    plan_id = (sub.get("metadata") or {}).get("plan_id")
    await _set_state(
        home_id, state,
        stripe_subscription_id=sub.get("id"),
        stripe_customer_id=sub.get("customer"),
        plan_id=plan_id,
    )


async def _handle_subscription_updated(event: WebhookEvent) -> None:
    sub = event.data
    home_id = await _home_id_from_subscription(sub)
    if not home_id:
        return
    state = _STRIPE_STATUS_MAP.get(sub.get("status"), "active")
    await _set_state(home_id, state)


async def _handle_subscription_deleted(event: WebhookEvent) -> None:
    sub = event.data
    home_id = await _home_id_from_subscription(sub)
    if not home_id:
        return
    await _set_state(
        home_id, "cancelled",
        cancelled_at=datetime.now(timezone.utc).isoformat(),
    )


async def _handle_invoice_paid(event: WebhookEvent) -> None:
    inv = event.data
    home_id = await _home_id_from_customer(inv.get("customer"))
    if not home_id:
        return
    amount = int(inv.get("amount_paid", 0))
    currency = (inv.get("currency") or "").lower()
    # Only record NIS invoices in the Israeli sequence. Non-NIS payments
    # (Stripe test mode in USD, USD-charged subscriptions for
    # international visitors per DECISIONS.md — should be rare for our
    # NIS-primary pricing) bump state but don't add an invoice row.
    if currency == "ils" and inv.get("id"):
        await invoice_module.record(
            home_id=home_id,
            stripe_invoice_id=str(inv.get("id")),
            amount_ils_agorot=amount,
        )
    await _set_state(home_id, "active")


async def _handle_invoice_payment_failed(event: WebhookEvent) -> None:
    inv = event.data
    home_id = await _home_id_from_customer(inv.get("customer"))
    if not home_id:
        return
    await _set_state(home_id, "past_due")


async def _handle_charge_refunded(event: WebhookEvent) -> None:
    charge = event.data
    home_id = await _home_id_from_customer(charge.get("customer"))
    if not home_id:
        return
    await _set_state(home_id, "refunded")
    # Founder-slot release only fires inside the 14d Israeli return
    # window (founder decision 6). After 14d the slot is permanently
    # bound even if a refund is later granted.
    if await slot_counter.is_within_return_window(home_id):
        await slot_counter.release(home_id, reason="refund_within_14d")


HANDLERS: dict[str, Callable[[WebhookEvent], Awaitable[None]]] = {
    "checkout.session.completed":   _handle_checkout_completed,
    "checkout.session.expired":     _handle_checkout_expired,
    "customer.subscription.created": _handle_subscription_created,
    "customer.subscription.updated": _handle_subscription_updated,
    "customer.subscription.deleted": _handle_subscription_deleted,
    "invoice.paid":                 _handle_invoice_paid,
    "invoice.payment_failed":       _handle_invoice_payment_failed,
    "charge.refunded":              _handle_charge_refunded,
}


# ---------------------------------------------------------------------------
# Router endpoint
# ---------------------------------------------------------------------------

@router.post("/webhook")
async def stripe_webhook(request: Request):
    raw = await request.body()
    src_ip = _client_ip(request)
    sig_header = request.headers.get("Stripe-Signature", "")

    await log_event(
        "stripe_webhook_received", source_ip=src_ip, ok=True,
        detail=f"bytes={len(raw)}",
    )

    provider = get_provider()
    try:
        event = provider.verify_webhook(payload=raw, signature_header=sig_header)
    except WebhookSignatureError as e:
        await log_event(
            "stripe_webhook_rejected", source_ip=src_ip, ok=False, detail=str(e),
        )
        raise HTTPException(400, "Invalid Stripe signature.")

    # Pre-check idempotency. Stripe retries until it gets a 2xx, and we
    # would rather not re-apply state transitions or re-record invoices
    # (the underlying ops are idempotent, but skipping cuts log noise +
    # one DB roundtrip).
    async with get_db() as db:
        seen = await db.execute_fetchall(
            "SELECT 1 FROM processed_webhooks WHERE event_id=?", (event.id,)
        )
    if seen:
        await log_event(
            "stripe_webhook_duplicate", source_ip=src_ip, ok=True,
            detail=f"event_id={event.id} type={event.type}",
        )
        return {"ok": True, "duplicate": True}

    handler = HANDLERS.get(event.type)
    if handler is None:
        # Unhandled event types are recorded as 'ignored' but still
        # marked processed so Stripe stops retrying them.
        await log_event(
            "stripe_webhook_ignored", source_ip=src_ip, ok=True,
            detail=f"type={event.type} id={event.id}",
        )
    else:
        try:
            await handler(event)
        except Exception as e:
            await log_event(
                "stripe_webhook_handler_failed", source_ip=src_ip, ok=False,
                detail=(f"type={event.type} id={event.id} "
                        f"err={type(e).__name__}: {e}"),
            )
            # 500 → Stripe retries. Do NOT insert into processed_webhooks.
            raise HTTPException(500, "Handler failed; Stripe will retry.")

    # Mark processed AFTER handler success (or after 'ignored'). A
    # concurrent duplicate delivery could race past the pre-check and
    # land here too; the UNIQUE constraint on event_id makes the
    # second INSERT no-op via IntegrityError.
    try:
        async with get_db() as db:
            await db.execute(
                """INSERT INTO processed_webhooks
                     (event_id, received_at, event_type)
                   VALUES (?,?,?)""",
                (event.id, datetime.now(timezone.utc).isoformat(), event.type),
            )
            await db.commit()
    except sqlite3.IntegrityError:
        # Raced duplicate; handler already ran for both deliveries but
        # both runs are idempotent. No corrective action required.
        pass

    if handler is not None:
        await log_event(
            "stripe_webhook_handled", source_ip=src_ip, ok=True,
            detail=f"type={event.type} id={event.id}",
        )
    return {"ok": True}
