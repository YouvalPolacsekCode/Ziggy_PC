"""
Persistent HA WebSocket subscriber.

Maintains a single long-lived connection to Home Assistant, receives all
state_changed events, keeps an in-memory state cache, and drives the
anomaly engine on every change.

Startup sequence (critical — prevents stale-state race):
  1. Connect + authenticate
  2. Subscribe to state_changed events (buffering begins)
  3. Full REST state snapshot → populate state_cache
  4. Begin processing buffered + live events

Reconnect sequence:
  1. Wait with exponential backoff (2s → 4s → 8s … cap 60s)
  2. Re-connect + re-authenticate
  3. Re-subscribe (restart buffer)
  4. Full REST snapshot → update state_cache
  5. Resume event processing
"""
from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone
from typing import Any

import websockets
import requests

from core.settings_loader import settings
from core.logger_module import log_info, log_error
from core.debug_bus import bus as _dbus, BASIC, VERBOSE, TRACE
from services import ha_client

# Credentials are read live inside _run_once / _refresh_with_retry. Snapshotting
# them at import time would mean a token rotation only takes effect after a full
# process restart — ha_runtime.set_ha_credentials + kick_reconnect now suffices.

# Shared in-memory state cache.  Read by anomaly_engine and /api/rooms/summary.
# { entity_id: { "state": str, "attributes": dict, "last_changed": str } }
state_cache: dict[str, dict] = {}

# Active anomalies per room.  { room_id: [ { rule_id, severity, message, since } ] }
active_anomalies: dict[str, list] = {}

# Public connection health flag.  True once HA auth + subscription succeeds.
# Becomes False when the connection drops.  Read by /api/health.
ha_connected: bool = False
# Timestamp of the most recent successful reconnect — used by anomaly engine
# to suppress false device-offline alerts caused by HA hiccups. MONOTONIC
# (compared with time.monotonic() in anomaly_engine; do not change to wall
# clock without updating the comparison there).
ha_last_reconnect: float = 0.0
# Same event in wall-clock time, for UIs that need an absolute timestamp
# (System health banner / Settings → Advanced). Updated alongside
# ha_last_reconnect; both are best-effort hints, never used for control flow.
ha_last_reconnect_wall: float = 0.0

_BACKOFF_BASE = 2
_BACKOFF_MAX = 60


def _parse_ha_ts(ts_str: str) -> float:
    """Convert HA ISO timestamp to Unix float.  Returns current time on failure."""
    try:
        dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return dt.astimezone(timezone.utc).timestamp()
    except Exception:
        return time.time()


def _full_state_refresh() -> bool:
    """Fetch all HA states via REST and populate state_cache. Returns True on success.

    Returns the set of entity_ids that were present in the pre-refresh cache
    but absent from HA's fresh snapshot — those need entity_removed broadcasts
    (HA dropped them while we were disconnected; live state_changed with
    new_state=None for the removal never arrived because HA had no socket to
    push it on). The caller broadcasts these so the frontend doesn't keep
    showing ghost entries.
    """
    try:
        resp = requests.get(f"{ha_client.url()}/api/states", headers=ha_client.headers(), timeout=15)
        resp.raise_for_status()
        pre_keys = set(state_cache.keys())
        seen: set[str] = set()
        for entity in resp.json():
            eid = entity.get("entity_id")
            if not eid:
                continue
            seen.add(eid)
            state_cache[eid] = {
                "state":        entity.get("state", "unknown"),
                "attributes":   entity.get("attributes", {}),
                "last_changed": entity.get("last_changed", ""),
            }
            # Seed anomaly engine on/off timestamps from HA's last_changed so
            # ANOM-03 (door open) and ANOM-06 (device runtime) work after restart.
            state       = entity.get("state", "unknown")
            last_changed = entity.get("last_changed", "")
            if last_changed:
                ts = _parse_ha_ts(last_changed)
                try:
                    from services import anomaly_engine as _ae
                    if state == "on":
                        _ae._last_on.setdefault(eid, ts)
                    elif state == "off":
                        _ae._last_off.setdefault(eid, ts)
                except Exception:
                    pass

        _removed = pre_keys - seen
        for eid in _removed:
            state_cache.pop(eid, None)
        _pending_reconnect_removals.update(_removed)
        log_info(
            f"[HASubscriber] State refresh: {len(state_cache)} entities loaded"
            + (f", {len(_removed)} dropped" if _removed else "")
        )
        return True
    except Exception as e:
        log_error(f"[HASubscriber] State refresh failed: {e}")
        return False


