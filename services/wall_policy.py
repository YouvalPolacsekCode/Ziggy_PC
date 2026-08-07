"""Wall-tablet capability policy — what a shared wall screen is allowed to do.

ADDITIVE: a sidecar keyed by the `tablet_id` the existing pairing flow already
issues. `dashboard_tablets.json` is never read for writing and its schema is
never modified, so a tablet paired for /hub keeps working there untouched.

Why a policy at all: a wall tablet is shared, always-on, and physically
reachable by everyone in the home including children and visitors. It cannot
carry a person's full permissions. So the tablet gets its own, narrower set,
and the sensitive parts of it sit behind a PIN.

Two layers:
    capabilities   what this tablet may do at all (a false here is invisible
                   in the UI *and* refused at the API)
    pin_required   capabilities that additionally need a PIN, which grants a
                   short-lived elevation rather than unlocking forever

Elevation is in-memory and dies with the process. That is deliberate: a hub
restart should re-lock the front door control, not leave it open because
someone typed a PIN yesterday.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import secrets
import time
from pathlib import Path
from typing import Optional

from core.logger_module import log_error

_FILE = Path(__file__).parent.parent / "user_files" / "wall_tablet_policy.json"
_LOCK = asyncio.Lock()

# Every capability the wall understands. A module or control declares one of
# these; anything not listed is unrestricted.
CAPABILITIES = (
    "lights", "climate", "media", "scenes", "lists",
    "cameras", "locks", "automations", "devices", "settings",
)

# What an unconfigured tablet gets. Chosen so a wall panel is immediately
# useful (lights, AC, music, lists, scenes) but cannot open a door, watch a
# camera, pair hardware, or change hub settings until an admin says so.
DEFAULT_CAPABILITIES = {
    "lights": True, "climate": True, "media": True, "scenes": True, "lists": True,
    "cameras": False, "locks": False, "automations": True, "devices": False, "settings": False,
}
DEFAULT_PIN_REQUIRED = ["locks", "cameras", "devices", "settings"]

# How long a correct PIN keeps a capability unlocked.
ELEVATION_TTL_S = 5 * 60

# Brute-force guard. A 4-digit PIN is 10k combinations; without a limit that
# falls in seconds over HTTP.
_PIN_ATTEMPT_MAX = 5
_PIN_ATTEMPT_WINDOW_S = 120

# tablet_id -> { capability: expires_at }
_elevations: dict[str, dict[str, float]] = {}
# tablet_id -> [attempt timestamps]
_pin_attempts: dict[str, list[float]] = {}


def _now() -> float:
    return time.time()


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _load() -> dict:
    if not _FILE.exists():
        return {}
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as e:
        log_error(f"[wall_policy] Read failed, starting empty: {e}")
        return {}


def _save(data: dict) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(_FILE)
    except Exception as e:
        log_error(f"[wall_policy] Write failed: {e}")


# ---------------------------------------------------------------------------
# PIN hashing
# ---------------------------------------------------------------------------
# PBKDF2 rather than a bare digest: a 4-6 digit PIN has almost no entropy, so
# the only meaningful defence if the file leaks is making each guess expensive.

def _hash_pin(pin: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(8)
    dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 120_000)
    return f"pbkdf2${salt}${dk.hex()}"


def _verify_pin(pin: str, stored: str) -> bool:
    try:
        algo, salt, digest = stored.split("$", 2)
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt.encode(), 120_000)
        return hmac.compare_digest(dk.hex(), digest)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def default_policy() -> dict:
    return {
        "capabilities": dict(DEFAULT_CAPABILITIES),
        "pin_required": list(DEFAULT_PIN_REQUIRED),
        "has_pin": False,
    }


def unrestricted_policy() -> dict:
    """Everything allowed, nothing gated.

    What an UNPAIRED visitor to /wall gets. Such a session is not a wall panel
    — it is a signed-in person looking at the wall view in their browser, and
    they already hold their own account's permissions. Restricting them would
    be both pointless (no header is sent, so the server cannot enforce it
    anyway) and confusing: the Devices button would vanish with no explanation.

    The restrictions exist for a PAIRED tablet, because that is the one that
    hangs on a wall where anyone in the house can reach it.
    """
    return {
        "capabilities": {c: True for c in CAPABILITIES},
        "pin_required": [],
        "has_pin": False,
    }


async def get_policy(tablet_id: Optional[str]) -> dict:
    """Policy for a tablet. Never raises, never returns the PIN hash."""
    if not tablet_id:
        return unrestricted_policy()
    data = await asyncio.to_thread(_load)
    rec = data.get(tablet_id)
    if not rec:
        return default_policy()
    caps = dict(DEFAULT_CAPABILITIES)
    caps.update({k: bool(v) for k, v in (rec.get("capabilities") or {}).items() if k in CAPABILITIES})
    return {
        "capabilities": caps,
        "pin_required": [c for c in (rec.get("pin_required") or []) if c in CAPABILITIES],
        "has_pin": bool(rec.get("pin_hash")),
    }


async def set_policy(tablet_id: str, policy: dict) -> dict:
    """Admin write. Leaves any existing PIN hash alone — the PIN has its own
    endpoint so a policy edit can never silently clear it."""
    if not tablet_id:
        raise ValueError("tablet_id is required.")
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        rec = data.get(tablet_id) or {}
        caps_in = (policy or {}).get("capabilities") or {}
        rec["capabilities"] = {
            k: bool(caps_in.get(k, DEFAULT_CAPABILITIES[k])) for k in CAPABILITIES
        }
        req_in = (policy or {}).get("pin_required")
        if req_in is not None:
            rec["pin_required"] = [c for c in req_in if c in CAPABILITIES]
        data[tablet_id] = rec
        await asyncio.to_thread(_save, data)
    return await get_policy(tablet_id)


async def set_pin(tablet_id: str, pin: Optional[str]) -> bool:
    """Set or clear the PIN. Passing None/empty clears it, which also drops
    every pin_required gate to 'allowed' — otherwise clearing the PIN would
    lock the tablet out of its own capabilities with no way back."""
    if not tablet_id:
        raise ValueError("tablet_id is required.")
    if pin is not None and pin != "":
        if not pin.isdigit() or not (4 <= len(pin) <= 8):
            raise ValueError("PIN must be 4-8 digits.")
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        rec = data.get(tablet_id) or {}
        if pin:
            rec["pin_hash"] = _hash_pin(pin)
        else:
            rec.pop("pin_hash", None)
            rec["pin_required"] = []
        data[tablet_id] = rec
        await asyncio.to_thread(_save, data)
    _elevations.pop(tablet_id, None)
    return True


def _rate_ok(tablet_id: str) -> bool:
    window = _now() - _PIN_ATTEMPT_WINDOW_S
    _pin_attempts[tablet_id] = [t for t in _pin_attempts.get(tablet_id, []) if t >= window]
    if len(_pin_attempts[tablet_id]) >= _PIN_ATTEMPT_MAX:
        return False
    _pin_attempts[tablet_id].append(_now())
    return True


async def verify_pin(tablet_id: str, capability: str, pin: str) -> dict:
    """Check a PIN and, on success, elevate that one capability for a while.

    Returns { ok, ttl_s } or raises PermissionError when rate-limited.
    """
    if not tablet_id:
        raise ValueError("tablet_id is required.")
    if not _rate_ok(tablet_id):
        raise PermissionError("Too many attempts. Wait a couple of minutes.")

    data = await asyncio.to_thread(_load)
    rec = data.get(tablet_id) or {}
    stored = rec.get("pin_hash")
    if not stored:
        return {"ok": False, "reason": "no_pin"}

    if not _verify_pin(pin or "", stored):
        return {"ok": False, "reason": "wrong"}

    # Correct PIN clears the attempt counter so a fat-fingered family member
    # isn't locked out right after succeeding.
    _pin_attempts.pop(tablet_id, None)
    _elevations.setdefault(tablet_id, {})[capability] = _now() + ELEVATION_TTL_S
    return {"ok": True, "ttl_s": ELEVATION_TTL_S}


def is_elevated(tablet_id: str, capability: str) -> bool:
    exp = (_elevations.get(tablet_id) or {}).get(capability)
    return bool(exp and exp > _now())


def drop_elevation(tablet_id: str) -> None:
    """Called when the tablet goes idle — walking away re-locks the door."""
    _elevations.pop(tablet_id, None)


async def delete_policy(tablet_id: str) -> bool:
    """Forget a tablet's policy entirely. Called on un-pair.

    Without this, un-pairing left the capability set AND the PIN hash on disk
    for a tablet id that no longer exists — so a reissued id would silently
    inherit a stranger's permissions and PIN.
    """
    if not tablet_id:
        return False
    drop_elevation(tablet_id)
    _pin_attempts.pop(tablet_id, None)
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        if tablet_id not in data:
            return False
        del data[tablet_id]
        await asyncio.to_thread(_save, data)
        return True


async def check(tablet_id: str, capability: Optional[str]) -> tuple[bool, str]:
    """Authoritative allow/deny for (tablet, capability).

    Returns (allowed, reason). Reason is 'ok', 'denied', or 'pin_required'.
    """
    if not capability:
        return True, "ok"
    policy = await get_policy(tablet_id)
    if policy["capabilities"].get(capability) is False:
        return False, "denied"
    if capability in policy["pin_required"] and not is_elevated(tablet_id, capability):
        return False, "pin_required"
    return True, "ok"
