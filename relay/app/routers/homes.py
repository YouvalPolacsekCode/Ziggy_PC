from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, BackgroundTasks
from pydantic import BaseModel

from ..audit import log_event, verify as verify_signature
from ..auth import require_role, current_user, new_id, new_token
from ..database import get_db

router = APIRouter(prefix="/homes")

ROLE_ADMIN = require_role("relay_admin")

# Hubs post telemetry every 5 minutes. Three missed posts is a real outage;
# one is a hiccup. Mirrors TELEMETRY_FRESHNESS_WINDOW_S on the hub side
# (backend/routers/edge_health_router.py) so both ends agree on "stale".
TELEMETRY_STALE_S = 15 * 60


def _parse_ts(ts: Optional[str]) -> Optional[float]:
    """Lenient ISO-8601 → epoch seconds. None on anything unparseable."""
    if not isinstance(ts, str) or not ts:
        return None
    try:
        s = ts.replace("Z", "+00:00") if ts.endswith("Z") else ts
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except (ValueError, TypeError):
        return None


def evaluate_home_health(
    payload: Optional[dict],
    ts_epoch: Optional[float],
    *,
    now: Optional[float] = None,
) -> dict:
    """Derive a home's health from its most recent pushed telemetry row.

    WHY NOT FETCH THE HUB DIRECTLY: the previous implementation called
    `{tunnel_url}/api/health` from the relay. Most homes register a raw
    `*.cfargotunnel.com` URL, which is only routable from inside Cloudflare's
    network — so from Fly the request timed out and the endpoint returned
    `{"ok": false, "reason": ""}` for every home, healthy or not. A check that
    is always false is worse than no check: it cannot be alerted on.

    Telemetry, by contrast, is pushed hub → relay every 5 minutes and works.
    It also separates the two failures that need different remedies:
      - hub not reporting at all      → the box or its uplink is down
      - hub reporting, no ha_version  → the box is fine, Home Assistant is not
        (the Canary signature of 2026-08-05)
    """
    now = time.time() if now is None else now

    if not isinstance(payload, dict) or ts_epoch is None:
        return {
            "ok": False,
            "hub_reachable": False,
            "ha_reachable": False,
            "ha_version": None,
            "last_seen_s": None,
            "reason": "Hub has not reported any telemetry.",
        }

    last_seen_s = max(0.0, now - ts_epoch)
    hub_reachable = last_seen_s <= TELEMETRY_STALE_S
    ha_version = payload.get("ha_version")
    ha_reachable = bool(ha_version)

    if not hub_reachable:
        reason = f"Hub has not reported for {int(last_seen_s // 60)} minutes."
    elif not ha_reachable:
        reason = "Hub is online but Home Assistant is unreachable from it."
    else:
        reason = ""

    return {
        "ok": hub_reachable and ha_reachable,
        "hub_reachable": hub_reachable,
        "ha_reachable": ha_reachable,
        "ha_version": ha_version,
        "sensor_count": payload.get("sensor_count"),
        "last_seen_s": int(last_seen_s),
        "reason": reason,
    }


# ---------------------------------------------------------------------------
# Hub self-registration — called by a Ziggy hub on startup
# ---------------------------------------------------------------------------

class RegisterHubBody(BaseModel):
    home_id:    str
    name:       str
    tunnel_url: str


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


