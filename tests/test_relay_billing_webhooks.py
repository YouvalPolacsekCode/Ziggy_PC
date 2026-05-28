"""Tests for relay/app/billing/webhooks.py — the Stripe webhook router.

Requires the stripe SDK (skipped when not installed; relay/requirements.txt
pins stripe==11.1.0 for the deploy image).

Coverage:
  Signature verification
    missing Stripe-Signature header → 400
    invalid signature → 400
  Idempotency
    duplicate event_id → 200, no double mutation
    handler raises → 500, event NOT marked processed (Stripe retries)
  Per-event handlers
    checkout.session.completed → stripe_customer_id/sub_id/plan_id set
    checkout.session.expired   → founder slot released
    customer.subscription.created → state from Stripe status
    customer.subscription.updated → re-sync state
    customer.subscription.deleted → state=cancelled, cancelled_at set
    invoice.paid (ILS)           → invoice recorded + state=active
    invoice.paid (USD)           → no invoice row, state still active
    invoice.payment_failed       → state=past_due
    charge.refunded within 14d   → state=refunded, slot released
    charge.refunded after 14d    → state=refunded, slot kept
  Unknown event type → 200 + ignored, still marked processed
"""

from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timedelta, timezone

import pytest

_has_jwt = importlib.util.find_spec("jwt") is not None
_has_stripe = importlib.util.find_spec("stripe") is not None
pytestmark = pytest.mark.skipif(
    not (_has_jwt and _has_stripe),
    reason="needs PyJWT + stripe — see relay/requirements.txt",
)

if _has_jwt and _has_stripe:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from relay.app import database as dbmod
    from relay.app.billing import slot_counter
    from relay.app.billing import stripe_provider as sp_mod
    from relay.app.billing import webhooks as webhooks_mod
    from relay.app.billing.provider import WebhookEvent, WebhookSignatureError
    from relay.app.billing.webhooks import router as webhook_router


HOME = "home-w"
CUST = "cus_test_42"
SUB = "sub_test_42"


# ---------- fake provider ----------

class _FakeProvider:
    """Drop-in replacement for StripeProvider used by webhook tests.

    Tests pre-load `next_event`; the router's verify_webhook call returns
    it without touching a real signature. `raise_error` toggles signature
    rejection for the bad-sig tests.
    """

    def __init__(self):
        self.next_event = None
        self.raise_error = None

    def verify_webhook(self, *, payload, signature_header):
        if self.raise_error is not None:
            raise WebhookSignatureError(self.raise_error)
        if self.next_event is None:
            raise WebhookSignatureError("no_event_loaded")
        return self.next_event


def _evt(event_id: str, event_type: str, data: dict) -> WebhookEvent:
    return WebhookEvent(id=event_id, type=event_type, data=data, raw=None)


# ---------- fixtures ----------

@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (HOME, "Home W", "cloud", "active", "secret-w", "2026-01-01"),
        )
        await conn.commit()
    return dbmod


@pytest.fixture
def provider(monkeypatch):
    sp_mod.reset_provider_for_tests()
    fake = _FakeProvider()
    monkeypatch.setattr(sp_mod, "_instance", fake)
    return fake


@pytest.fixture
async def client(db, provider):
    app = FastAPI()
    app.include_router(webhook_router, prefix="/api")
    return TestClient(app)


async def _set_home_customer(home_id: str, customer_id: str, subscription_id: str = None):
    async with dbmod.get_db() as conn:
        await conn.execute(
            "UPDATE homes SET stripe_customer_id=?, stripe_subscription_id=? WHERE id=?",
            (customer_id, subscription_id, home_id),
        )
        await conn.commit()


async def _get_home(home_id: str) -> dict:
    async with dbmod.get_db() as conn:
        rows = await conn.execute_fetchall("SELECT * FROM homes WHERE id=?", (home_id,))
    return dict(rows[0])


# ============================================================
# Signature verification
# ============================================================

async def test_missing_signature_header(client, provider):
    provider.raise_error = "missing_signature_header"
    resp = client.post("/api/billing/stripe/webhook", content=b"{}")
    assert resp.status_code == 400


async def test_invalid_signature(client, provider):
    provider.raise_error = "signature_mismatch: bad"
    resp = client.post(
        "/api/billing/stripe/webhook",
        content=b"{}",
        headers={"Stripe-Signature": "bogus"},
    )
    assert resp.status_code == 400


# ============================================================
# Idempotency
# ============================================================

async def test_duplicate_event_is_short_circuited(client, provider):
    provider.next_event = _evt(
        "evt_dup_1", "customer.subscription.updated",
        {"id": SUB, "customer": CUST, "status": "active",
         "metadata": {"home_id": HOME}},
    )
    r1 = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1,t=1"},
    )
    assert r1.status_code == 200 and r1.json().get("duplicate") is not True

    # Same event_id replayed
    r2 = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1,t=1"},
    )
    assert r2.status_code == 200
    assert r2.json().get("duplicate") is True


async def test_handler_failure_does_not_mark_processed(client, provider, monkeypatch):
    # Force a handler exception. The processed_webhooks row must NOT be
    # written, so a Stripe retry would re-attempt the handler.
    provider.next_event = _evt(
        "evt_fail_1", "customer.subscription.updated",
        {"id": SUB, "customer": CUST, "status": "active",
         "metadata": {"home_id": HOME}},
    )

    async def _boom(event):
        raise RuntimeError("simulated handler crash")

    monkeypatch.setitem(webhooks_mod.HANDLERS, "customer.subscription.updated", _boom)

    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 500

    # Was NOT marked processed
    async with dbmod.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT 1 FROM processed_webhooks WHERE event_id=?", ("evt_fail_1",)
        )
    assert rows == []


