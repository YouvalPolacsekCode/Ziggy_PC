"""
Ziggy-side scheduler for time-triggered and presence-triggered Ziggy-only automations.

HA handles scheduling for automations that contain call_service or state-change
triggers (needs_ha=True). For everything else — IR commands, virtual devices,
intents — the automation is stored in automations.json and this scheduler fires
it at the right local time.

Also runs a 5-minute presence sweep that:
  - Expires stale pings (last_seen > STALE_AFTER_MINUTES) → state degrades to "unknown"
  - Detects home→not_home and not_home→home transitions caused by expiry
  - Fires person_arrives / person_leaves automations on those transitions

Runs as an asyncio background task started at server startup.
"""
from __future__ import annotations

import asyncio
from datetime import datetime

from core.logger_module import log_error, log_info

_started = False
_tick: int = 0   # increments once per minute

# Track last known effective states to detect expiry-driven transitions
_last_effective: dict[str, str] = {}


async def _sweep_presence_expiry() -> None:
    """Mark stale persons as 'unknown' on disk and fire automations for the transitions."""
    try:
        import json
        from pathlib import Path
        from datetime import timezone, timedelta
        from services.presence_store import STALE_AFTER_MINUTES, effective_state

        registry = Path(__file__).resolve().parent.parent / "user_files" / "persons.json"
        if not registry.exists():
            return

        persons = json.loads(registry.read_text(encoding="utf-8"))
        changed = False

        for person in persons:
            pid  = person["id"]
            name = person["name"]
            eff  = effective_state(person)
            prev = _last_effective.get(pid)

            _last_effective[pid] = eff

            if prev is not None and prev != eff:
                # Transition driven by expiry — only fire leave events (home → unknown counts as leaving)
                if prev == "home" and eff == "unknown":
                    log_info(f"[Presence] {name}: ping expired — treating as left (home → unknown)")
                    await _fire_presence_automation("person_leaves", name)

        # Persist cleared state for persons that became unknown via expiry
        if changed:
            registry.write_text(json.dumps(persons, indent=2, ensure_ascii=False), encoding="utf-8")

    except Exception as exc:
        log_error(f"[Scheduler] Presence sweep failed: {exc}")


async def _fire_presence_automation(trigger_type: str, name: str) -> None:
    """Fire all enabled automations matching the given presence trigger_type and person."""
    try:
        from core.automation_file import list_automations
        from services.local_automation_actions import execute_ziggy_actions

        for auto in list_automations():
            if not auto.get("enabled", True):
                continue
            t = auto.get("trigger", {})
            if t.get("type") != trigger_type:
                continue
            person_filter = t.get("person", "*")
            if person_filter != "*" and person_filter.lower() != name.lower():
                continue
            log_info(f"[Scheduler] Firing '{auto.get('name', auto['id'])}' for {trigger_type} ({name})")
            try:
                await execute_ziggy_actions(auto["id"])
            except Exception as exc:
                log_error(f"[Scheduler] Automation {auto['id']} failed: {exc}")
    except Exception as exc:
        log_error(f"[Scheduler] _fire_presence_automation error: {exc}")


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

        # ── Time-triggered automations ────────────────────────────────────────
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

        # ── Every minute: clear ANOM-04 if quiet hours ended ─────────────────
        try:
            from services.anomaly_engine import clear_expired_time_anomalies
            from services.ha_subscriber import active_anomalies
            clear_expired_time_anomalies(active_anomalies)
        except Exception as exc:
            log_error(f"[Scheduler] ANOM-04 cleanup failed: {exc}")

        # ── Every 5 minutes: sweep stale presence pings ───────────────────────
        if _tick % 5 == 0:
            await _sweep_presence_expiry()

        # ── Hourly: sweep stale sensors (ANOM-10) ─────────────────────────────
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
