"""
Self-Heal — detect and recover devices whose on/off state is unreliable.

Some cheap Zigbee devices report a state that doesn't match physical reality and
intermittently ignore on/off commands (verified on a Tuya TS0505B kitchen bulb,
2026-07-18: reported OFF while physically lit, emitted a spurious OFF ~1s after
every ON, ignored OFF intermittently). Every software layer relayed faithfully —
the device is at fault — but the user just sees "the app is wrong and the light
won't turn off."

This engine watches state changes, correlates them with Ziggy's last intended
command (via services.command_ledger), and when a device repeatedly "reverts"
right after a command it runs an escalating recovery ladder, then tells the user.

Ground-truth caveat: a device that lies even to a direct poll gives us no certain
truth. Detection is therefore heuristic and recovery fails safe — after a bounded
number of attempts it gives up, flags the device, and enters a cooldown. It never
loops (self-heal's own commands are tagged origin='self_heal' and never counted).

Reuses existing plumbing: command_ledger (intent), home_automation (commands +
poll), push_notify + ws_manager (notify), telemetry_client (fleet roll-up),
debug_bus (diagnostic feed), SQLite home_map.db (history + snooze).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

from core.settings_loader import settings
from core.logger_module import log_info, log_error
from core.debug_bus import bus
from services.manual_overrides import CONTROLLABLE_DOMAINS

# ── Persistence (shared DB with anomaly_engine / map_router) ──────────────────
_DB = Path("user_files/home_map.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS self_heal_history (
    id          INTEGER PRIMARY KEY,
    entity_id   TEXT    NOT NULL,
    trigger     TEXT    NOT NULL,
    steps       TEXT    NOT NULL,
    outcome     TEXT    NOT NULL,
    detail      TEXT,
    fired_at    REAL    NOT NULL
);
CREATE TABLE IF NOT EXISTS self_heal_snooze (
    entity_id    TEXT PRIMARY KEY,
    snooze_until REAL NOT NULL
);
"""

# ── Defaults (overridable via settings["self_heal"]) ──────────────────────────
_DEFAULTS = {
    "revert_window_s":    2.0,    # a report this soon after a command = a "revert"
    "mismatch_count":     3,      # ≥ this many reverts in mismatch_window → fire
    "mismatch_window_s":  600,
    "retry_count":        3,      # > this many reverts in retry_window → fire (user fighting it)
    "retry_window_s":     60,
    "cooldown_s":         1800,   # after a give-up, wait before trying again
    "max_jolt_cycles":    2,      # escalation cycles before giving up
    "recover_telemetry_throttle_s": 3600,  # min gap between "recovered" telemetry per device
}

# ── Hot in-memory state ───────────────────────────────────────────────────────
_revert_events: dict[str, list[float]] = {}   # entity_id → [ts, …]
_cooldown: dict[str, float] = {}              # entity_id → until (epoch)
_healing: set[str] = set()                    # entities with recovery in flight
_snooze: dict[str, float] = {}                # entity_id → until (epoch)
_last_recover_telemetry: dict[str, float] = {}
_lock = threading.Lock()
_db_ready = False


# ── Config ────────────────────────────────────────────────────────────────────
def config() -> dict:
    cfg = dict(_DEFAULTS)
    user = settings.get("self_heal") or {}
    for k, v in user.items():
        if k in cfg and isinstance(v, (int, float)):
            cfg[k] = v
    return cfg


def _enabled() -> bool:
    feats = settings.get("features") or {}
    return bool(feats.get("self_heal", True))


# ── SQLite helpers ────────────────────────────────────────────────────────────
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
    try:
        _DB.parent.mkdir(parents=True, exist_ok=True)
        conn = _connect()
        try:
            conn.executescript(_SCHEMA)
            conn.commit()
            rows = conn.execute(
                "SELECT entity_id, snooze_until FROM self_heal_snooze"
            ).fetchall()
            now = time.time()
            with _lock:
                for eid, until in rows:
                    if until > now:
                        _snooze[eid] = until
        finally:
            conn.close()
        _db_ready = True
    except Exception as e:
        log_error(f"[SelfHeal] db init failed: {e}")


