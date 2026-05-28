"""Telemetry endpoints (Prompt 2 §C).

Public surface:

  Hub HMAC (per-home relay_secret over X-Ziggy-Signature):
    POST /api/devices/{device_id}/telemetry        hub posts every 5 min

  Founder JWT (relay_admin role, or home-owner for their own home):
    GET  /api/admin/homes/{home_id}/telemetry      latest N raw + summary
    GET  /api/admin/homes/{home_id}/telemetry/days daily aggregates

The relay never interprets the payload — it stores it verbatim as JSON.
Aggregation runs separately in relay/app/telemetry_retention.py. Schema
documentation for the payload shape lives at the top of this file so
edge-side telemetry_client.py stays the source of truth for fields:

    {
      "ha_version":   "2026.5.1",      str
      "ziggy_version":"1.2.3",         str
      "uptime_s":     3600,            int
      "sensors":      [...],           list (any element shape)
      "disk":         {used_gb,total_gb} | float pct,
      "cpu_pct":      12.5,            float
      "mem_pct":      35.0,            float
      "containers":   [...],           list
      "last_automation_trigger": "<iso8601>" | null,
    }

Anything else is accepted and stored — the admin dashboard pulls
fields it knows about. device_id == home_id (v1, see ota.py).
Telemetry shares the OTA gating policy: status='suspended' only,
NOT subscription_state. Cancelled hubs continue to report. See
relay/app/routers/ota.py for the rationale.
"""

from __future__ import annotations

import json as _json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..audit import log_event, verify as verify_signature
from ..auth import current_user
from ..billing import is_operational
from ..database import get_db
from .ota import (
    _client_ip,
    _resolve_home_id_from_device_id,
)

router = APIRouter()

# A POST larger than this is almost certainly malformed or hostile. The
# default psutil+sensors payload sits well under 8 KB on a typical hub.
MAX_TELEMETRY_BYTES = 64 * 1024


# ---------------------------------------------------------------------------
# Hub-facing: POST /api/devices/{device_id}/telemetry
# ---------------------------------------------------------------------------

@router.post("/api/devices/{device_id}/telemetry")
async def post_telemetry(device_id: str, request: Request):
    """Hub posts every 5 min. HMAC-signed with the home's relay_secret.

    The body must be a JSON object (top-level dict). Anything else is 400.
    On success: writes one row to telemetry_raw and an audit_log entry.
    """
    raw = await request.body()
    src_ip = _client_ip(request)
    sig_header = request.headers.get("X-Ziggy-Signature", "")

    if len(raw) > MAX_TELEMETRY_BYTES:
        await log_event(
            "telemetry_posted", home_id=device_id, source_ip=src_ip,
            ok=False, detail=f"payload_too_large:{len(raw)}",
        )
        raise HTTPException(413, "Payload too large.")

    try:
        payload = _json.loads(raw.decode("utf-8")) if raw else {}
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
    except Exception:
        await log_event(
            "telemetry_posted", home_id=device_id, source_ip=src_ip,
            ok=False, detail="malformed_json",
        )
        raise HTTPException(400, "Malformed body.")

    home_id = _resolve_home_id_from_device_id(device_id)

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT status, subscription_state, relay_secret FROM homes WHERE id=?",
            (home_id,),
        )
    if not rows:
        await log_event(
            "telemetry_posted", home_id=home_id, source_ip=src_ip,
            ok=False, detail="unknown_home_id",
        )
        raise HTTPException(404, "Home not provisioned.")
    home = rows[0]
    secret = home["relay_secret"]

    ok, reason = verify_signature(secret, raw, sig_header)
    if not ok:
        await log_event(
            "telemetry_posted", home_id=home_id, source_ip=src_ip,
            ok=False, detail=f"signature: {reason}",
        )
        raise HTTPException(401, "Invalid signature.")

    # Telemetry gates ONLY on operational status='suspended', NOT on
    # subscription_state — cancelled hubs continue to report so we know
    # they're alive (re-activation, diagnostics). The dashboard can
    # filter by subscription_state separately. See ota.py docstring and
    # billing/__init__.py::is_operational.
    if not is_operational(home["status"]):
        await log_event(
            "telemetry_posted", home_id=home_id, source_ip=src_ip,
            ok=False,
            detail=f"suspended: status={home['status']}",
        )
        raise HTTPException(403, "Home access is currently restricted.")

    now_iso = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        await db.execute(
            "INSERT INTO telemetry_raw (home_id, ts, payload) VALUES (?,?,?)",
            (home_id, now_iso, _json.dumps(payload, separators=(",", ":"))),
        )
        await db.commit()

    await log_event(
        "telemetry_posted", home_id=home_id, source_ip=src_ip, ok=True,
        # Compact summary in the audit detail — full body lives in
        # telemetry_raw so we don't double-store bytes.
        detail=(f"ha={payload.get('ha_version')} "
                f"ziggy={payload.get('ziggy_version')} "
                f"uptime_s={payload.get('uptime_s')}"),
    )
    return {"ok": True, "ts": now_iso}


# ---------------------------------------------------------------------------
# Admin: read recent telemetry
# ---------------------------------------------------------------------------

@router.get("/api/admin/homes/{home_id}/telemetry")
async def list_recent_telemetry(home_id: str, request: Request, limit: int = 50):
    """Most recent raw telemetry rows for a home, newest first.

    Visible to relay_admin OR to a user who owns this home (so a hub
    owner can self-serve their own health via the dashboard later).
    """
    user = current_user(request)
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied.")
    limit = max(1, min(int(limit), 500))
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, ts, payload FROM telemetry_raw "
            "WHERE home_id=? ORDER BY ts DESC LIMIT ?",
            (home_id, limit),
        )
    out: list[dict] = []
    for r in rows:
        try:
            body = _json.loads(r["payload"]) if r["payload"] else {}
            if not isinstance(body, dict):
                body = {"raw": r["payload"]}
        except _json.JSONDecodeError:
            body = {"raw": r["payload"]}
        out.append({"id": r["id"], "ts": r["ts"], "payload": body})
    return {"home_id": home_id, "rows": out, "count": len(out)}


@router.get("/api/admin/homes/{home_id}/telemetry/days")
async def list_daily_telemetry(home_id: str, request: Request, limit: int = 90):
    """Daily aggregates for a home, newest day first. Up to 365 rows in DB."""
    user = current_user(request)
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied.")
    limit = max(1, min(int(limit), 365))
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT day, ha_version, ziggy_version, uptime_avg_s, "
            "sensor_count_avg, disk_pct_avg, cpu_pct_avg, mem_pct_avg, "
            "sample_count, last_seen_ts "
            "FROM telemetry_daily WHERE home_id=? ORDER BY day DESC LIMIT ?",
            (home_id, limit),
        )
    return {"home_id": home_id, "days": [dict(r) for r in rows], "count": len(rows)}
