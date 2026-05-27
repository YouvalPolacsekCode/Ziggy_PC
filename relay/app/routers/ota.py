"""OTA manifest endpoints (Prompt 2 §B).

Public surface:

  Hub HMAC (per-home relay_secret over X-Ziggy-Signature):
    GET  /api/devices/{device_id}/ota-manifest    polled hourly by the edge

  Founder JWT (relay_admin role):
    GET  /api/admin/ota/releases                  list catalog
    POST /api/admin/ota/releases                  publish a new release
    GET  /api/admin/homes/{home_id}/ota-pin       read current pin
    PUT  /api/admin/homes/{home_id}/ota-pin       pin home to a release id
                                                  (body release_id=null unpins)

device_id semantics (v1):

    device_id == home_id

This equivalence is hardcoded by `_resolve_home_id_from_device_id`. v1.1
will introduce a `devices` table + a `GET /admin/homes/by-device/{device_id}`
lookup when customers replace hubs and need a stable identifier separate
from the home. Until then, the URL param is treated as the home_id verbatim.

Subscription gating:

    homes.status != 'suspended'  (stub — Prompt 9 swap-target)

Prompt 9 will introduce a real subscription_state column populated by Stripe
webhooks. The OTA + telemetry endpoints both call `_subscription_active`
below; when Prompt 9 lands, that one helper becomes the single line to swap.

Manifest signature:

    signature = t=<ts>,v1=<hex(hmac_sha256(home_relay_secret,
                                            "<ts>." + canonical_manifest))>

Computed using `relay/app/audit.py::sign`, identical wire format to
X-Ziggy-Signature. The edge can verify with the same per-home secret
it already holds, so no new key material is needed. The signature
guards staged manifests on disk — an edge that downloads and stages a
manifest can re-verify before applying. Out-of-scope of v1: founder-key
based offline signing that would defend against a relay compromise.
"""

from __future__ import annotations

import json as _json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..audit import log_event, sign as sign_signature, verify as verify_signature
from ..auth import current_user, require_role
from ..database import get_db

router = APIRouter()

OTA_MANIFEST_SCHEMA_VERSION = 1


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


def _resolve_home_id_from_device_id(device_id: str) -> str:
    """v1: device_id IS the home_id. v1.1 will look up via a devices table.

    Centralizing the equivalence here so the swap is one function body, not
    a search-and-replace across handlers.
    """
    return device_id


async def _subscription_active(home_status: str) -> bool:
    """Stub for Prompt 9's Stripe-driven subscription_state.

    Today: any home that isn't explicitly 'suspended' is treated as active.
    Provisioning / failed / pending_setup all still receive manifests — the
    edge may be mid-install and need its first version.

    TODO(Prompt 9): replace with a read of homes.subscription_state once
    the Stripe webhook handler populates that column. One-line swap.
    """
    return home_status != "suspended"


def _release_row_to_payload(row: Any, home_id: str) -> dict:
    """Materialize a stored ota_releases row into the wire manifest shape."""
    try:
        digests = _json.loads(row["image_digests"]) if row["image_digests"] else {}
        if not isinstance(digests, dict):
            digests = {}
    except Exception:
        digests = {}
    return {
        "schema_version": OTA_MANIFEST_SCHEMA_VERSION,
        "home_id":        home_id,
        "device_id":      home_id,   # v1 equivalence; see module docstring.
        "release_id":     row["id"],
        "ha_version":     row["ha_version"],
        "ziggy_version":  row["ziggy_version"],
        "image_digests":  digests,
        "notes":          row["notes"] or "",
        "released_at":    row["created_at"],
    }


def _canonical_bytes_for_signing(manifest_no_sig: dict) -> bytes:
    """Stable JSON encoding so signing and verifying produce the same bytes.

    sort_keys + tight separators match the edge-side verifier exactly. The
    `signature` field is NOT part of the canonical body — the signature is
    over the manifest without itself, then appended.
    """
    return _json.dumps(manifest_no_sig, sort_keys=True, separators=(",", ":")).encode("utf-8")


# ---------------------------------------------------------------------------
# Hub-facing: GET /api/devices/{device_id}/ota-manifest
# ---------------------------------------------------------------------------

