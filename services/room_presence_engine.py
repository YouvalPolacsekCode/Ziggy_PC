"""Door-aware room presence engine — bathroom-grade occupancy.

The Smart Presence entity (template_sensors) is a plain OR of its sources,
which is wrong for door-sensor rooms: door open reads occupied forever, and a
CLOSED door with a still person inside reads empty → lights off mid-shower.
This engine backs door-aware presence entities with a real state machine:

  - Door opens                          → occupied immediately.
  - Motion sustains it, open or closed.
  - Door closed + motion seen AFTER the close → LATCHED occupied until the
    door opens again (no timer while latched — nobody showers into darkness).
  - Door closed + no motion within the walk-out grace → clear (you left and
    shut the door behind you). The latch arms on a fresh motion edge after the
    close, or on motion/mmWave still held when the grace expires — never on
    motion that merely lingered from before the close, which is what makes
    walk-out-and-close release correctly.
  - Door open + quiet for the clear delay → clear.
  - Door-only room (no motion sources): open → occupied, close → grace → clear.

The result publishes over MQTT discovery as a normal HA binary_sensor
(device_class occupancy), so every existing consumer — Smart Room, the
"someone is in a room" trigger, the Devices-page smart-sensor card — sees it
as just another presence entity. An MQTT last-will flips the entity to
`unavailable` if Ziggy dies, so it never freezes on a stale "occupied".

Strictly additive: rooms enroll only when a presence entity is created with a
door among its sources (template_sensors._create_door_aware). OR-template
sensors are untouched. Engine thread starts from backend/server.py::_startup
(prod runs uvicorn, not core/ziggy_main) and idles until a room enrolls.

See docs/superpowers/specs/2026-07-26-door-aware-presence-design.md.
"""
from __future__ import annotations

import json
import threading
import time
from collections import deque
from typing import Any, Optional

from core.logger_module import log_error, log_info

_DISCOVERY_PREFIX = "homeassistant"
AVAILABILITY_TOPIC = "ziggy/presence/availability"

DEFAULT_CLEAR_DELAY_S = 30
DEFAULT_WALKOUT_GRACE_S = 120

# device_class values that mean "this is a door/opening", per HA.
DOOR_CLASSES = {"door", "opening", "garage_door", "window"}


def state_topic(room_slug: str) -> str:
    return f"ziggy/presence/{room_slug}/state"


def config_topic(room_slug: str) -> str:
    return f"{_DISCOVERY_PREFIX}/binary_sensor/ziggy_presence_{room_slug}/config"


def unique_id(room_slug: str) -> str:
    return f"ziggy_presence_{room_slug}"


def _is_on(state: Any) -> bool:
    return str(state).lower() == "on"


# ───────────────────────────── state machine ─────────────────────────────────

