# services/sensor_alerts.py
"""
Polls Home Assistant sensor states and sends Telegram notifications
when configured sensors change to their trigger state (e.g. door opened,
motion detected).  No HA MQTT automation required — uses the HA REST API.
"""

from __future__ import annotations

import time
import threading
from datetime import datetime, timedelta
from typing import Callable, Dict, Any

from core.settings_loader import settings
from core.logger_module import log_info, log_error
from services.home_automation import get_state

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
_CFG_KEY = "sensor_alerts"
_DEFAULT_POLL = 20       # seconds between polls
_DEFAULT_COOLDOWN = 10   # minutes before re-alerting same sensor


def _cfg() -> Dict[str, Any]:
    return settings.get(_CFG_KEY, {})


# ---------------------------------------------------------------------------
# Alert loop
# ---------------------------------------------------------------------------

def start_sensor_alerts(notify_fn: Callable[[str], None]) -> None:
    """
    Background loop.  notify_fn(message) sends a Telegram (or any) notification.
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

                result = get_state(entity_id)
                if not result.get("ok"):
                    continue

                state = str(result["data"].get("state", "")).lower()
                prev = last_state.get(entity_id)
                last_state[entity_id] = state

                # Only fire on a LOW→HIGH transition to trigger state
                if state != trigger or prev == trigger:
                    continue

                # Cooldown check
                now = datetime.now()
                last = last_alert.get(entity_id)
                if last and (now - last) < timedelta(minutes=cooldown_min):
                    continue

                last_alert[entity_id] = now
                log_info(f"[SensorAlerts] Alert: {label} → {state}")
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
