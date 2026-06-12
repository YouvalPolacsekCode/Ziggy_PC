"""
System-health aggregator and Zigbee-recovery state machine.

Owns the layered failure model that /api/health surfaces and the Dashboard
banner renders:

  HA unreachable                  → "Smart home system is offline"
  Coordinator setup_retry/error   → "Zigbee connection problem" + auto-reload
  Coordinator devices unavailable → "Zigbee connection problem" (≥80% offline)
  Many devices offline            → "N devices offline" + "It's OK, I know"
  A few devices offline           → small note, no system banner

The recovery state machine attempts ONE coordinator reload per cooldown window
(default 5 minutes) when a coordinator-level failure is detected. If that
reload doesn't bring the coordinator back to "loaded", it escalates straight
to a manual instruction ("Unplug the Zigbee USB dongle, plug it back in, tap
Retry"). This matches the real-world failure mode where HA's software reload
can't recover a wedged USB stick — only a physical re-enumerate can.

State is in-memory only; resets on Ziggy restart. Acknowledgements and
recovery progress are not persisted.

ZIGGY_HEALTH_AUTORECOVER=0 disables the auto-reload (manual-only mode).
"""
from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field

import requests

from core.debug_bus import bus as _dbus, BASIC, VERBOSE
from core.logger_module import log_info, log_error


# ── Tunables ────────────────────────────────────────────────────────────────
# Fractional thresholds on the offline share among physical devices.
# 0.5 → 50%: warn-level "many devices offline" banner with "It's OK, I know"
# 0.8 → 80%: hard error "Zigbee connection problem", overrides any ack
WARN_OFFLINE_SHARE  = 0.5
ERROR_OFFLINE_SHARE = 0.8
# Minimum total devices before share-based thresholds apply. Below this, a few
# offline devices are just a few — share is meaningless.
MIN_DEVICES_FOR_SHARE = 3
# How long between auto-reload attempts of the same coordinator entry.
RECOVERY_COOLDOWN_S = 5 * 60
# How long to wait after a reload before re-checking the coordinator state.
RECOVERY_VERIFY_DELAY_S = 10
# How long to cache the coordinator config-entry state. Keeps /api/health
# cheap and HA from being hammered by 20s polls; long enough that a flap is
# noticed within ~30s.
COORDINATOR_CACHE_TTL_S = 30
# Per-request budget for the REST call to /api/config/config_entries. The
# main subscriber connection is on its own loop; we don't want the health
# endpoint to ever block longer than this.
COORDINATOR_QUERY_TIMEOUT_S = 4

# Health-level enum. Kept as plain strings so the JSON payload stays simple.
LEVEL_OK       = "ok"
LEVEL_DEGRADED = "degraded"
LEVEL_DOWN     = "down"

# Primary-issue codes the frontend dispatches on.
ISSUE_OK                       = "ok"
ISSUE_HA_UNREACHABLE           = "ha_unreachable"
ISSUE_COORDINATOR_LOADING      = "coordinator_loading"
ISSUE_COORDINATOR_FAILED       = "coordinator_setup_failed"
ISSUE_COORDINATOR_DEVS_GONE    = "coordinator_devices_unavailable"
ISSUE_DEVICES_OFFLINE_MANY     = "devices_offline_many"
ISSUE_DEVICES_OFFLINE          = "devices_offline"

# Manual-action codes returned to the UI when auto-recovery has been exhausted.
MANUAL_REPLUG_DONGLE = "replug_zigbee_dongle"


# ── State (in-memory, module-level) ─────────────────────────────────────────

@dataclass
class CoordinatorState:
    """Snapshot of HA's view of the Zigbee coordinator integration."""
    entry_id: str
    domain: str             # "zha" | "zigbee2mqtt" | "deconz"
    title: str              # user-facing label ("Zigbee hub")
    state: str              # "loaded" | "setup_retry" | "setup_error" | ...
    raw_title: str = ""     # the integration's own title (for Settings → Advanced)


