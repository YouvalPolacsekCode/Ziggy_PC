"""
Anomaly Engine v2 — pluggable rule registry with confidence scoring.

Architecture:
  - Rules registered via @register_rule(rule_id, scope, severity, cooldown_s)
  - evaluate() dispatches every rule by scope on each HA state_changed event
  - AnomalyResult carries confidence (0–1); results below MIN_CONFIDENCE are
    stored in active_anomalies but suppressed from Telegram / WebSocket push
  - HomeContext provides occupancy mode and time-of-day to every rule function
  - Snooze state persisted to SQLite (anomaly_snooze table in home_map.db)
  - Anomaly history logged to SQLite (anomaly_history table in home_map.db)

Bug fixes vs v1:
  - ANOM-02: real room-empty timer tracked per area (was a cooldown proxy)
  - ANOM-04: cleared from active dict when quiet hours end or motion stops
  - ANOM-05: genuine 24h no-motion timer (was firing after 30 min cooldown)
  - Startup: _last_on/_last_off seeded by ha_subscriber from REST snapshot
  - Snooze: persisted to SQLite so server restarts don't re-fire snoozed rules

Rules (v2):
  ANOM-01  All persons away ≥5 min + no recent motion + lights on
  ANOM-02  Climate running + room empty for configurable threshold (default 30 min)
  ANOM-03  Door/window sensor open > threshold (default 1 h)
  ANOM-04  Motion during quiet hours (confidence boosted in away mode)
  ANOM-05  No motion anywhere for >24 h while someone is home
  ANOM-06  Switch / light / plug on > threshold hours (default 4 h)
  ANOM-07  Device used in an automation went offline/unavailable
  ANOM-08  Battery level below threshold (default 20 %)
  ANOM-09  Multiple physical devices offline in a short window (coordinator pattern)
"""
from __future__ import annotations

import asyncio
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Literal

import pytz

from core.settings_loader import settings
from core.logger_module import log_info, log_error
from services.ha_areas import get_areas
from services.presence_store import all_away as _ziggy_all_away, home_person_names as _ziggy_home_names, load_persons as _ziggy_load_persons, effective_state as _ziggy_effective_state

