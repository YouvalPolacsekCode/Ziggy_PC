"""Light hold — Ziggy remembers that you turned a light off yourself.

The couch problem (operator, 2026-09-18): you switch the kitchen light off in
the evening because it's too bright, motion clears, you shift on the sofa, and
the motion rule puts it straight back on. Every "smart" lighting rule has this
failure unless something remembers the manual off. Nothing did — the designer
even minted a `kitchen_light_manual_override` flag that no rule read.

This module is that memory, owned by the engine, not by any one automation.

The rule, agreed with the operator:
  1. A manual OFF holds the light: motion rules won't relight it.
     "Manual" = not issued by one of Ziggy's engines (see manual_overrides'
     engine tier) — wall switch, HA app, app tile, chat and voice all count,
     because a person decided.
  2. A manual ON clears the hold and the strike count. You said so yourself.
  3. The room going EMPTY for `empty_minutes` (30) releases the hold. The next
     entry relights normally.
  4. Second strike: if after that release an engine relit the light and you
     turned it off AGAIN with no manual-on in between, Ziggy concludes
     "off tonight" and holds until the morning time (06:30) — not until the
     room empties.

Where it is enforced: exactly one place — the automation executor's
`call_service` step, for steps marked `respect_hold`. Hold-aware recipes
compile those steps to an HA placeholder event so HA defers them to Ziggy
(ha_automations._action_to_ha / ha_defers_action). One evaluator, no split
brain.

Where it is visible: the light tile ("Held"), the device page (reason +
Release), chat (`explain_missing_action` verdict `light_held`, tool
`release_light_hold`), and /api/light-holds.

Storage: KV namespace `light_holds`, one record per light. A hold until
morning must survive a restart, so this is persisted, unlike the 30-minute
manual_overrides hint.
"""
from __future__ import annotations

import datetime as _dt
import time
from typing import Callable, Optional

from core.debug_bus import bus, BASIC
from core.logger_module import log_error, log_info
from services.local_automation_actions import get_local_state, set_local_state, _load_state

_NS = "light_holds"
HELD = "held"
HELD_UNTIL_MORNING = "held_until_morning"

_DEFAULTS = {"enabled": True, "empty_minutes": 30, "morning": "06:30"}

# How long after an automation fires a turn-on on one of its lights still counts
# as THAT automation, not a person.
#
# Why this exists (found on the operator's own hub, 2026-09-19): a rule whose
# actions Home Assistant executes natively sets neither attribution tier —
# exactly like a wall switch. So an automation relighting a held lamp read as
# "the user turned it back on" and ERASED the hold, which is the one outcome
# the feature exists to prevent. `note_automation_fired` closes that: when an
# automation fires we remember which lights it acts on, and a turn-on inside
# this window is treated as an engine relight (it feeds the second-strike
# memory) instead of clearing the hold.
#
# 20s is generous for an HA call plus a slow Zigbee report. The cost of being
# too generous is small and one-directional: a person flipping a light on
# within 20s of an automation firing keeps their hold instead of clearing it.
_ENGINE_WINDOW_S = 20.0

#: entity_id → epoch until which a turn-on is attributable to an automation.
#: In-memory: a transient hint, exactly like manual_overrides' windows.
_engine_touch: dict[str, float] = {}


# ── Settings ─────────────────────────────────────────────────────────────────

def settings() -> dict:
    try:
        from core.settings_loader import settings as _s
        cfg = dict(_s.get("light_hold") or {})
    except Exception:
        cfg = {}
    out = dict(_DEFAULTS)
    out.update({k: v for k, v in cfg.items() if v is not None})
    try:
        out["empty_minutes"] = max(1, int(out["empty_minutes"]))
    except Exception:
        out["empty_minutes"] = _DEFAULTS["empty_minutes"]
    return out


# ── Injectable lookups (monkeypatched in tests) ──────────────────────────────

