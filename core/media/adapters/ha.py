"""
Home Assistant media_player adapter.

Wraps HA's media_player.* services so the orchestrator never speaks HA
syntax directly. Reuses the same HA URL/token already loaded by
services/media_manager.py — no new credentials, no new connection.
"""
from __future__ import annotations

import asyncio
from typing import Any, Optional

import requests

from core.settings_loader import settings
from core.logger_module import log_error, log_info


def _ha_base() -> tuple[str, dict]:
    ha = settings.get("home_assistant") or {}
    url = (ha.get("url") or "").rstrip("/")
    token = ha.get("token") or ""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json",
    }
    return url, headers


def _call_sync(domain: str, service: str, payload: dict) -> tuple[bool, str]:
    url, headers = _ha_base()
    if not url:
        return False, "ha_not_configured"
    try:
        r = requests.post(
            f"{url}/api/services/{domain}/{service}",
            json=payload, headers=headers, timeout=8,
        )
        if r.ok:
            log_info(f"[media.ha] {domain}.{service} -> {r.status_code}")
            return True, "ok"
        log_error(f"[media.ha] {domain}.{service} -> {r.status_code} {r.text}")
        return False, f"http_{r.status_code}"
    except Exception as e:
        log_error(f"[media.ha] {domain}.{service} error: {e}")
        return False, str(e)


async def call_service(domain: str, service: str, payload: dict) -> tuple[bool, str]:
    return await asyncio.to_thread(_call_sync, domain, service, payload)


def _state_sync(entity_id: str) -> Optional[dict]:
    url, headers = _ha_base()
    if not url:
        return None
    try:
        r = requests.get(f"{url}/api/states/{entity_id}", headers=headers, timeout=6)
        if r.ok:
            return r.json()
    except Exception as e:
        log_error(f"[media.ha] state({entity_id}) error: {e}")
    return None


async def get_state(entity_id: str) -> Optional[dict]:
    return await asyncio.to_thread(_state_sync, entity_id)


def _all_media_players_sync() -> list[dict]:
    url, headers = _ha_base()
    if not url:
        return []
    try:
        r = requests.get(f"{url}/api/states", headers=headers, timeout=8)
        if not r.ok:
            return []
        out: list[dict] = []
        for s in r.json():
            ent = s.get("entity_id") or ""
            if ent.startswith("media_player."):
                out.append(s)
        return out
    except Exception as e:
        log_error(f"[media.ha] all_media_players error: {e}")
        return []


async def all_media_players() -> list[dict]:
    return await asyncio.to_thread(_all_media_players_sync)


# ----------------------------- Verbs --------------------------------------

async def play_uri(entity_id: str, uri: str, content_type: str = "music") -> tuple[bool, str]:
    return await call_service("media_player", "play_media", {
        "entity_id": entity_id,
        "media_content_id": uri,
        "media_content_type": content_type,
    })


async def pause(entity_id: str) -> tuple[bool, str]:
    return await call_service("media_player", "media_pause", {"entity_id": entity_id})


async def resume(entity_id: str) -> tuple[bool, str]:
    return await call_service("media_player", "media_play", {"entity_id": entity_id})


async def stop(entity_id: str) -> tuple[bool, str]:
    return await call_service("media_player", "media_stop", {"entity_id": entity_id})


async def next_track(entity_id: str) -> tuple[bool, str]:
    return await call_service("media_player", "media_next_track", {"entity_id": entity_id})


async def previous_track(entity_id: str) -> tuple[bool, str]:
    return await call_service("media_player", "media_previous_track", {"entity_id": entity_id})


async def set_volume(entity_id: str, level_0_to_1: float) -> tuple[bool, str]:
    level = max(0.0, min(1.0, float(level_0_to_1)))
    return await call_service("media_player", "volume_set", {
        "entity_id": entity_id,
        "volume_level": level,
    })


async def volume_up(entity_id: str) -> tuple[bool, str]:
    return await call_service("media_player", "volume_up", {"entity_id": entity_id})


async def volume_down(entity_id: str) -> tuple[bool, str]:
    return await call_service("media_player", "volume_down", {"entity_id": entity_id})


async def turn_on(entity_id: str) -> tuple[bool, str]:
    return await call_service("media_player", "turn_on", {"entity_id": entity_id})


async def select_source(entity_id: str, source: str) -> tuple[bool, str]:
    return await call_service("media_player", "select_source", {
        "entity_id": entity_id,
        "source":    source,
    })
