from __future__ import annotations

from typing import Optional

from core.settings_loader import settings
from services import ha_client


def resolve_camera_entity(name: str) -> Optional[str]:
    if name and name.startswith("camera."):
        return name
    cam_map = settings.get("media", {}).get("camera_map", {}) or {}
    return cam_map.get(name.strip().lower())


def ha_camera_stream_url(entity_id: str) -> Optional[str]:
    """Raw HA stream URL — contains the HA token. Do NOT send to frontend."""
    ha_url = ha_client.url()
    ha_token = ha_client.token()
    if ha_url and ha_token and entity_id:
        return f"{ha_url}/api/camera_proxy_stream/{entity_id}?token={ha_token}"
    return None


def ziggy_camera_stream_url(entity_id: str) -> str:
    """Ziggy-proxied stream URL — safe to send to frontend, HA token stays server-side."""
    return f"/api/cameras/{entity_id}/stream"


def ziggy_camera_snapshot_url(entity_id: str) -> str:
    """Ziggy-proxied snapshot URL — safe to send to frontend."""
    return f"/api/cameras/{entity_id}/snapshot"
