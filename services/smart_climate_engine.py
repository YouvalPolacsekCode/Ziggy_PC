"""Smart Climate Control — Ziggy-as-thermostat engine.

Ziggy watches a room's real temperature and switches a device on/off with
hysteresis. **No temperature is ever sent to the device** — the only number that
matters is the room's true reading, so the same loop drives a smart AC, an IR
Tadiran, a fan, or a heater on a smart plug. See
docs/superpowers/specs/2026-07-20-smart-climate-control-thermostat-design.md.

Per room (one instance per room):
  - one temperature reading the user picks (the room's sensor),
  - a cooling edge  — room ≥ on → cooling device on; room ≤ off → off (on > off),
  - a heating edge  — room ≤ on → heating device on; room ≥ off → off (on < off),
    revealed by the wizard's "+ Add heating"; either edge optional.

Manual-respecting via edge-triggered hysteresis (no override tracker needed):
Ziggy acts only on band *crossings* and only toggles from its own last action
state (`last`). So it only turns off what it turned on, and it never fights a
hand-change — it resumes on the next clean crossing. The on/off gap is the
anti-flap deadband.

How it stays applied:
  - on_temperature_changed — the room's sensor reports → evaluate that room now
                             (event-driven; the tick is only a safety net).
  - tick()                 — every ~5 min: evaluate every enabled room.
  - sync_room()            — the ▶ button + apply-on-save: force-evaluate now,
                             ignoring `last`, and re-assert the correct state.
"""
from __future__ import annotations

import json
import os
import threading
import time
from typing import Optional

from core.logger_module import log_info, log_error

_CONFIG_FILE = "user_files/smart_climate_config.json"

# Defaults surfaced to the wizard (cool-first, Israeli 24°C comfort floor).
COOL_DEFAULTS = {"on": 25, "off": 24}   # room ≥25 → cool on; ≤24 → off
HEAT_DEFAULTS = {"on": 19, "off": 20}   # room ≤19 → heat on; ≥20 → off

_ROOM_DEFAULTS = {
    "enabled": True,
    "roomName": "",
    "sensor": "",
    "cooling": None,       # {"device": {...}, "on": 25, "off": 24}
    "heating": None,       # {"device": {...}, "on": 19, "off": 20}
    "last": {"cooling": None, "heating": None},
}

# Serialize load-modify-save so an engine action and an API save don't clobber.
_lock = threading.RLock()


# ── config ─────────────────────────────────────────────────────────────────────

def load_config() -> dict:
    try:
        if os.path.exists(_CONFIG_FILE):
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f) or {}
                if isinstance(cfg.get("rooms"), dict):
                    return cfg
    except Exception as e:
        log_error(f"[SmartClimate] load_config: {e}")
    return {"rooms": {}}


def save_config(cfg: dict) -> dict:
    merged = {"rooms": (cfg or {}).get("rooms") or {}}
    try:
        os.makedirs(os.path.dirname(_CONFIG_FILE), exist_ok=True)
        with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log_error(f"[SmartClimate] save_config: {e}")
    return merged


def _clean_edge(edge: Optional[dict], direction: str) -> Optional[dict]:
    """Validate an edge {device, on, off}. Enforce the deadband direction:
    cooling needs on > off; heating needs on < off. Returns None if unusable."""
    if not isinstance(edge, dict):
        return None
    dev = edge.get("device") or {}
    device = {
        "kind": dev.get("kind"),
        "id":   dev.get("id"),
        "name": dev.get("name", ""),
        "room": dev.get("room", ""),
    }
    if not device["kind"] or not device["id"]:
        return None
    try:
        on_t = float(edge.get("on"))
        off_t = float(edge.get("off"))
    except (TypeError, ValueError):
        d = COOL_DEFAULTS if direction == "cool" else HEAT_DEFAULTS
        on_t, off_t = float(d["on"]), float(d["off"])
    # Keep a real gap so the band can't flap or invert.
    if direction == "cool" and not (on_t > off_t):
        off_t = on_t - 1
    if direction == "heat" and not (on_t < off_t):
        off_t = on_t + 1
    return {"device": device, "on": on_t, "off": off_t}


def save_room(room: str, *, sensor: str, cooling: Optional[dict],
              heating: Optional[dict], enabled: bool = True,
              room_name: Optional[str] = None,
              sensors: Optional[list] = None) -> dict:
    """Create/replace one room's climate config. Carries `last` forward so a
    re-save doesn't forget which state Ziggy already drove the device into.

    `sensors` (optional): when a non-empty list, Ziggy watches the AVERAGE of
    those temperature sensors instead of the single `sensor` (skipping any that
    are offline). The set is captured here at save time — adding a sensor to the
    room later means re-saving to include it."""
    clean_sensors = [s for s in (sensors or []) if isinstance(s, str) and s.startswith("sensor.")]
    with _lock:
        cfg = load_config()
        rooms = cfg.setdefault("rooms", {})
        prev = rooms.get(room) or {}
        rooms[room] = {
            "enabled": bool(enabled),
            "roomName": room_name or prev.get("roomName") or room,
            "sensor": sensor or "",
            "sensors": clean_sensors,          # non-empty → average mode
            "cooling": _clean_edge(cooling, "cool"),
            "heating": _clean_edge(heating, "heat"),
            "last": prev.get("last") or {"cooling": None, "heating": None},
        }
        save_config(cfg)
        return rooms[room]