class RoomStateMachine:
    """Pure door+motion occupancy logic. No I/O, injectable clock — feed it
    event sequences in tests.

    `on_sensor` / `on_tick` return the new occupied bool when it CHANGED,
    else None. `next_deadline()` is a monotonic timestamp for the pending
    timer (walk-out grace or open-quiet clear), or None.
    """

    def __init__(self, room_slug: str, doors: list[str], motions: list[str],
                 clear_delay_s: int = DEFAULT_CLEAR_DELAY_S,
                 walkout_grace_s: int = DEFAULT_WALKOUT_GRACE_S):
        self.room_slug = room_slug
        self.doors = list(doors)
        self.motions = list(motions)
        self.clear_delay_s = max(0, int(clear_delay_s))
        self.walkout_grace_s = max(0, int(walkout_grace_s))
        self.occupied = False
        self.latched = False
        self._door_open = False
        self._states: dict[str, bool] = {}
        self._pending: Optional[str] = None   # "walkout" | "open_clear"
        self._deadline: Optional[float] = None

    # -- helpers ------------------------------------------------------------
    def _any_motion(self) -> bool:
        return any(self._states.get(m, False) for m in self.motions)

    def _clear_pending(self) -> None:
        self._pending = None
        self._deadline = None

    def _start(self, kind: str, deadline: float) -> None:
        self._pending = kind
        self._deadline = deadline

    def next_deadline(self) -> Optional[float]:
        return self._deadline

    def watches(self) -> set[str]:
        return set(self.doors) | set(self.motions)

    # -- lifecycle ----------------------------------------------------------
    def init_from_states(self, states: dict[str, Any], now: float) -> bool:
        """Recover a sane state after (re)start. Conservative: a perfectly
        still person behind a closed door across a restart loses the latch —
        self-heals on any motion/door event."""
        for eid in self.watches():
            self._states[eid] = _is_on(states.get(eid, "off"))
        self._door_open = any(self._states.get(d, False) for d in self.doors)
        motion_on = self._any_motion()
        self.latched = False
        self._clear_pending()
        if self._door_open:
            self.occupied = motion_on or not self.motions
            if self.motions and not motion_on:
                # occupied=False already; no timer needed.
                pass
        else:
            self.occupied = motion_on
            self.latched = motion_on
        return self.occupied

    # -- events -------------------------------------------------------------
    def on_sensor(self, entity_id: str, new_state: Any, now: float) -> Optional[bool]:
        cur = _is_on(new_state)
        if self._states.get(entity_id) == cur:
            return None
        self._states[entity_id] = cur
        prev_occupied = self.occupied

        if entity_id in self.doors:
            door_open_now = any(self._states.get(d, False) for d in self.doors)
            if door_open_now != self._door_open:
                self._door_open = door_open_now
                self.latched = False
                self._clear_pending()
                # Touching a door is presence evidence either way.
                self.occupied = True
                if door_open_now:
                    if self.motions and not self._any_motion():
                        self._start("open_clear", now + self.clear_delay_s)
                else:
                    self._start("walkout", now + self.walkout_grace_s)

        elif entity_id in self.motions:
            if cur:
                self.occupied = True
                self._clear_pending()
                if not self._door_open:
                    # Fresh motion edge behind a closed door = someone inside.
                    self.latched = True
            else:
                if not self._any_motion() and self._door_open:
                    self._start("open_clear", now + self.clear_delay_s)
                # Door closed: either latched (holds) or the walk-out grace is
                # already running — nothing to do on quiet.

        return self.occupied if self.occupied != prev_occupied else None

    def on_tick(self, now: float) -> Optional[bool]:
        if self._deadline is None or now < self._deadline:
            return None
        kind = self._pending
        self._clear_pending()
        prev_occupied = self.occupied
        if kind == "walkout":
            if self._any_motion():
                # mmWave hold / motion lingering because someone IS inside.
                self.latched = True
            else:
                self.occupied = False
                self.latched = False
        elif kind == "open_clear":
            if self._any_motion():
                pass  # motion re-appeared without an edge we saw; keep occupied
            else:
                self.occupied = False
        return self.occupied if self.occupied != prev_occupied else None


# ───────────────────────────── engine runtime ────────────────────────────────

_lock = threading.RLock()
_cond = threading.Condition(_lock)
_rooms: dict[str, RoomStateMachine] = {}
_watched: frozenset[str] = frozenset()
_events: deque = deque()
_thread: Optional[threading.Thread] = None
_client = None                       # paho persistent client
_connected = threading.Event()


def watched_entities() -> frozenset[str]:
    """Cheap early-out set for the ha_subscriber hook (atomic swap, no lock)."""
    return _watched


def _rebuild_watched() -> None:
    global _watched
    s: set[str] = set()
    for m in _rooms.values():
        s |= m.watches()
    _watched = frozenset(s)


def on_sensor_event(entity_id: str, new_state: str) -> None:
    """Called from ha_subscriber on a watched binary_sensor change."""
    with _cond:
        _events.append((entity_id, str(new_state)))
        _cond.notify()


# -- MQTT -------------------------------------------------------------------

def _make_client():
    from paho.mqtt import client as mqtt
    from services.mqtt_client import _broker_url, _parse_broker, _settings_credentials
    host, port, tls, user, pw = _parse_broker(_broker_url())
    if user is None:
        fb_user, fb_pw = _settings_credentials()
        if fb_user is not None:
            user, pw = fb_user, (pw if pw is not None else fb_pw)
    c = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                    client_id="ziggy-room-presence")
    if user is not None:
        c.username_pw_set(user, pw or "")
    if tls:
        c.tls_set()
    c.will_set(AVAILABILITY_TOPIC, b"offline", qos=1, retain=True)

    def _on_connect(_c, _u, _flags, reason_code, _props):
        is_fail = getattr(reason_code, "is_failure", None)
        if is_fail is True or (is_fail is None and int(reason_code) != 0):
            log_error(f"[RoomPresence] MQTT connect refused: {reason_code}")
            return
        _connected.set()
        log_info("[RoomPresence] MQTT connected")
        # Re-assert everything on every (re)connect: broker restarts drop
        # nothing (topics are retained) but a wiped broker gets rebuilt.
        try:
            _c.publish(AVAILABILITY_TOPIC, b"online", qos=1, retain=True)
            with _lock:
                machines = list(_rooms.items())
            for slug, m in machines:
                _c.publish(config_topic(slug), _discovery_payload(slug, m._name if hasattr(m, "_name") else slug),
                           qos=1, retain=True)
                _c.publish(state_topic(slug), b"ON" if m.occupied else b"OFF", qos=1, retain=True)
        except Exception as e:
            log_error(f"[RoomPresence] reconnect republish failed: {e}")

    def _on_disconnect(_c, _u, _flags, reason_code, _props):
        _connected.clear()
        log_info(f"[RoomPresence] MQTT disconnected ({reason_code}); auto-reconnecting")

    c.on_connect = _on_connect
    c.on_disconnect = _on_disconnect
    c.connect_async(host, port, keepalive=30)
    c.loop_start()
    return c


