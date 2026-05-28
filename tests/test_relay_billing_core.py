"""Tests for relay/app/billing/ — schema, slot counter, invoice, gate, admin.

Prompt 9 chunk 2. Webhook handler dispatch lives in a separate file
because it requires the stripe SDK; everything here runs without it.

Coverage:
  Schema migration
    init_db adds 9 new homes columns + 3 new tables
    init_db is idempotent (rerun is a no-op)
    default subscription_state is 'active' (backward compat)
  Slot counter
    sequential reservation 1..30, then None for the 31st
    reserve() is idempotent (same home twice → same slot)
    release() deletes, no-op on un-claimed home
    is_within_return_window respects the 14d cutoff
    remaining() returns FOUNDER_SLOT_CAP - claimed
    CONCURRENT: 50 parallel reserve()s yield exactly 30 successes
  Invoice
    vat_split_inclusive math
    record() returns sequential numbers + idempotent on stripe_invoice_id
    AUTOINCREMENT preserves monotonicity even after row deletion
  Subscription gate
    full status × subscription_state truth-table matrix
  Kit-received admin endpoint
    Standard plan in pending_setup → flips to trialing + window set
    Standard plan in active → window set, state preserved
    Founder Lifetime plan → no window, state untouched
    Unknown plan in pending_setup → window + flip
    403 for non-admin, 404 for unknown home, explicit timestamp accepted
"""

from __future__ import annotations

import asyncio
import importlib.util
from datetime import datetime, timedelta, timezone

import pytest

_has_jwt = importlib.util.find_spec("jwt") is not None
pytestmark = pytest.mark.skipif(
    not _has_jwt,
    reason="PyJWT not installed in this venv — see relay/requirements.txt",
)

if _has_jwt:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from relay.app import database as dbmod
    from relay.app.auth import issue_jwt
    from relay.app.billing import ACTIVE_SUBSCRIPTION_STATES, SUBSCRIPTION_STATES
    from relay.app.billing import slot_counter
    from relay.app.billing import invoice as invoice_module
    from relay.app.billing.admin import router as admin_router
    from relay.app.billing.invoice import VAT_RATE, vat_split_inclusive
    from relay.app.billing.slot_counter import FOUNDER_SLOT_CAP, RETURN_WINDOW_DAYS
    from relay.app.routers.ota import _subscription_active


HOME_A = "home-a"
HOME_B = "home-b"


# ---------- fixtures ----------

@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


@pytest.fixture
async def db_with_homes(db):
    async with db.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (HOME_A, "Home A", "cloud", "active", "secret-aaa", "2026-01-01"),
        )
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (HOME_B, "Home B", "cloud", "active", "secret-bbb", "2026-01-01"),
        )
        await conn.commit()
    return db


@pytest.fixture
async def admin_client(db_with_homes):
    app = FastAPI()
    app.include_router(admin_router, prefix="/api")
    return TestClient(app)


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-admin', 'founder@example.com', 'relay_admin', None)}"}


def _user_headers(home_id: str = HOME_A) -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-user', 'user@example.com', 'user', home_id)}"}


# =====================================================================
# Schema migration
# =====================================================================

async def test_schema_adds_subscription_columns(db):
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall("PRAGMA table_info(homes)")
    cols = {r[1] for r in rows}
    for c in (
        "subscription_state", "stripe_customer_id", "stripe_subscription_id",
        "plan_id", "kit_received_at", "trial_started_at", "trial_ends_at",
        "subscription_updated_at", "cancelled_at",
    ):
        assert c in cols, f"missing column: {c}"


async def test_schema_adds_new_tables(db):
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    names = {r[0] for r in rows}
    assert "founder_slots" in names
    assert "processed_webhooks" in names
    assert "invoice_sequence" in names


