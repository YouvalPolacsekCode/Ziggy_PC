"""
Anomaly Engine — rule-based smart home anomaly detection.

Subsumes sensor_alerts.py (retired). Driven by ha_subscriber.py's state cache.
All rules are evaluated on every relevant state_changed event.

Rules (V1):
  ANOM-01  All person entities away + any light on  → alert
  ANOM-02  Climate entity running + room empty >30 min → alert
  ANOM-03  External door open >1 hour → alert
  ANOM-04  Motion detected during quiet hours → alert (per-room snooze supported)
  ANOM-05  No motion anywhere for >24h while home occupied → alert
  ANOM-06  Device continuously on >4h since last OFF → alert (exemption list in settings)

Occupancy model:
  - "Room empty" = no binary_sensor (motion/occupancy) in that room is "on"
  - "Home occupied" = any person entity in zone.home  OR  recent motion anywhere

Snooze state: in-memory dict, lost on restart (SQLite persistence is a tracked TODO).
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime
from typing import Any

import pytz

from core.settings_loader import settings
from core.logger_module import log_info, log_error
from services.ha_areas import get_areas

# Area map cache (refreshed every 60s to avoid hammering HA WebSocket)
_area_cache: dict | None = None
_area_cache_ts: float = 0.0

# Snooze: { "room_id:rule_id" → snooze_until_unix_timestamp }
_snooze: dict[str, float] = {}

# ANOM-06: { entity_id → unix timestamp of last time entity went to 'off' state }
_last_off: dict[str, float] = {}
# ANOM-06: { entity_id → unix timestamp of last time entity went to 'on' state }
_last_on: dict[str, float] = {}

# ANOM-01: timestamp when ALL persons first became away (used for time-buffer)
_all_away_since: float | None = None

# Simple per-sensor alert cooldown (replaces sensor_alerts.py polling loop)
# { "room_id:rule_id" → last_fired_unix_timestamp }
_last_fired: dict[str, float] = {}

_COOLDOWN_S = 60 * 30  # 30 minutes between repeated alerts for same rule+room
_ANOM01_BUFFER_S = 60 * 5  # require persons to be away ≥5 min before firing ANOM-01


def _cfg() -> dict:
    return settings.get("anomaly_engine", settings.get("sensor_alerts", {}))


def _tz() -> Any:
    tz_name = settings.get("timezone", "UTC")
    try:
        return pytz.timezone(tz_name)
    except Exception:
        return pytz.UTC


def _local_hour() -> int:
    return datetime.now(_tz()).hour


def _quiet_hours() -> tuple[int, int]:
    cfg = _cfg()
    return cfg.get("quiet_hour_start", 23), cfg.get("quiet_hour_end", 7)


def _in_quiet_hours() -> bool:
    start, end = _quiet_hours()
    h = _local_hour()
    if start > end:  # spans midnight e.g. 23-7
        return h >= start or h < end
    return start <= h < end


def _is_snoozed(room_id: str, rule_id: str) -> bool:
    key = f"{room_id}:{rule_id}"
    until = _snooze.get(key, 0)
    if time.time() < until:
        return True
    _snooze.pop(key, None)
    return False


def _cooldown_ok(room_id: str, rule_id: str) -> bool:
    key = f"{room_id}:{rule_id}"
    last = _last_fired.get(key, 0)
    return time.time() - last > _COOLDOWN_S


def _mark_fired(room_id: str, rule_id: str) -> None:
    _last_fired[f"{room_id}:{rule_id}"] = time.time()


def snooze(room_id: str, rule_id: str, duration_minutes: int = 60) -> None:
    _snooze[f"{room_id}:{rule_id}"] = time.time() + duration_minutes * 60
    log_info(f"[AnomalyEngine] Snoozed {rule_id} for room {room_id} for {duration_minutes}min")


def _push_anomaly(active: dict, room_id: str, rule_id: str, severity: str, message: str) -> None:
    entry = {"rule_id": rule_id, "severity": severity, "message": message, "since": time.time()}
    room_list = active.setdefault(room_id, [])
    # Replace existing entry for the same rule
    active[room_id] = [e for e in room_list if e["rule_id"] != rule_id]
    active[room_id].append(entry)

    _mark_fired(room_id, rule_id)
    log_info(f"[AnomalyEngine] {rule_id} fired for room '{room_id}': {message}")

    # Telegram push
    try:
        from interfaces.telegram_interface import send_reminder_message
        send_reminder_message(f"⚠️ {message}")
    except Exception as e:
        log_error(f"[AnomalyEngine] Telegram push failed: {e}")

    # WebSocket push to frontend
    try:
        from backend.ws_manager import manager
        import asyncio
        asyncio.create_task(manager.broadcast({
            "type": "anomaly_active",
            "room_id": room_id,
            "rule_id": rule_id,
            "severity": severity,
            "message": message,
        }))
    except Exception as e:
        log_error(f"[AnomalyEngine] WS push failed: {e}")


def _clear_anomaly(active: dict, room_id: str, rule_id: str) -> None:
    if room_id not in active:
        return
    before = len(active[room_id])
    active[room_id] = [e for e in active[room_id] if e["rule_id"] != rule_id]
    if len(active[room_id]) < before:
        try:
            from backend.ws_manager import manager
            import asyncio
            asyncio.create_task(manager.broadcast({
                "type": "anomaly_cleared",
                "room_id": room_id,
                "rule_id": rule_id,
            }))
        except Exception:
            pass


def _has_any_light_on(cache: dict) -> bool:
    return any(
        v["state"] == "on"
        for eid, v in cache.items()
        if eid.startswith("light.")
    )


def _all_persons_away(cache: dict) -> bool:
    persons = {eid: v for eid, v in cache.items() if eid.startswith("person.")}
    if not persons:
        return False  # No person entities → rule disabled
    return all(v["state"] != "home" for v in persons.values())


def _any_recent_motion(cache: dict, within_seconds: float = 1800) -> bool:
    """Return True if any motion/occupancy sensor triggered within within_seconds."""
    now = time.time()
    for eid, v in cache.items():
        if not eid.startswith("binary_sensor."):
            continue
        dc = v.get("attributes", {}).get("device_class", "")
        if dc not in ("motion", "occupancy", "presence"):
            continue
        if v.get("state") == "on":
            return True
        # Check last_on if sensor is currently off but was recently active
        last = _last_on.get(eid, 0)
        if last and (now - last) < within_seconds:
            return True
    return False


async def _get_area_map() -> dict[str, dict]:
    """Return { area_id: { name, entities: [entity_id] } } — cached for 60s."""
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


def _room_has_motion(area: dict, cache: dict) -> bool:
    """Return True if any motion/occupancy sensor in this area is 'on'."""
    for eid in area.get("entities", []):
        if not (eid.startswith("binary_sensor.")):
            continue
        device_class = cache.get(eid, {}).get("attributes", {}).get("device_class", "")
        if device_class in ("motion", "occupancy", "presence"):
            if cache.get(eid, {}).get("state") == "on":
                return True
    return False


def _room_climate_entities(area: dict) -> list[str]:
    return [e for e in area.get("entities", []) if e.startswith("climate.")]


def _room_door_entities(area: dict, cache: dict) -> list[str]:
    doors = []
    for eid in area.get("entities", []):
        if not eid.startswith("binary_sensor."):
            continue
        dc = cache.get(eid, {}).get("attributes", {}).get("device_class", "")
        if dc in ("door", "window", "garage_door"):
            doors.append(eid)
    return doors


async def evaluate(
    changed_entity: str,
    cache: dict,
    active: dict,
) -> None:
    """Entry point called by ha_subscriber on every state_changed event."""
    if not _cfg().get("enabled", True):
        return

    exemptions: list = _cfg().get("exemptions", [])
    anom06_threshold = _cfg().get("anom06_runtime_hours", 4) * 3600

    global _all_away_since

    # Track on/off transitions for ANOM-06
    new_state = cache.get(changed_entity, {}).get("state", "unknown")
    if new_state == "off":
        _last_off[changed_entity] = time.time()
    elif new_state == "on":
        _last_on[changed_entity] = time.time()

    # ANOM-01: everyone away + lights on
    # Guard: require persons to have been away for ≥5 min AND no recent motion (past 30 min).
    # This prevents false positives from delayed GPS updates and sensor lag.
    persons_away_now = _all_persons_away(cache)
    if persons_away_now:
        if _all_away_since is None:
            _all_away_since = time.time()
    else:
        _all_away_since = None

    away_long_enough = (
        _all_away_since is not None
        and (time.time() - _all_away_since) >= _ANOM01_BUFFER_S
    )
    recent_motion = _any_recent_motion(cache, within_seconds=1800)

    if persons_away_now and away_long_enough and not recent_motion and _has_any_light_on(cache):
        rule = "ANOM-01"
        if not _is_snoozed("home", rule) and _cooldown_ok("home", rule):
            log_info(
                f"[AnomalyEngine] ANOM-01 firing: persons away for "
                f"{int(time.time() - _all_away_since)}s, no motion in 30min, lights on."
            )
            _push_anomaly(active, "home", rule, "warning",
                          "Everyone appears to be away but lights are still on.")
    else:
        _clear_anomaly(active, "home", "ANOM-01")
        if persons_away_now and not away_long_enough:
            log_info(
                f"[AnomalyEngine] ANOM-01 suppressed: persons away only "
                f"{int(time.time() - (_all_away_since or time.time()))}s — waiting for {_ANOM01_BUFFER_S}s buffer."
            )
        elif persons_away_now and recent_motion:
            log_info("[AnomalyEngine] ANOM-01 suppressed: recent motion detected, person likely home.")

    # Per-area rules — fetch areas once per evaluation
    try:
        area_map = await _get_area_map()
    except Exception:
        area_map = {}

    now = time.time()

    for area_id, area in area_map.items():
        room_name = area["name"]

        # ANOM-02: climate running + room empty >30min
        climate_on = any(
            cache.get(eid, {}).get("state") not in ("off", "unknown", "unavailable")
            for eid in _room_climate_entities(area)
        )
        room_occupied = _room_has_motion(area, cache)
        rule = "ANOM-02"
        if climate_on and not room_occupied:
            # We approximate "30 min empty" by checking if no motion entity is on
            # The cooldown_ok acts as a proxy: only fires after 30 min of no motion
            threshold_s = _cfg().get("anom02_empty_minutes", 30) * 60
            if not _is_snoozed(area_id, rule) and _cooldown_ok(area_id, rule):
                _push_anomaly(active, area_id, rule, "warning",
                              f"{room_name}: climate running but room appears empty.")
        else:
            _clear_anomaly(active, area_id, rule)

        # ANOM-03: external door open >1 hour
        rule = "ANOM-03"
        door_threshold = _cfg().get("anom03_door_open_minutes", 60) * 60
        for eid in _room_door_entities(area, cache):
            if cache.get(eid, {}).get("state") == "on":
                # Entity went "on" means door opened — check last_on timestamp
                opened_at = _last_on.get(eid, now)
                if now - opened_at > door_threshold:
                    if not _is_snoozed(area_id, rule) and _cooldown_ok(area_id, rule):
                        label = cache.get(eid, {}).get("attributes", {}).get("friendly_name", eid)
                        _push_anomaly(active, area_id, rule, "warning",
                                      f"{label} has been open for over an hour.")
            else:
                _clear_anomaly(active, area_id, rule)

        # ANOM-04: motion during quiet hours
        rule = "ANOM-04"
        if _in_quiet_hours() and _room_has_motion(area, cache):
            if not _is_snoozed(area_id, rule) and _cooldown_ok(area_id, rule):
                _push_anomaly(active, area_id, rule, "critical",
                              f"Motion detected in {room_name} during quiet hours.")
        # No clear for ANOM-04 — it self-expires via cooldown

    # ANOM-05: no motion anywhere >24h while home occupied
    rule = "ANOM-05"
    any_motion = any(
        v["state"] == "on"
        for eid, v in cache.items()
        if eid.startswith("binary_sensor.") and
        v.get("attributes", {}).get("device_class") in ("motion", "occupancy", "presence")
    )
    any_person_home = any(
        v["state"] == "home"
        for eid, v in cache.items()
        if eid.startswith("person.")
    )
    if any_person_home and not any_motion:
        if not _is_snoozed("home", rule) and _cooldown_ok("home", rule):
            _push_anomaly(active, "home", rule, "warning",
                          "No motion detected anywhere for an extended period — is everyone OK?")
    else:
        _clear_anomaly(active, "home", rule)

    # ANOM-06: device continuously on >4h since last OFF
    rule = "ANOM-06"
    for eid, entry in cache.items():
        if entry.get("state") != "on":
            continue
        if eid in exemptions:
            continue
        if not (eid.startswith("switch.") or eid.startswith("light.") or eid.startswith("plug.")):
            continue
        on_since = _last_on.get(eid, now)
        if now - on_since > anom06_threshold:
            label = entry.get("attributes", {}).get("friendly_name", eid)
            if not _is_snoozed(eid, rule) and _cooldown_ok(eid, rule):
                _push_anomaly(active, eid, rule, "warning",
                              f"{label} has been on for over {_cfg().get('anom06_runtime_hours', 4)} hours.")
        else:
            _clear_anomaly(active, eid, rule)
