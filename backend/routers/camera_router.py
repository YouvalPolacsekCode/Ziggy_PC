from __future__ import annotations

from datetime import datetime, timedelta, timezone

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from core.logger_module import log_error
from core.settings_loader import settings
from services import ha_client

router = APIRouter()


def _ha_url() -> str:
    return ha_client.url()


def _ha_token() -> str:
    return ha_client.token()


def _headers() -> dict:
    return ha_client.headers()


def _stream_headers() -> dict:
    return {"Authorization": f"Bearer {ha_client.token()}"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ha_ok() -> bool:
    return bool(_ha_url() and _ha_token())


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/cameras")
def list_cameras():
    """List all camera entities from the live HA state cache."""
    from services.ha_subscriber import state_cache

    cameras = []
    for entity_id, data in state_cache.items():
        if not entity_id.startswith("camera."):
            continue
        attrs = data.get("attributes", {})
        cameras.append({
            "entity_id": entity_id,
            "name": attrs.get("friendly_name") or entity_id.split(".")[1].replace("_", " ").title(),
            "state": data.get("state", "unknown"),
            "attributes": attrs,
            "last_changed": data.get("last_changed", ""),
        })
    cameras.sort(key=lambda c: c["name"])
    return {"cameras": cameras}


@router.get("/api/cameras/motion")
def camera_motion_events(hours: int = 24):
    """Recent motion events from HA history for motion binary_sensors and cameras."""
    from services.ha_subscriber import state_cache

    start = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    motion_ids = [
        eid for eid, data in state_cache.items()
        if eid.startswith("binary_sensor.")
        and data.get("attributes", {}).get("device_class") in ("motion", "occupancy", "presence")
    ]
    camera_ids = [eid for eid in state_cache if eid.startswith("camera.")]
    all_ids = motion_ids + camera_ids

    if not all_ids or not _ha_ok():
        return {"events": []}

    try:
        resp = requests.get(
            f"{_ha_url()}/api/history/period/{start}",
            headers=_headers(),
            params={"filter_entity_id": ",".join(all_ids), "minimal_response": "true"},
            timeout=15,
        )
        if not resp.ok:
            return {"events": []}

        events = []
        for entity_history in resp.json():
            if not entity_history:
                continue
            for item in entity_history:
                eid = item.get("entity_id", "")
                state = item.get("state", "")
                if (eid.startswith("binary_sensor.") and state == "on") or \
                   (eid.startswith("camera.") and state in ("recording", "detected")):
                    attrs = item.get("attributes", {})
                    events.append({
                        "entity_id": eid,
                        "name": attrs.get("friendly_name") or eid.split(".")[1].replace("_", " ").title(),
                        "state": state,
                        "timestamp": item.get("last_changed", ""),
                        "type": "camera" if eid.startswith("camera.") else "motion",
                    })

        events.sort(key=lambda e: e["timestamp"], reverse=True)
        return {"events": events[:200]}
    except Exception as e:
        log_error(f"[camera_router] motion_events: {e}")
        return {"events": []}


@router.get("/api/cameras/{entity_id}/snapshot")
def camera_snapshot(entity_id: str):
    """Proxy a JPEG snapshot from HA. HA token stays server-side."""
    if not _ha_ok():
        raise HTTPException(status_code=503, detail="HA not configured")
    try:
        r = requests.get(
            f"{_ha_url()}/api/camera_proxy/{entity_id}",
            headers=_headers(),
            timeout=10,
        )
        if not r.ok:
            raise HTTPException(status_code=r.status_code, detail="HA snapshot failed")
        return Response(
            content=r.content,
            media_type=r.headers.get("Content-Type", "image/jpeg"),
        )
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[camera_router] snapshot {entity_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/api/cameras/{entity_id}/stream")
def camera_stream(entity_id: str):
    """Proxy MJPEG stream from HA. One thread per viewer — suitable for a home LAN."""
    if not _ha_ok():
        raise HTTPException(status_code=503, detail="HA not configured")

    try:
        r = requests.get(
            f"{_ha_url()}/api/camera_proxy_stream/{entity_id}",
            headers=_stream_headers(),
            stream=True,
            timeout=10,
        )
        if not r.ok:
            raise HTTPException(status_code=r.status_code, detail="HA stream failed")

        content_type = r.headers.get("Content-Type", "multipart/x-mixed-replace; boundary=ffserver")

        def _generate():
            try:
                for chunk in r.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            except Exception:
                pass
            finally:
                r.close()

        return StreamingResponse(_generate(), media_type=content_type)
    except HTTPException:
        raise
    except Exception as e:
        log_error(f"[camera_router] stream {entity_id}: {e}")
        raise HTTPException(status_code=502, detail=str(e))
