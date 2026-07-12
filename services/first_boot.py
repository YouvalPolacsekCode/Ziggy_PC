"""First-boot detector + claim-code orchestrator — Prompt 7 chunk 2.4.

Owns the question "is this edge box still waiting for a customer to claim
ownership?" and serves the LAN /pair page + its JSON sibling.

Lifecycle
---------
1. Edge boots. services.first_boot reads or mints the device_id (UUID4,
   persisted to /etc/ziggy/device_id by the factory imaging script on
   production boxes; falls back to user_files/device_id.txt on dev
   laptops that never ran factory imaging).
2. is_first_boot() → True. get_claim_qr() lazy-mints a 30-day claim-tier
   pair code (via services.mobile_app.create_claim_code, which is
   idempotent per device_id so restarts don't rotate the code).
3. Customer scans the QR (sticker on the box, or LAN /pair page). Mobile
   app redeems the claim code via /api/mobile/pair.
4. /api/onboarding/claim (Chunk 3) creates the owner account, binds the
   freshly-paired mobile device record, and calls mark_onboarding_complete()
   here. From that point on, get_claim_qr() returns None and the LAN
   /pair page shows a "this hub is already set up" notice.

Why a separate state file
-------------------------
The mobile_pair_codes.json file is the authoritative store for the claim
code itself. first_boot.json carries the *first-boot* lifecycle facts
(when the box first booted, when onboarding completed) plus a mirror of
the claim code metadata for ops visibility — so a founder reading the
file directly on a kit gets a self-contained timeline. The mirror is
re-synced on every get_claim_qr() call.

Paths
-----
device_id:        /etc/ziggy/device_id  (factory) → user_files/device_id.txt
                  Override: ZIGGY_DEVICE_ID_PATH
first_boot state: user_files/first_boot.json
                  Override: ZIGGY_FIRST_BOOT_STATE_PATH
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from core.logger_module import log_error, log_info
from services import mobile_app


DEFAULT_DEVICE_ID_PATH      = "/etc/ziggy/device_id"
DEFAULT_STATE_PATH          = "user_files/first_boot.json"
FALLBACK_DEVICE_ID_PATH     = "user_files/device_id.txt"


_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _owner_exists() -> bool:
    """True once ANY owner account exists on this hub.

    This is the authoritative "first-boot window is closed" signal — stronger
    than the completed_at stamp, because an owner can be created out-of-band
    (e.g. a technical user runs the web /api/auth/setup flow, or restores a
    backup) without ever walking the mobile claim wizard. The no-auth
    first-boot pair-code mint MUST hard-refuse the moment an owner exists, so
    we consult auth_db directly rather than trusting only our own state file.

    Imported lazily to avoid a module-load cycle (auth_db → settings → …) and
    to keep first_boot importable in minimal test contexts. Any failure is
    treated as "no owner" so a transient auth_db error never *serves* a claim
    code it shouldn't — wait, the opposite: a failure here must fail CLOSED for
    minting (treat as owner-present) so we never leak a claim code during an
    auth_db hiccup. Returns True on error.
    """
    try:
        from services import auth_db
        return auth_db.has_any_user()
    except Exception as e:  # pragma: no cover - defensive
        log_error(f"[first_boot] owner-existence check failed, failing closed: {e}")
        return True


def _home_id() -> Optional[str]:
    """Best-effort home_id from settings (settings.home.id). Recorded on the
    owner at claim time so the account is bound to this specific hub."""
    try:
        from core.settings_loader import load_settings
        s = load_settings() or {}
        hid = ((s.get("home") or {}).get("id"))
        return str(hid) if hid else None
    except Exception:
        return None


def _device_id_path() -> Path:
    return Path(os.environ.get("ZIGGY_DEVICE_ID_PATH", DEFAULT_DEVICE_ID_PATH))


def _fallback_device_id_path() -> Path:
    """Local-dev fallback when /etc/ziggy/device_id doesn't exist."""
    base = Path(__file__).resolve().parents[1]
    override = os.environ.get("ZIGGY_FALLBACK_DEVICE_ID_PATH")
    return Path(override) if override else base / FALLBACK_DEVICE_ID_PATH


def _state_path() -> Path:
    override = os.environ.get("ZIGGY_FIRST_BOOT_STATE_PATH")
    if override:
        return Path(override)
    base = Path(__file__).resolve().parents[1]
    return base / DEFAULT_STATE_PATH


# ── device_id resolution ─────────────────────────────────────────────────────

def get_device_id() -> str:
    """Return the edge box's UUIDv4 device_id, minting one if necessary.

    Lookup order:
      1. ZIGGY_DEVICE_ID_PATH (default /etc/ziggy/device_id) — factory-set.
      2. user_files/device_id.txt — dev-laptop fallback, persisted between
         boots so the claim code stays stable.
      3. Mint a fresh UUID4 and persist to the fallback path.

    The primary path (/etc/ziggy/device_id) is read-only from Ziggy's
    perspective — factory imaging writes it. We never try to create it.
    """
    primary = _device_id_path()
    if primary.exists():
        try:
            val = primary.read_text(encoding="utf-8").strip()
            if val:
                return val
        except Exception as e:
            log_error(f"[first_boot] could not read {primary}: {e}")

    fallback = _fallback_device_id_path()
    if fallback.exists():
        try:
            val = fallback.read_text(encoding="utf-8").strip()
            if val:
                return val
        except Exception as e:
            log_error(f"[first_boot] could not read {fallback}: {e}")

    new_id = str(uuid.uuid4())
    try:
        fallback.parent.mkdir(parents=True, exist_ok=True)
        fallback.write_text(new_id, encoding="utf-8")
        log_info(f"[first_boot] minted dev fallback device_id={new_id} at {fallback}")
    except Exception as e:
        # Even on a write failure we return the value; the next boot mints
        # again, which is annoying for dev but never blocks production
        # (production has the factory-written /etc/ziggy/device_id).
        log_error(f"[first_boot] failed to persist fallback device_id: {e}")
    return new_id


