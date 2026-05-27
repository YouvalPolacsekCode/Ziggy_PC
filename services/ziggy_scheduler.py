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
from core.debug_bus import bus as _dbus, BASIC, VERBOSE

_started = False
_tick: int = 0   # increments once per minute

# Per-day idempotency guard for the daily backup tick. Prevents the
# scheduler from firing twice if the HH:MM window straddles tick drift,
# and keeps repeat-day runs from re-firing on restart at 02:00.
_last_backup_date: str | None = None


async def _sweep_presence_expiry() -> None:
    """Detect ping-expiry driven departures and fire automations for them.

    All state-machine logic lives in services.presence_engine.sweep_expiry —
    this scheduler hook only fans out the resulting fired transitions.
    """
    try:
        from services import presence_engine
        decisions = presence_engine.sweep_expiry()
        for decision in decisions:
            presence_engine.log_decision(decision)
            if decision.fired_transition and decision.new_confirmed == "not_home":
                await _fire_presence_automation("person_leaves", decision.person_name)
    except Exception as exc:
        log_error(f"[Scheduler] Presence sweep failed: {exc}")


async def _maybe_fire_daily_backup(now: datetime) -> None:
    """Fire one daily backup if the configured HH:MM matches and we haven't
    already run today. Off unless settings.backup.enabled is true.

    The actual backup runs in a worker thread (via asyncio.to_thread) so a
    multi-minute backup never blocks the once-per-minute scheduler loop.
    Per DESIGN_BACKUP_DR.md §6 the run is fire-and-forget at this layer —
    inner failures land in the audit log via the engine, not here.
    """
    global _last_backup_date
    try:
        from core.settings_loader import settings as _settings
        backup_cfg = _settings.get("backup") or {}
        if not backup_cfg.get("enabled"):
            return
        target_hour = int(backup_cfg.get("schedule_hour", 2))
        target_minute = int(backup_cfg.get("schedule_minute", 0))
        if now.hour != target_hour or now.minute != target_minute:
            return
        today_str = now.date().isoformat()
        if _last_backup_date == today_str:
            return
        _last_backup_date = today_str
        log_info(f"[Scheduler] Firing daily backup at {now.hour:02d}:{now.minute:02d}")
        asyncio.create_task(_run_backup_offthread())
    except Exception as exc:
        log_error(f"[Scheduler] Daily backup tick error: {exc}")


async def _run_backup_offthread() -> None:
    """Build context + run the engine in a worker thread. Logs the outcome."""
    try:
        from services.backup_engine import (
            BackupContext, run_daily_backup_with_lock,
        )
        ctx = BackupContext.from_settings()
        result = await asyncio.to_thread(run_daily_backup_with_lock, ctx)
        if result.get("ok"):
            log_info(
                f"[Scheduler] Backup ok: {result.get('uploaded_bytes', 0)} bytes, "
                f"{len(result.get('files') or [])} files, "
                f"skipped={result.get('optional_skipped') or []}"
            )
        else:
            log_error(
                f"[Scheduler] Backup failed at stage={result.get('stage')}: "
                f"{result.get('error')}"
            )
    except Exception as exc:
        log_error(f"[Scheduler] Backup task crashed: {exc}")


async def _maybe_poll_ota() -> None:
    """Fire one OTA manifest poll if relay is configured. Fire-and-forget.

    Skips silently when settings.home.id / relay.url / relay.secret are not
    all set — a hub provisioned for cloud will have them; a local-only dev
    hub won't. The poller itself uses blocking requests, so we hand it off
    to a worker thread to keep the scheduler loop responsive.
    """
    try:
        from core.settings_loader import settings as _settings
        home_id  = (_settings.get("home")  or {}).get("id")
        relay    = _settings.get("relay") or {}
        if not (home_id and relay.get("url") and relay.get("secret")):
            return
        from services.ota_client import poll_once
        result = await asyncio.to_thread(poll_once)
        if result.get("ok"):
            _dbus.emit("ota", BASIC, "ota_poll_ok",
                       reason=result.get("reason"),
                       staged=result.get("staged"))
            if result.get("staged"):
                log_info(f"[Scheduler] OTA delta staged: {result.get('reason')}")
        else:
            _dbus.emit("ota", BASIC, "ota_poll_failed",
                       reason=result.get("reason"))
            log_error(f"[Scheduler] OTA poll failed: {result.get('reason')}")
    except Exception as exc:
        log_error(f"[Scheduler] OTA poll tick error: {exc}")


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
            _dbus.emit("presence", BASIC, "presence_automation_fired",
                       automation_id=auto["id"], name=auto.get("name", auto["id"]),
                       trigger_type=trigger_type, person=name)
            try:
                await execute_ziggy_actions(
                    auto["id"],
                    label=auto.get("name", auto["id"]),
                    trigger_reason=f"presence:{trigger_type}:{name}",
                )
            except Exception as exc:
                log_error(f"[Scheduler] Automation {auto['id']} failed: {exc}")
                _dbus.emit("presence", BASIC, "presence_automation_failed",
                           automation_id=auto["id"], error=str(exc), result="exception")
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
                auto_name = automation.get("name", auto_id)
                log_info(f"[Scheduler] Firing automation '{auto_name}'")
                _dbus.emit("scheduler", BASIC, "scheduled_automation_fired",
                           automation_id=auto_id, name=auto_name,
                           trigger_time=current_time)
                try:
                    await execute_ziggy_actions(
                        auto_id,
                        label=auto_name,
                        trigger_reason=f"scheduler-time:{current_time}",
                    )
                except Exception as exc:
                    log_error(f"[Scheduler] Execution failed for {auto_id}: {exc}")
                    _dbus.emit("scheduler", BASIC, "scheduled_automation_failed",
                               automation_id=auto_id, name=auto_name,
                               error=str(exc), result="exception")

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

        # ── Every minute: LAN reachability probe for opt-in persons ──────────
        # Matches the engine's dwell_seconds default of 60 s — multiple probes
        # in a row are required to commit a transition.
        try:
            from services.lan_presence import probe_all_persons
            await probe_all_persons()
        except Exception as exc:
            log_error(f"[Scheduler] LAN presence probe failed: {exc}")

        # ── Hourly: sweep stale sensors (ANOM-10) ─────────────────────────────
        if _tick % 60 == 0:
            try:
                from services.anomaly_engine import sweep_stale_sensors
                from services.ha_subscriber import state_cache, active_anomalies
                await sweep_stale_sensors(state_cache, active_anomalies)
                log_info("[Scheduler] Stale sensor sweep complete")
            except Exception as exc:
                log_error(f"[Scheduler] Stale sensor sweep failed: {exc}")

        # ── Hourly: poll OTA manifest from relay (Prompt 2 §B) ───────────────
        # Gated by relay config presence. A hub with no relay.url / secret /
        # home.id silently skips — that's the legitimate "local-only dev hub"
        # state, not an error. Burst-at-xx:00 across the fleet is fine for the
        # first 30 customers; add jitter when the fleet grows.
        if _tick % 60 == 0:
            await _maybe_poll_ota()

        # ── Daily: encrypted backup to B2 (DESIGN_BACKUP_DR.md §6) ───────────
        # Time-of-day gated, off unless backup.enabled=true in settings.
        # Runs off-thread so the scheduler keeps ticking during upload.
        await _maybe_fire_daily_backup(now)

        # Sleep to the start of the next minute.
        now = datetime.now()
        sleep_secs = 60 - now.second - now.microsecond / 1_000_000
        await asyncio.sleep(max(1.0, sleep_secs))