@dataclass
class RecoveryState:
    in_progress: bool = False
    last_attempt_at: float | None = None
    last_result: str | None = None             # "success" | "failed"
    last_attempt_entry_id: str | None = None
    manual_action_code: str | None = None      # set after auto-recovery escalates


@dataclass
class AckState:
    """User-acknowledged set of intentionally-offline devices.

    Invalidated when (a) new devices go offline beyond the acked set, or
    (b) overall offline share crosses ERROR_OFFLINE_SHARE.
    """
    offline_set: frozenset[str] = field(default_factory=frozenset)
    acknowledged_at: float = 0.0


_recovery: RecoveryState = RecoveryState()
_ack:      AckState      = AckState()
_coord_cache:    CoordinatorState | None = None
_coord_cache_at: float                  = 0.0


# ── Public knobs ────────────────────────────────────────────────────────────

def auto_recover_enabled() -> bool:
    """Disabled when ZIGGY_HEALTH_AUTORECOVER=0. Defaults to enabled."""
    return os.getenv("ZIGGY_HEALTH_AUTORECOVER", "1").strip() not in ("0", "false", "no", "")


# ── Coordinator discovery ───────────────────────────────────────────────────

# In preference order. Mirrors backend/routers/health_router._COORDINATOR_DOMAINS;
# kept local so this module is self-contained for tests.
_COORDINATOR_DOMAINS = ("zha", "zigbee2mqtt", "deconz")
_DOMAIN_RANK = {d: i for i, d in enumerate(_COORDINATOR_DOMAINS)}


def _friendly_coord_title(domain: str) -> str:
    """User-facing label. Hides 'ZHA' / 'deCONZ' so the banner stays plain English."""
    return "Zigbee hub"


def _raw_coord_title(domain: str) -> str:
    return {
        "zha":         "Zigbee Home Automation",
        "zigbee2mqtt": "Zigbee2MQTT",
        "deconz":      "deCONZ",
    }.get(domain, domain.upper() or "Unknown")


def fetch_coordinator_state(*, force: bool = False) -> CoordinatorState | None:
    """Query HA for the best-ranked Zigbee coordinator config entry.

    Cached for COORDINATOR_CACHE_TTL_S so 20-second /api/health polling
    doesn't translate into 20-second HA REST polling. Force refresh after a
    reload attempt or on an explicit user "Retry".
    """
    global _coord_cache, _coord_cache_at
    now = time.time()
    if not force and _coord_cache and (now - _coord_cache_at) < COORDINATOR_CACHE_TTL_S:
        return _coord_cache
    try:
        from services import ha_client
        resp = requests.get(
            f"{ha_client.url()}/api/config/config_entries",
            headers=ha_client.headers(),
            timeout=COORDINATOR_QUERY_TIMEOUT_S,
        )
        resp.raise_for_status()
        entries = resp.json()
    except Exception as e:
        # HA REST unreachable — return last-known, do NOT poison the cache.
        log_error(f"[Health] coordinator state fetch failed: {e}")
        return _coord_cache

    best: dict | None = None
    for entry in entries:
        domain = entry.get("domain") or ""
        if domain not in _DOMAIN_RANK:
            continue
        if best is None or _DOMAIN_RANK[domain] < _DOMAIN_RANK[best.get("domain") or ""]:
            best = entry

    if best is None:
        _coord_cache    = None
        _coord_cache_at = now
        return None

    cs = CoordinatorState(
        entry_id=best.get("entry_id") or "",
        domain=best.get("domain") or "",
        title=_friendly_coord_title(best.get("domain") or ""),
        state=best.get("state") or "unknown",
        raw_title=best.get("title") or _raw_coord_title(best.get("domain") or ""),
    )
    _coord_cache    = cs
    _coord_cache_at = now
    return cs


# ── Health computation ──────────────────────────────────────────────────────

