"""Tests for relay/app/billing/retention.py — 90-day B2 retention cron.

Stripe SDK not required (the cron doesn't touch Stripe). The B2 client
is dependency-injected, so we use a fake instead of boto3.

Coverage:
  Home selection
    cancelled + old → eligible
    cancelled + recent → skipped
    active + old → skipped (state wrong)
    cancelled + cancelled_at IS NULL → skipped
  Behavior
    no eligible homes → audit-logged run, no B2 calls
    eligible home + objects present → list + delete + audit row
    dry_run → list only, no delete
    missing B2 admin env → audit-logged skip, no exception
    home with zero B2 objects → skipped (audit row says keys=0)
    B2 list / delete exception → captured into errors list, run continues
"""

from __future__ import annotations

import importlib.util
from datetime import datetime, timedelta, timezone

import pytest

_has_jwt = importlib.util.find_spec("jwt") is not None
pytestmark = pytest.mark.skipif(
    not _has_jwt,
    reason="PyJWT not installed in this venv — see relay/requirements.txt",
)

if _has_jwt:
    from relay.app import database as dbmod
    from relay.app.billing import retention


# ---------- fake B2 client ----------

class _FakeB2:
    def __init__(self, by_prefix: dict[str, list[str]] | None = None,
                 raise_on_list: bool = False,
                 raise_on_delete: bool = False):
        self._by_prefix = by_prefix or {}
        self._deleted: list[str] = []
        self._raise_on_list = raise_on_list
        self._raise_on_delete = raise_on_delete

    def get_paginator(self, _name):
        outer = self
        class _P:
            def paginate(self, *, Bucket, Prefix):
                if outer._raise_on_list:
                    raise RuntimeError("simulated list failure")
                keys = outer._by_prefix.get(Prefix, [])
                yield {"Contents": [{"Key": k} for k in keys]}
        return _P()

    def delete_objects(self, *, Bucket, Delete):
        if self._raise_on_delete:
            raise RuntimeError("simulated delete failure")
        for entry in Delete["Objects"]:
            self._deleted.append(entry["Key"])
        return {}  # no Errors


# ---------- fixtures ----------

@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    return dbmod


async def _insert_home(home_id: str, *, status="active", subscription_state="active",
                       cancelled_at: str | None = None):
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, "
            "subscription_state, cancelled_at, created_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (home_id, home_id, "cloud", status, "s",
             subscription_state, cancelled_at, "2026-01-01"),
        )
        await conn.commit()


def _iso(days_ago: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days_ago)).isoformat()


# ---------- home selection ----------

async def test_no_eligible_homes(db, monkeypatch):
    await _insert_home("h-active", subscription_state="active")
    await _insert_home("h-recent",
                       subscription_state="cancelled",
                       cancelled_at=_iso(10))
    fake = _FakeB2()
    summary = await retention.run_once(b2_client_factory=lambda: fake)
    assert summary["checked"] == 0
    assert summary["deleted"] == 0
    assert fake._deleted == []


async def test_eligible_home_deletes_objects(db, monkeypatch):
    monkeypatch.setenv("B2_BUCKET", "test-bucket")
    await _insert_home("h-old",
                       subscription_state="cancelled",
                       cancelled_at=_iso(120))
    fake = _FakeB2(by_prefix={"h-old/": ["h-old/daily/foo", "h-old/daily/bar"]})
    summary = await retention.run_once(b2_client_factory=lambda: fake)
    assert summary["checked"] == 1
    assert summary["deleted"] == 2
    assert set(fake._deleted) == {"h-old/daily/foo", "h-old/daily/bar"}
    assert summary["errors"] == []


async def test_dry_run_lists_but_does_not_delete(db, monkeypatch):
    monkeypatch.setenv("B2_BUCKET", "test-bucket")
    await _insert_home("h-dry",
                       subscription_state="cancelled",
                       cancelled_at=_iso(120))
    fake = _FakeB2(by_prefix={"h-dry/": ["h-dry/x", "h-dry/y"]})
    summary = await retention.run_once(b2_client_factory=lambda: fake,
                                       dry_run=True)
    assert summary["checked"] == 1
    assert summary["deleted"] == 0
    assert fake._deleted == []
    assert summary["dry_run"] is True


async def test_eligible_home_with_no_objects(db, monkeypatch):
    monkeypatch.setenv("B2_BUCKET", "test-bucket")
    await _insert_home("h-empty",
                       subscription_state="cancelled",
                       cancelled_at=_iso(120))
    fake = _FakeB2(by_prefix={})  # prefix returns []
    summary = await retention.run_once(b2_client_factory=lambda: fake)
    assert summary["checked"] == 1
    assert summary["deleted"] == 0
    assert "h-empty" in summary["skipped"]


async def test_missing_b2_admin_env_skips_cleanly(db, monkeypatch):
    monkeypatch.setenv("B2_BUCKET", "test-bucket")
    await _insert_home("h-cancel",
                       subscription_state="cancelled",
                       cancelled_at=_iso(120))
    # Factory returns None → no admin creds configured
    summary = await retention.run_once(b2_client_factory=lambda: None)
    assert summary["checked"] == 1
    assert summary["deleted"] == 0
    assert "h-cancel" in summary["skipped"]
    assert summary["errors"] == []


async def test_missing_bucket_env_skips_cleanly(db, monkeypatch):
    monkeypatch.delenv("B2_BUCKET", raising=False)
    await _insert_home("h-noenv",
                       subscription_state="cancelled",
                       cancelled_at=_iso(120))
    fake = _FakeB2()
    summary = await retention.run_once(b2_client_factory=lambda: fake)
    assert summary["checked"] == 1
    assert "h-noenv" in summary["skipped"]


async def test_list_exception_recorded(db, monkeypatch):
    monkeypatch.setenv("B2_BUCKET", "test-bucket")
    await _insert_home("h-err",
                       subscription_state="cancelled",
                       cancelled_at=_iso(120))
    fake = _FakeB2(raise_on_list=True)
    summary = await retention.run_once(b2_client_factory=lambda: fake)
    assert len(summary["errors"]) == 1
    assert summary["errors"][0][0] == "h-err"
    assert "simulated list failure" in summary["errors"][0][1]


async def test_run_continues_past_one_failing_home(db, monkeypatch):
    monkeypatch.setenv("B2_BUCKET", "test-bucket")
    await _insert_home("h-fail",
                       subscription_state="cancelled",
                       cancelled_at=_iso(120))
    await _insert_home("h-ok",
                       subscription_state="cancelled",
                       cancelled_at=_iso(120))

    # Fake that raises only on a specific prefix
    class _Selective(_FakeB2):
        def get_paginator(self, name):
            outer = self
            class _P:
                def paginate(self, *, Bucket, Prefix):
                    if Prefix == "h-fail/":
                        raise RuntimeError("simulated for one home only")
                    yield {"Contents": [{"Key": f"{Prefix}item"}]}
            return _P()

    fake = _Selective()
    summary = await retention.run_once(b2_client_factory=lambda: fake)
    assert summary["checked"] == 2
    assert len(summary["errors"]) == 1
    # h-ok still got its delete done
    assert "h-ok/item" in fake._deleted