def _ensure_client(timeout: float = 8.0) -> bool:
    """Start (or reuse) the persistent MQTT client; True once connected."""
    global _client
    with _lock:
        if _client is None:
            try:
                _client = _make_client()
            except Exception as e:
                log_error(f"[RoomPresence] MQTT client start failed: {e}")
                _client = None
                return False
    return _connected.wait(timeout)


def _discovery_payload(room_slug: str, friendly_name: str) -> bytes:
    return json.dumps({
        "name": friendly_name,
        "unique_id": unique_id(room_slug),
        "state_topic": state_topic(room_slug),
        "payload_on": "ON",
        "payload_off": "OFF",
        "device_class": "occupancy",
        "availability_topic": AVAILABILITY_TOPIC,
        "device": {
            "identifiers": [unique_id(room_slug)],
            "name": friendly_name,
            "manufacturer": "Ziggy",
            "model": "Smart presence",
        },
    }, separators=(",", ":")).encode("utf-8")


def _publish(topic: str, payload: bytes, timeout: float = 5.0) -> bool:
    if not _ensure_client():
        return False
    try:
        info = _client.publish(topic, payload, qos=1, retain=True)
        info.wait_for_publish(timeout=timeout)
        return info.is_published()
    except Exception as e:
        log_error(f"[RoomPresence] publish {topic} failed: {e}")
        return False


def _publish_state(slug: str, occupied: bool) -> None:
    if not _publish(state_topic(slug), b"ON" if occupied else b"OFF"):
        log_error(f"[RoomPresence] state publish failed room={slug}")


# -- sensor state access ------------------------------------------------------

def _current_states(entity_ids: set[str]) -> dict[str, str]:
    """Best-effort current states, preferring the live subscriber cache."""
    out: dict[str, str] = {}
    try:
        from services.ha_subscriber import state_cache
        for eid in entity_ids:
            rec = state_cache.get(eid)
            if rec:
                out[eid] = rec.get("state", "off")
    except Exception:
        pass
    missing = entity_ids - set(out)
    if missing:
        try:
            from services.home_automation import get_all_states
            for s in get_all_states() or []:
                eid = s.get("entity_id")
                if eid in missing:
                    out[eid] = s.get("state", "off")
        except Exception as e:
            log_error(f"[RoomPresence] state fallback fetch failed: {e}")
    return out


# -- enrollment ---------------------------------------------------------------

def _machine_from_record(rec: dict) -> RoomStateMachine:
    m = RoomStateMachine(
        room_slug=rec["room"],
        doors=rec.get("doors") or [],
        motions=rec.get("motions") or [],
        clear_delay_s=rec.get("delay_off_seconds") or DEFAULT_CLEAR_DELAY_S,
        walkout_grace_s=rec.get("walkout_grace_seconds") or DEFAULT_WALKOUT_GRACE_S,
    )
    m._name = rec.get("name") or rec["room"].replace("_", " ").title()  # for discovery republish
    return m


def enroll_room(rec: dict, timeout: float = 8.0) -> dict:
    """Enroll a door-aware room: publish MQTT discovery + initial state and
    start tracking. rec: {room, name, doors, motions, delay_off_seconds,
    walkout_grace_seconds}. Fails honestly — no half-enrollment left behind."""
    slug = rec.get("room") or ""
    if not slug or not rec.get("doors"):
        return {"ok": False, "error": "room and at least one door sensor are required"}

    m = _machine_from_record(rec)
    m.init_from_states(_current_states(m.watches()), time.monotonic())

    if not _publish(config_topic(slug), _discovery_payload(slug, m._name), timeout=timeout):
        return {"ok": False, "error": "mqtt_unreachable"}
    _publish(AVAILABILITY_TOPIC, b"online")
    if not _publish(state_topic(slug), b"ON" if m.occupied else b"OFF", timeout=timeout):
        # Clear the retained config so HA doesn't keep a dead entity.
        _publish(config_topic(slug), b"")
        return {"ok": False, "error": "mqtt_unreachable"}

    with _cond:
        _rooms[slug] = m
        _rebuild_watched()
        _cond.notify()
    log_info(f"[RoomPresence] enrolled room={slug} doors={len(m.doors)} "
             f"motions={len(m.motions)} occupied={m.occupied}")
    return {"ok": True, "occupied": m.occupied}