@router.get("/api/devices/{device_id}/ota-manifest")
async def get_ota_manifest(device_id: str, request: Request):
    """Edge polls this hourly; returns the target manifest for this home.

    Authenticated by HMAC-SHA256 over the empty request body — GET has no
    body, so the signed payload is `"<ts>."` plus zero bytes. Same scheme
    as POST handlers but with the body bytes always empty.

    Response shape:
      {
        schema_version: 1,
        home_id: "home-abc",
        device_id: "home-abc",       # v1: equals home_id
        release_id: 7,
        ha_version: "2026.5.1",      # Prompt 4 consumes
        ziggy_version: "1.2.3",
        image_digests: {<name>: <digest>, ...},
        notes: "...",
        released_at: "<iso8601>",
        signature: "t=...,v1=..."
      }

    Returns 401 on signature mismatch, 403 on suspended home, 404 on
    unknown home or empty release catalog.
    """
    src_ip = _client_ip(request)
    sig_header = request.headers.get("X-Ziggy-Signature", "")
    raw = await request.body()  # GET should have an empty body; sign accordingly

    home_id = _resolve_home_id_from_device_id(device_id)

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, status, relay_secret, ota_pinned_release_id FROM homes WHERE id=?",
            (home_id,),
        )
    if not rows:
        await log_event(
            "ota_manifest_served", home_id=home_id, source_ip=src_ip,
            ok=False, detail="unknown_home_id",
        )
        raise HTTPException(404, "Home not provisioned.")
    home = rows[0]
    secret = home["relay_secret"]

    ok, reason = verify_signature(secret, raw, sig_header)
    if not ok:
        await log_event(
            "ota_manifest_served", home_id=home_id, source_ip=src_ip,
            ok=False, detail=f"signature: {reason}",
        )
        raise HTTPException(401, "Invalid signature.")

    if not await _subscription_active(home["status"]):
        await log_event(
            "ota_manifest_served", home_id=home_id, source_ip=src_ip,
            ok=False, detail=f"suspended: status={home['status']}",
        )
        raise HTTPException(403, "Home suspended.")

    pin_id = home["ota_pinned_release_id"]
    async with get_db() as db:
        if pin_id is not None:
            rel_rows = await db.execute_fetchall(
                "SELECT id, ha_version, ziggy_version, image_digests, notes, created_at "
                "FROM ota_releases WHERE id=?",
                (pin_id,),
            )
            resolution = "pinned"
        else:
            rel_rows = await db.execute_fetchall(
                "SELECT id, ha_version, ziggy_version, image_digests, notes, created_at "
                "FROM ota_releases ORDER BY id DESC LIMIT 1"
            )
            resolution = "latest"
    if not rel_rows:
        await log_event(
            "ota_manifest_served", home_id=home_id, source_ip=src_ip,
            ok=False, detail="no_release_available",
        )
        raise HTTPException(404, "No release published.")

    manifest = _release_row_to_payload(rel_rows[0], home_id)
    body_bytes = _canonical_bytes_for_signing(manifest)
    manifest["signature"] = sign_signature(secret, body_bytes)

    await log_event(
        "ota_manifest_served", home_id=home_id, source_ip=src_ip, ok=True,
        detail=f"release_id={manifest['release_id']} resolution={resolution}",
    )
    return manifest


# ---------------------------------------------------------------------------
# Admin: release catalog
# ---------------------------------------------------------------------------

class ReleaseCreateBody(BaseModel):
    ha_version:    str = Field(..., min_length=1)
    ziggy_version: str = Field(..., min_length=1)
    image_digests: dict[str, str] = Field(default_factory=dict)
    notes:         Optional[str] = None


@router.get("/api/admin/ota/releases")
async def list_releases(request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT id, ha_version, ziggy_version, image_digests, notes, "
            "created_at, created_by FROM ota_releases ORDER BY id DESC"
        )
    out: list[dict] = []
    for r in rows:
        try:
            digests = _json.loads(r["image_digests"]) if r["image_digests"] else {}
        except Exception:
            digests = {}
        out.append({
            "id":            r["id"],
            "ha_version":    r["ha_version"],
            "ziggy_version": r["ziggy_version"],
            "image_digests": digests if isinstance(digests, dict) else {},
            "notes":         r["notes"] or "",
            "created_at":    r["created_at"],
            "created_by":    r["created_by"],
        })
    return {"releases": out}


@router.post("/api/admin/ota/releases")
async def create_release(body: ReleaseCreateBody, request: Request):
    user = require_role("relay_admin")(request)
    digests_json = _json.dumps(body.image_digests, sort_keys=True, separators=(",", ":"))
    now_iso = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        cursor = await db.execute(
            "INSERT INTO ota_releases "
            "(ha_version, ziggy_version, image_digests, notes, created_at, created_by) "
            "VALUES (?,?,?,?,?,?)",
            (body.ha_version, body.ziggy_version, digests_json,
             body.notes, now_iso, user.get("email")),
        )
        await db.commit()
        new_id = cursor.lastrowid
    await log_event(
        "ota_release_created", source_ip=_client_ip(request), ok=True,
        detail=f"release_id={new_id} ha={body.ha_version} ziggy={body.ziggy_version}",
    )
    return {
        "id":            new_id,
        "ha_version":    body.ha_version,
        "ziggy_version": body.ziggy_version,
        "image_digests": body.image_digests,
        "notes":         body.notes or "",
        "created_at":    now_iso,
        "created_by":    user.get("email"),
    }


# ---------------------------------------------------------------------------
# Admin: per-home pin
# ---------------------------------------------------------------------------

class OtaPinBody(BaseModel):
    release_id: Optional[int] = Field(
        None,
        description="ota_releases.id to pin this home to. Pass null to unpin.",
    )


@router.get("/api/admin/homes/{home_id}/ota-pin")
async def get_ota_pin(home_id: str, request: Request):
    require_role("relay_admin")(request)
    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT ota_pinned_release_id FROM homes WHERE id=?", (home_id,)
        )
    if not rows:
        raise HTTPException(404, "Home not found.")
    return {"home_id": home_id, "release_id": rows[0]["ota_pinned_release_id"]}


@router.put("/api/admin/homes/{home_id}/ota-pin")
async def set_ota_pin(home_id: str, body: OtaPinBody, request: Request):
    require_role("relay_admin")(request)
    src_ip = _client_ip(request)
    async with get_db() as db:
        rows = await db.execute_fetchall("SELECT id FROM homes WHERE id=?", (home_id,))
        if not rows:
            raise HTTPException(404, "Home not found.")
        if body.release_id is not None:
            rel_rows = await db.execute_fetchall(
                "SELECT id FROM ota_releases WHERE id=?", (body.release_id,)
            )
            if not rel_rows:
                raise HTTPException(400, f"release_id {body.release_id} does not exist.")
        await db.execute(
            "UPDATE homes SET ota_pinned_release_id=? WHERE id=?",
            (body.release_id, home_id),
        )
        await db.commit()
    await log_event(
        "ota_pin_updated", home_id=home_id, source_ip=src_ip, ok=True,
        detail=f"release_id={body.release_id}",
    )
    return {"home_id": home_id, "release_id": body.release_id}