# Bucket of entity_ids dropped during a reconnect snapshot. Broadcast by the
# async caller (which has access to the event loop and ws manager); the sync
# refresh helper can't broadcast directly.
_pending_reconnect_removals: set[str] = set()


def _refresh_with_retry(max_attempts: int = 10, base_delay: float = 2.0) -> None:
    """Block until a full state refresh succeeds. Called from async context via run_in_executor."""
    for attempt in range(1, max_attempts + 1):
        if _full_state_refresh():
            return
        delay = min(base_delay * attempt, 30)
        log_info(f"[HASubscriber] Refresh retry {attempt}/{max_attempts} in {delay:.0f}s")
        time.sleep(delay)
    log_error("[HASubscriber] State refresh gave up after max attempts — cache may be stale")


async def _restore_entity_state(entity_id: str) -> None:
    """Replay saved settings after a device regains power."""
    await asyncio.sleep(2)  # Give the device time to fully initialize
    try:
        from services.state_memory import get_restore_payload
        from services.home_automation import call_service
        domain = entity_id.split(".")[0]
        # A light with a default preset wakes into it after a power cut; other
        # entities (and lights without a default) fall back to last-known state.
        payload = None
        source = "state_memory"
        if domain == "light":
            try:
                from services.device_presets import get_default
                default = get_default(entity_id)
                if default:
                    payload = {"entity_id": entity_id, **default["settings"]}
                    source = "default_preset"
            except Exception as e:
                log_error(f"[StateRestore] default lookup failed for {entity_id}: {e}")
        if payload is None:
            payload = get_restore_payload(entity_id)
        if payload:
            result = call_service(domain, "turn_on", payload)
            if result.get("ok"):
                log_info(f"[StateRestore] Restored {entity_id} → {payload} (via {source})")
            else:
                log_error(f"[StateRestore] Failed to restore {entity_id}: {result.get('message')}")
    except Exception as e:
        log_error(f"[StateRestore] Error restoring {entity_id}: {e}")


