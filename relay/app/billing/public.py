"""Public + customer-facing billing endpoints (Prompt 9 chunk 3).

Two endpoints share this module:

  GET  /api/billing/founder-slots/remaining
       No auth. Returns {"remaining": N, "total": 30}. Powers the landing
       page counter UI. Cached in-process for 60s + per-IP rate limited
       so a hostile crawler can't flood the relay.

  POST /api/billing/checkout
       Authenticated (any user JWT, must own a home). Reserves a founder
       slot when the requested plan is_founder; then creates a Stripe
       Checkout Session and returns the hosted URL. Stripe session
       expiry is 24h; the founder_slots release-on-abandon path
       consumes the matching checkout.session.expired webhook
       (relay/app/billing/webhooks.py:_handle_checkout_expired).

Slot reservation happens BEFORE Stripe session creation. Rationale per
audit §2.6: the race we care about is two simultaneous founder
checkouts at slot 30; the window that matters closes well before
money lands. If slot reservation fails, the checkout API 409s without
calling Stripe, so the user sees an immediate "founder pricing sold
out" message and the slot integrity holds.
"""

from __future__ import annotations

import time
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..audit import log_event
from ..auth import current_user
from ..database import get_db
from . import slot_counter
from .plans import PLANS, PlanMisconfiguredError, get_plan
from .stripe_provider import get_provider


router = APIRouter(prefix="/billing")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


# ---------------------------------------------------------------------------
# Public: founder-slots/remaining
# ---------------------------------------------------------------------------

_CACHE_TTL_S = 60
_cache_value: Optional[int] = None
_cache_set_at: float = 0.0

# Sliding-window rate limit: per-IP cap of 60 requests / 60s. Generous
# enough that a landing-page poll every 5s from a tab open all day is
# fine; tight enough that a script firing thousands of req/s gets 429.
# In-memory only — restart resets the buckets; fly.io's per-instance
# scaling means this is per-instance not global, acceptable for the
# light surface (single COUNT(*) query, no DB writes).
_RATE_LIMIT_PER_WINDOW = 60
_RATE_WINDOW_S = 60
_rate_buckets: dict[str, list[float]] = {}
# Soft cap on bucket dict size — protects against memory growth from
# IP fanout attacks. Eviction is "drop the oldest bucket entirely"
# which loses some accuracy but bounds memory.
_RATE_BUCKETS_MAX = 10_000


def _rate_limit_ok(ip: str) -> bool:
    now = time.time()
    cutoff = now - _RATE_WINDOW_S
    bucket = _rate_buckets.setdefault(ip, [])
    # Drop entries older than the window. Slice rebind beats repeated
    # list.pop(0) for many-entries case.
    if bucket and bucket[0] < cutoff:
        bucket[:] = [t for t in bucket if t >= cutoff]
    if len(bucket) >= _RATE_LIMIT_PER_WINDOW:
        return False
    bucket.append(now)
    # Soft-cap eviction: drop a random bucket if we're past the cap.
    # Picks the first key (insertion-ordered in py3.7+, so this is FIFO).
    if len(_rate_buckets) > _RATE_BUCKETS_MAX:
        _rate_buckets.pop(next(iter(_rate_buckets)), None)
    return True


async def _cached_remaining() -> int:
    global _cache_value, _cache_set_at
    now = time.time()
    if _cache_value is None or (now - _cache_set_at) > _CACHE_TTL_S:
        _cache_value = await slot_counter.remaining()
        _cache_set_at = now
    return _cache_value


def _reset_cache_for_tests() -> None:
    global _cache_value, _cache_set_at, _rate_buckets
    _cache_value = None
    _cache_set_at = 0.0
    _rate_buckets = {}


@router.get("/founder-slots/remaining")
async def founder_slots_remaining(request: Request):
    src_ip = _client_ip(request)
    if not _rate_limit_ok(src_ip):
        raise HTTPException(429, "Too many requests.")
    remaining = await _cached_remaining()
    return {
        "remaining": remaining,
        "total":     slot_counter.FOUNDER_SLOT_CAP,
    }


# ---------------------------------------------------------------------------
# Customer-facing: POST /checkout
# ---------------------------------------------------------------------------

class CheckoutBody(BaseModel):
    plan_id:     str
    success_url: str
    cancel_url:  str


@router.post("/checkout")
async def create_checkout(body: CheckoutBody, request: Request):
    """Reserve a founder slot (if applicable) and open a Stripe Checkout.

    Auth: any signed-in user JWT. The home_id and customer email are
    pulled from the user's claims, never from the request body — that
    prevents a malicious caller from creating checkouts pointing at
    other people's homes.
    """
    user = current_user(request)
    home_id = user.get("home_id")
    customer_email = user.get("email")
    if not home_id or not customer_email:
        raise HTTPException(403, "Account not provisioned for a home.")

    try:
        plan = get_plan(body.plan_id)
    except KeyError:
        raise HTTPException(400, f"Unknown plan: {body.plan_id!r}.")

    src_ip = _client_ip(request)
    reserved_slot: Optional[int] = None

    if plan.is_founder:
        # Atomic reserve BEFORE Stripe session creation. If we can't
        # reserve, the caller never sees Stripe — they see 409 and a
        # message telling them founder pricing sold out. Slot is
        # released by checkout.session.expired (24h) if the user
        # walks away from the Stripe page without paying.
        reserved_slot = await slot_counter.reserve(home_id)
        if reserved_slot is None:
            await log_event(
                "checkout_rejected_no_founder_slot", home_id=home_id,
                source_ip=src_ip, ok=False, detail=f"plan={body.plan_id}",
            )
            raise HTTPException(
                409, "Founder pricing is sold out. Please pick a Standard plan.",
            )

    try:
        provider = get_provider()
        session = await provider.create_checkout(
            home_id=home_id,
            plan_id=plan.id,
            customer_email=customer_email,
            success_url=body.success_url,
            cancel_url=body.cancel_url,
        )
    except PlanMisconfiguredError as e:
        # Plan's STRIPE_PRICE_* env var missing. Release the slot we
        # may have just grabbed so it doesn't strand on a never-paid
        # checkout.
        if reserved_slot is not None:
            await slot_counter.release(home_id, reason="checkout_creation_failed")
        await log_event(
            "checkout_rejected_misconfigured", home_id=home_id,
            source_ip=src_ip, ok=False, detail=str(e),
        )
        raise HTTPException(500, "Billing is misconfigured. Founder is investigating.")
    except Exception as e:
        if reserved_slot is not None:
            await slot_counter.release(home_id, reason="checkout_creation_failed")
        await log_event(
            "checkout_rejected_provider_error", home_id=home_id,
            source_ip=src_ip, ok=False,
            detail=f"{type(e).__name__}: {e}",
        )
        raise HTTPException(502, "Could not create checkout session.")

    await log_event(
        "checkout_created", home_id=home_id, source_ip=src_ip, ok=True,
        detail=(f"plan={plan.id} stripe_session={session.session_id} "
                f"slot={reserved_slot}"),
    )
    return {
        "url":             session.url,
        "session_id":      session.session_id,
        "expires_at":      session.expires_at,
        "founder_slot":    reserved_slot,
    }
