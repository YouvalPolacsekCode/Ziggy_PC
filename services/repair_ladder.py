"""
Repair ladder — try to bring a silent or wedged device back before nagging.

The two proactive sweeps (ANOM-13 "device went silent", ANOM-12 "occupancy
sensor latched") used to push an alert straight away. Now they first climb this
ladder, at most once per entity per 12 h, and the alert reflects what was tried.

Rungs, in order — stop at the first that brings the device back:

  1. nudge        force a real poll (controllables: self_heal.manual_refresh_heal,
                  which also re-asserts intent; sensors: a plain force poll).
                  Gate ``system.refresh_device`` (diagnostics → act).
  2. reinterview  Zigbee2MQTT only: ask Z2M to interview the device again — the
                  known fix for a stalled interview. Gate
                  ``system.reinterview_device`` (connectivity → confirm: acts and
                  notifies).
  3. repair       open pairing so the owner can re-add it. Gate
                  ``system.repair_device`` (pairing → ask). In the background
                  this rung does NOT act: it records ``needs_owner`` and becomes
                  the instruction in the alert / an offer in chat.
  4. physical     battery / wall-switch instruction. Always ``needs_owner``.

Every attempt is a row in ``repair_attempts`` (SQLite, user_files/home_map.db,
same conventions as self_heal). Authorization goes through core.agent.authz.check
which FAILS OPEN when the PDP isn't bootstrapped — these nudges already ran
unattended before the ladder existed. Entitlement ``auto_repair`` gates the whole
ladder (fail-open when the entitlements module is absent).

Nothing here produces user-facing jargon: ``describe_attempts`` says "waking" and
"reconnecting", never "interview", "Zigbee" or an entity id.
"""
from __future__ import annotations

import asyncio
import inspect
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from core.logger_module import log_info, log_error

RUNGS = ("nudge", "reinterview", "repair", "physical")

_RATE_LIMIT_S = 12 * 3600          # one ladder climb per entity per 12 h
_REINTERVIEW_SETTLE_S = 8.0        # Z2M interview round-trip before re-checking
_NUDGE_SETTLE_S = 1.5              # after a sensor force-poll, before re-checking
_BACK_WINDOW_S = 120.0             # "back" = reported within the last 2 minutes

# Outcomes that mean a rung actually did something (vs. was skipped).
_TRIED_OUTCOMES = frozenset({"fixed", "failed", "error", "pairing_opened"})

