"""
Ziggy-side scheduler for time-triggered Ziggy-only automations.

HA handles scheduling for automations that contain call_service or state-change
triggers (needs_ha=True). For everything else — IR commands, virtual devices,
intents — the automation is stored in automations.json and this scheduler fires
it at the right local time.

Runs as an asyncio background task started at server startup.
"""
from __future__ import annotations

import asyncio
from datetime import datetime

from core.logger_module import log_error, log_info

_started = False
_tick: int = 0   # increments once per minute, used to schedule sub-hourly periodic tasks


async def run_scheduler() -> None:
    """Fire Ziggy-only time automations at their scheduled minute."""
    global _started, _tick
    if _started:
        return
    _started = True
    log_info("[Scheduler] Ziggy automation scheduler started")

    while True:
        _tick += 1
        now = datetime.now()
        current_time = f"{now.hour:02d}:{now.minute:02d}"

        try:
            from core.automation_file import list_automations
            from services.local_automation_actions import execute_ziggy_actions

            for automation in list_automations():
                if not automation.get("enabled", True):
                    continue
                trigger = automation.get("trigger", {})
                if trigger.get("type") != "time":
                    continue
                if trigger.get("time") != current_time:
                    continue

                auto_id = automation["id"]
                log_info(f"[Scheduler] Firing automation '{automation.get('name', auto_id)}'")
                try:
                    await execute_ziggy_actions(auto_id)
                except Exception as exc:
                    log_error(f"[Scheduler] Execution failed for {auto_id}: {exc}")

        except Exception as exc:
            log_error(f"[Scheduler] Tick error: {exc}")

        # Every minute: clear ANOM-04 if quiet hours have ended (time-boundary cleanup).
        try:
            from services.anomaly_engine import clear_expired_time_anomalies
            from services.ha_subscriber import active_anomalies
            clear_expired_time_anomalies(active_anomalies)
        except Exception as exc:
            log_error(f"[Scheduler] ANOM-04 cleanup failed: {exc}")

        # Hourly: sweep for safety-critical sensors that haven't reported recently (ANOM-10).
        if _tick % 60 == 0:
            try:
                from services.anomaly_engine import sweep_stale_sensors
                from services.ha_subscriber import state_cache, active_anomalies
                await sweep_stale_sensors(state_cache, active_anomalies)
                log_info("[Scheduler] Stale sensor sweep complete")
            except Exception as exc:
                log_error(f"[Scheduler] Stale sensor sweep failed: {exc}")

        # Sleep to the start of the next minute.
        now = datetime.now()
        sleep_secs = 60 - now.second - now.microsecond / 1_000_000
        await asyncio.sleep(max(1.0, sleep_secs))
