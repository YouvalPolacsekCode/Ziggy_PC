"""Founder-pricing slot counter (Prompt 9 chunk 2).

The first 30 customers buying Founder Lifetime get the locked $5/mo
price (charged in NIS, see DECISIONS.md). The 31st must not be sold
that price; this module is the chokepoint that enforces the cap.

Reservation happens at *checkout-session creation* time, NOT at webhook
receipt. Rationale: by the time Stripe fires the success webhook, the
user has already entered card details and clicked. A race in which two
users complete checkout simultaneously and both walk away with founder
pricing is a real loss; the audit (§2.6) committed to atomic reserve
at checkout creation to close that window.

Release rules (per founder decisions, audit §2.6):

  1. Checkout abandoned: Stripe Checkout sessions auto-expire 24h after
     creation. Stripe fires checkout.session.expired; the webhook handler
     calls release(reason="checkout_expired"). Slot frees up immediately.
  2. Refund within 14 days of claim (Israeli consumer return law): the
     charge.refunded webhook handler checks is_within_return_window() and
     calls release(reason="refund_within_14d") if true. Slot frees up.
  3. Refund after 14 days: slot is permanently bound. Founder may issue
     the refund but the slot does not return to the pool.

Idempotency: reserve() is safe to call multiple times for the same
home_id; it returns the same slot_number on subsequent calls (UI
double-click safe). release() is a no-op if the slot was already
released.

Atomicity proof: the INSERT statement uses a single SELECT-derived row
guarded by a COUNT(*) < 30 subquery, executed inside SQLite's writer
lock. SQLite serializes all writes to the database file, so two
concurrent reserve() calls cannot both observe count=29 and both
insert; the second sees count=30 and the WHERE clause yields zero rows.

Slot number reuse: slot_number is assigned via COALESCE(MAX(...),0)+1,
NOT AUTOINCREMENT. A released slot's number is reused by the next
reservation. Intentional: a released slot means the prior holder
abandoned or was refunded (never converted), so there is no founder-#N
identity to preserve. If we ever issue physical founder certificates
where each # must be globally unique forever, switch slot_number to
AUTOINCREMENT and decouple "cap count" from "slot identity".
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from ..audit import log_event
from ..database import get_db


FOUNDER_SLOT_CAP = 30
RETURN_WINDOW_DAYS = 14


async def reserve(home_id: str) -> Optional[int]:
    """Atomically claim a founder slot for this home.

    Returns the assigned slot_number (1..FOUNDER_SLOT_CAP) on success.
    Returns None if all slots are claimed.
    Idempotent: re-calling for an already-reserved home returns the
    existing slot_number unchanged.
    """
    async with get_db() as db:
        existing = await db.execute_fetchall(
            "SELECT slot_number FROM founder_slots WHERE home_id=?", (home_id,)
        )
        if existing:
            return int(existing[0]["slot_number"])

        now_iso = datetime.now(timezone.utc).isoformat()
        # Cap-guarded atomic INSERT. Each piece, and why it's needed:
        #
        #   FROM (SELECT 1) AS dummy
        #     Yields exactly one synthetic row. Required because we want
        #     the WHERE to filter THIS row, not to filter the founder_slots
        #     aggregate — filtering an aggregate over an empty set still
        #     returns one NULL row, so the original `... FROM founder_slots
        #     WHERE (count < cap)` formulation would compute MAX=NULL ->
        #     slot_number=1 once the cap was hit and crash on UNIQUE.
        #
        #   (SELECT COALESCE(MAX(slot_number), 0) + 1 FROM founder_slots)
        #     Next slot number — computed inside the same writer txn so
        #     concurrent reservers see a consistent snapshot.
        #
        #   WHERE (SELECT COUNT(*) FROM founder_slots) < ?
        #     The cap. If 30 slots are already taken, this is FALSE, the
        #     dummy row is filtered out, and INSERT touches zero rows
        #     (cursor.rowcount == 0). SQLite's writer lock serializes the
        #     COUNT subquery against concurrent inserts.
        cursor = await db.execute(
            """INSERT INTO founder_slots (slot_number, home_id, claimed_at)
               SELECT (SELECT COALESCE(MAX(slot_number), 0) + 1 FROM founder_slots),
                      ?, ?
               FROM (SELECT 1) AS dummy
               WHERE (SELECT COUNT(*) FROM founder_slots) < ?""",
            (home_id, now_iso, FOUNDER_SLOT_CAP),
        )
        await db.commit()

        if cursor.rowcount == 0:
            await log_event(
                "founder_slot_full", home_id=home_id, ok=False,
                detail=f"cap={FOUNDER_SLOT_CAP}",
            )
            return None

        # Read back the assigned slot_number. INSERT...SELECT does not
        # populate lastrowid for the SELECT-derived value on every
        # SQLite version, so a follow-up SELECT is the portable read.
        rows = await db.execute_fetchall(
            "SELECT slot_number FROM founder_slots WHERE home_id=?", (home_id,)
        )

    slot_number = int(rows[0]["slot_number"]) if rows else None
    await log_event(
        "founder_slot_reserved", home_id=home_id, ok=True,
        detail=f"slot={slot_number}",
    )
    return slot_number


async def release(home_id: str, *, reason: str) -> bool:
    """Release this home's founder slot. Returns True if a row was deleted.

    `reason` is recorded in the audit log so we can later distinguish
    abandoned-checkout releases from within-14d-refund releases. After
    14 days no caller should invoke this for refund reasons (founder
    decision: post-14d slot is permanently bound).
    """
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM founder_slots WHERE home_id=?", (home_id,)
        )
        await db.commit()
        deleted = cursor.rowcount > 0

    await log_event(
        "founder_slot_released", home_id=home_id, ok=deleted,
        detail=f"reason={reason}" + ("" if deleted else " (no-op: not claimed)"),
    )
    return deleted


async def is_within_return_window(home_id: str) -> bool:
    """Israeli consumer law: 14 days from purchase. Source-of-truth
    timestamp is founder_slots.claimed_at, not the Stripe charge date,
    so the answer is unambiguous even if the founder later replays
    webhooks or backfills history."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT claimed_at FROM founder_slots WHERE home_id=?", (home_id,)
        )
    if not rows:
        return False
    claimed_at = datetime.fromisoformat(rows[0]["claimed_at"])
    return (datetime.now(timezone.utc) - claimed_at) <= timedelta(days=RETURN_WINDOW_DAYS)


async def remaining() -> int:
    """Slots not yet claimed. Powers the public counter UI endpoint
    ('X of 30 founder slots remaining') exposed in chunk 3."""
    async with get_db() as db:
        rows = await db.execute_fetchall("SELECT COUNT(*) AS n FROM founder_slots")
    used = int(rows[0]["n"]) if rows else 0
    return max(0, FOUNDER_SLOT_CAP - used)
