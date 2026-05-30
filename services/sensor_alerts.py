# services/sensor_alerts.py
"""
Polls sensor states and sends Ziggy app push notifications when configured
sensors change to their trigger state (e.g. door opened, motion detected).
"""

from __future__ import annotations

import time
import threading
from datetime import datetime, timedelta
from typing import Callable, Dict, Any

from core.settings_loader import settings
from core.logger_module import log_info, log_error
from core.debug_bus import bus as _dbus, BASIC, VERBOSE
from services.home_automation import get_state
from services.presence_store import any_home

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
_CFG_KEY = "sensor_alerts"
_DEFAULT_POLL = 20       # seconds between polls
_DEFAULT_COOLDOWN = 10   # minutes before re-alerting same sensor


def _cfg() -> Dict[str, Any]:
    return settings.get(_CFG_KEY, {})


def _check_conditions(conditions: Dict[str, Any]) -> bool:
    """Return True if all conditions for this sensor allow the alert to fire."""
    if not conditions:
        return True

    # Presence condition
    presence = conditions.get("presence", "always")
    if presence == "home" and not any_home():
        return False
    if presence == "away" and any_home():
        return False

    # Time window — both time_start and time_end must be set
    time_start = conditions.get("time_start")
    time_end   = conditions.get("time_end")
    if time_start and time_end:
        try:
            now     = datetime.now()
            current = now.hour * 60 + now.minute
            sh, sm  = map(int, time_start.split(":"))
            eh, em  = map(int, time_end.split(":"))
            start_m, end_m = sh * 60 + sm, eh * 60 + em
            if start_m <= end_m:
                in_window = start_m <= current < end_m
            else:                                      # overnight (e.g. 22:00 → 06:00)
                in_window = current >= start_m or current < end_m
            if not in_window:
                return False
        except Exception:
            pass

    return True


# ---------------------------------------------------------------------------
# Alert loop
# ---------------------------------------------------------------------------

def start_sensor_alerts(notify_fn: Callable[[str], None]) -> None:
    """
    Background loop.  notify_fn(message) sends a Ziggy app push notification.
    Runs until the process exits.
    """
    cfg = _cfg()
    if not cfg.get("enabled", True):
        log_info("[SensorAlerts] Disabled in settings.")
        return

    sensors = cfg.get("sensors", [])
    if not sensors:
        log_info("[SensorAlerts] No sensors configured.")
        return

    poll_s = int(cfg.get("poll_interval_s", _DEFAULT_POLL))
    cooldown_min = int(cfg.get("cooldown_minutes", _DEFAULT_COOLDOWN))

    # Track: entity_id → last time we fired an alert
    last_alert: Dict[str, datetime] = {}
    # Track: entity_id → last known state (to detect transitions)
    last_state: Dict[str, str] = {}
    # Track: entity_id → consecutive missing count (suppress repeated log noise)
    missing_count: Dict[str, int] = {}

    log_info(f"[SensorAlerts] Monitoring {len(sensors)} sensor(s). Poll every {poll_s}s.")

    while True:
        try:
            for sensor in sensors:
                entity_id = sensor.get("entity_id", "")
                label = sensor.get("label", entity_id)
                trigger = str(sensor.get("trigger_state", "on")).lower()
                message = sensor.get("message", f"{label} triggered")

                if not entity_id:
                    continue

                # Skip the API call entirely for entities already known to be absent —
                # avoids repeated "Entity not found" log noise from get_state().
                # Re-probe every 10th poll so we notice if the entity comes online.
                miss = missing_count.get(entity_id, 0)
                if miss > 0 and miss % 10 != 0:
                    missing_count[entity_id] = miss + 1
                    continue

                result = get_state(entity_id)
                if not result.get("ok"):
                    prev_missing = missing_count.get(entity_id, 0)
                    missing_count[entity_id] = prev_missing + 1
                    # Log only on first occurrence; suppress subsequent identical misses
                    if prev_missing == 0:
                        log_info(f"[SensorAlerts] Sensor not found: {entity_id} — will retry silently")
                    continue

                # Entity came back after being absent — log recovery once
                if missing_count.pop(entity_id, 0) > 0:
                    log_info(f"[SensorAlerts] Sensor back online: {entity_id}")

                state = str(result["data"].get("state", "")).lower()
                prev = last_state.get(entity_id)
                last_state[entity_id] = state

                # Only fire on a LOW→HIGH transition to trigger state
                if state != trigger or prev == trigger:
                    continue

                # Conditions check (presence, time window) — skipped silently, no cooldown used
                if not _check_conditions(sensor.get("conditions", {})):
                    continue

                # Cooldown check
                now = datetime.now()
                last = last_alert.get(entity_id)
                if last and (now - last) < timedelta(minutes=cooldown_min):
                    continue

                last_alert[entity_id] = now
                log_info(f"[SensorAlerts] Alert: {label} → {state}")
                _dbus.emit("sensor", BASIC, "sensor_alert_fired",
                           entity_id=entity_id, label=label,
                           state=state, trigger=trigger, message=message,
                           result="ok")
                try:
                    from services.push_notify import push_notify_fire_and_forget
                    # Don't block the sensor polling loop on push delivery —
                    # a slow VAPID endpoint must not delay the next sensor read.
                    push_notify_fire_and_forget(f"🔔 {label}", message, "/anomalies", f"sensor:{entity_id}")
                except Exception as e:
                    log_error(f"[SensorAlerts] Push failed: {e}")
                    _dbus.emit("sensor", BASIC, "sensor_alert_push_failed",
                               entity_id=entity_id, error=str(e), result="error")
                # Legacy notify_fn kept for any non-push callers
                if notify_fn is not None:
                    try:
                        notify_fn(f"🔔 {message}")
                    except Exception as e:
                        log_error(f"[SensorAlerts] notify_fn failed: {e}")

        except Exception as e:
            log_error(f"[SensorAlerts] Poll error: {e}")

        time.sleep(poll_s)


def start_sensor_alerts_thread(notify_fn: Callable[[str], None]) -> threading.Thread:
    t = threading.Thread(
        target=start_sensor_alerts,
        args=(notify_fn,),
        name="SensorAlerts",
        daemon=True,
    )
    t.start()
    return t
