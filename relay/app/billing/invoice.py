"""Israeli invoice sequence + VAT bookkeeping (Prompt 9 chunk 2).

Two related responsibilities:

1. SEQUENTIAL NUMBERING.  Israeli tax law requires invoice numbers to
   be monotonic with no gaps. invoice_sequence.id (AUTOINCREMENT) is
   the canonical sequence — SQLite's AUTOINCREMENT keyword (distinct
   from default ROWID behavior) guarantees the number never decreases
   even after row deletion, which is what regulators expect.

2. VAT TRACKING.  Israeli VAT is 18% (locked 2026-05-28 per founder
   decision; raised from 17% on 2025-01-01). All amounts stored as
   integer agorot (1/100 NIS) to avoid float rounding.

ON עוסק פטור vs עוסק מורשה — important nuance, founder review wanted:

  עוסק פטור (VAT-exempt sole trader, < NIS 120k/yr revenue): the
  invoice document is a קבלה (receipt). It MUST NOT show a separate
  VAT line — by definition no VAT is charged to the customer.

  עוסק מורשה (regular VAT-registered): the invoice is a חשבונית מס
  (tax invoice). VAT is broken out as a separate line.

DECISIONS.md says עוסק פטור registration is in progress; the prompt
also says "VAT (18%) included in display prices ... עוסק פטור rules".
This module reconciles the two by:
  - DEFAULT: עוסק פטור — customer-facing receipts show no VAT line,
    but vat_amount_agorot is still calculated and recorded internally
    against the day the founder graduates to עוסק מורשה (auto-flip on
    threshold breach is a v1.1 problem; for now flip MERCHANT_STATUS
    by hand).
  - When MERCHANT_STATUS flips to 'osek_morshe', existing rows already
    have correct VAT amounts; the customer-facing render simply starts
    showing the VAT line.

This module records the metadata; the printable document render lives
in chunk 3 (or later, depending on whether the founder wants a Python
template or a Stripe-hosted invoice template).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, Optional

from ..audit import log_event
from ..database import get_db


# Locked 2026-05-28 per founder decision; matches Israeli VAT raised from
# 17% to 18% on 2025-01-01. Treat this constant as the source of truth —
# historical invoices keep their stored vat_amount_agorot regardless.
VAT_RATE = Decimal("0.18")

MerchantStatus = Literal["osek_patur", "osek_morshe"]
MERCHANT_STATUS: MerchantStatus = "osek_patur"


def vat_split_inclusive(total_agorot: int) -> tuple[int, int]:
    """Split a VAT-inclusive total into (net, vat) in agorot.

    For inclusive pricing: vat = total * rate / (1 + rate).
    Uses Decimal + ROUND_HALF_UP so the math is deterministic and audit-
    reproducible (not banker's rounding, which surprises accountants).

    >>> vat_split_inclusive(11800)   # 118.00 NIS = 100 net + 18 vat
    (10000, 1800)
    """
    if total_agorot < 0:
        raise ValueError(f"total_agorot must be non-negative, got {total_agorot}")
    total = Decimal(total_agorot)
    vat = (total * VAT_RATE / (Decimal(1) + VAT_RATE)).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP
    )
    return int(total - vat), int(vat)


async def record(
    *,
    home_id: str,
    stripe_invoice_id: str,
    amount_ils_agorot: int,
    issued_at: Optional[str] = None,
) -> Optional[int]:
    """Record a paid invoice and return its sequential number.

    Idempotent on (stripe_invoice_id): a duplicate webhook delivery
    returns the existing invoice number instead of inserting a new
    row. Without idempotency, Stripe's retry behavior would tear holes
    in the sequence (rolled-back failed inserts still bump
    sqlite_sequence; new inserts after rollback get a fresh number).

    Returns None if the row could not be recorded.
    """
    if issued_at is None:
        issued_at = datetime.now(timezone.utc).isoformat()
    _net_agorot, vat_agorot = vat_split_inclusive(amount_ils_agorot)

    async with get_db() as db:
        existing = await db.execute_fetchall(
            "SELECT id FROM invoice_sequence WHERE stripe_invoice_id=?",
            (stripe_invoice_id,),
        )
        if existing:
            return int(existing[0]["id"])

        cursor = await db.execute(
            """INSERT INTO invoice_sequence
                 (home_id, stripe_invoice_id, issued_at,
                  amount_ils_agorot, vat_amount_agorot)
               VALUES (?,?,?,?,?)""",
            (home_id, stripe_invoice_id, issued_at,
             amount_ils_agorot, vat_agorot),
        )
        await db.commit()
        invoice_number = cursor.lastrowid

    await log_event(
        "invoice_recorded", home_id=home_id, ok=True,
        detail=(f"number={invoice_number} stripe_id={stripe_invoice_id} "
                f"total_agorot={amount_ils_agorot} vat_agorot={vat_agorot} "
                f"merchant={MERCHANT_STATUS}"),
    )
    return int(invoice_number) if invoice_number is not None else None


async def get_by_number(invoice_number: int) -> Optional[dict]:
    """Fetch one invoice by its sequential number. Used by the founder
    dashboard (Prompt 10) and the customer billing UI (chunk 3)."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """SELECT id, home_id, stripe_invoice_id, issued_at,
                      amount_ils_agorot, vat_amount_agorot
               FROM invoice_sequence WHERE id=?""",
            (invoice_number,),
        )
    return dict(rows[0]) if rows else None


async def list_for_home(home_id: str, *, limit: int = 50) -> list[dict]:
    """All invoices for one home, newest first."""
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """SELECT id, stripe_invoice_id, issued_at,
                      amount_ils_agorot, vat_amount_agorot
               FROM invoice_sequence WHERE home_id=?
               ORDER BY id DESC LIMIT ?""",
            (home_id, max(1, min(int(limit), 500))),
        )
    return [dict(r) for r in rows]


def format_number(invoice_number: int) -> str:
    """Render the customer-facing invoice number string. Zero-padded
    to 6 digits ('000042') so printed documents have stable width.
    The pad does not affect uniqueness or sequence semantics — it's
    purely a presentation concern."""
    return f"{int(invoice_number):06d}"