@router.post("/register-hub")
async def register_hub(request: Request):
    """Ziggy hub calls this on startup to register or update its tunnel URL.

    Authenticated by HMAC-SHA256 signature over the raw body, verified against
    the per-home relay_secret stored at provisioning time. Pre-existing hubs
    that still hold the legacy shared secret can rotate via /rotate-hub-secret
    before calling this endpoint.
    """
    raw = await request.body()
    src_ip = _client_ip(request)
    sig_header = request.headers.get("X-Ziggy-Signature", "")

    # Parse body manually so we have raw bytes for the signature *and* the
    # decoded fields. FastAPI's BaseModel-as-arg path would consume the body
    # internally and re-encode it for our hash, which is fragile.
    import json as _json
    try:
        payload = _json.loads(raw.decode("utf-8")) if raw else {}
        body = RegisterHubBody(**payload)
    except Exception as e:
        await log_event(
            "register_hub", source_ip=src_ip, ok=False,
            detail=f"bad_body: {type(e).__name__}",
        )
        raise HTTPException(400, "Malformed register-hub body.")

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, relay_secret FROM homes WHERE id=?", (body.home_id,)
        )
        if not rows:
            await log_event(
                "register_hub", home_id=body.home_id, source_ip=src_ip,
                ok=False, detail="unknown_home_id",
            )
            raise HTTPException(404, "Home not provisioned.")

        stored_secret = rows[0]["relay_secret"]
        ok, reason = verify_signature(stored_secret, raw, sig_header)
        if not ok:
            await log_event(
                "register_hub", home_id=body.home_id, source_ip=src_ip,
                ok=False, detail=f"signature: {reason}",
            )
            raise HTTPException(401, "Invalid signature.")

        await db.execute(
            "UPDATE homes SET tunnel_url=?, status='active' WHERE id=?",
            (body.tunnel_url.rstrip("/"), body.home_id),
        )
        await db.commit()

    await log_event(
        "register_hub", home_id=body.home_id, source_ip=src_ip, ok=True,
        detail=f"tunnel_url_updated",
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# One-shot rotation — legacy hubs upgrade their shared secret to per-home
# ---------------------------------------------------------------------------

class RotateHubBody(BaseModel):
    home_id: str


@router.post("/rotate-hub-secret")
async def rotate_hub_secret(request: Request):
    """Issue a fresh per-home relay_secret.

    Auth: HMAC-SHA256 signature over the raw body, verified against the
    home's CURRENT stored relay_secret. For homes that were created
    pre-Task-2 with the shared `ziggy-hub-primary-secret-2026`, that
    legacy value is what authenticates the rotation; afterwards the home
    holds an unguessable per-home secret. The endpoint is meant to be
    called once per legacy home on first run of the patched edge agent.

    Returns the new secret in the response body so the caller can
    persist it. The relay never re-emits an existing secret — calling
    rotate-hub-secret a second time generates yet another fresh value.
    """
    raw = await request.body()
    src_ip = _client_ip(request)
    sig_header = request.headers.get("X-Ziggy-Signature", "")

    import json as _json
    try:
        payload = _json.loads(raw.decode("utf-8")) if raw else {}
        body = RotateHubBody(**payload)
    except Exception as e:
        await log_event(
            "rotate_hub_secret", source_ip=src_ip, ok=False,
            detail=f"bad_body: {type(e).__name__}",
        )
        raise HTTPException(400, "Malformed rotate-hub-secret body.")

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT relay_secret FROM homes WHERE id=?", (body.home_id,)
        )
        if not rows:
            await log_event(
                "rotate_hub_secret", home_id=body.home_id, source_ip=src_ip,
                ok=False, detail="unknown_home_id",
            )
            raise HTTPException(404, "Home not provisioned.")
        current_secret = rows[0]["relay_secret"]

        ok, reason = verify_signature(current_secret, raw, sig_header)
        if not ok:
            await log_event(
                "rotate_hub_secret", home_id=body.home_id, source_ip=src_ip,
                ok=False, detail=f"signature: {reason}",
            )
            raise HTTPException(401, "Invalid signature.")

        import secrets as _secrets
        new_secret = _secrets.token_hex(32)
        await db.execute(
            "UPDATE homes SET relay_secret=? WHERE id=?",
            (new_secret, body.home_id),
        )
        await db.commit()

    await log_event(
        "rotate_hub_secret", home_id=body.home_id, source_ip=src_ip,
        ok=True, detail="secret_rotated",
    )
    return {
        "relay_secret": new_secret,
        "rotated_at":   datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# Admin endpoints
# ---------------------------------------------------------------------------

@router.get("/")
async def list_homes(request: Request):
    """Fleet list for the admin dashboard.

    Returns one row per home with the fields the operator console needs to
    render a traffic-light fleet view without N follow-up calls per home:

      * Identity / lifecycle: id, name, type, tunnel_url, status, created_at,
        owner_email, user_count.
      * Billing (Prompt 9): subscription_state, plan_id, kit_received_at,
        trial_ends_at, cancelled_at.
      * Tunnel (Prompt 3 / S2): cf_tunnel_id.
      * OTA (Prompt 2): ota_pinned_release_id.
      * Telemetry liveness (Prompt 2): last_seen_ts = MAX(telemetry_raw.ts)
        for the home. NULL means the hub has never posted, which the
        dashboard surfaces as a red traffic light.

    All additions are additive — older callers (CloudAdmin pre-Prompt-10,
    the mobile app) ignore unknown fields. The correlated subquery for
    last_seen_ts is covered by idx_telemetry_raw_home_ts.
    """
    require_role("relay_admin")(request)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """SELECT h.id, h.name, h.type, h.tunnel_url, h.status, h.created_at, h.owner_email,
                      h.cf_tunnel_id, h.subscription_state, h.plan_id,
                      h.kit_received_at, h.trial_ends_at, h.cancelled_at,
                      h.ota_pinned_release_id,
                      COUNT(u.id) AS user_count,
                      (SELECT MAX(t.ts) FROM telemetry_raw t WHERE t.home_id = h.id) AS last_seen_ts
               FROM homes h
               LEFT JOIN users u ON u.home_id = h.id
               GROUP BY h.id ORDER BY h.created_at DESC"""
        )
        return [dict(r) for r in rows]


