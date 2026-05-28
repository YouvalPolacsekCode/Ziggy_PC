"""
Runtime helpers for changing the Home Assistant connection without a restart.

Owns:
  - probe_ha(url, token): a fast WebSocket-auth probe (no side effects).
  - set_ha_credentials(url, token): persists new URL+token, invalidates caches,
    and kicks the HA WebSocket subscriber so it reconnects with the new values.

These helpers are the runtime side of the onboarding wizard's "Connect Home
Assistant" step and the admin /api/settings/ha PATCH endpoint. ha_areas and
ha_subscriber now read settings dynamically (no module-level constants), so a
single in-memory update + a subscriber kick is enough.
"""
from __future__ import annotations

import asyncio
import json
from typing import Optional

import websockets

from core.settings_loader import save_secrets, save_settings, settings
from core.logger_module import log_error, log_info


async def probe_ha(url: str, token: str, timeout: float = 4.0) -> dict:
    """Verify a candidate URL + token by performing the WS auth handshake.

    Returns {"ok": True, "ha_version": "..."} on success, or
    {"ok": False, "error": "..."} on failure. Never persists anything.
    """
    if not url or not token:
        return {"ok": False, "error": "url and token are required"}

    cleaned = url.rstrip("/")
    ws_url = cleaned.replace("https://", "wss://").replace("http://", "ws://") + "/api/websocket"

    try:
        async with websockets.connect(
            ws_url,
            open_timeout=timeout,
            ping_interval=None,
            close_timeout=2,
        ) as ws:
            hello_raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            hello = json.loads(hello_raw)
            ha_version = hello.get("ha_version", "") if isinstance(hello, dict) else ""

            await ws.send(json.dumps({"type": "auth", "access_token": token}))
            auth_raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            auth = json.loads(auth_raw)
            if auth.get("type") == "auth_ok":
                return {"ok": True, "ha_version": ha_version or auth.get("ha_version", "")}
            return {"ok": False, "error": auth.get("message") or "authentication failed"}
    except asyncio.TimeoutError:
        return {"ok": False, "error": "timed out connecting to Home Assistant"}
    except (websockets.InvalidURI, ValueError):
        return {"ok": False, "error": "invalid Home Assistant URL"}
    except OSError as e:
        return {"ok": False, "error": f"could not reach Home Assistant ({e})"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def set_ha_credentials(url: Optional[str], token: Optional[str]) -> None:
    """Update the URL/token in-memory + on disk, then nudge the subscriber.

    Either field may be None to leave it untouched. Token is persisted to
    config/secrets.yaml; url stays in settings.yaml.
    """
    ha = settings.setdefault("home_assistant", {})

    if url is not None:
        ha["url"] = url.strip()
        try:
            save_settings(settings)
        except Exception as e:
            log_error(f"[ha_runtime] save_settings failed: {e}")

    if token is not None:
        ha["token"] = token.strip()
        try:
            save_secrets({"home_assistant": {"token": token.strip()}})
        except Exception as e:
            log_error(f"[ha_runtime] save_secrets failed: {e}")

    # Drop the registry snapshot so the next read pulls fresh from the new HA.
    try:
        from services.ha_areas import invalidate_registry_cache
        invalidate_registry_cache()
    except Exception:
        pass

    # Kick the subscriber so its outer reconnect loop reopens with new creds.
    try:
        from services import ha_subscriber
        loop = asyncio.get_event_loop_policy().get_event_loop()
        if loop.is_running():
            asyncio.run_coroutine_threadsafe(ha_subscriber.kick_reconnect(), loop)
        else:
            loop.run_until_complete(ha_subscriber.kick_reconnect())
    except RuntimeError:
        # No running loop in this thread — subscriber will pick up the new
        # values on its next natural reconnect anyway.
        pass
    except Exception as e:
        log_error(f"[ha_runtime] kick_reconnect failed: {e}")

    log_info(f"[ha_runtime] HA credentials updated (url={'changed' if url is not None else 'unchanged'}, token={'changed' if token is not None else 'unchanged'})")