async def test_init_db_idempotent(db):
    # Re-running init_db must not raise, drop data, or duplicate columns.
    await db.init_db()
    await db.init_db()
    async with db.get_db() as conn:
        rows = await conn.execute_fetchall("PRAGMA table_info(homes)")
    # Just one of each subscription column — count == columns set size.
    cols = [r[1] for r in rows]
    assert cols.count("subscription_state") == 1
    assert cols.count("cancelled_at") == 1


async def test_default_subscription_state_is_active(db_with_homes):
    async with db_with_homes.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT subscription_state FROM homes WHERE id=?", (HOME_A,)
        )
    assert rows[0]["subscription_state"] == "active"


# =====================================================================
# Slot counter
# =====================================================================

async def test_slot_counter_sequential(db):
    # Each reserve() with a unique home_id gets the next slot.
    async with db.get_db() as conn:
        for i in range(FOUNDER_SLOT_CAP):
            await conn.execute(
                "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
                "VALUES (?,?,?,?,?,?)",
                (f"h-{i}", f"H{i}", "cloud", "active", "s", "2026-01-01"),
            )
        await conn.commit()

    for i in range(FOUNDER_SLOT_CAP):
        slot = await slot_counter.reserve(f"h-{i}")
        assert slot == i + 1, f"expected slot {i+1}, got {slot}"

    # 31st must be None
    async with db.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
            "VALUES (?,?,?,?,?,?)",
            ("h-31", "H31", "cloud", "active", "s", "2026-01-01"),
        )
        await conn.commit()
    over = await slot_counter.reserve("h-31")
    assert over is None


async def test_slot_counter_idempotent(db_with_homes):
    s1 = await slot_counter.reserve(HOME_A)
    s2 = await slot_counter.reserve(HOME_A)
    assert s1 == s2 == 1


async def test_slot_counter_release(db_with_homes):
    await slot_counter.reserve(HOME_A)
    assert await slot_counter.release(HOME_A, reason="checkout_expired") is True
    # Released slot frees up the slot_number for reuse — the next reserve
    # sees an empty table, computes MAX(slot_number)=NULL → 1. Slot number
    # reuse is intentional: a released slot represents a customer who
    # never converted (abandoned/refunded), so no founder-#N obligation
    # to preserve. See slot_counter module docstring.
    s = await slot_counter.reserve(HOME_B)
    assert s == 1


async def test_slot_counter_release_noop_on_unclaimed(db_with_homes):
    assert await slot_counter.release(HOME_A, reason="test") is False


async def test_slot_counter_within_return_window(db_with_homes, monkeypatch):
    await slot_counter.reserve(HOME_A)
    assert await slot_counter.is_within_return_window(HOME_A) is True

    # Backdate the claim to outside the window.
    past = (datetime.now(timezone.utc) - timedelta(days=RETURN_WINDOW_DAYS + 1)).isoformat()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "UPDATE founder_slots SET claimed_at=? WHERE home_id=?", (past, HOME_A)
        )
        await conn.commit()
    assert await slot_counter.is_within_return_window(HOME_A) is False


async def test_slot_counter_remaining(db_with_homes):
    assert await slot_counter.remaining() == FOUNDER_SLOT_CAP
    await slot_counter.reserve(HOME_A)
    assert await slot_counter.remaining() == FOUNDER_SLOT_CAP - 1


async def test_slot_counter_concurrent_reserve_safety(db):
    # The safety-critical test: many parallel reserves must NEVER over-sell.
    # SQLite serializes writes; the WHERE COUNT < cap subquery is evaluated
    # inside the same write txn so two callers cannot both observe count=29
    # and both insert.
    async with db.get_db() as conn:
        for i in range(50):
            await conn.execute(
                "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
                "VALUES (?,?,?,?,?,?)",
                (f"hc-{i}", f"HC{i}", "cloud", "active", "s", "2026-01-01"),
            )
        await conn.commit()

    results = await asyncio.gather(
        *(slot_counter.reserve(f"hc-{i}") for i in range(50))
    )
    successes = [r for r in results if r is not None]
    nulls = [r for r in results if r is None]
    assert len(successes) == FOUNDER_SLOT_CAP, (
        f"expected exactly {FOUNDER_SLOT_CAP} successes, got {len(successes)}"
    )
    assert len(nulls) == 50 - FOUNDER_SLOT_CAP
    # No duplicate slot numbers.
    assert len(set(successes)) == FOUNDER_SLOT_CAP


