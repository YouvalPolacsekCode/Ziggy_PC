"""Backup-keys + restore endpoints (DESIGN_BACKUP_DR.md §10, §11).

Five endpoints, split by authentication source:

  Founder JWT (relay_admin role):
    POST /api/homes/{home_id}/seal-key       initial seal at imaging
    POST /api/homes/{home_id}/unseal         restore-time unwrap (audited)
    GET  /api/homes/{home_id}/backup-status  read latest hub-reported status

  Hub HMAC (per-home relay_secret over X-Ziggy-Signature):
    POST /api/homes/{home_id}/backup-status  hub reports a successful daily run
    POST /api/homes/{home_id}/restore-events hub reports DR success/failure

The relay NEVER persists the master key. Every seal/unseal handler holds
it only in process memory for the duration of one request — see
DESIGN_BACKUP_DR.md §4 "Master key handling on the relay" for the
accepted-risk write-up on Python's lack of memory zeroing.

The wrap format is wire-compatible with services/backup_keys.py on the
edge agent: AES-256-GCM with a 12-byte nonce prefix and a trailing
16-byte tag. The relay decrypts only to verify a proof-of-knowledge
on seal and to return the data_key + B2 creds on unseal — never for
any other purpose.

Wrong master key, malformed body, missing row: ALL surface as the same
400 to the caller. The audit_log row carries the actual reason so we
can debug after the fact without exposing presence/absence to attackers.
"""

from __future__ import annotations

import base64
import json as _json
from datetime import datetime, timezone
from typing import Optional

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..audit import log_event, verify as verify_signature
from ..auth import current_user, require_role
from ..database import get_db

router = APIRouter(prefix="/homes")

# AES-GCM wire format constants (must match services/backup_keys.py).
_NONCE = 12
_KEY = 32
_TAG = 16

# Returned to the client on unseal — informational only. The relay does
# not enforce expiry; the restore script (Chunk #9) re-unseals if the
# window lapses mid-restore. DESIGN_BACKUP_DR.md §7.
UNSEAL_TTL_SECONDS = 300

# Restore-event names accepted by /restore-events. The audit_log.event
# column gets the same string verbatim, so these must match the
# BACKUP_AUDIT_EVENTS tuple in relay/app/database.py.
_RESTORE_EVENT_NAMES = {"restore_completed", "restore_aborted"}


# ---------- helpers ----------

def _unwrap(master: bytes, wrapped: bytes) -> bytes:
    """Reverse of services/backup_keys.wrap(). Same wire format.

    wrapped = nonce(12) || ciphertext || tag(16). Raises InvalidTag on
    wrong key or tampered ciphertext.
    """
    if len(master) != _KEY:
        raise ValueError(f"master must be {_KEY} bytes, got {len(master)}")
    if len(wrapped) < _NONCE + _TAG:
        raise ValueError("wrapped blob too short")
    nonce = bytes(wrapped[:_NONCE])
    body = bytes(wrapped[_NONCE:])
    return AESGCM(master).decrypt(nonce, body, associated_data=None)


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for", "").split(",")[0].strip()
            or (request.client.host if request.client else ""))


def _decode_b64(name: str, value: str, *, expect_len: Optional[int] = None) -> bytes:
    try:
        out = base64.b64decode(value, validate=True)
    except Exception:
        raise HTTPException(400, f"{name} must be valid base64.")
    if expect_len is not None and len(out) != expect_len:
        raise HTTPException(400, f"{name} must decode to exactly {expect_len} bytes.")
    return out


# ---------- seal-key (founder JWT) ----------

class SealKeyBody(BaseModel):
    master_key_b64: str
    wrapped_data_key_b64: str
    wrapped_b2_credentials_b64: str