@router.get("/{home_id}")
async def get_home(home_id: str, request: Request):
    user = current_user(request)
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied.")
    async with get_db() as db:
        rows = await db.execute_fetchall("SELECT * FROM homes WHERE id=?", (home_id,))
        if not rows:
            raise HTTPException(404, "Home not found.")
        home = dict(rows[0])
        home.pop("relay_secret", None)
        users = await db.execute_fetchall(
            "SELECT id, email, role, created_at FROM users WHERE home_id=?", (home_id,)
        )
        home["users"] = [dict(u) for u in users]
        return home


class UpdateHomeBody(BaseModel):
    name: Optional[str] = None
    status: Optional[str] = None


@router.patch("/{home_id}")
async def update_home(home_id: str, body: UpdateHomeBody, request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        if body.name:
            await db.execute("UPDATE homes SET name=? WHERE id=?", (body.name, home_id))
        if body.status:
            await db.execute("UPDATE homes SET status=? WHERE id=?", (body.status, home_id))
        await db.commit()
    return {"ok": True}


@router.delete("/{home_id}")
async def delete_home(home_id: str, request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        await db.execute("DELETE FROM homes WHERE id=?", (home_id,))
        await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Health check passthrough — relay polls each hub
# ---------------------------------------------------------------------------

@router.get("/{home_id}/health")
async def home_health(home_id: str, request: Request):
    user = current_user(request)
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied.")
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT tunnel_url, relay_secret, status FROM homes WHERE id=?", (home_id,)
        )
        if not rows:
            raise HTTPException(404, "Home not found.")
        h = dict(rows[0])
    # Verdict comes from the telemetry the hub PUSHES, not from a fetch we
    # initiate — see evaluate_home_health for why the old direct-fetch check
    # reported every home in the fleet as unhealthy.
    payload, ts_epoch = None, None
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT ts, payload FROM telemetry_raw WHERE home_id=? ORDER BY id DESC LIMIT 1",
            (home_id,),
        )
    if rows:
        row = dict(rows[0])
        try:
            payload = json.loads(row["payload"])
        except (TypeError, ValueError):
            payload = None
        ts_epoch = _parse_ts(row.get("ts"))

    verdict = evaluate_home_health(payload, ts_epoch)
    verdict["status"] = h["status"]
    return verdict