def _history_add(entity_id: str, trigger: str, steps: list[str],
                 outcome: str, detail: str = "") -> None:
    _db_init()
    try:
        conn = _connect()
        try:
            conn.execute(
                "INSERT INTO self_heal_history "
                "(entity_id, trigger, steps, outcome, detail, fired_at) "
                "VALUES (?,?,?,?,?,?)",
                (entity_id, trigger, ",".join(steps), outcome, detail, time.time()),
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        log_error(f"[SelfHeal] history write failed: {e}")


def get_log(limit: int = 100) -> list[dict]:
    """Recent self-heal events, newest first — the super-admin diagnostic feed."""
    _db_init()
    try:
        conn = _connect()
        try:
            rows = conn.execute(
                "SELECT entity_id, trigger, steps, outcome, detail, fired_at "
                "FROM self_heal_history ORDER BY fired_at DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        finally:
            conn.close()
    except Exception as e:
        log_error(f"[SelfHeal] get_log failed: {e}")
        return []
    return [
        {
            "entity_id": r[0], "trigger": r[1],
            "steps": r[2].split(",") if r[2] else [],
            "outcome": r[3], "detail": r[4], "fired_at": r[5],
        }
        for r in rows
    ]


# ── Snooze ────────────────────────────────────────────────────────────────────
def snooze(entity_id: str, minutes: int = 720) -> None:
    _db_init()
    until = time.time() + max(1, int(minutes)) * 60
    with _lock:
        _snooze[entity_id] = until
    try:
        conn = _connect()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO self_heal_snooze (entity_id, snooze_until) "
                "VALUES (?,?)", (entity_id, until))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:
        log_error(f"[SelfHeal] snooze write failed: {e}")


def _is_snoozed(entity_id: str) -> bool:
    now = time.time()
    with _lock:
        until = _snooze.get(entity_id)
        if not until:
            return False
        if until < now:
            _snooze.pop(entity_id, None)
            return False
        return True


# ── Detection ─────────────────────────────────────────────────────────────────
def _register_revert(entity_id: str, now: float, window: float) -> None:
    with _lock:
        lst = _revert_events.setdefault(entity_id, [])
        lst.append(now)
        cutoff = now - window
        _revert_events[entity_id] = [t for t in lst if t >= cutoff]


def _evidence_strong(entity_id: str, cfg: dict, now: float) -> Optional[str]:
    """Return a trigger reason if the gates are met, else None."""
    with _lock:
        events = list(_revert_events.get(entity_id, []))
    recent_retry = [t for t in events if t >= now - cfg["retry_window_s"]]
    if len(recent_retry) > cfg["retry_count"]:
        return f"user_retries:{len(recent_retry)} in {cfg['retry_window_s']}s"
    recent_mismatch = [t for t in events if t >= now - cfg["mismatch_window_s"]]
    if len(recent_mismatch) >= cfg["mismatch_count"]:
        return f"sustained_mismatch:{len(recent_mismatch)} in {cfg['mismatch_window_s']}s"
    return None


async def observe(entity_id: str, old_state: dict, new_state: dict,
                  ts: Optional[float] = None) -> None:
    """Feed one state change to the detector. Called from ha_subscriber._process_event.

    Fires an async recovery task when a device repeatedly reverts right after a
    (non-self-heal) command.
    """
    if not _enabled() or not entity_id:
        return
    domain = entity_id.split(".", 1)[0]
    if domain not in CONTROLLABLE_DOMAINS:
        return
    new_s = (new_state or {}).get("state")
    if new_s not in ("on", "off"):
        return

    from services import command_ledger
    last = command_ledger.get_last(entity_id)
    if not last or last["origin"] == "self_heal":
        return  # no recent Ziggy intent, or it's our own recovery command (loop guard)

    cfg = config()
    now = ts or time.time()
    if (now - last["ts"]) > cfg["revert_window_s"]:
        return
    if new_s == last["state"]:
        return  # device matches what we asked for — healthy

    # Revert: device went to the opposite of the intended state within the window.
    _register_revert(entity_id, now, cfg["mismatch_window_s"])
    bus.emit("self_heal", 1, "revert_observed",
             entity_id=entity_id, intended=last["state"], reported=new_s)

    reason = _evidence_strong(entity_id, cfg, now)
    if not reason:
        return
    if _is_snoozed(entity_id):
        return
    with _lock:
        if entity_id in _healing:
            return
        if _cooldown.get(entity_id, 0) > now:
            return
        _healing.add(entity_id)

    bus.emit("self_heal", 1, "recovery_triggered",
             entity_id=entity_id, trigger=reason, intended=last["state"])
    asyncio.create_task(_run_recovery(entity_id, last["state"], reason))


# ── Recovery ──────────────────────────────────────────────────────────────────
def _reassert(entity_id: str, intended: str) -> None:
    from services import home_automation as ha
    domain = entity_id.split(".", 1)[0]
    if domain == "light":
        ha.toggle_light(entity_id, turn_on=(intended == "on"), origin="self_heal")
    else:
        service = "turn_on" if intended == "on" else "turn_off"
        ha.call_service(domain, service, {"entity_id": entity_id}, origin="self_heal")


def _jolt(entity_id: str, intended: str) -> None:
    """Gentle nudge (brief color change) then snap back to intended — the un-stick."""
    from services import home_automation as ha
    if entity_id.startswith("light."):
        try:
            ha.set_light_color(entity_id, color_temp=350)
        except Exception:
            pass
        time.sleep(0.5)
    _reassert(entity_id, intended)


def _current_state(entity_id: str) -> Optional[str]:
    from services import home_automation as ha
    st = ha.get_light_state(entity_id)  # /api/states/{eid} — works for any domain
    return (st or {}).get("state")


def _matches(entity_id: str, intended: str) -> bool:
    return _current_state(entity_id) == intended


async def _run_recovery(entity_id: str, intended: str, trigger: str) -> None:
    cfg = config()
    steps: list[str] = []
    success = False
    try:
        for _cycle in range(int(cfg["max_jolt_cycles"])):
            # 1. re-assert intended state
            await asyncio.to_thread(_reassert, entity_id, intended)
            steps.append("reassert")
            await asyncio.sleep(cfg["revert_window_s"] + 0.5)
            if await asyncio.to_thread(_matches, entity_id, intended):
                success = True
                break
            # 2. force a real device poll (confirm it's genuinely wrong)
            await asyncio.to_thread(_force_poll, entity_id)
            steps.append("force_poll")
            await asyncio.sleep(1.5)
            if await asyncio.to_thread(_matches, entity_id, intended):
                success = True
                break
            # 3. gentle jolt (lights) then re-assert
            await asyncio.to_thread(_jolt, entity_id, intended)
            steps.append("jolt")
            await asyncio.sleep(cfg["revert_window_s"] + 0.5)
            if await asyncio.to_thread(_matches, entity_id, intended):
                success = True
                break

        outcome = "recovered" if success else "failed"
        _history_add(entity_id, trigger, steps, outcome)
        with _lock:
            _revert_events.pop(entity_id, None)
            if not success:
                _cooldown[entity_id] = time.time() + cfg["cooldown_s"]

        bus.emit("self_heal", 1, "recovery_" + outcome,
                 entity_id=entity_id, steps=steps, trigger=trigger)
        await _notify(outcome, entity_id)
        _report_telemetry(entity_id, outcome, len(steps), trigger)
    except Exception as e:
        log_error(f"[SelfHeal] recovery error {entity_id}: {e}")
        _history_add(entity_id, trigger, steps, "error", detail=str(e))
    finally:
        with _lock:
            _healing.discard(entity_id)


def _force_poll(entity_id: str) -> None:
    from services import home_automation as ha
    try:
        ha.force_poll(entity_id)
    except Exception:
        pass


# ── Manual refresh → sync & heal (device refresh button) ──────────────────────
async def manual_refresh_heal(entity_id: str) -> dict:
    """Force a real poll; if the device disagrees with the last intent, heal once.

    Returns {ok, outcome, state}. outcome ∈ {synced, recovered, failed, healing}.
    """
    if not entity_id:
        return {"ok": False, "outcome": "synced", "state": None}
    await asyncio.to_thread(_force_poll, entity_id)
    await asyncio.sleep(0.8)
    state = await asyncio.to_thread(_current_state, entity_id)

    from services import command_ledger
    last = command_ledger.get_last(entity_id)
    intended = last["state"] if (last and last["origin"] != "self_heal") else None

    if not intended or state == intended:
        bus.emit("self_heal", 1, "manual_refresh_synced",
                 entity_id=entity_id, state=state)
        return {"ok": True, "outcome": "synced", "state": state}

    with _lock:
        if entity_id in _healing:
            return {"ok": True, "outcome": "healing", "state": state}
        _healing.add(entity_id)
    try:
        cfg = config()
        steps: list[str] = []
        success = False
        for _cycle in range(int(cfg["max_jolt_cycles"])):
            await asyncio.to_thread(_reassert, entity_id, intended); steps.append("reassert")
            await asyncio.sleep(cfg["revert_window_s"] + 0.5)
            if await asyncio.to_thread(_matches, entity_id, intended):
                success = True; break
            await asyncio.to_thread(_jolt, entity_id, intended); steps.append("jolt")
            await asyncio.sleep(cfg["revert_window_s"] + 0.5)
            if await asyncio.to_thread(_matches, entity_id, intended):
                success = True; break
        outcome = "recovered" if success else "failed"
        _history_add(entity_id, "manual_refresh", steps, outcome)
        state = await asyncio.to_thread(_current_state, entity_id)
        bus.emit("self_heal", 1, "manual_refresh_" + outcome,
                 entity_id=entity_id, steps=steps)
        if not success:
            await _notify("failed", entity_id)
            _report_telemetry(entity_id, "failed", len(steps), "manual_refresh")
        return {"ok": True, "outcome": outcome, "state": state}
    finally:
        with _lock:
            _healing.discard(entity_id)


# ── Notify ────────────────────────────────────────────────────────────────────
def _friendly_name(entity_id: str) -> str:
    from services.ha_subscriber import state_cache
    attrs = (state_cache.get(entity_id) or {}).get("attributes", {})
    return attrs.get("friendly_name") or entity_id.split(".", 1)[-1].replace("_", " ")


async def _notify(outcome: str, entity_id: str) -> None:
    name = _friendly_name(entity_id)
    if outcome == "recovered":
        title = "Device recovered"
        body = f"{name} was unreliable — I nudged it back to the right state."
        wtype = "self_heal_recovered"
    else:
        title = "Device not responding reliably"
        body = f"{name} isn't responding reliably. It may need to be replaced."
        wtype = "self_heal_failed"

    try:
        from services.push_notify import push_notify_fire_and_forget
        push_notify_fire_and_forget(title, body, url="/", category="self_heal")
    except Exception as e:
        log_error(f"[SelfHeal] push failed: {e}")
    try:
        from backend.ws_manager import manager
        await manager.broadcast({"type": wtype, "entity_id": entity_id, "message": body})
    except Exception as e:
        log_error(f"[SelfHeal] broadcast failed: {e}")


# ── Fleet telemetry ───────────────────────────────────────────────────────────
def _anon_id(entity_id: str) -> str:
    home_id = ((settings.get("home") or {}).get("id")) or ""
    return hashlib.sha256(f"{home_id}:{entity_id}".encode()).hexdigest()[:16]


def _device_meta(entity_id: str) -> dict:
    from services.ha_subscriber import state_cache
    attrs = (state_cache.get(entity_id) or {}).get("attributes", {})
    return {
        "model": attrs.get("model") or attrs.get("model_id"),
        "manufacturer": attrs.get("manufacturer"),
    }


def _report_telemetry(entity_id: str, outcome: str, attempts: int, symptom: str) -> None:
    cfg = config()
    now = time.time()
    if outcome == "recovered":
        last = _last_recover_telemetry.get(entity_id, 0)
        if now - last < cfg["recover_telemetry_throttle_s"]:
            return
        _last_recover_telemetry[entity_id] = now

    meta = _device_meta(entity_id)
    payload = {
        "flaky_device": {
            "anon_id": _anon_id(entity_id),
            "domain": entity_id.split(".", 1)[0],
            "model": meta["model"],
            "manufacturer": meta["manufacturer"],
            "symptom": symptom,
            "attempts": attempts,
            "outcome": outcome,
            "ts": now,
        }
    }

    def _send():
        try:
            from services import telemetry_client
            telemetry_client.post_once(extra=payload)
        except Exception as e:
            log_error(f"[SelfHeal] telemetry failed: {e}")

    try:
        threading.Thread(target=_send, daemon=True, name="SelfHealTelemetry").start()
    except Exception:
        pass


# Initialise persistence lazily on import so the snooze table survives restarts.
try:
    _db_init()
except Exception:
    pass