async def _process_event(event: dict) -> None:
    """Handle a single state_changed event from HA."""
    data = event.get("event", {}).get("data", {})
    entity_id = data.get("entity_id")
    raw_new_state = data.get("new_state")
    raw_old_state = data.get("old_state")
    if not entity_id:
        return

    # Entity removal: HA emits state_changed with new_state=None when the
    # entity is dropped from the registry (manual delete, integration unload,
    # device removal). Without this branch the state_cache row stays forever
    # and /api/ha/entities keeps serving the ghost — that's how a deleted
    # device "reappears" on the Devices page after the user confirms delete.
    if raw_new_state is None:
        had_entry = state_cache.pop(entity_id, None) is not None
        if not had_entry:
            return
        try:
            from backend.ws_manager import manager
            await manager.broadcast({
                "type": "entity_removed",
                "entity_id": entity_id,
            })
        except Exception as e:
            log_error(f"[HASubscriber] removal broadcast failed: {e}")
        _dbus.emit("ha", VERBOSE, "ha_entity_removed", entity_id=entity_id)
        return

    new_state = raw_new_state
    old_state = raw_old_state or {}

    prev_s = old_state.get("state", "")
    new_s = new_state.get("state", "unknown")

    attrs = new_state.get("attributes", {})
    state_cache[entity_id] = {
        "state": new_s,
        "attributes": attrs,
        "last_changed": new_state.get("last_changed", ""),
    }

    # Broadcast to frontend FIRST — this is the user-perceived latency path
    # for "click → tile reflects HA's confirmed state". Every other operation
    # below (manual-override mark, command_router learning, restore check,
    # anomaly evaluate) is internal bookkeeping that doesn't affect the
    # broadcast payload, and used to sit BEFORE it, adding their cost to
    # what users see as the round-trip. None of them mutate `attrs` or
    # `new_s`, so reordering is functionally identical.
    try:
        from backend.ws_manager import manager
        await manager.broadcast({
            "type": "state_changed",
            "entity_id": entity_id,
            "new_state": new_s,
            "attributes": attrs,
        })
    except Exception as e:
        log_error(f"[HASubscriber] broadcast failed: {e}")

    # Manual-override detection — if the user (or another system) just changed
    # a controllable entity and Ziggy did NOT initiate the change, mark it as
    # manually overridden for the default window. The executor will skip steps
    # targeting overridden entities to avoid fighting the user.
    try:
        from services.manual_overrides import (
            was_ziggy_initiated, mark_manual, CONTROLLABLE_DOMAINS,
        )
        if prev_s and new_s and prev_s != new_s:
            domain = entity_id.split(".", 1)[0]
            if domain in CONTROLLABLE_DOMAINS and not was_ziggy_initiated(entity_id):
                mark_manual(entity_id)
    except Exception:
        pass

    # Smart Light Schedule hook — a scheduled light joining/leaving the ramp.
    # off→on: enroll it (snap to the current ramp point). Staying on but with a
    # hand-changed brightness/color (not our own write): mark it manual so the
    # engine backs off "until manually set". Cheap early-out on non-lights.
    if entity_id.startswith("light."):
        try:
            from services import circadian_engine as _circ
            if entity_id in _circ.scheduled_lights():
                if prev_s != "on" and new_s == "on":
                    _circ.on_light_turned_on(entity_id)
                elif prev_s == "on" and new_s == "on" and not was_ziggy_initiated(entity_id):
                    old_a = old_state.get("attributes", {}) or {}
                    if (old_a.get("brightness") != attrs.get("brightness")
                            or old_a.get("color_temp_kelvin") != attrs.get("color_temp_kelvin")):
                        _circ.mark_manual(entity_id)
        except Exception as e:
            log_error(f"[HASubscriber] circadian hook {entity_id}: {e}")

    # Smart Climate Control hook — a watched room temperature sensor reported a
    # new reading. Evaluate that room's thermostat now (event-driven; the engine's
    # ~5 min loop is only a safety net). Cheap early-out on non-sensors.
    if entity_id.startswith("sensor.") and prev_s != new_s:
        try:
            from services import smart_climate_engine as _clim
            if entity_id in _clim.configured_sensors():
                _clim.on_temperature_changed(entity_id, new_s)
        except Exception as e:
            log_error(f"[HASubscriber] smart-climate hook {entity_id}: {e}")

    # TRACE-level: emit every HA state change (very noisy — only in trace mode)
    _dbus.emit("ha", TRACE, "ha_state_changed",
               entity_id=entity_id, prev_state=prev_s, new_state=new_s)

    # Hybrid-routing learning: track last meaningful state per entity, and learn
    # wifi_dies_when_off on hybrid devices that go off → unavailable.
    try:
        from services.command_router import observe_state_transition
        observe_state_transition(entity_id, prev_s, new_s)
    except Exception:
        pass

    # Restore last intentional settings when a device regains power.
    # Trigger: unavailable/unknown → on (physical switch restored / brief outage).
    # A normal software turn-on goes off→on and is excluded.
    # The set of restore-eligible domains is driven by domain_registry (restore_on_reconnect=True).
    if new_s == "on" and prev_s in ("unavailable", "unknown"):
        domain = entity_id.split(".")[0]
        try:
            from services.domain_registry import restore_domains as _restore_domains
            _eligible = _restore_domains()
        except Exception:
            _eligible = frozenset({"light", "climate", "fan"})
        if domain in _eligible:
            asyncio.create_task(_restore_entity_state(entity_id))

    # Drive anomaly evaluation on every state change (already debounced to
    # ~250 ms so this no longer blocks the event handler measurably).
    try:
        from services.anomaly_engine import evaluate
        await evaluate(entity_id, state_cache, active_anomalies)
    except Exception as e:
        log_error(f"[HASubscriber] anomaly evaluate failed: {e}")

    # Self-heal: correlate this change with Ziggy's last intended command and
    # recover devices that repeatedly revert right after a command.
    try:
        from services import self_heal
        await self_heal.observe(entity_id, old_state, new_state)
    except Exception as e:
        log_error(f"[HASubscriber] self_heal observe failed: {e}")