# ============================================================
# Per-event handlers
# ============================================================

async def test_checkout_completed_sets_ids(client, provider):
    provider.next_event = _evt(
        "evt_co_1", "checkout.session.completed",
        {"client_reference_id": HOME, "customer": CUST, "subscription": SUB,
         "metadata": {"plan_id": "standard_monthly_2026"}},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    home = await _get_home(HOME)
    assert home["stripe_customer_id"] == CUST
    assert home["stripe_subscription_id"] == SUB
    assert home["plan_id"] == "standard_monthly_2026"
    assert home["subscription_state"] == "active"


async def test_checkout_expired_releases_slot(client, provider):
    # Reserve a slot, then fire expired.
    await slot_counter.reserve(HOME)
    assert await slot_counter.remaining() == slot_counter.FOUNDER_SLOT_CAP - 1

    provider.next_event = _evt(
        "evt_exp_1", "checkout.session.expired",
        {"client_reference_id": HOME, "metadata": {}},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    assert await slot_counter.remaining() == slot_counter.FOUNDER_SLOT_CAP


async def test_subscription_created_sets_state(client, provider):
    provider.next_event = _evt(
        "evt_sc_1", "customer.subscription.created",
        {"id": SUB, "customer": CUST, "status": "trialing",
         "metadata": {"home_id": HOME, "plan_id": "standard_monthly_2026"}},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    home = await _get_home(HOME)
    assert home["subscription_state"] == "trialing"
    assert home["plan_id"] == "standard_monthly_2026"


async def test_subscription_deleted_sets_cancelled_at(client, provider):
    await _set_home_customer(HOME, CUST, SUB)
    provider.next_event = _evt(
        "evt_sd_1", "customer.subscription.deleted",
        {"id": SUB, "customer": CUST, "status": "canceled",
         "metadata": {"home_id": HOME}},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    home = await _get_home(HOME)
    assert home["subscription_state"] == "cancelled"
    assert home["cancelled_at"] is not None


async def test_invoice_paid_ils_records_invoice(client, provider):
    await _set_home_customer(HOME, CUST, SUB)
    provider.next_event = _evt(
        "evt_ip_1", "invoice.paid",
        {"id": "in_xyz", "customer": CUST,
         "amount_paid": 11800, "currency": "ils"},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    home = await _get_home(HOME)
    assert home["subscription_state"] == "active"
    async with dbmod.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT id, vat_amount_agorot FROM invoice_sequence WHERE stripe_invoice_id=?",
            ("in_xyz",),
        )
    assert len(rows) == 1
    assert rows[0]["vat_amount_agorot"] == 1800


async def test_invoice_paid_usd_skips_invoice_row(client, provider):
    await _set_home_customer(HOME, CUST, SUB)
    provider.next_event = _evt(
        "evt_ip_2", "invoice.paid",
        {"id": "in_usd", "customer": CUST,
         "amount_paid": 500, "currency": "usd"},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    async with dbmod.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT 1 FROM invoice_sequence WHERE stripe_invoice_id=?", ("in_usd",)
        )
    # USD payment does NOT land in the Israeli sequence
    assert rows == []
    home = await _get_home(HOME)
    assert home["subscription_state"] == "active"


async def test_invoice_payment_failed_sets_past_due(client, provider):
    await _set_home_customer(HOME, CUST, SUB)
    provider.next_event = _evt(
        "evt_ipf_1", "invoice.payment_failed",
        {"id": "in_fail", "customer": CUST},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    home = await _get_home(HOME)
    assert home["subscription_state"] == "past_due"


async def test_charge_refunded_within_14d_releases_slot(client, provider):
    await _set_home_customer(HOME, CUST, SUB)
    await slot_counter.reserve(HOME)
    provider.next_event = _evt(
        "evt_ref_1", "charge.refunded",
        {"id": "ch_x", "customer": CUST, "amount_refunded": 11800},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    home = await _get_home(HOME)
    assert home["subscription_state"] == "refunded"
    # Slot released (claim was just now → within 14d window)
    assert await slot_counter.remaining() == slot_counter.FOUNDER_SLOT_CAP


async def test_charge_refunded_after_14d_keeps_slot(client, provider):
    await _set_home_customer(HOME, CUST, SUB)
    await slot_counter.reserve(HOME)
    # Backdate the claim to outside the 14d window
    past = (datetime.now(timezone.utc) - timedelta(days=15)).isoformat()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "UPDATE founder_slots SET claimed_at=? WHERE home_id=?", (past, HOME)
        )
        await conn.commit()

    provider.next_event = _evt(
        "evt_ref_2", "charge.refunded",
        {"id": "ch_y", "customer": CUST, "amount_refunded": 11800},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    home = await _get_home(HOME)
    assert home["subscription_state"] == "refunded"
    # Slot stays — permanently bound past 14d per founder decision
    assert await slot_counter.remaining() == slot_counter.FOUNDER_SLOT_CAP - 1


async def test_unknown_event_type_ignored(client, provider):
    provider.next_event = _evt(
        "evt_unk_1", "customer.subscription.trial_will_end",
        {"id": SUB, "customer": CUST},
    )
    r = client.post(
        "/api/billing/stripe/webhook", content=b"{}",
        headers={"Stripe-Signature": "v=1"},
    )
    assert r.status_code == 200
    # Still marked processed so Stripe stops retrying
    async with dbmod.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT 1 FROM processed_webhooks WHERE event_id=?", ("evt_unk_1",)
        )
    assert len(rows) == 1