# ── State file I/O ───────────────────────────────────────────────────────────

def _default_state(device_id: str) -> dict:
    return {
        "device_id":            device_id,
        "first_boot_at":        _now(),
        "claim_code":           None,
        "claim_code_minted_at": None,
        "claim_expires_at":     None,
        "completed_at":         None,
    }


def _load_state() -> dict:
    p = _state_path()
    if not p.exists():
        return _default_state(get_device_id())
    try:
        data = json.loads(p.read_text(encoding="utf-8")) or {}
    except Exception as e:
        log_error(f"[first_boot] failed to read {p}: {e} — reinitialising")
        return _default_state(get_device_id())
    if not isinstance(data, dict):
        return _default_state(get_device_id())
    # Heal missing keys without losing existing values.
    base = _default_state(data.get("device_id") or get_device_id())
    base.update(data)
    return base


def _save_state(state: dict) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)


# ── Public surface ───────────────────────────────────────────────────────────

def is_first_boot() -> bool:
    """True until mark_onboarding_complete() runs OR an owner account exists.

    Drives the LAN /pair page visibility and (later) the edge agent's
    decision to show the boot-time QR sticker fallback page.

    Gated on BOTH signals: our own completed_at stamp AND auth_db owner
    existence. The moment a home has an owner (via the mobile claim flow OR an
    out-of-band web /api/auth/setup), the first-boot window is closed even if
    completed_at was never stamped.
    """
    if _load_state().get("completed_at") not in (None, ""):
        return False
    return not _owner_exists()


def get_claim_qr() -> Optional[dict]:
    """Return the data the LAN /pair page renders, or None when the box is
    no longer in first-boot state.

    Lazy-mints the underlying claim-tier pair code via mobile_app on first
    call. Idempotent across restarts — mobile_app.create_claim_code reuses
    the existing non-expired code for the same device_id.

    Returned shape:
      {device_id, code, expires_at, ttl_seconds}
    """
    with _lock:
        state = _load_state()
        if state.get("completed_at"):
            return None
        # Hard-refuse once an owner exists — even if completed_at was never
        # stamped (out-of-band web setup, backup restore). Auto-close the
        # window so the LAN /pair page + qr.json reflect reality and every
        # future mint routes through the authenticated /api/mobile/pair-code.
        if _owner_exists():
            state["completed_at"] = _now()
            _save_state(state)
            log_info("[first_boot] owner already exists — closing first-boot window, refusing claim mint")
            return None
        # M1: as soon as the FIRST phone has redeemed a claim code (a
        # claim-pending device now exists), stop minting NEW claim codes. The
        # window is effectively closed until that device finishes /claim (owner
        # created → the branch above fires) or is revoked (reopens). This stops
        # a second phone from obtaining its own claim token and feeding the
        # owner-creation race.
        if mobile_app.has_claim_pending_device():
            log_info("[first_boot] a claim is already in progress — refusing to mint a new claim code")
            return None
        device_id = state.get("device_id") or get_device_id()
        state["device_id"] = device_id  # heal a missing/empty id
        res = mobile_app.create_claim_code(device_id)
        state["claim_code"]           = res["code"]
        state["claim_expires_at"]     = res["expires_at"]
        # `claim_code_minted_at` records the first mint, not subsequent
        # idempotent re-reads, so the founder can read the file and see when
        # the code first appeared.
        if not state.get("claim_code_minted_at"):
            state["claim_code_minted_at"] = _now()
        _save_state(state)
        return {
            "device_id":   device_id,
            "code":        res["code"],
            "expires_at":  res["expires_at"],
            "ttl_seconds": res["ttl_seconds"],
        }


def mark_onboarding_complete() -> dict:
    """Stamp completed_at on the state file. Idempotent — subsequent calls
    return the same timestamp without overwriting it.

    Will be called from /api/onboarding/complete (Chunk 3.6). Exposing it
    in Chunk 2 keeps the lifecycle owned in one place.
    """
    with _lock:
        state = _load_state()
        if not state.get("completed_at"):
            state["completed_at"] = _now()
            _save_state(state)
            log_info(f"[first_boot] onboarding complete for device {state.get('device_id')}")
        return state


def reset_first_boot() -> dict:
    """Wipe the first-boot state file so the LAN /pair page reappears.

    Used by the factory wipe script (PROMPT_FACTORY_IMAGING §5) and by
    super-admin debugging. Does NOT touch /etc/ziggy/device_id — the box's
    identity is meant to outlive a factory reset.

    Note: any extant claim code in mobile_pair_codes.json will keep being
    served until it expires. If callers want a *fresh* code post-reset
    they should also revoke claim codes via mobile_app (left to the
    factory wipe flow, not Ziggy proper).
    """
    with _lock:
        fresh = _default_state(get_device_id())
        _save_state(fresh)
        log_info(f"[first_boot] state reset for device {fresh['device_id']}")
        return fresh


def snapshot() -> dict:
    """Read-only state dump for diagnostics. No side effects."""
    return _load_state()