# HA config-entry states considered "the integration is broken" rather than
# "still bringing up". Source: homeassistant.config_entries.ConfigEntryState.
_COORDINATOR_BAD_STATES = frozenset({
    "setup_retry",
    "setup_error",
    "migration_error",
    "failed_unload",
    "not_loaded",
})
_COORDINATOR_LOADING_STATES = frozenset({"setup_in_progress"})


def compute_system_health(
    *,
    ha_connected: bool,
    offline_primary_ids: set[str],
    total_devices: int,
    coordinator: CoordinatorState | None,
    now: float | None = None,
) -> dict:
    """Pure mapping from inputs → structured health payload.

    Separated from any HA query so it's trivially unit-testable: tests pass
    synthetic CoordinatorState objects + arbitrary offline sets.
    Side-effects (auto-recovery trigger, ack invalidation) happen here
    because they're all in-memory mutations of module state; HA calls are
    fire-and-forget via asyncio.create_task.
    """
    global _ack
    now = now if now is not None else time.time()

    offline_count = len(offline_primary_ids)
    offline_share = (offline_count / total_devices) if total_devices > 0 else 0.0

    # 1. Determine primary issue from the raw inputs (pre-ack).
    primary, level = _classify(
        ha_connected=ha_connected,
        coordinator=coordinator,
        offline_count=offline_count,
        offline_share=offline_share,
        total_devices=total_devices,
    )

    # 2. Apply / invalidate user acknowledgement.
    ack_active = _apply_acknowledgement(
        offline_primary_ids=offline_primary_ids,
        offline_share=offline_share,
        primary=primary,
    )
    if ack_active and primary == ISSUE_DEVICES_OFFLINE_MANY:
        # Hide the banner — counts still appear in devices.offline.
        primary = ISSUE_OK
        level   = LEVEL_OK

    ack_can_show = (primary == ISSUE_DEVICES_OFFLINE_MANY) and not ack_active

    # 3. Trigger auto-recovery if appropriate (cooldown-gated; once per window).
    #    Cooldown bookkeeping happens HERE (synchronously) so that two close-
    #    together polls don't both schedule a recovery task before either has
    #    a chance to record its own last_attempt_at. _run_auto_recover later
    #    overwrites with its actual start time (a few ms later, harmless).
    if _should_auto_recover(primary, coordinator, now):
        _recovery.last_attempt_at       = now
        _recovery.last_attempt_entry_id = coordinator.entry_id  # type: ignore[union-attr]
        try:
            asyncio.create_task(_run_auto_recover(coordinator))  # type: ignore[arg-type]
        except RuntimeError:
            # No running loop (e.g. sync test path) — skip silently.
            pass

    # 4. Build manual_action payload.
    manual_action = None
    if _recovery.manual_action_code:
        manual_action = {
            "code":      _recovery.manual_action_code,
            "title_key": f"health.manual.{_recovery.manual_action_code}.title",
            "body_key":  f"health.manual.{_recovery.manual_action_code}.body",
        }

    return {
        "level":   level,
        "primary": primary,
        "ha": {
            "reachable":         ha_connected,
            "last_reconnect_at": _safe_last_reconnect(),
        },
        "zigbee": {
            "coordinator_state":    coordinator.state if coordinator else "unknown",
            "coordinator_title":    coordinator.title if coordinator else "",
            "coordinator_entry_id": coordinator.entry_id if coordinator else "",
            "coordinator_domain":   coordinator.domain if coordinator else "",
            "coordinator_raw_title": coordinator.raw_title if coordinator else "",
            "offline_share":        round(offline_share, 3),
        },
        "devices": {
            "total":   total_devices,
            "offline": offline_count,
        },
        "recovery": {
            "in_progress":     _recovery.in_progress,
            "last_attempt_at": _recovery.last_attempt_at,
            "last_result":     _recovery.last_result,
            "manual_action":   manual_action,
            "auto_enabled":    auto_recover_enabled(),
            "cooldown_s":      RECOVERY_COOLDOWN_S,
        },
        "ack": {
            "active":          ack_active,
            "can_acknowledge": ack_can_show,
            "set_size":        len(_ack.offline_set),
        },
    }


