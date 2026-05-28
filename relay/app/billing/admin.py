"""Founder-facing billing admin endpoints (Prompt 9 chunk 2).

Today this is just the kit-received marker — the founder POSTs when a
kit lands in the customer's hands, which starts the 14-day trial clock
on Standard plans (per founder decision 7). Future admin endpoints
(manual state override, slot release, refund handling) belong here too.

Endpoint surface:

  PATCH /api/admin/homes/{home_id}/kit-received    relay_admin only
        body: { "kit_received_at": "<iso8601>"? }   (optional; defaults to now)
        → 200 { kit_received_at, trial_started_at, trial_ends_at,
                subscription_state, plan_id }

Trial-start semantics (decision 7):

  * Standard plans (has_trial=True): kit_received_at sets the trial
    window (kit_received_at .. kit_received_at + 14d). subscription_state
    flips to 'trialing' ONLY if it was 'pending_setup' (i.e. payment
    not yet on file). If the customer already paid (state='active'),
    we record kit_received_at as audit metadata but do NOT downgrade
    the active state.

  * Founder Lifetime (has_trial=False): there is no trial; the price
    IS the offer. kit_received_at is recorded for audit but the trial
    columns stay NULL and subscription_state is left alone.

  * Unknown plan (plan_id IS NULL — pre-checkout): trial window is
    recorded; subscription_state flips to 'trialing' if it was
    'pending_setup', so a customer who receives the kit before
    setting up payment gets the 14-day window starting now.

Idempotency: PATCH is safe to replay — re-setting kit_received_at
moves the trial window forward (rare but supported, e.g. if the
original timestamp was wrong). Each call writes an audit row so
the history is reconstructable.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..audit import log_event
from ..auth import require_role
from ..database import get_db
from .plans import PLANS


router = APIRouter(prefix="/admin/homes")

TRIAL_DAYS = 14


class KitReceivedBody(BaseModel):
    # Optional — defaults to now() at handler time. Accepting an
    # explicit value lets the founder backdate if they forgot to
    # mark a kit at delivery time.
    kit_received_at: Optional[str] = None


def _parse_iso(s: str) -> datetime:
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(400, f"Invalid kit_received_at: {e}")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@router.patch("/{home_id}/kit-received")
async def mark_kit_received(home_id: str, body: KitReceivedBody, request: Request):
    require_role("relay_admin")(request)

    received_dt = _parse_iso(body.kit_received_at) if body.kit_received_at else datetime.now(timezone.utc)
    received_iso = received_dt.isoformat()

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, plan_id, subscription_state FROM homes WHERE id=?",
            (home_id,),
        )
        if not rows:
            raise HTTPException(404, "Home not found.")
        home = dict(rows[0])
        plan_id = home.get("plan_id")
        current_state = home.get("subscription_state", "active")

        plan = PLANS.get(plan_id) if plan_id else None
        plan_grants_trial = plan is None or plan.has_trial
        # Only flip an unpaid state to 'trialing'. Never downgrade
        # an already-paid 'active' subscription, never resurrect a
        # 'cancelled' or 'refunded' one.
        flip_to_trialing = plan_grants_trial and current_state == "pending_setup"

        if plan_grants_trial:
            trial_started_at = received_iso
            trial_ends_at = (received_dt + timedelta(days=TRIAL_DAYS)).isoformat()
        else:
            trial_started_at = None
            trial_ends_at = None

        sets = ["kit_received_at=?", "trial_started_at=?", "trial_ends_at=?"]
        args: list = [received_iso, trial_started_at, trial_ends_at]
        new_state = current_state
        if flip_to_trialing:
            sets.append("subscription_state=?")
            args.append("trialing")
            sets.append("subscription_updated_at=?")
            args.append(datetime.now(timezone.utc).isoformat())
            new_state = "trialing"
        args.append(home_id)

        await db.execute(
            f"UPDATE homes SET {', '.join(sets)} WHERE id=?", args,
        )
        await db.commit()

    await log_event(
        "kit_received_marked", home_id=home_id, ok=True,
        detail=(f"received_at={received_iso} plan={plan_id} "
                f"trial_ends={trial_ends_at} state={new_state}"),
    )
    return {
        "kit_received_at":   received_iso,
        "trial_started_at":  trial_started_at,
        "trial_ends_at":     trial_ends_at,
        "subscription_state": new_state,
        "plan_id":           plan_id,
    }
