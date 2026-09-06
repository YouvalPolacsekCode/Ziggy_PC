"""Plan entitlements in the OTA manifest (v3 brain, spec §3.8).

Two things are pinned here:

1. `entitlements_for` fails OPEN. Founder homes have plan_id NULL in the
   homes table (they were provisioned before billing existed) and MUST get
   every feature. An unknown plan slug — a newer relay wrote it, or an
   admin typo — must also not lock a home out; the catalog mismatch is an
   audit problem, not a customer-facing outage.

2. The served manifest carries `plan_id` + `entitlements` INSIDE the
   signed body, so a hub cannot be handed a forged entitlement list by
   anyone who doesn't hold its relay secret.
"""
from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timezone

import pytest

from relay.app.billing import plans as plansmod
from relay.app.billing.plans import ALL_FEATURES, PLANS, Plan, entitlements_for

_has_httpx = importlib.util.find_spec("httpx") is not None

if _has_httpx:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from relay.app import database as dbmod
    from relay.app.audit import sign, verify
    from relay.app.routers import ota as otamod


# ---------------------------------------------------------------------------
# entitlements_for — pure resolver
# ---------------------------------------------------------------------------

class TestEntitlementsFor:
    def test_none_plan_gets_everything(self):
        # Founder homes: plan_id NULL → full set, sorted for stable HMAC bytes.
        assert entitlements_for(None) == sorted(ALL_FEATURES)

    def test_empty_plan_gets_everything(self):
        assert entitlements_for("") == sorted(ALL_FEATURES)

    def test_unknown_plan_fails_open(self):
        assert entitlements_for("plan_from_the_future_2031") == sorted(ALL_FEATURES)

    def test_known_plan_returns_its_features(self, monkeypatch):
        # A restricted tier proves the resolver reads the plan's set rather
        # than always returning ALL_FEATURES.
        restricted = Plan(
            id="basic_test",
            display_name="Basic (test)",
            stripe_price_env="STRIPE_PRICE_BASIC_TEST",
            is_founder=False,
            has_trial=True,
            interval="month",
            features=frozenset({"diagnostics"}),
        )
        monkeypatch.setitem(plansmod.PLANS, "basic_test", restricted)
        assert entitlements_for("basic_test") == ["diagnostics"]

    def test_every_shipped_plan_currently_gets_everything(self):
        # Spec §3.8: today all tiers unlock all three features. If a plan is
        # ever added without `features=`, the dataclass default (empty) makes
        # this fail loudly instead of silently shipping a locked-down tier.
        for plan_id, plan in PLANS.items():
            assert plan.features == ALL_FEATURES, plan_id
            assert entitlements_for(plan_id) == sorted(ALL_FEATURES)

    def test_all_features_is_the_expected_trio(self):
        assert ALL_FEATURES == frozenset({"diagnostics", "auto_repair", "explain_changes"})

    def test_result_is_sorted_and_deterministic(self):
        a = entitlements_for(None)
        assert a == sorted(a)
        assert a == entitlements_for(None)


# ---------------------------------------------------------------------------
# Served manifest — GET /api/devices/{id}/ota-manifest
# ---------------------------------------------------------------------------

FOUNDER_HOME = "home-founder-null-plan"
STANDARD_HOME = "home-standard-monthly"
UNKNOWN_PLAN_HOME = "home-unknown-plan"
SECRET = "relay-secret-for-entitlement-tests"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    now = datetime.now(timezone.utc).isoformat()
    async with dbmod.get_db() as d:
        for home_id, plan_id in (
            (FOUNDER_HOME, None),
            (STANDARD_HOME, "standard_monthly_2026"),
            (UNKNOWN_PLAN_HOME, "plan_from_the_future_2031"),
        ):
            await d.execute(
                "INSERT INTO homes (id, name, type, status, subscription_state, "
                "                   relay_secret, plan_id, created_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (home_id, "Test", "hub", "active", "active", SECRET, plan_id, now),
            )
        await d.execute(
            "INSERT INTO ota_releases (ha_version, ziggy_version, image_digests, notes, created_at) "
            "VALUES (?,?,?,?,?)",
            ("2026.8.1", "release-2026-09-06", json.dumps({"ziggy": "sha256:abc"}), "", now),
        )
        await d.commit()
    return dbmod


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(otamod.router)
    return TestClient(app)


def _get_manifest(client, home_id: str) -> dict:
    # GET has an empty body; the HMAC is over b"" (same scheme as the hub).
    r = client.get(
        f"/api/devices/{home_id}/ota-manifest",
        headers={"X-Ziggy-Signature": sign(SECRET, b"")},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _signed_body(manifest: dict) -> bytes:
    body = {k: v for k, v in manifest.items() if k != "signature"}
    return otamod._canonical_bytes_for_signing(body)


@pytest.mark.skipif(not _has_httpx, reason="httpx not installed")
class TestServedManifest:
    def test_founder_home_null_plan_gets_all_entitlements(self, client):
        m = _get_manifest(client, FOUNDER_HOME)
        assert "plan_id" in m and m["plan_id"] is None
        assert m["entitlements"] == sorted(ALL_FEATURES)

    def test_standard_home_carries_its_plan(self, client):
        m = _get_manifest(client, STANDARD_HOME)
        assert m["plan_id"] == "standard_monthly_2026"
        assert m["entitlements"] == sorted(PLANS["standard_monthly_2026"].features)

    def test_unknown_plan_is_echoed_but_fails_open(self, client):
        m = _get_manifest(client, UNKNOWN_PLAN_HOME)
        assert m["plan_id"] == "plan_from_the_future_2031"
        assert m["entitlements"] == sorted(ALL_FEATURES)

    def test_schema_version_is_3(self, client):
        m = _get_manifest(client, FOUNDER_HOME)
        assert m["schema_version"] == otamod.OTA_MANIFEST_SCHEMA_VERSION == 3

    def test_existing_schema2_fields_still_present(self, client):
        # Additive change: nothing a schema-2 hub reads may disappear.
        m = _get_manifest(client, STANDARD_HOME)
        for key in ("release_id", "ha_version", "ziggy_version", "image_digests",
                    "subscription_state", "subscription_state_expires_at", "signature"):
            assert key in m, key

    def test_signature_covers_plan_and_entitlements(self, client):
        m = _get_manifest(client, STANDARD_HOME)
        ok, reason = verify(SECRET, _signed_body(m), m["signature"])
        assert ok, reason

        # Tampering with entitlements after the fact must break the HMAC —
        # this is what stops a MITM from granting a hub features.
        forged = dict(m)
        forged["entitlements"] = ["diagnostics"]
        ok, reason = verify(SECRET, _signed_body(forged), m["signature"])
        assert not ok and reason == "signature_mismatch"

        forged = dict(m)
        forged["plan_id"] = "founder_lifetime_v1"
        ok, _ = verify(SECRET, _signed_body(forged), m["signature"])
        assert not ok