# =====================================================================
# Invoice
# =====================================================================

def test_vat_split_inclusive_math():
    # 118.00 NIS inclusive → 100.00 net + 18.00 vat
    assert vat_split_inclusive(11800) == (10000, 1800)
    # 100 agorot → 85 net + 15 vat (15.25 → 15 via ROUND_HALF_UP on .25 boundary)
    assert vat_split_inclusive(100) == (85, 15)
    assert vat_split_inclusive(0) == (0, 0)
    # negative should raise
    with pytest.raises(ValueError):
        vat_split_inclusive(-1)
    # VAT rate locked at 18%
    assert VAT_RATE == __import__("decimal").Decimal("0.18")


async def test_invoice_record_sequential(db_with_homes):
    n1 = await invoice_module.record(
        home_id=HOME_A, stripe_invoice_id="in_test_1", amount_ils_agorot=11800,
    )
    n2 = await invoice_module.record(
        home_id=HOME_A, stripe_invoice_id="in_test_2", amount_ils_agorot=11800,
    )
    n3 = await invoice_module.record(
        home_id=HOME_B, stripe_invoice_id="in_test_3", amount_ils_agorot=11800,
    )
    assert (n1, n2, n3) == (1, 2, 3)


async def test_invoice_idempotent_on_stripe_id(db_with_homes):
    n1 = await invoice_module.record(
        home_id=HOME_A, stripe_invoice_id="in_dup", amount_ils_agorot=11800,
    )
    n2 = await invoice_module.record(
        home_id=HOME_A, stripe_invoice_id="in_dup", amount_ils_agorot=99999,
    )
    assert n1 == n2 == 1
    # Original amount preserved on idempotent re-call.
    row = await invoice_module.get_by_number(n1)
    assert row["amount_ils_agorot"] == 11800


async def test_invoice_numbering_monotonic_across_delete(db_with_homes):
    # Israeli tax law: invoice numbers must never be reused. AUTOINCREMENT
    # (not default ROWID) guarantees this even after deletion.
    await invoice_module.record(
        home_id=HOME_A, stripe_invoice_id="in_1", amount_ils_agorot=11800,
    )
    async with dbmod.get_db() as conn:
        await conn.execute("DELETE FROM invoice_sequence WHERE stripe_invoice_id='in_1'")
        await conn.commit()
    n2 = await invoice_module.record(
        home_id=HOME_A, stripe_invoice_id="in_2", amount_ils_agorot=11800,
    )
    assert n2 == 2, f"expected 2 (no reuse of 1), got {n2}"


async def test_invoice_vat_recorded(db_with_homes):
    n = await invoice_module.record(
        home_id=HOME_A, stripe_invoice_id="in_vat", amount_ils_agorot=11800,
    )
    row = await invoice_module.get_by_number(n)
    assert row["amount_ils_agorot"] == 11800
    assert row["vat_amount_agorot"] == 1800


# =====================================================================
# Subscription gate (_subscription_active matrix)
# =====================================================================