def _room_and_occupancy(entity_id: str) -> tuple[Optional[str], Optional[str]]:
    """(room slug, the room's occupancy entity) for a light, best effort.

    Room from the device registry; occupancy from the room's fused sensor
    (smart_room_recipe.resolve_occupancy_entity), else the first raw presence
    or motion sensor the home context lists for that room. (None, None) when
    the light has no room — the hold then releases on time alone.
    """
    room: Optional[str] = None
    try:
        from services import device_registry as _dr
        if not _dr._initialized:
            _dr.init()
        for row in _dr.get_all():
            if row.get("entity_id") == entity_id:
                room = (row.get("room") or None)
                break
    except Exception as e:
        log_error(f"[LightHold] registry lookup failed for {entity_id}: {e}")
    if not room:
        return None, None
    occ: Optional[str] = None
    try:
        from services.smart_room_recipe import resolve_occupancy_entity
        occ = resolve_occupancy_entity({}, room)
    except Exception:
        occ = None
    if not occ:
        try:
            from services.home_context import load_home_context
            from services.room_alias_bank import resolve_room
            target = resolve_room(room.lower())
            for r in (load_home_context("en").get("rooms") or []):
                if resolve_room(str(r.get("id", "")).lower()) != target:
                    continue
                ents = r.get("entities") or {}
                for bucket in ("presence", "occupancy", "motion"):
                    for e in ents.get(bucket) or []:
                        if e.get("entity_id"):
                            occ = e["entity_id"]
                            break
                    if occ:
                        break
                break
        except Exception as e:
            log_error(f"[LightHold] home context lookup failed for {room}: {e}")
    return room, occ


