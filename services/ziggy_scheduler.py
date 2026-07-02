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


async def _maybe_post_telemetry() -> None:
    """Fire one telemetry post if relay is configured. Fire-and-forget.

    Same gating as _maybe_poll_ota. Blocking requests calls collect HA +
    psutil state, so we hand the work to a worker thread.
    """
    try:
        from core.settings_loader import settings as _settings
        home_id = (_settings.get("home")  or {}).get("id")
        relay   = _settings.get("relay") or {}
        if not (home_id and relay.get("url") and relay.get("secret")):
            return
        from services.telemetry_client import post_once
        result = await asyncio.to_thread(post_once)
        if result.get("ok"):
            _dbus.emit("telemetry", VERBOSE, "telemetry_post_ok",
                       payload_bytes=result.get("payload_bytes"))
        else:
            _dbus.emit("telemetry", BASIC, "telemetry_post_failed",
                       reason=result.get("reason"))
    except Exception as exc:
        log_error(f"[Scheduler] Telemetry post tick error: {exc}")


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


# Per-day idempotency guard for HA installer apply. Same shape as
# _last_backup_date — prevents two applies in one maintenance window if
# the minute tick straddles drift, and a daily reset means a freshly
# released manifest gets a chance every night.
_last_ha_apply_date: str | None = None


def _within_window(now_hm: str, start: str, end: str) -> bool:
    """Inclusive of start, exclusive of end. Both strings 'HH:MM'.

    Doesn't handle wrap-around (e.g. 23:30 → 01:00). The default window
    03:00–04:00 doesn't cross midnight; if a user reconfigures across
    midnight, the apply just won't fire that night — explicit failure
    is better than a clever wrap that misbehaves at the edge.
    """
    return start <= now_hm < end


async def _maybe_apply_ha_install(now: datetime) -> None:
    """Apply a staged HA manifest if (a) auto_install is enabled, (b) we're
    inside the configured maintenance window, (c) a staged manifest is
    present, and (d) we haven't already applied today.

    Ships DORMANT — ha.auto_install defaults to false in
    config/settings.example.yaml. Flip on a single non-prod hub to
    validate, then roll wider. Manual admin trigger lives in chunk-2.
    """
    global _last_ha_apply_date
    try:
        from core.settings_loader import settings as _settings
        ha_cfg = (_settings.get("ha") or {})
        if not ha_cfg.get("auto_install"):
            return

        window = ha_cfg.get("maintenance_window") or {}
        start = str(window.get("start") or "03:00")
        end   = str(window.get("end")   or "04:00")
        current_hm = f"{now.hour:02d}:{now.minute:02d}"
        if not _within_window(current_hm, start, end):
            return

        today_str = now.date().isoformat()
        if _last_ha_apply_date == today_str:
            return

        # Read the staged manifest. If none, nothing to do.
        from services.ota_client import load_state as _load_ota_state
        ota_state = _load_ota_state()
        staged = ota_state.get("staged")
        installed = ota_state.get("installed") or {}
        if not staged:
            return

        # Defense in depth — if staged matches what's already installed,
        # there's no version delta to apply. apply_manifest itself catches
        # this with `already_at_target`, but skipping the worker-thread
        # spawn entirely is cleaner.
        if installed.get("ha_version") == staged.get("ha_version"):
            return

        _last_ha_apply_date = today_str   # claim the slot before applying

        log_info(
            f"[Scheduler] HA installer: applying staged manifest "
            f"release_id={staged.get('release_id')} "
            f"ha_version={staged.get('ha_version')}"
        )
        from services.ha_installer import apply_manifest
        result = await asyncio.to_thread(apply_manifest, staged)

        if result.get("ok"):
            _dbus.emit("ha_install", BASIC, "ha_install_ok",
                       from_version=result.get("from_version"),
                       to_version=result.get("to_version"),
                       duration_s=result.get("duration_s"))
            log_info(
                f"[Scheduler] HA installer ok: "
                f"{result.get('from_version')} -> {result.get('to_version')} "
                f"in {result.get('duration_s')}s"
            )
        else:
            _dbus.emit("ha_install", BASIC, "ha_install_failed",
                       reason=result.get("reason"),
                       rolled_back=result.get("rolled_back"),
                       from_version=result.get("from_version"),
                       to_version=result.get("to_version"))
            log_error(
                f"[Scheduler] HA installer failed: reason={result.get('reason')} "
                f"rolled_back={result.get('rolled_back')} detail={result.get('detail')}"
            )
    except Exception as exc:
        log_error(f"[Scheduler] HA installer tick error: {exc}")