def _classify(
    *,
    ha_connected: bool,
    coordinator: CoordinatorState | None,
    offline_count: int,
    offline_share: float,
    total_devices: int,
) -> tuple[str, str]:
    """Pick (primary, level) from raw inputs. Order matters: highest-severity wins."""
    if not ha_connected:
        return ISSUE_HA_UNREACHABLE, LEVEL_DOWN

    # HA reachable but no coordinator integration found at all → treat as OK
    # for system_health purposes (the user may simply not have one yet). The
    # Settings → Pairing flow surfaces the missing integration separately.
    if coordinator is None:
        if total_devices >= MIN_DEVICES_FOR_SHARE and offline_share >= ERROR_OFFLINE_SHARE:
            return ISSUE_DEVICES_OFFLINE_MANY, LEVEL_DEGRADED
        if offline_count > 0:
            return ISSUE_DEVICES_OFFLINE, LEVEL_DEGRADED
        return ISSUE_OK, LEVEL_OK

    if coordinator.state in _COORDINATOR_LOADING_STATES:
        return ISSUE_COORDINATOR_LOADING, LEVEL_DEGRADED

    if coordinator.state in _COORDINATOR_BAD_STATES:
        return ISSUE_COORDINATOR_FAILED, LEVEL_DOWN

    # coordinator.state == "loaded" — fall through to device-level signals.
    if total_devices >= MIN_DEVICES_FOR_SHARE and offline_share >= ERROR_OFFLINE_SHARE:
        # Integration says loaded but ≥80% of devices vanished — looks like a
        # dongle that's still presenting to HA but no longer talking to the
        # mesh. Same user-facing message as a setup_retry coordinator.
        return ISSUE_COORDINATOR_DEVS_GONE, LEVEL_DOWN

    if total_devices >= MIN_DEVICES_FOR_SHARE and offline_share >= WARN_OFFLINE_SHARE:
        return ISSUE_DEVICES_OFFLINE_MANY, LEVEL_DEGRADED

    if offline_count > 0:
        return ISSUE_DEVICES_OFFLINE, LEVEL_DEGRADED

    return ISSUE_OK, LEVEL_OK


def _apply_acknowledgement(
    *,
    offline_primary_ids: set[str],
    offline_share: float,
    primary: str,
) -> bool:
    """Return True if the user's acknowledgement is still valid."""
    global _ack
    if not _ack.offline_set:
        return False

    # Invalidate on HA-down / coordinator failure — that's a real problem, not
    # "user knows these devices are off."
    if primary in (ISSUE_HA_UNREACHABLE, ISSUE_COORDINATOR_FAILED,
                   ISSUE_COORDINATOR_DEVS_GONE, ISSUE_COORDINATOR_LOADING):
        _ack = AckState()
        return False

    # New device(s) went offline beyond the acked set — invalidate so user
    # is told about the new offline device(s).
    if not offline_primary_ids.issubset(_ack.offline_set):
        _ack = AckState()
        return False

    # Escalated past the hard error threshold — invalidate.
    if offline_share >= ERROR_OFFLINE_SHARE:
        _ack = AckState()
        return False

    return True


def _should_auto_recover(primary: str, coordinator: CoordinatorState | None, now: float) -> bool:
    """Gate for auto-triggering a coordinator reload.

    Conditions (all must hold):
      - auto-recovery is enabled by env flag
      - issue is coordinator-level (not just devices-offline at user's home)
      - a coordinator was discovered (entry_id known)
      - no recovery is currently in progress
      - we don't already have a manual_action queued (user needs to physically act)
      - cooldown has elapsed since the last attempt
    """
    if not auto_recover_enabled():
        return False
    if primary not in (ISSUE_COORDINATOR_FAILED, ISSUE_COORDINATOR_DEVS_GONE):
        return False
    if coordinator is None or not coordinator.entry_id:
        return False
    if _recovery.in_progress:
        return False
    if _recovery.manual_action_code:
        return False
    if _recovery.last_attempt_at is not None and (now - _recovery.last_attempt_at) < RECOVERY_COOLDOWN_S:
        return False
    return True