def _occupancy_off_since(occ_entity: str) -> Optional[float]:
    """Epoch since which the room's occupancy entity has read `off`, or None
    when it is on / unknown / not cached."""
    try:
        from services.ha_subscriber import state_cache
        rec = state_cache.get(occ_entity) or {}
        if rec.get("state") != "off":
            return None
        lc = rec.get("last_changed") or ""
        if not lc:
            return None
        return _dt.datetime.fromisoformat(lc.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def _next_morning(now: float) -> float:
    from services.modes import next_morning_epoch
    return next_morning_epoch(now)


def _default_broadcast(payload: dict) -> None:
    try:
        import asyncio
        from backend.ws_manager import manager
        loop = asyncio.get_running_loop()
    except Exception:
        return
    loop.create_task(manager.broadcast(payload))


_broadcast_hook: Callable[[dict], None] = _default_broadcast


# ── State ────────────────────────────────────────────────────────────────────

def _get_raw(entity_id: str) -> Optional[dict]:
    rec = get_local_state(_NS, entity_id)
    return dict(rec) if isinstance(rec, dict) else None


def _put(entity_id: str, rec: Optional[dict]) -> None:
    # set_local_state can't delete; store None to drop (list_active skips it).
    set_local_state(_NS, entity_id, rec)


def _emit(event: str, entity_id: str, rec: Optional[dict], **extra) -> None:
    state = (rec or {}).get("state")
    payload = {"type": "light_hold_changed", "entity_id": entity_id,
               "state": state, "until": (rec or {}).get("until"),
               "room": (rec or {}).get("room")}
    try:
        _broadcast_hook(payload)
    except Exception as e:
        log_error(f"[LightHold] broadcast failed: {e}")
    bus.emit("light_hold", BASIC, event, entity_id=entity_id, state=state, **extra)


def _fmt(ts: Optional[float]) -> str:
    return _dt.datetime.fromtimestamp(ts).strftime("%H:%M") if ts else ""


def get(entity_id: str) -> Optional[dict]:
    """The stored record (held or released-with-memory), or None."""
    rec = _get_raw(entity_id)
    return rec or None


def is_held(entity_id: str, now: Optional[float] = None) -> bool:
    rec = _get_raw(entity_id)
    if not rec or rec.get("state") not in (HELD, HELD_UNTIL_MORNING):
        return False
    if rec.get("state") == HELD_UNTIL_MORNING and rec.get("until"):
        return float(rec["until"]) > (time.time() if now is None else float(now))
    return True


def list_active(now: Optional[float] = None) -> list[dict]:
    now_ts = time.time() if now is None else float(now)
    out: list[dict] = []
    ns = (_load_state().get(_NS) or {})
    for eid, rec in ns.items():
        if not isinstance(rec, dict):
            continue
        if rec.get("state") not in (HELD, HELD_UNTIL_MORNING):
            continue
        if rec.get("state") == HELD_UNTIL_MORNING and rec.get("until") and float(rec["until"]) <= now_ts:
            continue
        out.append({"entity_id": eid, **rec, "until_text": _fmt(rec.get("until"))})
    out.sort(key=lambda r: r.get("since") or 0, reverse=True)
    return out


# ── Transitions ──────────────────────────────────────────────────────────────

def on_manual_off(entity_id: str, *, now: Optional[float] = None) -> dict:
    """A person turned this light off. Hold it — or, on a second strike, hold
    it until morning."""
    cfg = settings()
    if not cfg.get("enabled", True):
        return {}
    now_ts = time.time() if now is None else float(now)
    prev = _get_raw(entity_id) or {}
    room, occ = _room_and_occupancy(entity_id)
    second_strike = (prev.get("last_release") == "empty"
                     and bool(prev.get("engine_on_since_release")))
    if second_strike:
        until = _next_morning(now_ts)
        rec = {"state": HELD_UNTIL_MORNING, "since": now_ts, "until": until,
               "room": room, "occupancy_entity": occ, "strikes": 2,
               "last_release": None, "engine_on_since_release": False}
        log_info(f"[LightHold] {entity_id} turned off by hand again → held until {_fmt(until)}")
    else:
        rec = {"state": HELD, "since": now_ts, "until": None,
               "room": room, "occupancy_entity": occ, "strikes": 1,
               "last_release": None, "engine_on_since_release": False}
        log_info(f"[LightHold] {entity_id} turned off by hand → held (room={room}, occ={occ})")
    _put(entity_id, rec)
    _emit("hold_started", entity_id, rec, strikes=rec["strikes"])
    return rec


def on_manual_on(entity_id: str, *, now: Optional[float] = None) -> None:
    """A person turned it on themselves: the hold and its memory are gone."""
    if _get_raw(entity_id) is None:
        return
    _put(entity_id, None)
    log_info(f"[LightHold] {entity_id} turned on by hand → hold cleared")
    _emit("hold_cleared_manual_on", entity_id, None)


def on_engine_on(entity_id: str, *, now: Optional[float] = None) -> None:
    """One of Ziggy's engines turned it on. Feeds the second-strike memory; a
    relight of a HELD light is a recipe that bypassed the gate — log it."""
    rec = _get_raw(entity_id)
    if not rec:
        return
    if rec.get("state") in (HELD, HELD_UNTIL_MORNING) and is_held(entity_id, now):
        log_error(f"[LightHold] {entity_id} relit by an engine while held — a rule bypassed the hold gate")
        bus.emit("light_hold", BASIC, "hold_violated", entity_id=entity_id)
        return
    if rec.get("last_release") == "empty" and not rec.get("engine_on_since_release"):
        rec["engine_on_since_release"] = True
        _put(entity_id, rec)


def note_engine_activity(entity_ids, *, now: Optional[float] = None) -> None:
    """Remember that an ENGINE is about to act on these lights, so the resulting
    turn-on is not mistaken for a person's."""
    ids = entity_ids if isinstance(entity_ids, (list, tuple, set)) else [entity_ids]
    until = (time.time() if now is None else float(now)) + _ENGINE_WINDOW_S
    for eid in ids:
        if isinstance(eid, str) and eid.startswith("light."):
            _engine_touch[eid] = until


def _engine_recent(entity_id: str, now: Optional[float] = None) -> bool:
    exp = _engine_touch.get(entity_id)
    if not exp:
        return False
    if exp < (time.time() if now is None else float(now)):
        _engine_touch.pop(entity_id, None)
        return False
    return True


def lights_an_automation_turns_on(automation_id: str) -> list[str]:
    """The lights an automation switches ON, from its stored Ziggy steps.

    Covers every Ziggy-created automation (recipes, Library bundles, the
    wizard) because they all persist their steps. A hand-written Home
    Assistant automation has no stored steps and returns [] — its relight
    still reads as manual, which is the honest answer when we cannot tell.
    """
    try:
        from services.local_automation_actions import get_all_saved_actions
        steps = get_all_saved_actions(automation_id) or []
    except Exception as e:
        log_error(f"[LightHold] could not read steps for {automation_id}: {e}")
        return []
    out: list[str] = []
    for s in steps:
        if not isinstance(s, dict) or s.get("type") not in ("call_service", "device"):
            continue
        eid = s.get("entity_id")
        if not isinstance(eid, str) or not eid.startswith("light."):
            continue
        svc = f"{s.get('service', '')}{s.get('service_value', '')}{s.get('ha_service', '')}{s.get('action', '')}"
        if "turn_on" in svc and eid not in out:
            out.append(eid)
    return out


def note_automation_fired(automation_entity_id: str, attrs: Optional[dict] = None,
                          *, now: Optional[float] = None) -> list[str]:
    """Called by ha_subscriber the moment an automation's last_triggered moves.
    Marks the lights it turns on, so their relight is attributed to it."""
    aid = ((attrs or {}).get("id")
           or automation_entity_id[len("automation."):] if automation_entity_id.startswith("automation.")
           else automation_entity_id)
    lights = lights_an_automation_turns_on(aid)
    if lights:
        note_engine_activity(lights, now=now)
    return lights


def on_state_change(entity_id: str, prev_s: str, new_s: str, *, engine_initiated: bool,
                    now: Optional[float] = None) -> None:
    """Single entry point for ha_subscriber. Lights only."""
    if not entity_id.startswith("light."):
        return
    if prev_s == "on" and new_s == "off":
        if not engine_initiated:
            on_manual_off(entity_id, now=now)
    elif prev_s == "off" and new_s == "on":
        # `engine_initiated` only catches a call Ziggy's executor made itself.
        # An automation Home Assistant ran natively sets nothing — so also ask
        # whether an automation that acts on this light just fired.
        if engine_initiated or _engine_recent(entity_id, now):
            on_engine_on(entity_id, now=now)
        else:
            on_manual_on(entity_id, now=now)


def release(entity_id: str, *, by: str, now: Optional[float] = None) -> bool:
    """Explicit release (tile button, chat). Drops the memory too — a person
    asked for normal behaviour back."""
    if not is_held(entity_id, now):
        return False
    _put(entity_id, None)
    log_info(f"[LightHold] {entity_id} released by {by}")
    _emit("hold_released", entity_id, None, by=by)
    return True


def _release_by_empty(entity_id: str, rec: dict, now_ts: float) -> None:
    kept = {**rec, "state": None, "until": None, "released_at": now_ts,
            "last_release": "empty", "engine_on_since_release": False}
    _put(entity_id, kept)
    log_info(f"[LightHold] {entity_id} released — room empty for {settings()['empty_minutes']} min")
    _emit("hold_released", entity_id, kept, by="empty")


def tick(now: Optional[float] = None) -> list[str]:
    """Scheduler minute tick: release holds whose condition has passed."""
    now_ts = time.time() if now is None else float(now)
    cfg = settings()
    empty_s = int(cfg["empty_minutes"]) * 60
    released: list[str] = []
    ns = dict(_load_state().get(_NS) or {})
    for eid, rec in ns.items():
        if not isinstance(rec, dict):
            continue
        state = rec.get("state")
        if state == HELD_UNTIL_MORNING:
            if rec.get("until") and float(rec["until"]) <= now_ts:
                _put(eid, None)
                log_info(f"[LightHold] {eid} released — morning")
                _emit("hold_released", eid, None, by="morning")
                released.append(eid)
            continue
        if state != HELD:
            continue
        occ = rec.get("occupancy_entity")
        if occ:
            off_since = _occupancy_off_since(occ)
            if off_since is not None and now_ts - off_since >= empty_s:
                _release_by_empty(eid, rec, now_ts)
                released.append(eid)
        else:
            # No room evidence either way: don't hold forever.
            if now_ts - float(rec.get("since") or now_ts) >= empty_s:
                _release_by_empty(eid, rec, now_ts)
                released.append(eid)
    return released
