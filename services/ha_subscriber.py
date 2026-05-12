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
from typing import Any

import websockets
import requests

from core.settings_loader import settings
from core.logger_module import log_info, log_error

HA_URL: str = settings["home_assistant"]["url"].rstrip("/")
HA_TOKEN: str = settings["home_assistant"]["token"]
WS_URL = HA_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/websocket"
REST_STATES_URL = f"{HA_URL}/api/states"
REST_HEADERS = {"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"}

# Shared in-memory state cache.  Read by anomaly_engine and /api/rooms/summary.
# { entity_id: { "state": str, "attributes": dict, "last_changed": str } }
state_cache: dict[str, dict] = {}

# Active anomalies per room.  { room_id: [ { rule_id, severity, message, since } ] }
active_anomalies: dict[str, list] = {}

_BACKOFF_BASE = 2
_BACKOFF_MAX = 60


def _full_state_refresh() -> bool:
    """Fetch all HA states via REST and populate state_cache. Returns True on success."""
    try:
        resp = requests.get(REST_STATES_URL, headers=REST_HEADERS, timeout=15)
        resp.raise_for_status()
        for entity in resp.json():
            eid = entity.get("entity_id")
            if eid:
                state_cache[eid] = {
                    "state": entity.get("state", "unknown"),
                    "attributes": entity.get("attributes", {}),
                    "last_changed": entity.get("last_changed", ""),
                }
        log_info(f"[HASubscriber] State refresh: {len(state_cache)} entities loaded")
        return True
    except Exception as e:
        log_error(f"[HASubscriber] State refresh failed: {e}")
        return False


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
        payload = get_restore_payload(entity_id)
        if payload:
            domain = entity_id.split(".")[0]
            result = call_service(domain, "turn_on", payload)
            if result.get("ok"):
                log_info(f"[StateRestore] Restored {entity_id} → {payload}")
            else:
                log_error(f"[StateRestore] Failed to restore {entity_id}: {result.get('message')}")
    except Exception as e:
        log_error(f"[StateRestore] Error restoring {entity_id}: {e}")


async def _process_event(event: dict) -> None:
    """Handle a single state_changed event from HA."""
    data = event.get("event", {}).get("data", {})
    entity_id = data.get("entity_id")
    new_state = data.get("new_state") or {}
    old_state = data.get("old_state") or {}
    if not entity_id or not new_state:
        return

    prev_s = old_state.get("state", "")
    new_s = new_state.get("state", "unknown")

    state_cache[entity_id] = {
        "state": new_s,
        "attributes": new_state.get("attributes", {}),
        "last_changed": new_state.get("last_changed", ""),
    }

    # Restore last intentional settings when a device regains power.
    # Trigger: unavailable/unknown → on (physical switch restored / brief outage).
    # A normal software turn-on goes off→on and is excluded.
    if new_s == "on" and prev_s in ("unavailable", "unknown"):
        domain = entity_id.split(".")[0]
        if domain in ("light", "climate", "fan"):
            asyncio.create_task(_restore_entity_state(entity_id))

    # Broadcast to frontend via the shared ws_manager
    try:
        from backend.ws_manager import manager
        await manager.broadcast({
            "type": "state_changed",
            "entity_id": entity_id,
            "new_state": new_s,
            "attributes": new_state.get("attributes", {}),
        })
    except Exception as e:
        log_error(f"[HASubscriber] broadcast failed: {e}")

    # Drive anomaly evaluation on every state change
    try:
        from services.anomaly_engine import evaluate
        await evaluate(entity_id, state_cache, active_anomalies)
    except Exception as e:
        log_error(f"[HASubscriber] anomaly evaluate failed: {e}")


async def _run_once() -> None:
    """One connection attempt: connect, auth, subscribe, refresh, process events."""
    async with websockets.connect(WS_URL, ping_interval=30, ping_timeout=10) as ws:
        # Auth handshake
        await ws.recv()  # auth_required
        await ws.send(json.dumps({"type": "auth", "access_token": HA_TOKEN}))
        auth_resp = json.loads(await ws.recv())
        if auth_resp.get("type") != "auth_ok":
            raise RuntimeError(f"HA auth failed: {auth_resp}")

        # Subscribe to state_changed events (id=1)
        await ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "state_changed"}))
        sub_resp = json.loads(await ws.recv())
        if not sub_resp.get("success"):
            raise RuntimeError(f"HA subscribe failed: {sub_resp}")

        log_info("[HASubscriber] Connected and subscribed. Loading state snapshot…")

        # Full state refresh before processing any buffered events
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _refresh_with_retry)

        log_info("[HASubscriber] State snapshot loaded. Processing live events.")

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
    attempt = 0
    while True:
        try:
            attempt += 1
            log_info(f"[HASubscriber] Connecting (attempt {attempt})…")
            await _run_once()
        except Exception as e:
            backoff = min(_BACKOFF_BASE ** min(attempt, 6), _BACKOFF_MAX)
            log_error(f"[HASubscriber] Connection lost: {e}. Retry in {backoff}s")
            await asyncio.sleep(backoff)
        else:
            # Clean disconnect — reset backoff
            attempt = 0
            log_info("[HASubscriber] Connection closed cleanly. Reconnecting…")
            await asyncio.sleep(2)