# ── SQLite (shared DB with map_router) ───────────────────────────────────────
_DB = Path("user_files/home_map.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS anomaly_snooze (
    key          TEXT PRIMARY KEY,
    snooze_until REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS anomaly_history (
    id           INTEGER PRIMARY KEY,
    rule_id      TEXT    NOT NULL,
    room_id      TEXT    NOT NULL,
    severity     TEXT    NOT NULL,
    confidence   REAL    NOT NULL DEFAULT 1.0,
    message      TEXT    NOT NULL,
    fired_at     REAL    NOT NULL,
    cleared_at   REAL,
    action_taken TEXT
);
"""

# ── Constants ─────────────────────────────────────────────────────────────────
MIN_CONFIDENCE    = 0.50   # below this: stored in active dict, no Telegram/WS push
_DEFAULT_COOLDOWN = 1800   # 30 min between repeated alerts for the same rule+room
_ANOM01_BUFFER_S  = 300    # persons must be away ≥5 min before ANOM-01 fires
_ANOM05_THRESHOLD = 86400  # 24 h of no motion before ANOM-05 fires
_BULK_OFFLINE_WINDOW     = 120  # seconds — window for ANOM-09 bulk-offline detection
_BULK_OFFLINE_THRESHOLD  = 3   # how many physical devices must go offline to suspect coordinator
_STALE_COOLDOWN          = 21600  # 6 h between repeated ANOM-10 alerts per entity

# Device classes considered safety-critical for stale reporting (ANOM-10).
# These sensors must report regularly; silence implies dead battery or disconnect.
_STALE_SAFETY_CLASSES = frozenset({
    "moisture", "door", "window", "smoke", "carbon_monoxide", "gas",
    "motion", "occupancy", "presence", "vibration",
})

# Domains that are helpers/virtual and should NOT count as physical devices
_NON_PHYS_DOMAINS = frozenset({
    "person", "sun", "zone", "weather", "automation", "script", "scene",
    "timer", "counter", "input_select", "input_number", "input_text",
    "input_datetime", "input_button", "group", "stt", "tts", "conversation",
    "update", "button",
})

# ── Module-level state ────────────────────────────────────────────────────────
_snooze: dict[str, float]    = {}   # { "room_id:rule_id" → until }
_last_fired: dict[str, float] = {}  # { "room_id:rule_id" → ts }

# Entity-level timestamps — seeded at startup by ha_subscriber._full_state_refresh
_last_on:  dict[str, float] = {}    # { entity_id → ts of last "on" }
_last_off: dict[str, float] = {}    # { entity_id → ts of last "off" }

# ANOM-01: when all persons first became away
_all_away_since: float | None = None

# ANOM-02: { area_id → ts when room became empty (climate still running) }
_room_empty_since: dict[str, float] = {}

# ANOM-05: ts when any motion was last observed globally (None = currently observed)
_no_motion_since: float | None = None

# ANOM-09: { entity_id → ts } when physical devices recently went unavailable
_recent_unavailable: dict[str, float] = {}

# ANOM-07/ANOM-08: automation dependency cache { entity_id → [automation_name] }
_automation_deps: dict[str, list[str]] = {}
_automation_deps_ts: float = 0.0
_AUTOMATION_DEPS_TTL = 300  # refresh every 5 min

# Area map (60-second cache)
_area_cache: dict | None = None
_area_cache_ts: float = 0.0


# ── Dataclasses ───────────────────────────────────────────────────────────────
@dataclass
class HomeContext:
    mode: Literal["away", "night", "home"]
    quiet_hours: bool
    occupants_home: list[str]
    local_hour: int
    day_of_week: int


@dataclass
class AnomalyResult:
    message: str
    confidence: float = 1.0
    action_available: bool = False
    suggested_action: str | None = None
    context: str | None = None


@dataclass
class EvalContext:
    cache: dict
    ctx: HomeContext
    cfg: dict
    now: float
    area_map: dict = field(default_factory=dict)
    area_id: str   = ""
    area: dict     = field(default_factory=dict)
    entity_id: str = ""
    entity_entry: dict = field(default_factory=dict)


@dataclass
class AnomalyRule:
    rule_id:   str
    scope:     Literal["home", "area", "entity"]
    severity:  Literal["critical", "warning", "info"]
    cooldown_s: int
    fn: Callable[[EvalContext], AnomalyResult | None]


# ── Rule registry ─────────────────────────────────────────────────────────────
_RULES: list[AnomalyRule] = []


def register_rule(
    rule_id:   str,
    scope:     Literal["home", "area", "entity"],
    severity:  Literal["critical", "warning", "info"],
    cooldown_s: int = _DEFAULT_COOLDOWN,
):
    def decorator(fn: Callable) -> Callable:
        _RULES.append(AnomalyRule(rule_id=rule_id, scope=scope,
                                  severity=severity, cooldown_s=cooldown_s, fn=fn))
        return fn
    return decorator


# ── SQLite helpers ────────────────────────────────────────────────────────────
def _db_init() -> None:
    try:
        _DB.parent.mkdir(parents=True, exist_ok=True)
        with _connect() as conn:
            # WAL persists in the DB header; setting it here covers any future
            # opener (map_router via aiosqlite, this module). synchronous=NORMAL
            # is per-connection — repeated on every open below — and is a safe
            # default with WAL since fsync happens on checkpoints.
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.executescript(_SCHEMA)
            conn.commit()
    except Exception as e:
        log_error(f"[AnomalyEngine] DB init failed: {e}")


def _connect():
    """Open a SQLite connection with safe pragmas for hot paths.

    synchronous=NORMAL must be set per-connection (it's not stored in the
    DB header). The default FULL adds fsync to every commit, which is
    overkill for the anomaly history table and added ~50–80 ms per write
    on macOS HFS+. NORMAL is the recommended pairing with WAL.
    """
    conn = sqlite3.connect(_DB)
    try:
        conn.execute("PRAGMA synchronous=NORMAL")
    except Exception:
        pass
    return conn


def _load_snooze_from_db() -> None:
    try:
        with _connect() as conn:
            now = time.time()
            rows = conn.execute(
                "SELECT key, snooze_until FROM anomaly_snooze WHERE snooze_until > ?", (now,)
            ).fetchall()
            for key, until in rows:
                _snooze[key] = until
        log_info(f"[AnomalyEngine] Loaded {len(_snooze)} active snooze entries")
    except Exception:
        pass


def _save_snooze_to_db(key: str, until: float) -> None:
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO anomaly_snooze(key, snooze_until) VALUES (?,?) "
                "ON CONFLICT(key) DO UPDATE SET snooze_until=excluded.snooze_until",
                (key, until),
            )
            conn.commit()
    except Exception as e:
        log_error(f"[AnomalyEngine] Snooze DB save failed: {e}")


def _log_history_fired(rule_id: str, room_id: str, severity: str,
                       confidence: float, message: str) -> None:
    try:
        with _connect() as conn:
            conn.execute(
                "INSERT INTO anomaly_history"
                "(rule_id, room_id, severity, confidence, message, fired_at) "
                "VALUES (?,?,?,?,?,?)",
                (rule_id, room_id, severity, confidence, message, time.time()),
            )
            conn.commit()
    except Exception as e:
        log_error(f"[AnomalyEngine] History write failed: {e}")


def _log_history_cleared(rule_id: str, room_id: str) -> None:
    try:
        with _connect() as conn:
            conn.execute(
                "UPDATE anomaly_history SET cleared_at=? "
                "WHERE rule_id=? AND room_id=? AND cleared_at IS NULL",
                (time.time(), rule_id, room_id),
            )
            conn.commit()
    except Exception:
        pass


# ── Time helpers ──────────────────────────────────────────────────────────────
def _cfg() -> dict:
    return settings.get("anomaly_engine", settings.get("sensor_alerts", {}))


def _tz() -> Any:
    try:
        return pytz.timezone(settings.get("system", {}).get("timezone", "UTC"))
    except Exception:
        return pytz.UTC


def _local_hour() -> int:
    return datetime.now(_tz()).hour


def _in_quiet_hours() -> bool:
    """Use push-preferences quiet hours as the single quiet-hours definition."""
    try:
        from services.push_preferences import get_prefs
        users = settings.get("users", [])
        if not users:
            return False
        prefs = get_prefs(users[0]["username"])
        qh = prefs.get("quiet_hours", {})
        if not qh.get("enabled"):
            return False
        sh, sm = map(int, qh.get("start", "23:00").split(":"))
        eh, em = map(int, qh.get("end",   "07:00").split(":"))
        h = _local_hour()
        if sh > eh:          # spans midnight
            return h >= sh or h < eh
        return sh <= h < eh
    except Exception:
        return False


# ── Snooze / cooldown ─────────────────────────────────────────────────────────
def _is_snoozed(room_id: str, rule_id: str) -> bool:
    key = f"{room_id}:{rule_id}"
    until = _snooze.get(key, 0)
    if time.time() < until:
        return True
    _snooze.pop(key, None)
    return False


def _cooldown_ok(room_id: str, rule_id: str, cooldown_s: int) -> bool:
    return time.time() - _last_fired.get(f"{room_id}:{rule_id}", 0) > cooldown_s


def _mark_fired(room_id: str, rule_id: str) -> None:
    _last_fired[f"{room_id}:{rule_id}"] = time.time()


def snooze(room_id: str, rule_id: str, duration_minutes: int = 60) -> None:
    """Public API — called by map_router snooze endpoint."""
    key = f"{room_id}:{rule_id}"
    until = time.time() + duration_minutes * 60
    _snooze[key] = until
    _save_snooze_to_db(key, until)
    log_info(f"[AnomalyEngine] Snoozed {rule_id} for room '{room_id}' for {duration_minutes} min")


# ── Push / clear ──────────────────────────────────────────────────────────────
def _push_anomaly(active: dict, room_id: str, rule: AnomalyRule,
                  result: AnomalyResult) -> None:
    room_list = active.setdefault(room_id, [])
    existing = next((e for e in room_list if e["rule_id"] == rule.rule_id), None)
    entry = {
        "rule_id":          rule.rule_id,
        "severity":         rule.severity,
        "message":          result.message,
        "confidence":       round(result.confidence, 2),
        "action_available": result.action_available,
        "suggested_action": result.suggested_action,
        "context":          result.context,
        "since":            existing["since"] if existing else time.time(),
    }
    active[room_id] = [e for e in room_list if e["rule_id"] != rule.rule_id]
    active[room_id].append(entry)
    _mark_fired(room_id, rule.rule_id)
    _log_history_fired(rule.rule_id, room_id, rule.severity,
                       result.confidence, result.message)
    log_info(f"[AnomalyEngine] {rule.rule_id} fired "
             f"(conf={result.confidence:.2f}) room='{room_id}': {result.message}")

    if result.confidence < MIN_CONFIDENCE:
        log_info(f"[AnomalyEngine] {rule.rule_id} suppressed (conf {result.confidence:.2f} < {MIN_CONFIDENCE})")
        return

    try:
        from services.push_notify import push_notify_fire_and_forget
        category = "anomaly_critical" if rule.severity == "critical" else "anomaly_warning"
        icon = "🚨" if rule.severity == "critical" else "⚠️"
        # Fire-and-forget: a slow web-push endpoint must not stall the HA WS
        # event handler that triggered this rule evaluation. webpush() has a
        # 10 s per-subscription timeout; 3 dead endpoints = 30 s of blocked
        # event-loop time, which freezes every downstream HA state update.
        push_notify_fire_and_forget(f"{icon} Ziggy Alert", result.message, "/anomalies", category)
    except Exception as e:
        log_error(f"[AnomalyEngine] Push notification failed: {e}")

    try:
        from backend.ws_manager import manager
        asyncio.create_task(manager.broadcast({
            "type":       "anomaly_active",
            "room_id":    room_id,
            "rule_id":    rule.rule_id,
            "severity":   rule.severity,
            "confidence": round(result.confidence, 2),
            "message":    result.message,
        }))
    except Exception as e:
        log_error(f"[AnomalyEngine] WS push failed: {e}")


def _clear_anomaly(active: dict, room_id: str, rule_id: str) -> None:
    if room_id not in active:
        return
    before = len(active[room_id])
    active[room_id] = [e for e in active[room_id] if e["rule_id"] != rule_id]
    if len(active[room_id]) < before:
        _log_history_cleared(rule_id, room_id)
        try:
            from backend.ws_manager import manager
            asyncio.create_task(manager.broadcast({
                "type":    "anomaly_cleared",
                "room_id": room_id,
                "rule_id": rule_id,
            }))
        except Exception:
            pass


# ── Predicates used by rules ──────────────────────────────────────────────────
def _lights_on(cache: dict) -> list[str]:
    return [eid for eid, v in cache.items()
            if eid.startswith("light.") and v["state"] == "on"]


def _all_persons_away(cache: dict) -> bool:
    ha_persons    = [v for eid, v in cache.items() if eid.startswith("person.")]
    ziggy_persons = _ziggy_load_persons()
    if not ha_persons and not ziggy_persons:
        return False
    ha_away    = all(v["state"] != "home" for v in ha_persons)
    ziggy_away = all(_ziggy_effective_state(p) != "home" for p in ziggy_persons)
    return ha_away and ziggy_away


def _any_recent_motion(cache: dict, within_seconds: float = 1800) -> bool:
    now = time.time()
    for eid, v in cache.items():
        if not eid.startswith("binary_sensor."):
            continue
        if v.get("attributes", {}).get("device_class", "") not in ("motion", "occupancy", "presence"):
            continue
        if v.get("state") == "on":
            return True
        if now - _last_on.get(eid, 0) < within_seconds:
            return True
    return False


def _room_has_motion(area: dict, cache: dict) -> bool:
    for eid in area.get("entities", []):
        if not eid.startswith("binary_sensor."):
            continue
        dc = cache.get(eid, {}).get("attributes", {}).get("device_class", "")
        if dc in ("motion", "occupancy", "presence") and cache.get(eid, {}).get("state") == "on":
            return True
    return False


def _room_climate_entities(area: dict) -> list[str]:
    return [e for e in area.get("entities", []) if e.startswith("climate.")]


def _room_door_entities(area: dict, cache: dict) -> list[str]:
    return [
        eid for eid in area.get("entities", [])
        if eid.startswith("binary_sensor.")
        and cache.get(eid, {}).get("attributes", {}).get("device_class", "")
        in ("door", "window", "garage_door")
    ]


async def _get_area_map() -> dict[str, dict]:
    global _area_cache, _area_cache_ts
    now = time.time()
    if _area_cache is not None and now - _area_cache_ts < 60:
        return _area_cache
    try:
        areas = await get_areas()
        _area_cache = {a["id"]: a for a in areas}
        _area_cache_ts = now
        return _area_cache
    except Exception:
        return _area_cache or {}


# ── HomeContext builder ───────────────────────────────────────────────────────
def _build_context(cache: dict) -> HomeContext:
    ha_persons   = {eid: v for eid, v in cache.items() if eid.startswith("person.")}
    ziggy_persons = _ziggy_load_persons()
    ha_home      = [eid.split(".")[1] for eid, v in ha_persons.items() if v["state"] == "home"]
    ziggy_home   = [p["name"] for p in ziggy_persons if _ziggy_effective_state(p) == "home"]
    occupants    = list({*ha_home, *ziggy_home})
    has_presence = bool(ha_persons) or bool(ziggy_persons)
    mode: Literal["away", "night", "home"] = (
        "away"  if (has_presence and not occupants) else
        "night" if _in_quiet_hours()               else
        "home"
    )
    return HomeContext(
        mode=mode,
        quiet_hours=_in_quiet_hours(),
        occupants_home=occupants,
        local_hour=_local_hour(),
        day_of_week=datetime.now(_tz()).weekday(),
    )


# ── Rules ─────────────────────────────────────────────────────────────────────

@register_rule("ANOM-01", scope="home", severity="warning")
def _rule_anom01(ec: EvalContext) -> AnomalyResult | None:
    """All persons away ≥5 min + no recent motion + lights on."""
    global _all_away_since

    persons_away = _all_persons_away(ec.cache)
    if persons_away:
        if _all_away_since is None:
            _all_away_since = ec.now
    else:
        _all_away_since = None
        return None

    if ec.now - _all_away_since < _ANOM01_BUFFER_S:
        return None

    if _any_recent_motion(ec.cache, within_seconds=1800):
        return None

    lights = _lights_on(ec.cache)
    if not lights:
        return None

    # More lights on → higher confidence
    confidence = min(0.75 + len(lights) * 0.05, 0.95)
    return AnomalyResult(
        message=(f"Everyone is away but {len(lights)} light{'s are' if len(lights) > 1 else ' is'}"
                 " still on."),
        confidence=round(confidence, 2),
        action_available=True,
        suggested_action="turn_off_all_lights",
    )


@register_rule("ANOM-02", scope="area", severity="warning")
def _rule_anom02(ec: EvalContext) -> AnomalyResult | None:
    """Climate running + room empty for configurable period."""
    threshold_s = ec.cfg.get("anom02_empty_minutes", 30) * 60

    climate_on = any(
        ec.cache.get(eid, {}).get("state") not in ("off", "unknown", "unavailable")
        for eid in _room_climate_entities(ec.area)
    )
    if not climate_on:
        _room_empty_since.pop(ec.area_id, None)
        return None

    if _room_has_motion(ec.area, ec.cache):
        _room_empty_since.pop(ec.area_id, None)
        return None

    # Start the empty timer on first observation
    empty_since = _room_empty_since.setdefault(ec.area_id, ec.now)
    empty_duration = ec.now - empty_since
    if empty_duration < threshold_s:
        return None

    mins = int(empty_duration // 60)
    return AnomalyResult(
        message=f"{ec.area['name']}: climate running but room has been empty for {mins} minutes.",
        confidence=0.80,
    )


@register_rule("ANOM-03", scope="area", severity="warning")
def _rule_anom03(ec: EvalContext) -> AnomalyResult | None:
    """External door/window open > threshold."""
    door_threshold = ec.cfg.get("anom03_door_open_minutes", 60) * 60
    for eid in _room_door_entities(ec.area, ec.cache):
        if ec.cache.get(eid, {}).get("state") == "on":
            opened_at = _last_on.get(eid, ec.now)
            open_duration = ec.now - opened_at
            if open_duration > door_threshold:
                label = ec.cache.get(eid, {}).get("attributes", {}).get("friendly_name", eid)
                # Confidence grows the longer it stays open past the threshold
                confidence = min(0.85 + (open_duration - door_threshold) / 3600 * 0.08, 0.98)
                return AnomalyResult(
                    message=f"{label} has been open for {int(open_duration // 60)} minutes.",
                    confidence=round(confidence, 2),
                )
    return None


@register_rule("ANOM-04", scope="area", severity="critical")
def _rule_anom04(ec: EvalContext) -> AnomalyResult | None:
    """Motion during quiet hours.  Clears naturally when motion stops OR quiet hours end."""
    if not ec.ctx.quiet_hours:
        return None
    if not _room_has_motion(ec.area, ec.cache):
        return None

    confidence = 0.65
    if ec.ctx.mode == "away":
        confidence += 0.30   # no one should be home at all

    # Reduce confidence if a person recently arrived (GPS lag / settling)
    for eid, v in ec.cache.items():
        if eid.startswith("person.") and v["state"] == "home":
            if ec.now - _last_on.get(eid, 0) < 1200:   # within 20 min
                confidence -= 0.25
                break

    return AnomalyResult(
        message=f"Motion detected in {ec.area['name']}.",
        confidence=round(max(confidence, 0.10), 2),
        context="quiet_hours",
    )


@register_rule("ANOM-05", scope="home", severity="warning")
def _rule_anom05(ec: EvalContext) -> AnomalyResult | None:
    """No motion anywhere for >24 h while someone is home."""
    global _no_motion_since

    any_motion = any(
        v["state"] == "on"
        for eid, v in ec.cache.items()
        if eid.startswith("binary_sensor.")
        and v.get("attributes", {}).get("device_class") in ("motion", "occupancy", "presence")
    )

    if any_motion:
        _no_motion_since = None
        return None

    if not ec.ctx.occupants_home:
        _no_motion_since = None
        return None

    if _no_motion_since is None:
        _no_motion_since = ec.now

    duration = ec.now - _no_motion_since
    if duration < _ANOM05_THRESHOLD:
        return None

    hours = int(duration // 3600)
    return AnomalyResult(
        message=f"No motion detected anywhere for {hours} hours while home is occupied — is everyone OK?",
        confidence=0.75,
    )


@register_rule("ANOM-06", scope="entity", severity="warning")
def _rule_anom06(ec: EvalContext) -> AnomalyResult | None:
    """Device continuously on > threshold hours."""
    eid   = ec.entity_id
    entry = ec.entity_entry
    threshold_h = ec.cfg.get("anom06_runtime_hours", 4)
    threshold_s = threshold_h * 3600

    if entry.get("state") != "on":
        return None
    if eid in ec.cfg.get("exemptions", []):
        return None
    if not (eid.startswith("switch.") or eid.startswith("light.") or eid.startswith("plug.")):
        return None

    on_since = _last_on.get(eid, ec.now)
    runtime  = ec.now - on_since
    if runtime <= threshold_s:
        return None

    label    = entry.get("attributes", {}).get("friendly_name", eid)
    hours_on = runtime / 3600
    # Confidence climbs with time beyond threshold, caps at 0.95
    confidence = min(0.80 + (hours_on - threshold_h) * 0.04, 0.95)

    return AnomalyResult(
        message=f"{label} has been on for {hours_on:.1f} hours.",
        confidence=round(confidence, 2),
        action_available=True,
        suggested_action=f"turn_off:{eid}",
    )


# ── Automation dependency helpers ─────────────────────────────────────────────

def _refresh_automation_deps() -> dict[str, list[str]]:
    """Build entity_id → [automation names] map for all enabled automations."""
    global _automation_deps, _automation_deps_ts
    now = time.time()
    if now - _automation_deps_ts < _AUTOMATION_DEPS_TTL and _automation_deps:
        return _automation_deps
    try:
        from services.ha_automations import list_automations
        deps: dict[str, list[str]] = {}
        for auto in list_automations():
            if not auto.get("enabled", True):
                continue
            name = auto.get("name") or auto.get("id", "")
            for action in (auto.get("actions") or []):
                eid = action.get("entity_id")
                if eid:
                    deps.setdefault(eid, []).append(name)
        _automation_deps = deps
        _automation_deps_ts = now
    except Exception:
        pass
    return _automation_deps


def get_automation_deps() -> dict[str, list[str]]:
    """Public: entity_id → [automation names] for all enabled automations. Cached 5 min."""
    return _refresh_automation_deps()


# ── Rules — ANOM-07 / ANOM-08 / ANOM-09 ──────────────────────────────────────

@register_rule("ANOM-07", scope="entity", severity="warning", cooldown_s=3600)
def _rule_anom07(ec: EvalContext) -> AnomalyResult | None:
    """Device used in an automation went offline/unavailable."""
    eid   = ec.entity_id
    state = ec.entity_entry.get("state", "")
    if state not in ("unavailable", "unknown"):
        return None

    deps = _refresh_automation_deps()
    auto_names = deps.get(eid, [])
    if not auto_names:
        return None

    attrs = ec.entity_entry.get("attributes", {}) or {}
    label = attrs.get("friendly_name") or eid.split(".")[-1].replace("_", " ").title()
    if len(auto_names) == 1:
        msg = (f"{label} is offline. The automation '{auto_names[0]}' "
               "may not work correctly.")
    else:
        msg = (f"{label} is offline. {len(auto_names)} automation"
               f"{'s' if len(auto_names) > 1 else ''} may not work correctly.")

    return AnomalyResult(message=msg, confidence=0.90)


@register_rule("ANOM-08", scope="entity", severity="warning", cooldown_s=86400)
def _rule_anom08(ec: EvalContext) -> AnomalyResult | None:
    """Battery level below threshold (default 20 %)."""
    eid   = ec.entity_id
    attrs = ec.entity_entry.get("attributes", {}) or {}
    state = ec.entity_entry.get("state", "")

    battery: int | None = None

    if attrs.get("device_class") == "battery":
        # The entity IS a battery sensor; its state value is the percentage.
        try:
            battery = int(float(state))
        except (ValueError, TypeError):
            return None
    else:
        for key in ("battery_level", "battery", "battery_percent"):
            if key in attrs:
                try:
                    battery = int(attrs[key])
                    break
                except (ValueError, TypeError):
                    pass

    if battery is None or not (0 <= battery <= 100):
        return None

    threshold = ec.cfg.get("anom08_battery_threshold", 20)
    if battery >= threshold:
        return None

    label = attrs.get("friendly_name") or eid.split(".")[-1].replace("_", " ").title()
    return AnomalyResult(
        message=f"{label} battery is low ({battery}%). Consider replacing it.",
        confidence=0.95,
    )


@register_rule("ANOM-09", scope="home", severity="critical", cooldown_s=3600)
def _rule_anom09(ec: EvalContext) -> AnomalyResult | None:
    """Multiple physical devices offline in a short window — possible coordinator/network failure."""
    count = len(_recent_unavailable)
    if count < _BULK_OFFLINE_THRESHOLD:
        return None

    # Suppress when HA just reconnected — devices going unavailable during a
    # HA WebSocket drop is expected and does not indicate real device failure.
    try:
        import time as _t
        from services.ha_subscriber import ha_last_reconnect
        if _t.monotonic() - ha_last_reconnect < _BULK_OFFLINE_WINDOW:
            return None
    except Exception:
        pass

    window_min = _BULK_OFFLINE_WINDOW // 60
    return AnomalyResult(
        message=(
            f"{count} devices went offline at the same time. "
            "They may be unreachable — try reconnecting from the Home screen."
        ),
        confidence=min(0.75 + (count - _BULK_OFFLINE_THRESHOLD) * 0.05, 0.95),
        action_available=True,
        suggested_action="check_coordinator",
    )


# ── Dispatch helper ───────────────────────────────────────────────────────────
def _dispatch(rule: AnomalyRule, ec: EvalContext, active: dict, room_id: str) -> None:
    try:
        result = rule.fn(ec)
    except Exception as e:
        log_error(f"[AnomalyEngine] {rule.rule_id} raised: {e}")
        return

    if result is None:
        _clear_anomaly(active, room_id, rule.rule_id)
        return

    if _is_snoozed(room_id, rule.rule_id):
        return
    if not _cooldown_ok(room_id, rule.rule_id, rule.cooldown_s):
        return

    _push_anomaly(active, room_id, rule, result)


# ── Main evaluate loop ────────────────────────────────────────────────────────
async def evaluate(changed_entity: str, cache: dict, active: dict) -> None:
    """Entry point — called by ha_subscriber on every HA state_changed event."""
    if not _cfg().get("enabled", True):
        return

    cfg = _cfg()
    now = time.time()

    new_state = cache.get(changed_entity, {}).get("state", "unknown")
    if new_state == "off":
        _last_off[changed_entity] = now
    elif new_state == "on":
        _last_on[changed_entity] = now

    # Track bulk-offline window for ANOM-09 (physical domains only)
    if new_state in ("unavailable", "unknown"):
        domain = changed_entity.split(".")[0]
        if domain not in _NON_PHYS_DOMAINS:
            _recent_unavailable[changed_entity] = now
    else:
        _recent_unavailable.pop(changed_entity, None)

    # Prune stale entries older than the detection window
    cutoff = now - _BULK_OFFLINE_WINDOW
    for eid in [k for k, v in _recent_unavailable.items() if v < cutoff]:
        del _recent_unavailable[eid]

    ctx      = _build_context(cache)
    area_map: dict = {}
    try:
        area_map = await _get_area_map()
    except Exception:
        pass

    # If a safety-critical sensor just reported any state change, it's no longer stale.
    # Clear ANOM-10 immediately rather than waiting for the next hourly sweep.
    _changed_domain = changed_entity.split(".")[0]
    if _changed_domain in ("binary_sensor", "sensor"):
        _changed_dc = cache.get(changed_entity, {}).get("attributes", {}).get("device_class", "")
        if _changed_dc in _STALE_SAFETY_CLASSES and new_state not in ("unavailable", "unknown"):
            _stale_room = next(
                (aid for aid, a in area_map.items() if changed_entity in a.get("entities", [])),
                changed_entity,
            )
            _clear_anomaly(active, _stale_room, "ANOM-10")

    disabled = settings.get("anomaly_engine", {}).get("disabled_rules", [])

    for rule in _RULES:
        if rule.rule_id in disabled:
            continue

        if rule.scope == "home":
            ec = EvalContext(cache=cache, ctx=ctx, cfg=cfg, now=now, area_map=area_map)
            _dispatch(rule, ec, active, "home")

        elif rule.scope == "area":
            for area_id, area in area_map.items():
                ec = EvalContext(cache=cache, ctx=ctx, cfg=cfg, now=now,
                                 area_map=area_map, area_id=area_id, area=area)
                _dispatch(rule, ec, active, area_id)

        elif rule.scope == "entity":
            for eid, entry in cache.items():
                # Store entity-level anomalies under the area that contains the entity,
                # so they appear in room cards.  Fall back to entity_id if unmapped.
                room_id = next(
                    (aid for aid, a in area_map.items() if eid in a.get("entities", [])),
                    eid,
                )
                ec = EvalContext(cache=cache, ctx=ctx, cfg=cfg, now=now,
                                 area_map=area_map, entity_id=eid, entity_entry=entry)
                _dispatch(rule, ec, active, room_id)


# ── ANOM-04 — time-boundary cleanup ──────────────────────────────────────────

def clear_expired_time_anomalies(active: dict) -> None:
    """Remove ANOM-04 entries whose quiet-hours window has closed.

    Called every minute from ziggy_scheduler so ANOM-04 clears promptly
    even when no HA state_changed event fires at the boundary.
    """
    if _in_quiet_hours():
        return
    for room_id in list(active.keys()):
        _clear_anomaly(active, room_id, "ANOM-04")


# ── ANOM-10 — stale safety sensor sweep ──────────────────────────────────────
# Not event-driven (silent sensors don't fire state_changed).
# Called hourly from ziggy_scheduler.

# Synthetic rule object reused across all ANOM-10 firings.
_ANOM10_RULE = AnomalyRule(
    rule_id="ANOM-10",
    scope="entity",
    severity="warning",
    cooldown_s=_STALE_COOLDOWN,
    fn=lambda _: None,
)


async def sweep_stale_sensors(
    cache:  dict | None = None,
    active: dict | None = None,
) -> None:
    """Sweep state_cache for safety-critical sensors that haven't reported recently.

    Called periodically (hourly) from ziggy_scheduler — NOT from the event loop.
    Uses the same _push_anomaly / _clear_anomaly infrastructure as all other rules
    so results appear in room cards, Telegram, and anomaly history.
    """
    from datetime import datetime, timezone as _tz_module

    if cache is None or active is None:
        try:
            from services.ha_subscriber import state_cache as _sc, active_anomalies as _aa
            cache, active = _sc, _aa
        except ImportError:
            return
    if not cache:
        return

    cfg = _cfg()
    if not cfg.get("enabled", True):
        return

    threshold_s = cfg.get("anom10_stale_hours", 24) * 3600
    now = time.time()
    area_map: dict = {}
    try:
        area_map = await _get_area_map()
    except Exception:
        pass

    for eid, entry in list(cache.items()):
        domain = eid.split(".")[0]
        if domain not in ("binary_sensor", "sensor"):
            continue

        dc = (entry.get("attributes") or {}).get("device_class", "")
        if dc not in _STALE_SAFETY_CLASSES:
            continue

        state = entry.get("state", "")

        # Room this entity belongs to (fall back to entity_id as key)
        room_id = next(
            (aid for aid, a in area_map.items() if eid in a.get("entities", [])),
            eid,
        )

        # If the device is already offline, ANOM-07 handles it — clear any stale alert.
        if state in ("unavailable", "unknown"):
            _clear_anomaly(active, room_id, "ANOM-10")
            continue

        # Parse last_changed to determine how long the sensor has been silent.
        last_changed_str = entry.get("last_changed", "")
        if not last_changed_str:
            continue
        try:
            dt = datetime.fromisoformat(last_changed_str.replace("Z", "+00:00"))
            last_ts = dt.astimezone(_tz_module.utc).timestamp()
        except Exception:
            continue

        stale_duration = now - last_ts

        if stale_duration < threshold_s:
            _clear_anomaly(active, room_id, "ANOM-10")
            continue

        if _is_snoozed(room_id, "ANOM-10"):
            continue
        if not _cooldown_ok(room_id, "ANOM-10", _STALE_COOLDOWN):
            continue

        attrs = entry.get("attributes") or {}
        label = attrs.get("friendly_name") or eid.split(".")[-1].replace("_", " ").title()
        hours_stale = int(stale_duration / 3600)

        msg = (
            f"{label} hasn't reported in {hours_stale} hour{'s' if hours_stale != 1 else ''}. "
            f"Check the battery or connection — this {dc.replace('_', ' ')} sensor "
            "should update regularly."
        )
        _push_anomaly(active, room_id, _ANOM10_RULE, AnomalyResult(message=msg, confidence=0.80))


# ── Module init ───────────────────────────────────────────────────────────────
_db_init()
_load_snooze_from_db()