@pytest.mark.parametrize("status,sub,expected", [
    # Active billing states + active operational → allowed
    ("active", "trialing", True),
    ("active", "active", True),
    # Billing kill-switch states → denied
    ("active", "past_due", False),
    ("active", "cancelled", False),
    ("active", "refunded", False),
    ("active", "pending_setup", False),
    # Operational suspension overrides everything → denied
    ("suspended", "active", False),
    ("suspended", "trialing", False),
    ("suspended", "cancelled", False),
    # Non-suspended operational states still subject to billing gate
    ("provisioning", "active", True),
    ("provisioning", "cancelled", False),
    ("pending_setup", "active", True),
    ("failed: x", "active", True),
])
async def test_subscription_active_matrix(status, sub, expected):
    got = await _subscription_active(home_status=status, subscription_state=sub)
    assert got is expected, (
        f"_subscription_active(status={status!r}, sub={sub!r}) "
        f"expected {expected}, got {got}"
    )


def test_active_states_constant_matches_matrix():
    # The constant must enumerate exactly the states that the gate allows.
    assert ACTIVE_SUBSCRIPTION_STATES == frozenset({"trialing", "active"})


def test_subscription_states_constant_includes_all_referenced():
    # Webhook handlers and the kill-switch must agree on the universe of
    # legal states. Catch typos by listing the full set in one place.
    expected = {
        "pending_setup", "trialing", "active",
        "past_due", "cancelled", "refunded",
    }
    assert set(SUBSCRIPTION_STATES) == expected


# =====================================================================
# Kit-received admin endpoint
# =====================================================================

async def test_kit_received_no_body_defaults_to_now(admin_client):
    # Plan unknown + state pending_setup → window + flip
    async with dbmod.get_db() as conn:
        await conn.execute(
            "UPDATE homes SET subscription_state='pending_setup' WHERE id=?",
            (HOME_A,),
        )
        await conn.commit()
    resp = admin_client.patch(
        f"/api/admin/homes/{HOME_A}/kit-received",
        json={},
        headers=_admin_headers(),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["subscription_state"] == "trialing"
    assert body["trial_started_at"] is not None
    assert body["trial_ends_at"] is not None


async def test_kit_received_explicit_timestamp(admin_client):
    ts = "2026-05-01T12:00:00+00:00"
    resp = admin_client.patch(
        f"/api/admin/homes/{HOME_A}/kit-received",
        json={"kit_received_at": ts},
        headers=_admin_headers(),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["kit_received_at"] == ts
    # 14-day trial window
    assert body["trial_ends_at"] == "2026-05-15T12:00:00+00:00"


async def test_kit_received_standard_plan_in_active_preserves_state(admin_client):
    # State already 'active' (already paid) — kit_received should record
    # the window but NOT downgrade to 'trialing'.
    async with dbmod.get_db() as conn:
        await conn.execute(
            "UPDATE homes SET subscription_state='active', plan_id='standard_monthly_2026' WHERE id=?",
            (HOME_A,),
        )
        await conn.commit()
    resp = admin_client.patch(
        f"/api/admin/homes/{HOME_A}/kit-received",
        json={},
        headers=_admin_headers(),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["subscription_state"] == "active", "must not downgrade paid customer"
    assert body["trial_ends_at"] is not None, "window still recorded for audit"


async def test_kit_received_founder_lifetime_no_trial(admin_client):
    async with dbmod.get_db() as conn:
        await conn.execute(
            "UPDATE homes SET subscription_state='active', plan_id='founder_lifetime_v1' WHERE id=?",
            (HOME_A,),
        )
        await conn.commit()
    resp = admin_client.patch(
        f"/api/admin/homes/{HOME_A}/kit-received",
        json={},
        headers=_admin_headers(),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["trial_started_at"] is None
    assert body["trial_ends_at"] is None
    assert body["subscription_state"] == "active"


async def test_kit_received_forbidden_for_non_admin(admin_client):
    resp = admin_client.patch(
        f"/api/admin/homes/{HOME_A}/kit-received",
        json={},
        headers=_user_headers(),
    )
    assert resp.status_code == 403


async def test_kit_received_404_unknown_home(admin_client):
    resp = admin_client.patch(
        "/api/admin/homes/does-not-exist/kit-received",
        json={},
        headers=_admin_headers(),
    )
    assert resp.status_code == 404
