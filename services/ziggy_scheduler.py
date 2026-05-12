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


async def run_scheduler() -> None:
    """Fire Ziggy-only time automations at their scheduled minute."""
    global _started
    if _started:
        return
    _started = True
    log_info("[Scheduler] Ziggy automation scheduler started")

    while True:
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

        # Sleep to the start of the next minute.
        now = datetime.now()
        sleep_secs = 60 - now.second - now.microsecond / 1_000_000
        await asyncio.sleep(max(1.0, sleep_secs))
