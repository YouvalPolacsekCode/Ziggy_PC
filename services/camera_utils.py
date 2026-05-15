from __future__ import annotations

from typing import Optional

from core.settings_loader import settings

_HA_URL: str = settings.get("home_assistant", {}).get("url", "").rstrip("/")
_HA_TOKEN: str = settings.get("home_assistant", {}).get("token", "")


def resolve_camera_entity(name: str) -> Optional[str]:
    if name and name.startswith("camera."):
        return name
    cam_map = settings.get("media", {}).get("camera_map", {}) or {}
    return cam_map.get(name.strip().lower())


def ha_camera_stream_url(entity_id: str) -> Optional[str]:
    """Raw HA stream URL — contains the HA token. Do NOT send to frontend."""
    if _HA_URL and _HA_TOKEN and entity_id:
        return f"{_HA_URL}/api/camera_proxy_stream/{entity_id}?token={_HA_TOKEN}"
    return None


def ziggy_camera_stream_url(entity_id: str) -> str:
    """Ziggy-proxied stream URL — safe to send to frontend, HA token stays server-side."""
    return f"/api/cameras/{entity_id}/stream"


def ziggy_camera_snapshot_url(entity_id: str) -> str:
    """Ziggy-proxied snapshot URL — safe to send to frontend."""
    return f"/api/cameras/{entity_id}/snapshot"
