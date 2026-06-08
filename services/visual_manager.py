from __future__ import annotations

import os
from typing import Any, Dict, Optional

import requests

from core.logger_module import log_info, log_error
from core.settings_loader import settings
from services import ha_client


def HA_URL() -> str:  # noqa: N802 — callable shim so credential reads stay dynamic
    return ha_client.url()


def HEADERS() -> dict:  # noqa: N802
    return ha_client.headers()


def _resolve_cast_device(hint: Optional[str]) -> Optional[str]:
    media = settings.get("media", {}) or {}
    devmap = {k.lower(): v for k, v in (media.get("device_map") or {}).items()}
    default = media.get("default_cast_device")
    if hint:
        return devmap.get(hint.strip().lower(), default)
    return default


def _cast_stream(url: str, entity_id: str, media_type: str = "video") -> Dict[str, Any]:
    try:
        resp = requests.post(
            f"{HA_URL()}/api/services/media_player/play_media",
            headers=HEADERS(),
            json={"entity_id": entity_id, "media_content_id": url, "media_content_type": media_type},
            timeout=8,
        )
        ok = resp.ok
        if not ok:
            log_error(f"[visual] cast_stream {resp.status_code}: {resp.text}")
        return {"ok": ok, "message": "Cast started." if ok else f"Cast failed: {resp.status_code}"}
    except Exception as e:
        log_error(f"[visual] _cast_stream: {e}")
        return {"ok": False, "message": str(e)}


# ---------------------------------------------------------------------------
# Public Scenarios
# ---------------------------------------------------------------------------

def cast_photo_album(source: str, album_name: str, device_hint: str = "") -> Dict[str, Any]:
    """Show a photo album slideshow. Google Photos requires additional OAuth setup."""
    return {
        "ok": False,
        "message": (
            "Photo album casting requires Google Photos API setup. "
            "For local photos, place images in user_files/photos/ and ask me to cast a slideshow."
        ),
        "data": {},
    }


def cast_today_calendar(device_hint: str = "") -> Dict[str, Any]:
    """Fetch today's calendar events from HA and return a summary."""
    cal_cfg = settings.get("calendar", {})
    entity_ids = cal_cfg.get("entity_ids") or []
    if isinstance(entity_ids, str):
        entity_ids = [entity_ids]

    if not entity_ids:
        return {
            "ok": False,
            "message": "No calendar entity configured. Add calendar.entity_ids to settings.yaml.",
            "data": {},
        }

    from datetime import date, datetime, timedelta
    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    all_events = []
    for eid in entity_ids:
        try:
            resp = requests.get(
                f"{HA_URL()}/api/calendars/{eid}",
                headers=HEADERS(),
                params={"start": today, "end": tomorrow},
                timeout=10,
            )
            if resp.ok:
                all_events.extend(resp.json())
        except Exception as e:
            log_error(f"[visual] calendar fetch {eid}: {e}")

    if not all_events:
        return {"ok": True, "message": "Nothing on the calendar today.", "data": {"events": []}}

    lines = ["📅 Today's calendar:"]
    for ev in all_events:
        start = ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date", "")
        summary = ev.get("summary", "Untitled event")
        if "T" in start:
            try:
                dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
                start = dt.strftime("%H:%M")
            except Exception:
                pass
        lines.append(f"• {start} — {summary}")

    text = "\n".join(lines)
    dev = _resolve_cast_device(device_hint)
    if dev:
        log_info(f"[visual] Calendar displayed on {dev} via broadcast")

    return {"ok": True, "message": text, "data": {"events": all_events}}


def cast_security_camera(camera_name: str, device_hint: str = "") -> Dict[str, Any]:
    """Stream a security camera to a cast device."""
    from services.camera_utils import resolve_camera_entity, ha_camera_stream_url
    cam_entity = resolve_camera_entity(camera_name)
    if not cam_entity:
        return {
            "ok": False,
            "message": f"Camera '{camera_name}' not found. Add it to settings.media.camera_map.",
            "data": {},
        }

    stream_url = ha_camera_stream_url(cam_entity)
    if not stream_url:
        return {"ok": False, "message": "Could not build camera stream URL. Check HA URL/token.", "data": {}}

    dev = _resolve_cast_device(device_hint)
    if dev:
        result = _cast_stream(stream_url, dev)
        if result["ok"]:
            log_info(f"[visual] Casting {cam_entity} to {dev}")
            return {"ok": True, "message": f"Casting {camera_name} to {dev}.", "data": {"device": dev}}
        return result

    return {"ok": True, "message": f"Started camera stream for {camera_name}.", "data": {"camera": cam_entity}}


def cast_image_slideshow(criteria_or_folder: str, device_hint: str = "", duration: Optional[float] = None) -> Dict[str, Any]:
    """Simple image slideshow from local photos folder."""
    photos_dir = os.path.join("user_files", "photos")
    if not os.path.isdir(photos_dir):
        os.makedirs(photos_dir, exist_ok=True)
        return {
            "ok": False,
            "message": f"No photos found. Place images in {photos_dir}/ and try again.",
            "data": {},
        }

    exts = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
    images = [f for f in os.listdir(photos_dir) if os.path.splitext(f)[1].lower() in exts]

    if criteria_or_folder:
        q = criteria_or_folder.lower()
        images = [f for f in images if q in f.lower()] or images

    if not images:
        return {"ok": False, "message": "No matching images found.", "data": {}}

    return {
        "ok": True,
        "message": f"Found {len(images)} images. Slideshow is available in the dashboard.",
        "data": {"images": images, "folder": photos_dir, "duration_s": duration or 5},
    }