# ── Persistence (shared DB with self_heal / anomaly_engine / map_router) ──────
_DB = Path("user_files/home_map.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS repair_attempts (
    id        INTEGER PRIMARY KEY,
    entity_id TEXT    NOT NULL,
    rung      TEXT    NOT NULL,
    outcome   TEXT    NOT NULL,
    detail    TEXT,
    trigger   TEXT,
    ts        REAL    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repair_attempts_entity_ts
    ON repair_attempts (entity_id, ts DESC);
"""

_lock = threading.Lock()
_db_ready = False


def _connect():
    conn = sqlite3.connect(_DB)
    try:
        conn.execute("PRAGMA synchronous=NORMAL")
    except Exception:
        pass
    return conn


def _db_init() -> None:
    global _db_ready
    if _db_ready:
        return
    with _lock:
        if _db_ready:
            return
        try:
            _DB.parent.mkdir(parents=True, exist_ok=True)
            conn = _connect()
            try:
                conn.executescript(_SCHEMA)
                conn.commit()
            finally:
                conn.close()
            _db_ready = True
        except Exception as e:
            log_error(f"[RepairLadder] db init failed: {e}")


def record_attempt(entity_id: str, rung: str, outcome: str,
                   detail: str = "", trigger: str = "", ts: float | None = None) -> None:
    """Append one attempt row. Never raises — a history write must not stop a repair."""
    _db_init()
    try:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO repair_attempts (entity_id, rung, outcome, detail, trigger, ts) "
                "VALUES (?,?,?,?,?,?)",
                (entity_id, rung, outcome, detail or "", trigger or "",
                 float(ts if ts is not None else time.time())),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        log_error(f"[RepairLadder] history write failed: {e}")


def history(entity_id: str, limit: int = 10) -> list[dict]:
    """Attempts for one entity, newest first."""
    _db_init()
    try:
        conn = _connect()
        try:
            rows = conn.execute(
                "SELECT id, entity_id, rung, outcome, detail, trigger, ts "
                "FROM repair_attempts WHERE entity_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
                (entity_id, int(limit)),
            ).fetchall()
        finally:
            conn.close()
    except Exception as e:
        log_error(f"[RepairLadder] history read failed: {e}")
        return []
    return [
        {"id": r[0], "entity_id": r[1], "rung": r[2], "outcome": r[3],
         "detail": r[4] or "", "trigger": r[5] or "", "ts": r[6]}
        for r in rows
    ]


def last_attempt_ts(entity_id: str) -> float | None:
    """Timestamp of the most recent attempt on this entity, or None."""
    _db_init()
    try:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT MAX(ts) FROM repair_attempts WHERE entity_id = ?", (entity_id,)
            ).fetchone()
        finally:
            conn.close()
    except Exception as e:
        log_error(f"[RepairLadder] last_attempt_ts failed: {e}")
        return None
    return float(row[0]) if row and row[0] is not None else None


def should_run(entity_id: str, now: float | None = None) -> bool:
    """True when no ladder attempt has been recorded for this entity in the last 12 h."""
    last = last_attempt_ts(entity_id)
    if last is None:
        return True
    now = now if now is not None else time.time()
    return (now - last) >= _RATE_LIMIT_S


# ── Entitlement + authorization gates ─────────────────────────────────────────
def _entitled() -> bool:
    """``auto_repair`` entitlement; allowed when the module is absent or errors."""
    try:
        from services import entitlements  # created by another change; may not exist yet
    except Exception:
        return True
    try:
        return bool(entitlements.has("auto_repair"))
    except Exception:
        return True


def _default_authz_check(action: str) -> tuple[bool, str]:
    """core.agent.authz.check — fails open (no PDP, no policy → allowed)."""
    try:
        from core.agent import authz
        return authz.check(action)
    except Exception as e:
        log_error(f"[RepairLadder] authz unavailable for {action}, failing open: {e}")
        return True, "open"


# ── Reachability re-check ─────────────────────────────────────────────────────
def _parse_ts(ts: Any) -> Optional[float]:
    if not ts or not isinstance(ts, str):
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except Exception:
        return None


def _entry_is_back(entry: dict | None, now: float) -> bool:
    if not entry:
        return False
    if entry.get("state") in ("unavailable", "unknown", "", None):
        return False
    ts = max((t for t in (_parse_ts(entry.get("last_reported")),
                          _parse_ts(entry.get("last_updated")),
                          _parse_ts(entry.get("last_changed"))) if t is not None),
             default=None)
    return ts is not None and (now - ts) <= _BACK_WINDOW_S


async def _is_back(entity_id: str, now: float | None = None) -> bool:
    """Is the device reporting again? Cache first, then one live read.

    The WS state cache only carries ``last_changed`` (moves on a state change),
    so a device that answered a poll with the SAME state looks stale there. When
    the cache can't confirm, ask HA once for the full state, which carries
    ``last_reported`` (moves on ANY report). Tolerates a missing cache/HA.
    """
    now = now if now is not None else time.time()
    try:
        from services.ha_subscriber import state_cache
        if _entry_is_back(state_cache.get(entity_id), now):
            return True
    except Exception:
        pass
    try:
        from services import home_automation as ha
        live = await asyncio.to_thread(ha.get_light_state, entity_id)  # /api/states/{eid}, any domain
        return _entry_is_back(live, now)
    except Exception:
        return False


# ── Default executors (overridable for tests) ─────────────────────────────────
async def _default_nudge_device(entity_id: str) -> dict:
    from services import self_heal
    return await self_heal.manual_refresh_heal(entity_id)


async def _default_nudge_sensor(entity_id: str) -> None:
    from services import self_heal
    await asyncio.to_thread(self_heal._force_poll, entity_id)


async def _default_reinterview(entity_id: str) -> dict:
    from services import ha_zigbee
    return await ha_zigbee.reinterview_entity(entity_id)


async def _default_permit_join(seconds: int = 60) -> dict:
    from services import ha_zigbee
    return await ha_zigbee.start_permit_join(seconds)


def _executors(overrides: dict | None) -> dict[str, Callable]:
    ex: dict[str, Callable] = {
        "nudge_device": _default_nudge_device,
        "nudge_sensor": _default_nudge_sensor,
        "reinterview": _default_reinterview,
        "permit_join": _default_permit_join,
        "is_back": _is_back,
        "sleep": asyncio.sleep,
        "authz_check": _default_authz_check,
    }
    for k, v in (overrides or {}).items():
        if k in ex and v is not None:
            ex[k] = v
    return ex


async def _call(fn: Callable, *args, **kwargs):
    """Call an executor that may be sync or async."""
    res = fn(*args, **kwargs)
    if inspect.isawaitable(res):
        res = await res
    return res


# ── The ladder ────────────────────────────────────────────────────────────────
async def run_ladder(entity_id: str, *, trigger: str, kind: str,
                     executors: dict | None = None, now: float | None = None) -> dict:
    """Climb the rungs for one entity; stop at the first that brings it back.

    ``kind`` ∈ {"device", "sensor"} picks the nudge (refresh-and-heal vs. poll).
    Returns ``{"entity_id", "rungs": [{rung, outcome, detail}], "fixed", "next_step"}``
    where ``next_step`` names the rung the owner must do by hand ("repair" =
    press the pairing button / re-add it, "physical" = battery / wall switch),
    or None when the device came back.
    """
    if kind not in ("device", "sensor"):
        raise ValueError(f"kind must be 'device' or 'sensor', got {kind!r}")
    ex = _executors(executors)
    now = now if now is not None else time.time()
    rungs: list[dict] = []
    result = {"entity_id": entity_id, "rungs": rungs, "fixed": False, "next_step": None}

    def _rec(rung: str, outcome: str, detail: str = "") -> None:
        rungs.append({"rung": rung, "outcome": outcome, "detail": detail})
        record_attempt(entity_id, rung, outcome, detail=detail, trigger=trigger)

    if not _entitled():
        _rec("ladder", "skipped", "not_entitled")
        result["next_step"] = "physical"
        return result

    async def _back() -> bool:
        try:
            return bool(await _call(ex["is_back"], entity_id))
        except Exception as e:
            log_error(f"[RepairLadder] is_back({entity_id}) failed: {e}")
            return False

    # 1. nudge ---------------------------------------------------------------
    may_act, mode = ex["authz_check"]("system.refresh_device")
    if not may_act:
        _rec("nudge", "not_permitted", mode)
    else:
        try:
            if kind == "device":
                res = await _call(ex["nudge_device"], entity_id) or {}
                outcome = str(res.get("outcome", ""))
                # "recovered" = it obeyed a re-assert, so it is talking. "synced"
                # only means "no disagreement with the last intent" — with no
                # intent (or HA unreachable, state None) it says nothing about
                # reachability, so it must be confirmed by a fresh report.
                fixed = outcome == "recovered" or await _back()
                _rec("nudge", "fixed" if fixed else "failed", outcome)
            else:
                await _call(ex["nudge_sensor"], entity_id)
                await _call(ex["sleep"], _NUDGE_SETTLE_S)
                fixed = await _back()
                _rec("nudge", "fixed" if fixed else "failed", "force_poll")
            if fixed:
                result["fixed"] = True
                return result
        except Exception as e:
            log_error(f"[RepairLadder] nudge {entity_id}: {e}")
            _rec("nudge", "error", str(e)[:200])

    # 2. reinterview (Zigbee2MQTT only) --------------------------------------
    may_act, mode = ex["authz_check"]("system.reinterview_device")
    if not may_act:
        _rec("reinterview", "not_permitted", mode)
    else:
        try:
            res = await _call(ex["reinterview"], entity_id) or {}
            if not res.get("ok"):
                reason = str(res.get("reason") or "not_zigbee")
                _rec("reinterview", "skipped", reason)
            else:
                await _call(ex["sleep"], _REINTERVIEW_SETTLE_S)
                fixed = await _back()
                _rec("reinterview", "fixed" if fixed else "failed", str(res.get("ieee") or ""))
                if fixed:
                    result["fixed"] = True
                    return result
        except Exception as e:
            log_error(f"[RepairLadder] reinterview {entity_id}: {e}")
            _rec("reinterview", "error", str(e)[:200])

    # 3. repair (open pairing) — "ask" in the background → hand to the owner ---
    # Only an EXPLICIT policy verdict may open pairing unattended. authz.check
    # fails open ("open") when no PDP is bootstrapped so that remediations which
    # always ran unattended keep running — opening a pairing window from a
    # background sweep was never one of those, so "open" means "needs_owner".
    may_act, mode = ex["authz_check"]("system.repair_device")
    if not may_act or mode == "open":
        _rec("repair", "needs_owner", mode)
        result["next_step"] = "repair"
        return result
    try:
        await _call(ex["permit_join"], 60)
        _rec("repair", "pairing_opened", mode)
    except Exception as e:
        log_error(f"[RepairLadder] permit_join {entity_id}: {e}")
        _rec("repair", "error", str(e)[:200])
    # Pairing being open is still the owner's move (press the button), so the
    # next step stays "repair" even when we opened the window ourselves.
    result["next_step"] = "repair"
    return result


# ── Owner-facing summary ──────────────────────────────────────────────────────
_PHRASES = {
    "en": {"nudge": "waking it", "reinterview": "reconnecting it",
           "repair": "opening it up to re-pair"},
    "he": {"nudge": "להעיר אותו", "reinterview": "לחבר אותו מחדש",
           "repair": "לפתוח אותו לחיבור מחדש"},
}


def _join(parts: list[str], lang: str) -> str:
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    if lang == "he":
        return ", ".join(parts[:-1]) + " ו" + parts[-1]
    return ", ".join(parts[:-1]) + " and " + parts[-1]


def describe_attempts(result: dict, lang: str = "en") -> str:
    """One plain sentence on what was tried, or "" when nothing was.

    "I tried waking it and reconnecting it — no luck." /
    "ניסיתי להעיר אותו ולחבר אותו מחדש — לא הצליח."  No ids, no engine words.
    """
    lang = "he" if str(lang or "").lower().startswith("he") else "en"
    phrases = _PHRASES[lang]
    tried: list[str] = []
    for r in (result or {}).get("rungs") or []:
        if r.get("outcome") in _TRIED_OUTCOMES and r.get("rung") in phrases:
            p = phrases[r["rung"]]
            if p not in tried:
                tried.append(p)
    if not tried:
        return ""
    body = _join(tried, lang)
    fixed = bool((result or {}).get("fixed"))
    if lang == "he":
        return f"ניסיתי {body} — " + ("הוא חזר." if fixed else "לא הצליח.")
    return f"I tried {body} — " + ("it's back." if fixed else "no luck.")


# Initialise persistence lazily on import, as self_heal does.
try:
    _db_init()
except Exception:
    pass