def set_enabled(room: str, enabled: bool) -> Optional[dict]:
    with _lock:
        cfg = load_config()
        rc = (cfg.get("rooms") or {}).get(room)
        if not rc:
            return None
        rc["enabled"] = bool(enabled)
        save_config(cfg)
        return rc


def delete_room(room: str) -> dict:
    with _lock:
        cfg = load_config()
        rooms = cfg.get("rooms") or {}
        if room in rooms:
            rooms.pop(room)
            save_config(cfg)
    return {"ok": True}


def configured_sensors() -> set[str]:
    """Temperature sensors any enabled room watches — the ha_subscriber filter.
    Includes every sensor of an averaged room so a new reading on any one of
    them re-evaluates the room."""
    out: set[str] = set()
    for rc in (load_config().get("rooms") or {}).values():
        if not rc.get("enabled"):
            continue
        if rc.get("sensor"):
            out.add(rc["sensor"])
        for s in (rc.get("sensors") or []):
            out.add(s)
    return out


# ── hysteresis math (pure, unit-tested) ────────────────────────────────────────

def _desired(temp: float, on_t: float, off_t: float, direction: str) -> Optional[str]:
    """The state the room *wants* right now, or None inside the deadband.
    cooling: hot → on, cold → off.  heating: cold → on, hot → off."""
    if direction == "cool":
        if temp >= on_t:
            return "on"
        if temp <= off_t:
            return "off"
    else:  # heat
        if temp <= on_t:
            return "on"
        if temp >= off_t:
            return "off"
    return None


def decide(temp: Optional[float], edge: Optional[dict], direction: str,
           last: Optional[str], *, force: bool = False) -> Optional[str]:
    """Return "on"/"off" to actuate, or None for no-op.

    Edge-triggered: only fire when the wanted state DIFFERS from our own last
    action (`last`). `force=True` (Sync now) drops that gate and asserts the
    wanted state regardless — but still respects the deadband (None inside it).
    """
    if temp is None or not edge:
        return None
    try:
        on_t = float(edge.get("on"))
        off_t = float(edge.get("off"))
    except (TypeError, ValueError):
        return None
    want = _desired(temp, on_t, off_t, direction)
    if want is None:
        return None
    if not force and want == last:
        return None
    return want


# ── driving the device ("any way it can") ──────────────────────────────────────

def _drive(device: dict, action: str, direction: str) -> bool:
    """Switch a device on/off. NO temperature is ever sent — Ziggy owns the
    cutoff. Dispatch by device kind; best-effort cool/heat mode on turn-on so one
    reversible AC can serve both edges."""
    kind = (device or {}).get("kind")
    eid = (device or {}).get("id")
    if not kind or not eid:
        return False
    try:
        if kind == "climate":
            from services.home_automation import call_service
            from services.manual_overrides import register_ziggy_call
            register_ziggy_call(eid)
            if action == "on":
                mode = "cool" if direction == "cool" else "heat"
                # set_hvac_mode(cool|heat) also powers the unit on; no setpoint.
                call_service("climate", "set_hvac_mode",
                             {"entity_id": eid, "hvac_mode": mode}, origin="smart_climate")
            else:
                call_service("climate", "turn_off", {"entity_id": eid}, origin="smart_climate")
            return True

        if kind == "ir_ac":
            from services.ir_manager import send_ir_command
            if action == "on":
                mode_cmd = "mode_cool" if direction == "cool" else "mode_heat"
                send_ir_command(eid, mode_cmd)     # best-effort mode (may be unlearned)
                time.sleep(0.6)                    # Broadlink breathing gap between frames
                r = send_ir_command(eid, "power_on")
                return bool(r.get("ok"))
            r = send_ir_command(eid, "power_off")
            return bool(r.get("ok"))

        if kind in ("fan", "switch"):
            from services.home_automation import call_service
            from services.manual_overrides import register_ziggy_call
            register_ziggy_call(eid)
            domain = eid.split(".")[0]
            svc = "turn_on" if action == "on" else "turn_off"
            call_service(domain, svc, {"entity_id": eid}, origin="smart_climate")
            return True
    except Exception as e:
        log_error(f"[SmartClimate] drive {eid} {action}: {e}")
    return False


# ── reading the room ───────────────────────────────────────────────────────────