async def _run_once() -> None:
    """One connection attempt: connect, auth, subscribe, refresh, process events."""
    global ha_connected, ha_last_reconnect, ha_last_reconnect_wall
    # Resolve creds at connect time so a credential rotation is picked up on
    # the next reconnect without a process restart.
    ws_url = ha_client.ws_url()
    ha_token = ha_client.token()
    async with websockets.connect(ws_url, ping_interval=30, ping_timeout=10) as ws:
        # Auth handshake
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": ha_token}))
        auth_resp = json.loads(await ws.recv())
        if auth_resp.get("type") != "auth_ok":
            raise RuntimeError(f"HA auth failed: {auth_resp}")

        # Subscribe to state_changed events (id=1)
        await ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "state_changed"}))
        sub_resp = json.loads(await ws.recv())
        if not sub_resp.get("success"):
            raise RuntimeError(f"HA subscribe failed: {sub_resp}")

        import time as _time_mod
        log_info("[HASubscriber] Connected and subscribed. Loading state snapshot…")
        ha_connected = True
        ha_last_reconnect = _time_mod.monotonic()
        ha_last_reconnect_wall = _time_mod.time()
        _dbus.emit("ha", BASIC, "ha_subscriber_connected",
                   url=ws_url, result="ok")

        # Full state refresh before processing any buffered events
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _refresh_with_retry)

        # Broadcast removals that were detected during the snapshot diff.
        # Mirrors the live-deletion path in _process_event so the frontend
        # drops ghost entries instead of showing them until the next refresh.
        if _pending_reconnect_removals:
            try:
                from backend.ws_manager import manager
                for eid in list(_pending_reconnect_removals):
                    await manager.broadcast({"type": "entity_removed", "entity_id": eid})
                    _dbus.emit("ha", VERBOSE, "ha_entity_removed_on_reconnect", entity_id=eid)
            except Exception as e:
                log_error(f"[HASubscriber] reconnect removal broadcast failed: {e}")
            finally:
                _pending_reconnect_removals.clear()

        log_info("[HASubscriber] State snapshot loaded. Processing live events.")
        _dbus.emit("ha", VERBOSE, "ha_state_snapshot_loaded",
                   entity_count=len(state_cache))

        # Main event loop
        async for raw in ws:
            try:
                msg = json.loads(raw)
                if msg.get("type") == "event" and msg.get("id") == 1:
                    await _process_event(msg)
            except Exception as e:
                log_error(f"[HASubscriber] Event processing error: {e}")


async def run_subscriber() -> None:
    """Reconnect loop with exponential backoff. Runs indefinitely."""
    global ha_connected
    attempt = 0
    while True:
        ha_connected = False
        try:
            attempt += 1
            log_info(f"[HASubscriber] Connecting (attempt {attempt})…")
            await _run_once()
        except Exception as e:
            ha_connected = False
            backoff = min(_BACKOFF_BASE ** min(attempt, 6), _BACKOFF_MAX)
            log_error(f"[HASubscriber] Connection lost: {e}. Retry in {backoff}s")
            _dbus.emit("ha", BASIC, "ha_subscriber_disconnected",
                       error=str(e), retry_in_s=backoff, attempt=attempt,
                       result="error",
                       suggestion="Check HA is running and token is valid.")
            await asyncio.sleep(backoff)
        else:
            # Clean disconnect — reset backoff
            ha_connected = False
            attempt = 0
            log_info("[HASubscriber] Connection closed cleanly. Reconnecting…")
            await asyncio.sleep(2)
