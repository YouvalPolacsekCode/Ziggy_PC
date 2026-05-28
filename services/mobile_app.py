"""
Mobile-app protocol translator.

Bridges between the Ziggy Home mobile app (Capacitor-wrapped) and the existing
Ziggy services. The mobile app POSTs webhook payloads with types like
`update_location`, `update_sensors`, `fire_event`; this module unpacks them and
routes each into the right existing primitive:

  update_location  → services.presence_engine.ingest_external_state(...)
  update_sensors   → in-memory device sensor cache + ws fan-out
  fire_event       → core event bus (deferred to phase 2)

This is intentionally THIN — no decision logic lives here, only translation.
All actual presence math, automation routing, and history persistence happens
in the existing services that have already been battle-tested.

Storage (added by this module, do not edit elsewhere):
  user_files/mobile_devices.json — registered mobile devices
  user_files/mobile_pair_codes.json — short-lived pair codes (5 min TTL)
"""
from __future__ import annotations

import asyncio
import json
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from core.logger_module import log_info, log_error
from services import presence_engine

# ── Storage paths ────────────────────────────────────────────────────────────

_DEVICES_FILE = Path(__file__).resolve().parents[1] / "user_files" / "mobile_devices.json"
_PAIR_FILE    = Path(__file__).resolve().parents[1] / "user_files" / "mobile_pair_codes.json"

_PAIR_TTL_S       = 300       # 5 minutes (user-tier — PWA → phone)
_CLAIM_TTL_S      = 30 * 24 * 60 * 60   # 30 days (first-boot claim, mirrors
                                        # PROMPT_FACTORY_IMAGING §4 step 11)
_DEVICE_TOKEN_LEN = 32       # bytes of entropy in the auth token

_lock = threading.Lock()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        log_error(f"[mobile_app] failed to read {path}: {e}")
        return default