# ── Recovery actions ────────────────────────────────────────────────────────

async def _run_auto_recover(coordinator: CoordinatorState) -> None:
    """One reload attempt; verify; on failure → manual_action.

    Idempotent under concurrent calls: the `in_progress` flag gates a second
    coroutine from racing the first.
    """
    global _recovery
    if _recovery.in_progress:
        return
    _recovery.in_progress           = True
    _recovery.last_attempt_at       = time.time()
    _recovery.last_attempt_entry_id = coordinator.entry_id
    _recovery.last_result           = None

    _dbus.emit("health", BASIC, "auto_recover_started",
               entry_id=coordinator.entry_id, domain=coordinator.domain,
               coordinator_state=coordinator.state)
    log_info(f"[Health] auto-recover started: domain={coordinator.domain} "
             f"entry={coordinator.entry_id} state={coordinator.state}")

    t0 = time.time()
    try:
        from services.home_automation import call_service
        result = call_service(
            "homeassistant", "reload_config_entry",
            {"entry_id": coordinator.entry_id},
        )
        if not result.get("ok"):
            _finalize_recovery(success=False,
                               note=f"reload call failed: {result.get('message')}",
                               t0=t0, coordinator=coordinator)
            return

        # Give HA time to bring the integration back. setup_in_progress for ~5s,
        # then either "loaded" (success) or back to "setup_retry" (dongle still
        # wedged — manual action needed).
        await asyncio.sleep(RECOVERY_VERIFY_DELAY_S)
        fresh = fetch_coordinator_state(force=True)
        if fresh and fresh.state == "loaded":
            _finalize_recovery(success=True,
                               note="coordinator loaded after reload",
                               t0=t0, coordinator=coordinator)
        else:
            note = f"post-verify state={fresh.state if fresh else 'unknown'} (expected 'loaded')"
            _finalize_recovery(success=False, note=note, t0=t0, coordinator=coordinator)
    except Exception as e:
        _finalize_recovery(success=False,
                           note=f"exception: {type(e).__name__}: {e}",
                           t0=t0, coordinator=coordinator)


def _finalize_recovery(
    *,
    success: bool,
    note: str,
    t0: float,
    coordinator: CoordinatorState,
) -> None:
    global _recovery
    previous_manual_action = _recovery.manual_action_code  # capture BEFORE mutating
    latency_ms = int((time.time() - t0) * 1000)
    if success:
        _recovery.last_result        = "success"
        _recovery.manual_action_code = None
        log_info(f"[Health] auto-recover OK ({latency_ms} ms): {note}")
    else:
        _recovery.last_result        = "failed"
        _recovery.manual_action_code = MANUAL_REPLUG_DONGLE
        log_info(f"[Health] auto-recover FAILED ({latency_ms} ms) — manual action queued: {note}")

    # Fire push when manual_action_code transitions None -> MANUAL_REPLUG_DONGLE.
    # Otherwise the user only sees the banner in-app; with a closed tab they'd
    # never know. Web push is best-effort (fire-and-forget, swallows errors)
    # so a missing push subscription can't break the recovery state machine.
    if previous_manual_action is None and _recovery.manual_action_code == MANUAL_REPLUG_DONGLE:
        _push_replug_alert()

    _dbus.emit("health", BASIC, "auto_recover_result",
               entry_id=coordinator.entry_id, ok=success,
               latency_ms=latency_ms, note=note,
               manual_action=_recovery.manual_action_code)
    _recovery.in_progress = False


