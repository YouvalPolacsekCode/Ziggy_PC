"""
Synchronous request/response wrapper for HA's WebSocket API.

Why this exists
---------------
HA exposes a few capabilities only via WebSocket (no REST equivalent):
  - automation/script traces (`trace/list`, `trace/get`)
  - the modern Template helper config-flow

`ha_subscriber.py` already holds a long-lived WS connection but it's a
single-purpose state subscriber, not a generic command channel. Rather
than retrofit it with a multiplex layer, this helper opens a fresh
short-lived connection per call: HA's auth handshake adds ~50ms, which
is fine for the few-per-page-load latencies we need.

Call pattern: synchronous, blocking. Designed for use inside the FastAPI
worker threads `asyncio.to_thread` already creates for `ha_automations`
calls. Internally runs an asyncio loop per call.
"""
from __future__ import annotations
import asyncio
import json
from typing import Any

from services import ha_client
from core.logger_module import log_error

try:
    import websockets
except ImportError:  # pragma: no cover — dev fallback
    websockets = None  # type: ignore


_AUTH_TIMEOUT = 5.0
_DEFAULT_TIMEOUT = 10.0


def _ws_url() -> str:
    """Convert the configured HA HTTP URL to its WebSocket form."""
    base = ha_client.url().rstrip("/")
    if base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    elif base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    return f"{base}/api/websocket"


def _ha_token() -> str:
    """Extract the bearer token from ha_client's headers."""
    auth = (ha_client.headers() or {}).get("Authorization", "")
    return auth.removeprefix("Bearer ").strip()


async def _run_one(command: dict, timeout: float) -> dict:
    if websockets is None:
        return {"ok": False, "error": "websockets package not installed"}
    url = _ws_url()
    token = _ha_token()
    if not token:
        return {"ok": False, "error": "no HA token configured"}

    try:
        async with websockets.connect(url, ping_interval=None, open_timeout=_AUTH_TIMEOUT) as ws:
            # HA auth handshake: server sends auth_required → we send auth → server sends auth_ok/invalid.
            await asyncio.wait_for(ws.recv(), timeout=_AUTH_TIMEOUT)
            await ws.send(json.dumps({"type": "auth", "access_token": token}))
            auth_resp_raw = await asyncio.wait_for(ws.recv(), timeout=_AUTH_TIMEOUT)
            auth_resp = json.loads(auth_resp_raw)
            if auth_resp.get("type") != "auth_ok":
                return {"ok": False, "error": f"HA WS auth failed: {auth_resp.get('message', 'unknown')}"}

            # Send the command with a fixed id=1 (single command per connection)
            await ws.send(json.dumps({"id": 1, **command}))

            # Drain until we see id=1 result. HA may interleave subscription
            # events; we ignore anything that isn't our result.
            loop = asyncio.get_event_loop()
            deadline = loop.time() + timeout
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    return {"ok": False, "error": "HA WS command timeout"}
                resp_raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                resp = json.loads(resp_raw)
                if resp.get("id") != 1 or resp.get("type") != "result":
                    continue
                if resp.get("success"):
                    return {"ok": True, "result": resp.get("result")}
                err = resp.get("error") or {}
                msg = err.get("message") if isinstance(err, dict) else str(err)
                return {"ok": False, "error": msg or "HA WS command failed"}
    except asyncio.TimeoutError:
        return {"ok": False, "error": "HA WS network timeout"}
    except Exception as e:
        return {"ok": False, "error": f"HA WS error: {e}"}


def ha_ws_command(command: dict, timeout: float = _DEFAULT_TIMEOUT) -> dict:
    """Send one WS command, return {"ok": bool, "result"|"error": ...}.

    Safe to call from FastAPI worker threads (asyncio.to_thread context).
    Internally creates a fresh event loop per call.
    """
    try:
        return asyncio.run(_run_one(command, timeout))
    except RuntimeError as e:
        # Caller is already in an event loop — fall back to a thread.
        # This shouldn't happen in normal flow (callers are sync handlers
        # under asyncio.to_thread, which has no loop) but guard anyway.
        import threading
        out: list[dict[str, Any]] = [{"ok": False, "error": "thread fallback init"}]

        def _target():
            try:
                out[0] = asyncio.run(_run_one(command, timeout))
            except Exception as exc:
                out[0] = {"ok": False, "error": f"thread runner: {exc}"}

        t = threading.Thread(target=_target, daemon=True)
        t.start()
        t.join(timeout=timeout + 5)
        if t.is_alive():
            log_error(f"[ha_ws] command thread did not finish in {timeout + 5}s: {command.get('type')}")
            return {"ok": False, "error": "HA WS thread timeout"}
        return out[0]