def _save(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _new_token() -> str:
    # Prefix lets us identify mobile tokens at a glance in logs.
    return "zgy_mb_" + secrets.token_urlsafe(_DEVICE_TOKEN_LEN)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


# ── Pair codes ───────────────────────────────────────────────────────────────

def _mint_code_string() -> str:
    return "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))


def create_pair_code(user_id: str) -> dict:
    """Mint a short-lived (5 min) USER-tier pair code. The PWA owner shows the
    code (or its QR) to their phone; phone POSTs to /mobile/pair to redeem.

    Use this when an owner account already exists. For the kit-out-of-box
    first-boot flow where no owner is yet defined, see create_claim_code.
    """
    code = _mint_code_string()
    expires_at = _now() + timedelta(seconds=_PAIR_TTL_S)
    with _lock:
        codes = _load(_PAIR_FILE, [])
        codes = [c for c in codes if datetime.fromisoformat(c["expires_at"]) > _now()]
        codes.append({
            "code":       code,
            "kind":       "user",          # explicit so consume can route
            "user_id":    user_id,
            "created_at": _now().isoformat(),
            "expires_at": expires_at.isoformat(),
        })
        _save(_PAIR_FILE, codes)
    return {"code": code, "expires_at": expires_at.isoformat(), "ttl_seconds": _PAIR_TTL_S}


def create_claim_code(device_id: str, *, ttl_seconds: int = _CLAIM_TTL_S) -> dict:
    """Mint a long-lived (default 30 days) CLAIM-tier pair code bound to a
    device_id rather than a user_id.

    Used on a freshly-imaged box where the customer hasn't created an owner
    account yet. The mobile app redeems via /api/mobile/pair; the resulting
    device record stays in a `claim_pending` state until /api/onboarding/claim
    (Chunk 3) creates the owner and binds it.

    Idempotent within a single device's lifetime: if a non-expired claim
    code already exists for this device_id, return it instead of minting a
    second one. Stops first-boot.py from minting fresh codes on every
    process restart.
    """
    if not device_id or not device_id.strip():
        raise ValueError("device_id is required to mint a claim code")
    device_id = device_id.strip()
    with _lock:
        codes = _load(_PAIR_FILE, [])
        codes = [c for c in codes if datetime.fromisoformat(c["expires_at"]) > _now()]
        # Idempotency: reuse an existing non-expired claim code for the same
        # device. Lets the LAN /pair page re-render the same QR even after
        # an edge restart, so a sticker printed at imaging time stays valid.
        for c in codes:
            if c.get("kind") == "claim" and c.get("device_id") == device_id:
                _save(_PAIR_FILE, codes)  # drop expired neighbours
                return {
                    "code":        c["code"],
                    "device_id":   device_id,
                    "expires_at":  c["expires_at"],
                    "ttl_seconds": int(
                        (datetime.fromisoformat(c["expires_at"]) - _now()).total_seconds()
                    ),
                    "kind":        "claim",
                    "reused":      True,
                }
        code = _mint_code_string()
        expires_at = _now() + timedelta(seconds=ttl_seconds)
        codes.append({
            "code":       code,
            "kind":       "claim",
            "device_id":  device_id,
            "created_at": _now().isoformat(),
            "expires_at": expires_at.isoformat(),
        })
        _save(_PAIR_FILE, codes)
    log_info(f"[mobile_app] minted claim code for device {device_id} (ttl_s={ttl_seconds})")
    return {
        "code":        code,
        "device_id":   device_id,
        "expires_at":  expires_at.isoformat(),
        "ttl_seconds": ttl_seconds,
        "kind":        "claim",
        "reused":      False,
    }


def consume_pair_code(code: str) -> Optional[dict]:
    """Return the pair record if `code` is valid, removing it atomically.
    Returns None if expired or unknown.

    The returned dict always carries a `kind` field — "user" or "claim".
    Older codes minted before the kind field existed are treated as "user"
    (forward-compatible default).

    Callers should branch on kind:
      kind=="user"   → match["user_id"] identifies the owner
      kind=="claim"  → match["device_id"] identifies the box; owner is created
                       later via /api/onboarding/claim (Chunk 3)
    """
    with _lock:
        codes = _load(_PAIR_FILE, [])
        match = None
        remaining = []
        for c in codes:
            if c["code"] == code and datetime.fromisoformat(c["expires_at"]) > _now():
                match = c
            elif datetime.fromisoformat(c["expires_at"]) > _now():
                remaining.append(c)
        _save(_PAIR_FILE, remaining)
    if match is None:
        return None
    # Forward-compat: older records without kind are user-tier.
    match.setdefault("kind", "user")
    return match


# ── Devices ──────────────────────────────────────────────────────────────────

def register_device(
    user_id: Optional[str],
    device_info: dict,
    *,
    claim_pending: bool = False,
    claim_device_id: Optional[str] = None,
) -> dict:
    """Create a new mobile-device record and return it with its auth token.

    Two modes:
      Normal (claim_pending=False):
        user_id is required. Behaviour is unchanged from the pre-Prompt-7
        flow — the device is immediately bound to its owner.

      Claim-pending (claim_pending=True):
        user_id may be None. The record is created with `claim_pending=True`
        and `claim_device_id=<edge device_id>`, indicating the mobile app
        successfully redeemed a first-boot claim code but the owner account
        has not been created yet. /api/onboarding/claim (Chunk 3) will bind
        a real user_id via bind_claim_pending_device().
    """
    if not claim_pending and not user_id:
        raise ValueError("user_id is required unless claim_pending=True")

    device_id = _new_id("dev")
    webhook_id = _new_id("wh")
    token = _new_token()

    record = {
        "device_id":       device_id,
        "webhook_id":      webhook_id,
        "user_id":         user_id,
        "person_id":       None,
        "auth_token":      token,
        "push_token":      None,
        "push_provider":   None,
        "platform":        device_info.get("platform"),
        "model":           device_info.get("model"),
        "os_version":      device_info.get("os_version"),
        "app_version":     device_info.get("app_version"),
        "claim_pending":   claim_pending,
        "claim_device_id": claim_device_id,
        "created_at":      _now().isoformat(),
        "last_seen":       _now().isoformat(),
    }
    with _lock:
        devices = _load(_DEVICES_FILE, [])
        devices.append(record)
        _save(_DEVICES_FILE, devices)
    if claim_pending:
        log_info(
            f"[mobile_app] registered claim-pending device {device_id} "
            f"({record['platform']} {record['model']}) for box {claim_device_id}"
        )
    else:
        log_info(
            f"[mobile_app] registered device {device_id} "
            f"({record['platform']} {record['model']}) for user {user_id}"
        )
    return record


def bind_claim_pending_device(device_id: str, user_id: str) -> bool:
    """Bind a claim-pending mobile-device record to a freshly-created owner.

    Called from /api/onboarding/claim (Chunk 3) after the owner account has
    been minted. Idempotent: a non-claim-pending or unknown record returns
    False so the caller can decide whether to 404 or 409.
    """
    if not user_id:
        raise ValueError("user_id is required to bind a claim-pending device")
    with _lock:
        devices = _load(_DEVICES_FILE, [])
        for d in devices:
            if d.get("device_id") != device_id:
                continue
            if not d.get("claim_pending"):
                return False
            d["user_id"]       = user_id
            d["claim_pending"] = False
            d["last_seen"]     = _now().isoformat()
            _save(_DEVICES_FILE, devices)
            log_info(f"[mobile_app] bound claim-pending device {device_id} → user {user_id}")
            return True
    return False


def find_device_by_token(token: str) -> Optional[dict]:
    if not token:
        return None
    with _lock:
        for d in _load(_DEVICES_FILE, []):
            if d.get("auth_token") == token:
                return d
    return None


def find_device_by_webhook_id(webhook_id: str) -> Optional[dict]:
    with _lock:
        for d in _load(_DEVICES_FILE, []):
            if d.get("webhook_id") == webhook_id:
                return d
    return None


def update_device(device_id: str, fields: dict) -> None:
    """Patch a device record. Used by /mobile/register to set push token,
    permissions, person binding, etc."""
    with _lock:
        devices = _load(_DEVICES_FILE, [])
        for d in devices:
            if d.get("device_id") == device_id:
                d.update(fields)
                d["last_seen"] = _now().isoformat()
                _save(_DEVICES_FILE, devices)
                return


def list_devices_for_user(user_id: str) -> list[dict]:
    """Return public-safe device records for a user (no auth_token)."""
    with _lock:
        devices = _load(_DEVICES_FILE, [])
    return [_redact(d) for d in devices if d.get("user_id") == user_id]


def list_all_devices() -> list[dict]:
    """All devices, redacted. Used by push fan-out."""
    with _lock:
        devices = _load(_DEVICES_FILE, [])
    return [_redact(d) for d in devices]


def delete_device(device_id: str, *, user_id: Optional[str] = None) -> bool:
    """Remove a device record. If user_id is given, the device must belong to
    that user — defends against a leaked token deleting someone else's record.
    Returns True if deleted.
    """
    with _lock:
        devices = _load(_DEVICES_FILE, [])
        kept = []
        deleted = False
        for d in devices:
            if d.get("device_id") == device_id:
                if user_id is not None and d.get("user_id") != user_id:
                    kept.append(d)
                    continue
                deleted = True
                continue
            kept.append(d)
        if deleted:
            _save(_DEVICES_FILE, kept)
    if deleted:
        log_info(f"[mobile_app] deleted device {device_id}")
    return deleted


def _redact(d: dict) -> dict:
    """Strip secrets from a device record before returning to the PWA."""
    return {k: v for k, v in d.items() if k not in ("auth_token",)}


# ── Webhook payload routers ──────────────────────────────────────────────────

def handle_webhook(device: dict, payload: dict) -> dict:
    """Dispatch a single webhook payload from the mobile app.
    Returns a small response dict the app can use for confirmation.
    """
    ptype = payload.get("type")
    data = payload.get("data") or {}

    if ptype == "update_location":
        return _handle_location(device, data)
    if ptype == "update_sensors":
        return _handle_sensors(device, data)
    if ptype == "fire_event":
        # Phase 2: hook into core.debug_bus / automation engine.
        log_info(f"[mobile_app] fire_event from {device['device_id']}: {data.get('event')}")
        return {"ok": True, "queued": True}

    return {"ok": False, "error": f"unknown_type:{ptype}"}


def _handle_location(device: dict, data: dict) -> dict:
    """Phase 1 stub: log the location, mark device last_seen, and (if a
    person_id is bound) forward to presence_engine.

    The fully-fused signal path (GPS + WiFi + activity + LAN) lands in Phase 3
    once the native plugin is sending us geofence enter/exit events.
    """
    update_device(device["device_id"], {})  # bump last_seen
    person_id = device.get("person_id")
    if not person_id:
        return {"ok": True, "ignored": "no_person_bound"}

    source = data.get("source", "gps")
    # Phase 1: we just record. Geofence-enter/exit translate to home/not_home
    # in Phase 3 once the native plugin classifies them.
    log_info(
        f"[mobile_app] location from {device['device_id']} person={person_id} "
        f"src={source} lat={data.get('lat')} lon={data.get('lon')} "
        f"acc={data.get('accuracy_m')}m"
    )
    return {"ok": True, "recorded": True}


def _handle_sensors(device: dict, data: Any) -> dict:
    """Phase 1 stub: write per-device sensor values into the device record.
    Full ingestion into the presence/anomaly engines lands in Phase 3.
    """
    if not isinstance(data, list):
        return {"ok": False, "error": "data_must_be_list"}
    sensors = {s["key"]: {"value": s.get("value"), "ts": s.get("ts")} for s in data if "key" in s}
    if not sensors:
        return {"ok": False, "error": "no_sensors"}
    update_device(device["device_id"], {"last_sensors": sensors})
    log_info(f"[mobile_app] {len(sensors)} sensors from {device['device_id']}")
    return {"ok": True, "ingested": len(sensors)}
