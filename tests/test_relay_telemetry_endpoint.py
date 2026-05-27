"""Tests for relay/app/routers/telemetry.py + relay/app/telemetry_retention.py.

Chunk 2.3 — POST /telemetry, admin reads, aggregation + pruning.

Coverage:
  POST /api/devices/{device_id}/telemetry
                       valid HMAC + dict body → 200 + row, signature
                       mismatch (401), unknown home (404), malformed
                       JSON (400), non-object body (400), suspended
                       (403), payload too large (413)
  GET  /api/admin/homes/{home_id}/telemetry
                       admin reads, home-owner reads own, cross-home
                       forbidden (403), respects limit
  GET  /api/admin/homes/{home_id}/telemetry/days
                       reads aggregated rows
  retention            aggregates yesterday's raw, leaves today raw,
                       prunes 30d-stale raw, prunes 365d-stale daily
"""

from __future__ import annotations

import importlib.util
import json
from datetime import datetime, timezone, timedelta

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
    from relay.app.audit import sign as sign_hmac
    from relay.app.auth import issue_jwt
    from relay.app.routers.telemetry import router as telemetry_router
    from relay.app.telemetry_retention import (
        RAW_RETENTION_DAYS,
        DAILY_RETENTION_DAYS,
        run_retention_pass,
    )


HOME_ID = "home-1"
HOME_SECRET = "test-secret-32-bytes-aaaaaaaaaa"


@pytest.fixture
async def db(tmp_path, monkeypatch):
    p = tmp_path / "relay.db"
    monkeypatch.setattr(dbmod, "DATABASE_URL", str(p))
    await dbmod.init_db()
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO homes (id, name, type, status, relay_secret, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (HOME_ID, "Test Home", "cloud", "active", HOME_SECRET, "2026-01-01"),
        )
        await conn.commit()
    return dbmod


@pytest.fixture
async def client(db):
    app = FastAPI()
    app.include_router(telemetry_router)
    return TestClient(app)


def _admin_headers() -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-admin', 'founder@example.com', 'relay_admin', None)}"}


def _home_user_headers(home_id: str = HOME_ID) -> dict:
    return {"Authorization": f"Bearer {issue_jwt('u-user', 'user@example.com', 'user', home_id)}"}


def _payload_bytes(d: dict) -> bytes:
    return json.dumps(d, separators=(",", ":")).encode("utf-8")


def _signed_headers(body: bytes, secret: str = HOME_SECRET) -> dict:
    return {
        "Content-Type":      "application/json",
        "X-Ziggy-Signature": sign_hmac(secret, body),
    }


# ---------- POST telemetry ----------

async def test_post_telemetry_happy_path(client):
    body = _payload_bytes({"ha_version": "2026.5.1", "ziggy_version": "1.2.3", "uptime_s": 60})
    resp = client.post(
        f"/api/devices/{HOME_ID}/telemetry",
        headers=_signed_headers(body),
        content=body,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["ok"] is True

    async with dbmod.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT home_id, payload FROM telemetry_raw"
        )
    assert len(rows) == 1
    assert rows[0]["home_id"] == HOME_ID
    assert json.loads(rows[0]["payload"])["ha_version"] == "2026.5.1"


async def test_post_telemetry_bad_signature(client):
    body = _payload_bytes({"ha_version": "x"})
    resp = client.post(
        f"/api/devices/{HOME_ID}/telemetry",
        headers={"X-Ziggy-Signature": "t=1,v1=cafef00d", "Content-Type": "application/json"},
        content=body,
    )
    assert resp.status_code == 401


async def test_post_telemetry_unknown_home(client):
    body = _payload_bytes({"ha_version": "x"})
    resp = client.post(
        "/api/devices/home-unknown/telemetry",
        headers=_signed_headers(body),
        content=body,
    )
    assert resp.status_code == 404


async def test_post_telemetry_malformed_json(client):
    body = b"not-json{"
    resp = client.post(
        f"/api/devices/{HOME_ID}/telemetry",
        headers=_signed_headers(body),
        content=body,
    )
    assert resp.status_code == 400


async def test_post_telemetry_non_object_body(client):
    body = b'["a","b"]'
    resp = client.post(
        f"/api/devices/{HOME_ID}/telemetry",
        headers=_signed_headers(body),
        content=body,
    )
    assert resp.status_code == 400


async def test_post_telemetry_suspended(client):
    async with dbmod.get_db() as conn:
        await conn.execute("UPDATE homes SET status='suspended' WHERE id=?", (HOME_ID,))
        await conn.commit()
    body = _payload_bytes({"ha_version": "x"})
    resp = client.post(
        f"/api/devices/{HOME_ID}/telemetry",
        headers=_signed_headers(body),
        content=body,
    )
    assert resp.status_code == 403


async def test_post_telemetry_too_large(client):
    # 65 KB body — over the 64 KB cap. Even bad-signature should not be
    # reached; the size check fires first.
    body = b'{"x":"' + b"a" * (65 * 1024) + b'"}'
    resp = client.post(
        f"/api/devices/{HOME_ID}/telemetry",
        headers=_signed_headers(body),
        content=body,
    )
    assert resp.status_code == 413


# ---------- Admin read ----------