@router.post("/{home_id}/seal-key")
async def seal_key(home_id: str, body: SealKeyBody, request: Request):
    """Persist wrapped key material for a home. Founder-only.

    The body's master key is used to verify proof-of-knowledge: it must
    actually unwrap the wrapped_data_key + wrapped_b2_credentials blobs.
    If it doesn't, we refuse — otherwise an attacker with relay_admin
    creds could store arbitrary garbage that no one can later decrypt.

    The master key is then DISCARDED — never written to disk.

    Re-sealing an already-sealed home is permitted (founder may re-image
    a hub). The row is updated in place and key_version is incremented;
    the audit row records this as a 're_sealed' action.
    """
    require_role("relay_admin")(request)
    src_ip = _client_ip(request)

    master = _decode_b64("master_key_b64", body.master_key_b64, expect_len=_KEY)
    wrapped_dk = _decode_b64("wrapped_data_key_b64", body.wrapped_data_key_b64)
    wrapped_b2 = _decode_b64("wrapped_b2_credentials_b64", body.wrapped_b2_credentials_b64)

    try:
        _ = _unwrap(master, wrapped_dk)
        _ = _unwrap(master, wrapped_b2)
    except (InvalidTag, ValueError):
        await log_event(
            "backup_key_sealed", home_id=home_id, source_ip=src_ip,
            ok=False, detail="proof_of_knowledge_failed",
        )
        raise HTTPException(400, "Master key does not unwrap the provided blobs.")

    async with get_db() as db:
        rows = await db.execute_fetchall("SELECT id FROM homes WHERE id=?", (home_id,))
        if not rows:
            await log_event(
                "backup_key_sealed", home_id=home_id, source_ip=src_ip,
                ok=False, detail="unknown_home_id",
            )
            raise HTTPException(404, "Home not provisioned.")

        existing = await db.execute_fetchall(
            "SELECT key_version FROM home_backup_keys WHERE home_id=?", (home_id,)
        )
        now_iso = datetime.now(timezone.utc).isoformat()
        if existing:
            await db.execute(
                """UPDATE home_backup_keys
                   SET wrapped_data_key=?, wrapped_b2_credentials=?,
                       key_version=key_version+1
                   WHERE home_id=?""",
                (wrapped_dk, wrapped_b2, home_id),
            )
            action = "re_sealed"
        else:
            await db.execute(
                """INSERT INTO home_backup_keys
                   (home_id, wrapped_data_key, wrapped_b2_credentials,
                    key_version, created_at)
                   VALUES (?, ?, ?, 1, ?)""",
                (home_id, wrapped_dk, wrapped_b2, now_iso),
            )
            action = "first_seal"
        await db.commit()

    await log_event(
        "backup_key_sealed", home_id=home_id, source_ip=src_ip,
        ok=True, detail=action,
    )
    return {"ok": True, "home_id": home_id, "action": action}


# ---------- unseal (founder JWT) ----------

class UnsealBody(BaseModel):
    master_key_b64: str
    reason: str = Field(..., min_length=1, description="Free-text reason — audited.")


@router.post("/{home_id}/unseal")
async def unseal(home_id: str, body: UnsealBody, request: Request):
    """Return the per-home data_key + B2 creds, ephemerally (5-min TTL).

    Caller must hold the founder master key. Audit row is written for
    every attempt — success or failure — with the founder email and the
    free-text reason. The response never reveals whether the home was
    sealed vs the master key wrong: both surface as 400 "Unable to unseal."
    """
    require_role("relay_admin")(request)
    user = current_user(request)
    src_ip = _client_ip(request)

    master = _decode_b64("master_key_b64", body.master_key_b64, expect_len=_KEY)

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT wrapped_data_key, wrapped_b2_credentials FROM home_backup_keys WHERE home_id=?",
            (home_id,),
        )
        if not rows:
            await log_event(
                "backup_key_unsealed", home_id=home_id, source_ip=src_ip,
                ok=False, detail=f"no_sealed_key founder={user.get('email')} reason={body.reason}",
            )
            raise HTTPException(400, "Unable to unseal.")
        wrapped_dk = bytes(rows[0]["wrapped_data_key"])
        wrapped_b2 = bytes(rows[0]["wrapped_b2_credentials"])

        try:
            data_key = _unwrap(master, wrapped_dk)
            b2_creds_json = _unwrap(master, wrapped_b2)
        except (InvalidTag, ValueError):
            await log_event(
                "backup_key_unsealed", home_id=home_id, source_ip=src_ip,
                ok=False, detail=f"wrong_master_key founder={user.get('email')} reason={body.reason}",
            )
            raise HTTPException(400, "Unable to unseal.")

        try:
            b2_creds = _json.loads(b2_creds_json.decode("utf-8"))
        except Exception:
            await log_event(
                "backup_key_unsealed", home_id=home_id, source_ip=src_ip,
                ok=False, detail="b2_creds_not_json",
            )
            raise HTTPException(500, "B2 credentials blob malformed (server-side).")

        now_iso = datetime.now(timezone.utc).isoformat()
        await db.execute(
            """UPDATE home_backup_keys
               SET last_unsealed_at=?, last_unsealed_by=?
               WHERE home_id=?""",
            (now_iso, user.get("email"), home_id),
        )
        await db.commit()

    await log_event(
        "backup_key_unsealed", home_id=home_id, source_ip=src_ip,
        ok=True,
        detail=f"founder={user.get('email')} reason={body.reason} ttl={UNSEAL_TTL_SECONDS}s",
    )
    return {
        "data_key_b64": base64.b64encode(data_key).decode(),
        "b2_credentials": b2_creds,
        "ttl_seconds": UNSEAL_TTL_SECONDS,
        "home_id": home_id,
    }


# ---------- backup-status: hub POST, founder GET ----------

