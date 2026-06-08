"""Single Home Assistant client seam.

Every HA-talking module reads credentials and opens connections through this
module. There are no module-level URL/token snapshots anywhere — each call
reads settings live, so an onboarding-time credential change takes effect
without restarting the process.

What this owns
--------------
- Credential access:   url(), token(), ws_url(), headers(), session()
- REST passthroughs:   call_service, get_state, get_all_states, resolve_entity
                       (delegated to services.home_automation, which is the
                       canonical REST implementation — it already reads creds
                       dynamically and pools a shared requests.Session)
- WS helper:           ws(*commands, timeout=4.0) — opens a short-lived
                       authenticated connection, runs N commands, returns
                       N results. Replaces ha_areas._ws (now aliased to this).

What this does NOT own
----------------------
- The long-lived WS connection in services.ha_subscriber. That subscriber is
  the single source of truth for live state and stays where it is. It calls
  url() / token() at connect time so credential changes take effect on the
  next reconnect.
- HA installer's docker-compose manipulation (services.ha_installer) — that's
  outside the protocol surface.

Why not absorb home_automation entirely?
----------------------------------------
home_automation.py is ~620 LOC of well-tested REST helpers plus a resolve-entity
cache. Re-homing that code carries regression risk for no behavioural gain;
ha_client wraps it so callers can import everything from one place without
moving the implementation.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

import websockets

from core.settings_loader import settings


# ── Credential access (always dynamic — no module-level snapshots) ──────────

def url() -> str:
    """Current HA base URL with no trailing slash. Reads settings live."""
    return (settings.get("home_assistant", {}) or {}).get("url", "").rstrip("/")


def token() -> str:
    """Current HA long-lived token. Reads settings live."""
    return (settings.get("home_assistant", {}) or {}).get("token", "")


def ws_url() -> str:
    """Current HA WebSocket URL, derived dynamically from url()."""
    base = url()
    return base.replace("https://", "wss://").replace("http://", "ws://") + "/api/websocket"


def headers() -> dict[str, str]:
    """REST authorization headers built from the current token."""
    return {
        "Authorization": f"Bearer {token()}",
        "Content-Type": "application/json",
    }


def session():
    """Return the shared connection-pooled requests.Session.

    Provided so callers don't open a fresh TCP/TLS connection per HA call
    (previously each ad-hoc requests.post() paid a ~30–60 ms handshake).
    """
    from services.home_automation import _session
    return _session


# ── REST passthroughs ───────────────────────────────────────────────────────
#
# These exist so a caller can `from services import ha_client` and not have
# to know that the actual implementation lives in home_automation.

def call_service(domain: str, service: str, data: dict) -> dict:
    from services.home_automation import call_service as _impl
    return _impl(domain, service, data)


def get_state(entity_id: str) -> dict:
    from services.home_automation import get_state as _impl
    return _impl(entity_id)


def get_all_states() -> list[dict]:
    from services.home_automation import get_all_states as _impl
    return _impl()


def resolve_entity(room: str, sensor_type: str):
    from services.home_automation import resolve_entity as _impl
    return _impl(room, sensor_type)


# ── WS helper (the only place a short-lived HA WS is opened) ────────────────

async def ws(*commands: dict, timeout: float = 4.0) -> list[dict]:
    """Open a WS connection, authenticate, send N commands, return N results.

    Aggressive 4 s timeout matches the pre-seam behaviour from ha_areas._ws:
    when HA's WS is stalled, every caller would otherwise block ~10 s on the
    default handshake timeout and the FE would lock up. Fail fast here so
    callers can return a cached/empty result.

    Fresh connection per call — credentials are read live so a token change
    takes effect on the next call without a restart.
    """
    async with websockets.connect(
        ws_url(),
        open_timeout=timeout,
        ping_interval=None,
        close_timeout=2,
    ) as conn:
        await asyncio.wait_for(conn.recv(), timeout=timeout)  # auth_required
        await conn.send(json.dumps({"type": "auth", "access_token": token()}))
        auth = json.loads(await asyncio.wait_for(conn.recv(), timeout=timeout))
        if auth.get("type") != "auth_ok":
            raise RuntimeError(f"HA WS auth failed: {auth}")
        results: list[dict] = []
        for i, cmd in enumerate(commands, start=1):
            await conn.send(json.dumps({"id": i, **cmd}))
        for _ in commands:
            results.append(json.loads(await asyncio.wait_for(conn.recv(), timeout=timeout)))
        return results