def _read_one(sensor: Optional[str]) -> Optional[float]:
    if not sensor:
        return None
    try:
        from services.ha_subscriber import state_cache
        st = (state_cache or {}).get(sensor) or {}
        v = st.get("state")
        if v in (None, "", "unknown", "unavailable"):
            return None
        return float(v)
    except Exception:
        return None


def room_temp(rc: dict) -> Optional[float]:
    """The room's current temperature per its config: the AVERAGE of `sensors`
    (skipping offline ones) when that list is non-empty, else the single `sensor`."""
    sensors = rc.get("sensors") or []
    if sensors:
        vals = [v for v in (_read_one(s) for s in sensors) if v is not None]
        return round(sum(vals) / len(vals), 2) if vals else None
    return _read_one(rc.get("sensor"))


def _persist_last(room: str, changed: dict) -> None:
    """Record the state Ziggy just drove each edge into (survives restart so we
    don't re-toggle on boot). Re-reads under lock to not clobber a concurrent save."""
    with _lock:
        cfg = load_config()
        rc = (cfg.get("rooms") or {}).get(room)
        if not rc:
            return
        last = rc.setdefault("last", {"cooling": None, "heating": None})
        last.update(changed)
        save_config(cfg)


# ── evaluation ─────────────────────────────────────────────────────────────────

def evaluate_room(room: str, rc: dict, *, force: bool = False) -> dict:
    """Read the room's live sensor, run the hysteresis for each configured edge,
    actuate on a decision (or on force), and persist the new `last`."""
    if not rc or (not rc.get("enabled") and not force):
        return {"ran": False}
    temp = room_temp(rc)
    if temp is None:
        return {"ran": False, "reason": "no_reading"}
    last = rc.get("last") or {}
    changed: dict = {}
    for edge_name, direction in (("cooling", "cool"), ("heating", "heat")):
        edge = rc.get(edge_name)
        if not edge or not edge.get("device"):
            continue
        action = decide(temp, edge, direction, last.get(edge_name), force=force)
        if action:
            if _drive(edge["device"], action, direction):
                changed[edge_name] = action
                log_info(f"[SmartClimate] {room}: {temp}° → {edge_name} {action}")
    if changed:
        _persist_last(room, changed)
    return {"ran": True, "temp": temp, "changed": changed}


def evaluate_all(*, force: bool = False) -> dict:
    cfg = load_config()
    n = 0
    for room, rc in (cfg.get("rooms") or {}).items():
        try:
            if evaluate_room(room, rc, force=force).get("changed"):
                n += 1
        except Exception as e:
            log_error(f"[SmartClimate] evaluate {room}: {e}")
    return {"rooms": len(cfg.get("rooms") or {}), "acted": n}


def on_temperature_changed(entity_id: str, value: Optional[float] = None) -> None:
    """ha_subscriber hook — a watched sensor reported; evaluate its room now."""
    cfg = load_config()
    for room, rc in (cfg.get("rooms") or {}).items():
        if rc.get("enabled") and rc.get("sensor") == entity_id:
            try:
                evaluate_room(room, rc)
            except Exception as e:
                log_error(f"[SmartClimate] on_temp {room}: {e}")


def sync_room(room: str) -> dict:
    """▶ / apply-on-save — force-evaluate now, ignoring `last`."""
    cfg = load_config()
    rc = (cfg.get("rooms") or {}).get(room)
    if not rc:
        return {"ok": False, "reason": "no_room"}
    res = evaluate_room(room, rc, force=True)
    return {"ok": True, **res}


def status() -> dict:
    """For the View modal + card: config + each room's current temp & believed state."""
    cfg = load_config()
    out = {}
    for room, rc in (cfg.get("rooms") or {}).items():
        last = rc.get("last") or {}
        out[room] = {
            **rc,
            "current": {
                "temp": room_temp(rc),
                "cooling_state": last.get("cooling"),
                "heating_state": last.get("heating"),
            },
        }
    return {"rooms": out}


# ── background loop ─────────────────────────────────────────────────────────────

def start_scheduler(interval_s: int = 300) -> None:
    """Safety-net pass every `interval_s` (~5 min). The real responsiveness comes
    from the ha_subscriber hook; this catches missed reports + reasserts state.
    Spawned as a daemon thread from backend/server.py::_startup (prod runs
    uvicorn, not core/ziggy_main). Exits on shutdown_event."""
    from core.shared_flags import shutdown_event
    log_info(f"[SmartClimate] scheduler started (every {interval_s}s)")
    if shutdown_event.wait(30):     # settle so the state cache is populated
        return
    while not shutdown_event.is_set():
        try:
            if (load_config().get("rooms") or {}):
                evaluate_all()
        except Exception as e:
            log_error(f"[SmartClimate] tick failed: {e}")
        if shutdown_event.wait(interval_s):
            break