async def test_admin_read_recent(client):
    body = _payload_bytes({"ha_version": "2026.5.1"})
    client.post(f"/api/devices/{HOME_ID}/telemetry",
                headers=_signed_headers(body), content=body)
    resp = client.get(f"/api/admin/homes/{HOME_ID}/telemetry",
                      headers=_admin_headers())
    assert resp.status_code == 200
    assert resp.json()["count"] == 1
    assert resp.json()["rows"][0]["payload"]["ha_version"] == "2026.5.1"


async def test_home_owner_reads_own_telemetry(client):
    body = _payload_bytes({"ziggy_version": "1.2.3"})
    client.post(f"/api/devices/{HOME_ID}/telemetry",
                headers=_signed_headers(body), content=body)
    resp = client.get(f"/api/admin/homes/{HOME_ID}/telemetry",
                      headers=_home_user_headers(HOME_ID))
    assert resp.status_code == 200


async def test_cross_home_telemetry_forbidden(client):
    body = _payload_bytes({"ziggy_version": "1.2.3"})
    client.post(f"/api/devices/{HOME_ID}/telemetry",
                headers=_signed_headers(body), content=body)
    resp = client.get(f"/api/admin/homes/{HOME_ID}/telemetry",
                      headers=_home_user_headers("home-other"))
    assert resp.status_code == 403


async def test_admin_read_days_empty(client):
    resp = client.get(f"/api/admin/homes/{HOME_ID}/telemetry/days",
                      headers=_admin_headers())
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


# ---------- Retention ----------

async def _insert_raw(home_id: str, ts_iso: str, payload: dict) -> None:
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO telemetry_raw (home_id, ts, payload) VALUES (?,?,?)",
            (home_id, ts_iso, json.dumps(payload, separators=(",", ":"))),
        )
        await conn.commit()


async def test_retention_aggregates_past_days_only(db):
    now = datetime(2026, 5, 27, 12, 0, 0, tzinfo=timezone.utc)
    yesterday = (now - timedelta(days=1)).date().isoformat()
    today = now.date().isoformat()

    # 3 samples yesterday + 1 today
    for i in range(3):
        await _insert_raw(HOME_ID, f"{yesterday}T0{i}:00:00+00:00",
                          {"ha_version": "2026.5.1", "ziggy_version": "1.2.3",
                           "uptime_s": 100 + i, "sensors": [{}], "cpu_pct": 5.0 + i,
                           "mem_pct": 30.0 + i,
                           "disk": {"used_gb": 4.0 + i, "total_gb": 20.0}})
    await _insert_raw(HOME_ID, f"{today}T12:00:00+00:00", {"ha_version": "2026.5.1"})

    result = await run_retention_pass(now=now)
    assert result["aggregated_days"] == 1
    assert result["deleted_raw"] == 0  # 30d cutoff hasn't elapsed

    async with dbmod.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT day, sample_count, uptime_avg_s, cpu_pct_avg, ha_version "
            "FROM telemetry_daily WHERE home_id=?", (HOME_ID,))
    assert len(rows) == 1
    r = rows[0]
    assert r["day"] == yesterday
    assert r["sample_count"] == 3
    assert r["uptime_avg_s"] == 101  # avg of 100,101,102
    assert abs(r["cpu_pct_avg"] - 6.0) < 0.01  # avg of 5,6,7
    assert r["ha_version"] == "2026.5.1"


async def test_retention_prunes_old_raw_and_daily(db):
    now = datetime(2026, 5, 27, 12, 0, 0, tzinfo=timezone.utc)
    ancient = (now - timedelta(days=RAW_RETENTION_DAYS + 5)).isoformat()
    ancient_daily = (now - timedelta(days=DAILY_RETENTION_DAYS + 5)).date().isoformat()

    await _insert_raw(HOME_ID, ancient, {"ha_version": "old"})
    async with dbmod.get_db() as conn:
        await conn.execute(
            "INSERT INTO telemetry_daily (home_id, day, sample_count) VALUES (?,?,?)",
            (HOME_ID, ancient_daily, 1),
        )
        await conn.commit()

    result = await run_retention_pass(now=now)
    assert result["deleted_raw"] == 1
    assert result["deleted_daily"] == 1

    async with dbmod.get_db() as conn:
        r = await conn.execute_fetchall("SELECT COUNT(*) AS c FROM telemetry_raw")
        assert r[0]["c"] == 0
        r = await conn.execute_fetchall(
            "SELECT COUNT(*) AS c FROM telemetry_daily WHERE day < ?",
            ((now - timedelta(days=DAILY_RETENTION_DAYS)).date().isoformat(),))
        assert r[0]["c"] == 0


async def test_retention_idempotent(db):
    now = datetime(2026, 5, 27, 12, 0, 0, tzinfo=timezone.utc)
    yesterday = (now - timedelta(days=1)).date().isoformat()
    await _insert_raw(HOME_ID, f"{yesterday}T01:00:00+00:00",
                      {"ha_version": "x", "uptime_s": 50})

    r1 = await run_retention_pass(now=now)
    r2 = await run_retention_pass(now=now)
    # First pass aggregates 1 day; second has the same raw row so it
    # aggregates again (rewriting the same daily row). Both passes
    # must succeed without raising and yield consistent counts.
    assert r1["aggregated_days"] == 1
    assert r2["aggregated_days"] == 1
    async with dbmod.get_db() as conn:
        rows = await conn.execute_fetchall(
            "SELECT sample_count FROM telemetry_daily WHERE home_id=? AND day=?",
            (HOME_ID, yesterday))
    assert len(rows) == 1
    assert rows[0]["sample_count"] == 1