@router.post("/{home_id}/backup-status")
async def report_backup_status(home_id: str, request: Request):
    """Hub posts daily backup result. HMAC-signed with the home's relay_secret.

    Body (JSON, free-form — relay does not validate keys):
      {
        "uploaded_bytes": int,
        "files": [str],
        "optional_skipped": [str],
        "ha_version": str | null,
        "ziggy_version": str
      }

    Persisted as JSON 'detail' on a backup_status_updated audit row;
    the GET endpoint reads it back from there.
    """
    raw = await request.body()
    src_ip = _client_ip(request)
    sig_header = request.headers.get("X-Ziggy-Signature", "")

    try:
        payload = _json.loads(raw.decode("utf-8")) if raw else {}
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
    except Exception:
        await log_event(
            "backup_status_updated", home_id=home_id, source_ip=src_ip,
            ok=False, detail="malformed_json",
        )
        raise HTTPException(400, "Malformed body.")

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT relay_secret FROM homes WHERE id=?", (home_id,)
        )
    if not rows:
        await log_event(
            "backup_status_updated", home_id=home_id, source_ip=src_ip,
            ok=False, detail="unknown_home_id",
        )
        raise HTTPException(404, "Home not provisioned.")
    secret = rows[0]["relay_secret"]

    ok, reason = verify_signature(secret, raw, sig_header)
    if not ok:
        await log_event(
            "backup_status_updated", home_id=home_id, source_ip=src_ip,
            ok=False, detail=f"signature: {reason}",
        )
        raise HTTPException(401, "Invalid signature.")

    await log_event(
        "backup_status_updated", home_id=home_id, source_ip=src_ip,
        ok=True, detail=_json.dumps(payload, separators=(",", ":")),
    )
    return {"ok": True}


@router.get("/{home_id}/backup-status")
async def read_backup_status(home_id: str, request: Request):
    """Most recent successful daily backup row for this home.

    Pulled from audit_log; the idx_audit_home index covers the WHERE.
    Returns 404 if no backup has ever succeeded for this home.
    """
    user = current_user(request)
    if user.get("role") != "relay_admin" and user.get("home_id") != home_id:
        raise HTTPException(403, "Access denied.")
    async with get_db() as db:
        rows = await db.execute_fetchall(
            """SELECT ts, detail FROM audit_log
               WHERE home_id=? AND event='backup_status_updated' AND ok=1
               ORDER BY ts DESC LIMIT 1""",
            (home_id,),
        )
    if not rows:
        raise HTTPException(404, "No backup status on record for this home.")
    try:
        detail = _json.loads(rows[0]["detail"]) if rows[0]["detail"] else {}
        if not isinstance(detail, dict):
            detail = {"raw": rows[0]["detail"]}
    except Exception:
        detail = {"raw": rows[0]["detail"]}
    return {"ts": rows[0]["ts"], "home_id": home_id, **detail}


# ---------- restore-events (hub HMAC) ----------

@router.post("/{home_id}/restore-events")
async def report_restore_event(home_id: str, request: Request):
    """New hub reports DR success/failure.

    Body:
      { "event": "restore_completed" | "restore_aborted",
        ...any other detail fields (old_device_id, stage, reason, ...) }
    """
    raw = await request.body()
    src_ip = _client_ip(request)
    sig_header = request.headers.get("X-Ziggy-Signature", "")

    try:
        payload = _json.loads(raw.decode("utf-8")) if raw else {}
        if not isinstance(payload, dict):
            raise ValueError("body must be a JSON object")
    except Exception:
        await log_event(
            "restore_aborted", home_id=home_id, source_ip=src_ip,
            ok=False, detail="malformed_json",
        )
        raise HTTPException(400, "Malformed body.")

    event = payload.get("event")
    if event not in _RESTORE_EVENT_NAMES:
        raise HTTPException(
            400, f"event must be one of {sorted(_RESTORE_EVENT_NAMES)}"
        )

    async with get_db() as db:
        rows = await db.execute_fetchall(
            "SELECT relay_secret FROM homes WHERE id=?", (home_id,)
        )
    if not rows:
        await log_event(
            event, home_id=home_id, source_ip=src_ip,
            ok=False, detail="unknown_home_id",
        )
        raise HTTPException(404, "Home not provisioned.")
    secret = rows[0]["relay_secret"]

    ok_sig, reason = verify_signature(secret, raw, sig_header)
    if not ok_sig:
        await log_event(
            event, home_id=home_id, source_ip=src_ip,
            ok=False, detail=f"signature: {reason}",
        )
        raise HTTPException(401, "Invalid signature.")

    # Don't double-store 'event' inside detail — the column already has it.
    detail_dict = {k: v for k, v in payload.items() if k != "event"}
    await log_event(
        event, home_id=home_id, source_ip=src_ip,
        ok=(event == "restore_completed"),
        detail=_json.dumps(detail_dict, separators=(",", ":")),
    )
    return {"ok": True}