def _push_replug_alert() -> None:
    """Notify the user the Zigbee coordinator needs physical replug.

    Wired here (inside the recovery state machine) rather than in the FE
    because the banner is only seen when a dashboard tab is open. Real-world
    scenario: Zigbee dies overnight after a Windows update; user discovers it
    next morning. With this push the user gets a phone alert within minutes.
    """
    try:
        from services.push_notify import push_notify_fire_and_forget
        push_notify_fire_and_forget(
            title="Zigbee needs a hand",
            body="Unplug the Zigbee dongle on the hub, wait 5 seconds, plug it back in. Devices will come back automatically.",
            url="/",
            category="system_health",
        )
    except Exception as exc:
        log_error(f"[Health] push_notify_fire_and_forget failed: {exc}")


async def trigger_recover_now() -> dict:
    """User-tapped Retry: bypass cooldown, attempt one reload, return outcome.

    Distinct from auto-recovery in two ways:
      1. Ignores RECOVERY_COOLDOWN_S — user explicitly asked for it.
      2. Clears manual_action_code on success.
    """
    global _recovery
    if _recovery.in_progress:
        return {"ok": False, "in_progress": True,
                "message": "Recovery already in progress."}

    coord = fetch_coordinator_state(force=True)
    if coord is None:
        # No coordinator → nothing to reload. Clear any stale manual_action.
        _recovery.manual_action_code = None
        return {"ok": True, "no_coordinator": True,
                "message": "No Zigbee hub found."}

    if coord.state == "loaded":
        # Already healthy — surface that and clear any prior manual_action so
        # the banner clears the next time the FE polls.
        _recovery.manual_action_code = None
        _recovery.last_result        = "success"
        _recovery.last_attempt_at    = time.time()
        return {"ok": True, "already_healthy": True,
                "message": "Smart home system looks healthy."}

    # Coordinator is unhealthy — run one explicit reload.
    await _run_auto_recover(coord)
    return {
        "ok":         _recovery.last_result == "success",
        "message":    "Retry complete." if _recovery.last_result == "success"
                      else "Reconnect didn't fix it. Please unplug the Zigbee USB dongle, wait 5 seconds, plug it back in, then tap Retry.",
        "result":     _recovery.last_result,
        "manual_action": _recovery.manual_action_code,
    }


# ── Acknowledgement ─────────────────────────────────────────────────────────

def acknowledge_offline(offline_ids: set[str]) -> dict:
    """User tapped 'It's OK, I know' — snapshot the current offline set."""
    global _ack
    _ack = AckState(
        offline_set=frozenset(offline_ids),
        acknowledged_at=time.time(),
    )
    _dbus.emit("health", VERBOSE, "offline_acknowledged", count=len(offline_ids))
    log_info(f"[Health] user acknowledged {len(offline_ids)} offline device(s)")
    return {"ok": True, "acknowledged_count": len(offline_ids)}


def clear_acknowledgement() -> None:
    global _ack
    _ack = AckState()


# ── Helpers ─────────────────────────────────────────────────────────────────

def _safe_last_reconnect() -> float | None:
    """Wall-clock timestamp of the most recent successful HA reconnect, or None."""
    try:
        from services.ha_subscriber import ha_last_reconnect_wall
        return ha_last_reconnect_wall if ha_last_reconnect_wall > 0 else None
    except Exception:
        return None


# ── Test seam ───────────────────────────────────────────────────────────────

def _reset_state_for_tests() -> None:
    """Reset all in-memory state. Tests call this in a fixture."""
    global _recovery, _ack, _coord_cache, _coord_cache_at
    _recovery       = RecoveryState()
    _ack            = AckState()
    _coord_cache    = None
    _coord_cache_at = 0.0


def _peek_state_for_tests() -> dict:
    """Read-only snapshot. Used by tests to assert internal transitions."""
    return {
        "recovery": {
            "in_progress":           _recovery.in_progress,
            "last_attempt_at":       _recovery.last_attempt_at,
            "last_result":           _recovery.last_result,
            "last_attempt_entry_id": _recovery.last_attempt_entry_id,
            "manual_action_code":    _recovery.manual_action_code,
        },
        "ack": {
            "offline_set":     set(_ack.offline_set),
            "acknowledged_at": _ack.acknowledged_at,
        },
    }