async def _health_watchdog_tick() -> None:
    """Call compute_system_health from the scheduler so the auto-recovery
    state machine fires even when no dashboard tab is open and no external
    pinger is hitting /health. compute_system_health has side effects
    (schedules fire-and-forget recovery tasks via asyncio.create_task) gated
    by the cooldown inside ha_health, which prevents duplicate attempts when
    this tick races a real /api/health poll.

    Why this exists: today the recovery state machine was only triggered by
    polls. During an overnight Windows-update reboot, the dashboard wasn't
    open and the Zigbee coordinator stayed in "setup_retry" indefinitely
    until the operator noticed manually.
    """
    try:
        from services import ha_health
        from services.ha_subscriber import ha_connected, state_cache
        from services.entity_filter import _should_hide
        offline_ids = {
            eid for eid, e in state_cache.items()
            if not _should_hide(eid) and (e.get("state") in ("unavailable", "unknown"))
        }
        total = sum(1 for eid in state_cache if not _should_hide(eid))
        coord = (await ha_health.fetch_coordinator_state()) if ha_connected else None
        ha_health.compute_system_health(
            ha_connected=ha_connected,
            offline_primary_ids=offline_ids,
            total_devices=total,
            coordinator=coord,
        )
    except Exception as exc:
        log_error(f"[Health] watchdog tick compute failed: {exc}")


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

        # ── Every 5 minutes: post telemetry to relay (Prompt 2 §C) ───────────
        # Same gating rule as OTA: silently skip if relay config absent.
        if _tick % 5 == 0:
            await _maybe_post_telemetry()

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

        # ── Hourly: prune orphaned Ziggy KV records vs HA config_entries ─────
        # Clears smart-sensor KV entries whose HA helper was deleted out from
        # under us (the `test_bedroom` orphan class). Conservative: prunes
        # nothing if HA is unreachable. Off-thread — it opens a short-lived HA
        # WS connection and must not stall the once-per-minute loop.
        if _tick % 60 == 0:
            try:
                from services.ha_reconciler import reconcile_occupancy_sensors
                result = await asyncio.to_thread(reconcile_occupancy_sensors)
                if result.get("pruned"):
                    _dbus.emit("scheduler", BASIC, "occupancy_kv_reconciled",
                               pruned=len(result["pruned"]),
                               rooms=[p.get("room") for p in result["pruned"]])
            except Exception as exc:
                log_error(f"[Scheduler] Occupancy KV reconcile failed: {exc}")

        # ── Every minute: Fake Occupancy scheduler tick ──────────────────────
        # No-op when no activations are registered — safe to call
        # unconditionally. Owns its own lock + persistence; errors are absorbed
        # inside tick() so a bad activation never crashes this loop.
        try:
            from services import fake_occupancy_scheduler
            await fake_occupancy_scheduler.tick(now)
        except Exception as exc:
            log_error(f"[Scheduler] Fake occupancy tick failed: {exc}")

        # ── Every 2 minutes: system-health watchdog tick ─────────────────────
        # Drives the ha_health auto-recovery state machine even when nobody
        # is polling /api/health. Without this tick, the Zigbee-coordinator
        # auto-reload only fires when a dashboard tab is open OR an external
        # pinger (UptimeRobot) is hitting /health. Cooldown inside
        # compute_system_health (RECOVERY_COOLDOWN_S = 5 min) prevents
        # duplicate recovery attempts when both this tick and a poll coincide.
        if _tick % 2 == 0:
            try:
                await _health_watchdog_tick()
            except Exception as exc:
                log_error(f"[Scheduler] Health watchdog tick failed: {exc}")

        # ── Daily: encrypted backup to B2 (DESIGN_BACKUP_DR.md §6) ───────────
        # Time-of-day gated, off unless backup.enabled=true in settings.
        # Runs off-thread so the scheduler keeps ticking during upload.
        await _maybe_fire_daily_backup(now)

        # ── HA installer: apply staged manifest in the maintenance window ────
        # (Prompt 4 chunk 1.E). Dormant unless settings.ha.auto_install=true
        # AND a staged manifest is present AND current time falls inside
        # settings.ha.maintenance_window (default 03:00–04:00, after the
        # 02:00 backup). One apply per day max via _last_ha_apply_date.
        await _maybe_apply_ha_install(now)

        # Sleep to the start of the next minute.
        now = datetime.now()
        sleep_secs = 60 - now.second - now.microsecond / 1_000_000
        await asyncio.sleep(max(1.0, sleep_secs))