def unenroll_room(room_slug: str, clear_retained: bool = True) -> dict:
    """Stop tracking a room; optionally clear its retained MQTT topics (which
    removes the discovered entity from HA)."""
    with _cond:
        existed = _rooms.pop(room_slug, None) is not None
        _rebuild_watched()
    if clear_retained:
        ok_cfg = _publish(config_topic(room_slug), b"")
        _publish(state_topic(room_slug), b"")
        if not ok_cfg:
            return {"ok": False, "error": "mqtt_unreachable",
                    "message": "could not clear the retained discovery config"}
    log_info(f"[RoomPresence] unenrolled room={room_slug} (was tracked: {existed})")
    return {"ok": True}


def lookup_mqtt_entity_id(uid: str, attempts: int = 6, delay: float = 0.5) -> Optional[str]:
    """Resolve the ACTUAL entity_id HA assigned to our MQTT-discovered sensor
    (by unique_id, platform mqtt). HA processes discovery asynchronously, so
    retry briefly. None on persistent failure."""
    try:
        from services.ha_ws import ha_ws_command
    except ImportError:
        return None
    for attempt in range(attempts):
        if attempt:
            time.sleep(delay)
        resp = ha_ws_command({"type": "config/entity_registry/list"}, timeout=5.0)
        if not resp.get("ok"):
            continue
        for e in resp.get("result") or []:
            if (isinstance(e, dict) and e.get("platform") == "mqtt"
                    and e.get("unique_id") == uid and e.get("entity_id")):
                return e["entity_id"]
    return None


# -- engine loop --------------------------------------------------------------

def _load_enrolled_from_kv() -> list[dict]:
    try:
        from services.local_automation_actions import _load_state
        from services.template_sensors import _KV_NAMESPACE
        state = _load_state()
        rooms = (state.get(_KV_NAMESPACE) or {}) if isinstance(state, dict) else {}
        out = []
        for slug, meta in rooms.items():
            if isinstance(meta, dict) and meta.get("mode") == "door_aware":
                out.append({**meta, "room": slug})
        return out
    except Exception as e:
        log_error(f"[RoomPresence] KV load failed: {e}")
        return []


def start_engine() -> None:
    """Blocking loop — spawn as a daemon thread from server startup. Idles
    (no MQTT connection) until at least one room is enrolled."""
    global _thread
    _thread = threading.current_thread()
    from core.shared_flags import shutdown_event

    # Settle so ha_subscriber's cache has real states before recovery.
    if shutdown_event.wait(20):
        return

    records = _load_enrolled_from_kv()
    for rec in records:
        try:
            res = enroll_room(rec)
            if not res.get("ok"):
                log_error(f"[RoomPresence] startup enroll failed room={rec.get('room')}: {res.get('error')}")
        except Exception as e:
            log_error(f"[RoomPresence] startup enroll crashed room={rec.get('room')}: {e}")
    log_info(f"[RoomPresence] engine started ({len(records)} door-aware room(s))")

    while not shutdown_event.is_set():
        publishes: list[tuple[str, bool]] = []
        with _cond:
            now = time.monotonic()
            deadlines = [m.next_deadline() for m in _rooms.values() if m.next_deadline() is not None]
            timeout = 30.0
            if _events:
                timeout = 0.0
            elif deadlines:
                timeout = max(0.0, min(deadlines) - now)
            if timeout > 0:
                _cond.wait(min(timeout, 30.0))
            now = time.monotonic()
            drained = []
            while _events:
                drained.append(_events.popleft())
            for eid, new_state in drained:
                for slug, m in _rooms.items():
                    if eid in m.watches():
                        changed = m.on_sensor(eid, new_state, now)
                        if changed is not None:
                            publishes.append((slug, changed))
            for slug, m in _rooms.items():
                changed = m.on_tick(now)
                if changed is not None:
                    publishes.append((slug, changed))
        for slug, occupied in publishes:
            _publish_state(slug, occupied)

    # Graceful shutdown: tell HA we're gone (entity → unavailable, not stale).
    try:
        if _client is not None and _connected.is_set():
            info = _client.publish(AVAILABILITY_TOPIC, b"offline", qos=1, retain=True)
            info.wait_for_publish(timeout=2.0)
            _client.loop_stop()
            _client.disconnect()
    except Exception:
        pass
    log_info("[RoomPresence] engine stopped")
