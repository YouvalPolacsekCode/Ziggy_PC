"""Home modes — the fixed set a household can put the house in.

    sleep     motion won't turn lights on            (ends at the morning time)
    movie     same as sleep, timed                    (3 h default)
    cleaning  "off when empty" rules don't fire       (2 h default)
    guest     "everyone left" doesn't fire            (until turned off)
    vacation  the house looks lived-in in the evening (until turned off)

Why a FIXED set: on 2026-09-18 the chat designer "created" two mode flags
(`kitchen_light_manual_override`, `living_area_motion_lighting_paused`) that
nothing read and nothing wrote — a dead variable dressed up as a feature. A mode
is only real when it is visible, flippable, conditionable and has one defined
effect. Five such modes are designed here; nothing else is creatable by anyone
(not the designer, not the wizard, not a user).

One object, four doors, one truth:
  * state      — file-backed KV (`home_modes` namespace), no in-memory copy;
  * flip       — /api/modes, chat (`set_mode` tool), a button, an automation
                 `set_mode` step, the legacy /api/mode facade;
  * read       — Ziggy's evaluator (`{"type": "mode"}` condition), the agent's
                 context, the Home screen chips, and Home Assistant through the
                 retained MQTT mirror in `services.modes_mqtt`;
  * effect     — enforced in engine code (`blocks_*` guards + recipe conditions),
                 never something a user must remember to wire.

Expiry is lazy on read AND swept by the scheduler minute tick (`expire_due`),
so a read after `until` is honest even before the sweep runs.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import time
from typing import Any, Callable, Optional

from core.debug_bus import bus, BASIC
from core.logger_module import log_error, log_info
from services.local_automation_actions import get_local_state, set_local_state

MODES: tuple[str, ...] = ("sleep", "movie", "cleaning", "guest", "vacation")

# Hours a mode stays on when switched on without an explicit duration.
# None = until turned off (sleep is special-cased to the morning time).
DEFAULT_HOURS: dict[str, Optional[float]] = {
    "sleep": None, "movie": 3.0, "cleaning": 2.0, "guest": None, "vacation": None,
}

_NS = "home_modes"
_DEFAULT_MORNING = "06:30"

_META: dict[str, dict[str, str]] = {
    "sleep": {
        "label_en": "Sleep", "label_he": "שינה",
        "effect_en": "Motion won't turn lights on until morning.",
        "effect_he": "תנועה לא מדליקה אורות עד הבוקר.",
    },
    "movie": {
        "label_en": "Movie", "label_he": "סרט",
        "effect_en": "Motion won't turn lights on for a while.",
        "effect_he": "תנועה לא מדליקה אורות לזמן מה.",
    },
    "cleaning": {
        "label_en": "Cleaning", "label_he": "ניקיון",
        "effect_en": "Lights stay on even when a room looks empty.",
        "effect_he": "האורות לא נכבים גם כשהחדר נראה ריק.",
    },
    "guest": {
        "label_en": "Guests", "label_he": "אורחים",
        "effect_en": "\"Everyone left\" won't run while guests are here.",
        "effect_he": "״כולם יצאו״ לא מופעל כשיש אורחים.",
    },
    "vacation": {
        "label_en": "Vacation", "label_he": "חופשה",
        "effect_en": "The house looks lived-in every evening while you're away.",
        "effect_he": "הבית נראה מאוכלס בכל ערב כשאין אף אחד.",
    },
}


# ── Hooks (module-level so tests and callers can swap them) ──────────────────

def _default_publish(mode: str, on: bool) -> None:
    from services import modes_mqtt
    modes_mqtt.publish_state(mode, on)


def _default_broadcast(payload: dict) -> None:
    """Broadcast on the running loop if there is one; a sync caller with no
    loop (a scheduler thread, a test) simply doesn't broadcast — the state is
    already persisted and the next fetch is correct."""
    try:
        from backend.ws_manager import manager
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    except Exception as e:  # ws_manager import problems in odd contexts
        log_error(f"[modes] broadcast unavailable: {e}")
        return
    loop.create_task(manager.broadcast(payload))


def _apply_side_effect(mode: str, on: bool) -> None:
    """The one engine-side effect a mode owns beyond its conditions.

    vacation → the lived-in simulation (services.fake_occupancy_scheduler),
    built long ago but manual-activation only; a mode is the natural switch.
    The other modes act purely through `blocks_*` guards and recipe conditions.
    """
    if mode != "vacation":
        return
    from services import fake_occupancy_scheduler as fo
    aid = "ziggy_mode_vacation"
    if not on:
        fo.stop(aid)
        return
    room_pool: list[dict] = []
    tv_id = None
    try:
        from services.capability_matcher import detect_capabilities
        from services.automation_templates import _dimmable_lights_by_room, _first_tv_ir_device
        cap_map = detect_capabilities()
        room_pool = _dimmable_lights_by_room(cap_map)
        tv = _first_tv_ir_device()
        tv_id = (tv or {}).get("id")
    except Exception as e:
        log_error(f"[modes] vacation room pool unavailable: {e}")
    if not room_pool:
        log_info("[modes] vacation on but no dimmable light per room — simulation not started")
        return
    fo.start(automation_id=aid, label="Vacation", window_start="19:00", window_end="23:00",
             duration_days=30, room_pool=room_pool, tv_ir_device_id=tv_id)


_publish_hook: Callable[[str, bool], None] = _default_publish
_broadcast_hook: Callable[[dict], None] = _default_broadcast
_side_effect_hook: Callable[[str, bool], None] = _apply_side_effect


# ── Time ─────────────────────────────────────────────────────────────────────

def _morning_hm() -> str:
    try:
        from core.settings_loader import settings
        val = ((settings.get("light_hold") or {}).get("morning")) or _DEFAULT_MORNING
        return str(val)[:5]
    except Exception:
        return _DEFAULT_MORNING


def next_morning_epoch(now: Optional[float] = None) -> float:
    """Epoch of the next `light_hold.morning` (default 06:30) in local time."""
    now_ts = time.time() if now is None else float(now)
    hm = _morning_hm()
    try:
        h, m = int(hm[:2]), int(hm[3:5])
    except Exception:
        h, m = 6, 30
    base = _dt.datetime.fromtimestamp(now_ts)
    candidate = base.replace(hour=h, minute=m, second=0, microsecond=0)
    if candidate.timestamp() <= now_ts:
        candidate = candidate + _dt.timedelta(days=1)
    return candidate.timestamp()


# ── State ────────────────────────────────────────────────────────────────────

def _blank() -> dict:
    return {"on": False, "since": None, "until": None, "by": None}


def _raw(mode: str) -> dict:
    rec = get_local_state(_NS, mode)
    return dict(rec) if isinstance(rec, dict) else _blank()


def _effective(mode: str, now: float) -> dict:
    """The record as it should be READ: an elapsed `until` reads as off."""
    rec = _raw(mode)
    until = rec.get("until")
    if rec.get("on") and until is not None and float(until) <= now:
        return {**rec, "on": False}
    return rec


def _write(mode: str, rec: dict) -> None:
    set_local_state(_NS, mode, rec)


def get(mode: str, now: Optional[float] = None) -> dict:
    if mode not in MODES:
        raise ValueError(f"Unknown mode {mode!r}. Modes: {', '.join(MODES)}")
    return _effective(mode, time.time() if now is None else float(now))


def is_on(mode: str, now: Optional[float] = None) -> bool:
    if mode not in MODES:
        return False
    return bool(_effective(mode, time.time() if now is None else float(now)).get("on"))


def list_modes(now: Optional[float] = None) -> list[dict]:
    now_ts = time.time() if now is None else float(now)
    out: list[dict] = []
    for mode in MODES:
        rec = _effective(mode, now_ts)
        out.append({
            "id": mode,
            "on": bool(rec.get("on")),
            "since": rec.get("since"),
            "until": rec.get("until") if rec.get("on") else None,
            "by": rec.get("by"),
            "default_hours": DEFAULT_HOURS[mode],
            **_META[mode],
        })
    return out


def _after_change(mode: str, on: bool, rec: dict) -> None:
    for name, fn in (("publish", lambda: _publish_hook(mode, on)),
                     ("broadcast", lambda: _broadcast_hook({
                         "type": "mode_changed", "mode": mode, "on": on,
                         "until": rec.get("until"), "by": rec.get("by"),
                         # legacy chip vocabulary (home/night/vacation) for old clients
                         "legacy_mode": legacy_mode(),
                     })),
                     ("side_effect", lambda: _side_effect_hook(mode, on))):
        try:
            fn()
        except Exception as e:
            log_error(f"[modes] {name} hook failed for {mode}={on}: {e}")
    bus.emit("modes", BASIC, "mode_set", mode=mode, on=on, by=rec.get("by"), until=rec.get("until"))


async def set_mode(mode: str, on: bool, *, by: str, hours: Optional[float] = None,
                   now: Optional[float] = None) -> dict:
    """Turn a mode on or off. `hours` overrides the default duration."""
    if mode not in MODES:
        raise ValueError(f"Unknown mode {mode!r}. Modes: {', '.join(MODES)}")
    now_ts = time.time() if now is None else float(now)
    if on:
        if hours is not None:
            until: Optional[float] = now_ts + float(hours) * 3600.0
        elif mode == "sleep":
            until = next_morning_epoch(now_ts)
        elif DEFAULT_HOURS[mode] is not None:
            until = now_ts + float(DEFAULT_HOURS[mode]) * 3600.0
        else:
            until = None
        rec = {"on": True, "since": now_ts, "until": until, "by": by}
    else:
        rec = {"on": False, "since": None, "until": None, "by": by}
    _write(mode, rec)
    _after_change(mode, on, rec)
    log_info(f"[modes] {mode} {'on' if on else 'off'} by {by}"
             + (f" until {_dt.datetime.fromtimestamp(rec['until']).strftime('%H:%M')}" if rec.get("until") else ""))
    return {"id": mode, **rec}


def expire_due(now: Optional[float] = None) -> list[str]:
    """Sweep modes whose `until` passed. Called from the scheduler minute tick."""
    now_ts = time.time() if now is None else float(now)
    expired: list[str] = []
    for mode in MODES:
        raw = _raw(mode)
        until = raw.get("until")
        if raw.get("on") and until is not None and float(until) <= now_ts:
            rec = {"on": False, "since": None, "until": None, "by": "expiry"}
            _write(mode, rec)
            _after_change(mode, False, rec)
            expired.append(mode)
            log_info(f"[modes] {mode} expired")
    return expired


# ── Guards the engines consult ───────────────────────────────────────────────

def blocks_motion_lighting() -> bool:
    return is_on("sleep") or is_on("movie")


def blocks_off_when_empty() -> bool:
    return is_on("cleaning")


def blocks_everyone_left() -> bool:
    return is_on("guest")


def legacy_mode() -> str:
    """The old single-value house mode, derived: night | vacation | home."""
    if is_on("vacation"):
        return "vacation"
    if is_on("sleep"):
        return "night"
    return "home"


def summary_text(lang: str = "en", now: Optional[float] = None) -> str:
    """One line for the assistant's context: 'sleep off · movie ON until 23:40 · …'."""
    parts: list[str] = []
    for m in list_modes(now):
        label = m["label_he"] if lang == "he" else m["id"]
        if m["on"]:
            s = f"{label} ON"
            if m["until"]:
                s += " until " + _dt.datetime.fromtimestamp(m["until"]).strftime("%H:%M")
        else:
            s = f"{label} off"
        parts.append(s)
    return " · ".join(parts)
