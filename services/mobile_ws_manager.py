"""
Mobile WebSocket connection manager.

A small registry of active mobile-app WebSocket connections, keyed by
device_id. Lets the rest of the backend deliver realtime events to a specific
device (send_to_device) or every device belonging to a user (send_to_user)
without spinning through the global PWA broadcast bus.

Why a separate registry (and not just extending backend.ws_manager)?
  * PWA broadcasts are unaddressed (every connected web client gets the same
    payload). Mobile delivery is addressed (per-device or per-user fan-out).
  * The PWA manager evicts on a per-message timeout; the mobile manager
    should retry/queue (handled at the caller, not here) and prefer WS over
    push when possible.
  * Keeping the two registries separate means a slow phone never blocks a
    state_changed broadcast to web tabs and vice-versa.

Phase-2 scope: connection lifecycle + targeted send. Phase-3 will add:
  * Bridge: subscribe mobile connections to a filtered subset of the PWA
    broadcast bus (state_changed for entities the user cares about).
  * Push fallback orchestration (if device is offline, route to mobile_push).
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Optional

from fastapi import WebSocket

from core.logger_module import log_info

# Bound any single send so a slow phone can't stall the event loop. Mobile
# is more latency-tolerant than the PWA, so we give it a longer budget than
# ws_manager._BROADCAST_TIMEOUT_S.
_SEND_TIMEOUT_S = 2.0


class MobileConnectionManager:
    def __init__(self) -> None:
        # device_id → WebSocket (one connection per device; reconnects evict
        # the prior socket).
        self._by_device: dict[str, WebSocket] = {}
        # Reverse map for fast lookup on disconnect, since FastAPI passes the
        # WebSocket back to us not the device_id.
        self._by_ws: dict[WebSocket, str] = {}

    async def connect(self, ws: WebSocket, device_id: str) -> None:
        """Register a freshly-accepted WS. Replaces any prior socket for this
        device (a reconnect from the same device wins)."""
        prior = self._by_device.get(device_id)
        if prior is not None and prior is not ws:
            self._by_ws.pop(prior, None)
            try:
                await prior.close(code=4000)
            except Exception:
                pass
        self._by_device[device_id] = ws
        self._by_ws[ws] = device_id
        log_info(f"[mobile_ws] connected device={device_id} total={len(self._by_device)}")

    def disconnect(self, ws: WebSocket) -> Optional[str]:
        """Drop a closed WS; returns the device_id it was bound to."""
        device_id = self._by_ws.pop(ws, None)
        if device_id is not None and self._by_device.get(device_id) is ws:
            self._by_device.pop(device_id, None)
            log_info(f"[mobile_ws] disconnected device={device_id} total={len(self._by_device)}")
        return device_id

    async def send_to_device(self, device_id: str, payload: dict) -> bool:
        """Returns True if the device was connected and the message was sent."""
        ws = self._by_device.get(device_id)
        if ws is None:
            return False
        return await self._send(ws, payload)

    async def send_to_devices(self, device_ids: list[str], payload: dict) -> int:
        """Fan-out to a set of devices. Returns count of successful sends."""
        sends = [self.send_to_device(d, payload) for d in device_ids]
        results = await asyncio.gather(*sends, return_exceptions=False)
        return sum(1 for r in results if r)

    async def send_to_user(self, user_id: str, payload: dict, devices: list[dict]) -> int:
        """Fan-out to every device belonging to a user. Caller supplies the
        list of device records (avoids this module loading from disk on every
        call)."""
        targets = [d["device_id"] for d in devices if d.get("user_id") == user_id]
        return await self.send_to_devices(targets, payload)

    async def broadcast(self, payload: dict) -> int:
        """Send to every connected mobile device. Returns count of successes."""
        items = list(self._by_device.items())
        sends = [self._send(ws, payload) for _, ws in items]
        results = await asyncio.gather(*sends, return_exceptions=False)
        return sum(1 for r in results if r)

    async def _send(self, ws: WebSocket, payload: dict) -> bool:
        try:
            text = json.dumps(payload, default=str)
            await asyncio.wait_for(ws.send_text(text), timeout=_SEND_TIMEOUT_S)
            return True
        except Exception:
            self.disconnect(ws)
            try:
                await ws.close()
            except Exception:
                pass
            return False

    def is_connected(self, device_id: str) -> bool:
        return device_id in self._by_device

    def connected_device_ids(self) -> list[str]:
        return list(self._by_device.keys())

    @property
    def count(self) -> int:
        return len(self._by_device)


# Singleton — import as `from services.mobile_ws_manager import mobile_ws`
mobile_ws = MobileConnectionManager()
