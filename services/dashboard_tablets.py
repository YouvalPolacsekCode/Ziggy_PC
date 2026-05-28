"""Hub-tablet registry + pairing.

Tablets are devices that should boot into the Hub at /hub instead of the
normal Dashboard. A device becomes a tablet by being **paired** through this
service: an admin generates a one-shot 6-digit code in Settings, the user
opens /hub on the tablet, enters the code, and the tablet receives a
persistent `tablet_id` it stores in localStorage.

Storage is a JSON file mirroring ui_prefs.json. Pairing codes live in memory
only — they're short-lived (5 min TTL) and re-issuable, so losing them on
restart is fine and safer than persisting hashed codes.

This module is intentionally tablet-only. Mobile phones, web browsers, and
unpaired devices keep their existing behavior. Paired tablets are a separate
class of client identified by `tablet_id`.
"""
from __future__ import annotations

import asyncio
import hmac
import json
import secrets
import time
import uuid
from pathlib import Path
from typing import Optional

from core.logger_module import log_error

_FILE = Path(__file__).parent.parent / "user_files" / "dashboard_tablets.json"

# Pairing code TTL — long enough to walk from the laptop to the wall tablet,
# short enough that a leaked code expires before it matters.
_PAIR_CODE_TTL_S = 5 * 60

# Rate limit pairing-code attempts. The code is 6 digits = 1M combinations;
# without a limit, brute-forcing one open code takes seconds at HTTP speed.
_PAIR_ATTEMPT_MAX  = 5
_PAIR_ATTEMPT_WINDOW_S = 60


# In-memory state. Lost on restart — by design.
# _pending: code → { expires_at, created_by, display_name_hint }
# _attempts: ip-or-username → [timestamps]
_pending: dict[str, dict] = {}
_attempts: dict[str, list[float]] = {}


# ---------------------------------------------------------------------------
# Disk storage
# ---------------------------------------------------------------------------

def _load_all() -> dict:
    if not _FILE.exists():
        return {"tablets": {}}
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or "tablets" not in data:
            return {"tablets": {}}
        return data
    except Exception as e:
        log_error(f"[dashboard_tablets] Read failed, starting empty: {e}")
        return {"tablets": {}}


def _save_all(data: dict) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        _FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:
        log_error(f"[dashboard_tablets] Write failed: {e}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _now() -> float:
    return time.time()


def _purge_expired_codes() -> None:
    now = _now()
    dead = [code for code, rec in _pending.items() if rec["expires_at"] < now]
    for code in dead:
        _pending.pop(code, None)


def _purge_attempts(key: str) -> None:
    window_start = _now() - _PAIR_ATTEMPT_WINDOW_S
    _attempts[key] = [t for t in _attempts.get(key, []) if t >= window_start]


def _generate_code() -> str:
    """6-digit numeric, leading zeros preserved."""
    # secrets.randbelow is a cryptographically safe RNG. Tablet pairing isn't
    # high-stakes (TTL + rate limit cap it), but we don't want predictability.
    return f"{secrets.randbelow(10**6):06d}"


def create_pairing_code(created_by: str, display_name_hint: str = "") -> dict:
    """Admin generates a one-shot code for a new tablet.

    Returns { code, expires_at }. The code is shown ONCE in the admin UI;
    losing it means generating a new one (cheap).
    """
    _purge_expired_codes()
    # In the (cosmically unlikely) event of a code collision against another
    # active pending code, regenerate. Bounded retry — at 1M codes vs ~handful
    # of pending, this loop ends on iteration 1.
    for _ in range(8):
        code = _generate_code()
        if code not in _pending:
            break
    else:
        # Pathological — wipe the table and re-issue. Admin can retry pairing.
        _pending.clear()
        code = _generate_code()
    expires_at = _now() + _PAIR_CODE_TTL_S
    _pending[code] = {
        "expires_at":         expires_at,
        "created_by":         created_by,
        "display_name_hint":  display_name_hint or "",
    }
    return {"code": code, "expires_at": expires_at, "ttl_s": _PAIR_CODE_TTL_S}


def _check_rate_limit(client_key: str) -> bool:
    _purge_attempts(client_key)
    if len(_attempts.get(client_key, [])) >= _PAIR_ATTEMPT_MAX:
        return False
    _attempts.setdefault(client_key, []).append(_now())
    return True


async def claim_pairing_code(
    code: str,
    display_name: str,
    room: Optional[str],
    claiming_user: str,
    client_key: str,
) -> dict:
    """Tablet exchanges a 6-digit code for a persistent tablet_id.

    Constant-time code compare against every pending code so a timing oracle
    can't tell which codes are live. Rate-limited per client_key (IP or user).
    """
    if not _check_rate_limit(client_key):
        raise PermissionError("Too many pairing attempts. Wait a minute and try again.")
    _purge_expired_codes()

    submitted = (code or "").strip()
    if not submitted:
        raise ValueError("Pairing code is required.")

    # Constant-time scan across the pending set — never short-circuit.
    matched_code: Optional[str] = None
    for k in list(_pending.keys()):
        if hmac.compare_digest(k, submitted):
            matched_code = k
    if matched_code is None:
        raise ValueError("Invalid or expired pairing code.")

    record = _pending.pop(matched_code)
    name = (display_name or record.get("display_name_hint") or "Hub Tablet").strip()[:80]
    room_slug = (room or "").strip()[:64] or None

    tablet_id = "tab_" + uuid.uuid4().hex[:16]

    data = await asyncio.to_thread(_load_all)
    data["tablets"][tablet_id] = {
        "id":            tablet_id,
        "display_name":  name,
        "room":          room_slug,
        "registered_by": claiming_user,
        "registered_at": _now(),
        "last_seen":     _now(),
    }
    await asyncio.to_thread(_save_all, data)

    return {"tablet_id": tablet_id, "display_name": name, "room": room_slug}


async def touch_tablet(tablet_id: str) -> None:
    """Update last_seen. Silently no-ops if tablet is unknown."""
    if not tablet_id:
        return
    data = await asyncio.to_thread(_load_all)
    rec = data["tablets"].get(tablet_id)
    if not rec:
        return
    rec["last_seen"] = _now()
    await asyncio.to_thread(_save_all, data)


async def list_tablets() -> list[dict]:
    data = await asyncio.to_thread(_load_all)
    return list(data["tablets"].values())


async def get_tablet(tablet_id: str) -> Optional[dict]:
    if not tablet_id:
        return None
    data = await asyncio.to_thread(_load_all)
    return data["tablets"].get(tablet_id)


async def rename_tablet(tablet_id: str, display_name: str, room: Optional[str]) -> Optional[dict]:
    data = await asyncio.to_thread(_load_all)
    rec = data["tablets"].get(tablet_id)
    if not rec:
        return None
    if display_name:
        rec["display_name"] = display_name.strip()[:80]
    if room is not None:
        rec["room"] = (room.strip()[:64] or None)
    await asyncio.to_thread(_save_all, data)
    return rec


async def delete_tablet(tablet_id: str) -> bool:
    data = await asyncio.to_thread(_load_all)
    if tablet_id not in data["tablets"]:
        return False
    del data["tablets"][tablet_id]
    await asyncio.to_thread(_save_all, data)
    return True
