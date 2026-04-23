# services/media_manager.py
from __future__ import annotations

import re
import time
from typing import Optional, Dict, Any

import requests

from core.settings_loader import settings
from core.logger_module import log_info, log_error

HA_URL = settings.get("home_assistant", {}).get("url", "").rstrip("/")
HA_TOKEN = settings.get("home_assistant", {}).get("token", "")
DEFAULT_CAST = settings.get("media", {}).get("default_cast_device", None)
DEFAULT_SPEAKER = settings.get("media", {}).get("default_speaker", None)
DEFAULT_VOL = settings.get("media", {}).get("default_volume", 0.35)

HEADERS = {
    "Authorization": f"Bearer {HA_TOKEN}",
    "Content-Type": "application/json",
}


# ---------- Alias/entity helpers ----------

def _norm(s: str) -> str:
    return " ".join(str(s).strip().lower().split())


def _device_map() -> Dict[str, str]:
    media = settings.get("media", {}) or {}
    return {_norm(k): v for k, v in (media.get("device_map") or {}).items()}


def get_media_entity_id(alias: Optional[str] = None) -> str:
    """
    Resolve media_player entity_id from settings['media'].
    If alias provided, look up in device_map (normalized).
    Falls back to default_cast_device.
    """
    devmap = _device_map()
    if alias:
        ent = devmap.get(_norm(alias))
        if ent:
            return ent
    ent = DEFAULT_CAST
    if not ent:
        raise ValueError("No media device found: set media.default_cast_device or media.device_map.")
    return ent


def set_tv_power(turn_on: bool, alias: str | None = None) -> tuple[int, str]:
    entity_id = _resolve_cast_device(alias) or DEFAULT_CAST
    if not entity_id:
        return 400, "No media device configured."

    log_info(f"[media_manager] set_tv_power -> alias='{alias}', resolved entity_id='{entity_id}'")

    if not entity_id.startswith("media_player."):
        return 400, f"Expected a media_player entity, got {entity_id}"

    service = "turn_on" if turn_on else "turn_off"
    status, text = _ha_call("media_player", service, {"entity_id": entity_id})
    if 200 <= status < 300:
        return 200, "OK"

    # webostv fallback only for LG WebOS TVs — other devices don't support this domain
    if "webos" in entity_id.lower() or "lg_" in entity_id.lower():
        status2, text2 = _ha_call("webostv", service, {"entity_id": entity_id})
        if 200 <= status2 < 300:
            log_info(f"[media_manager] Fallback webostv.{service} succeeded for {entity_id}")
            return 200, "OK (fallback)"
        err = f"HA call failed: media_player.{service} -> {status} {text}; fallback webostv.{service} -> {status2} {text2}"
    else:
        err = f"HA call failed: media_player.{service} -> {status} {text}"

    log_error(f"[media_manager] {err}")
    return 502, err


def set_tv_source(source: str, alias: Optional[str] = None) -> tuple[int, str]:
    entity_id = _resolve_cast_device(alias) or DEFAULT_CAST
    if not entity_id:
        return 400, "No media device configured."
    ok, status, text = _ha_call_detail("media_player", "select_source", {"entity_id": entity_id, "source": source})
    return (200, "OK") if ok else (status or 500, text or "HA call failed")


# ---------- Public Scenarios ----------

def stream_youtube_to_chromecast_hd(input_text: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    try:
        url = _extract_url_from_text(input_text) or input_text.strip()
        dev = _resolve_cast_device(device_hint) or DEFAULT_CAST
        if not (HA_URL and HA_TOKEN and dev):
            return _todo("Home Assistant URL/token/default media_player not set. "
                         "Set HA_BASE_URL, HA_TOKEN in .env and media.default_cast_device in settings.yaml.")
        if not _ensure_device_on(dev):
            return {"ok": False, "message": f"Failed to turn on {dev}.", "data": {}}

        parsed = _parse_media_request(url)
        if parsed.get("type") == "youtube":
            res = _cast_youtube(parsed["url"], dev, quality="1080p")
        else:
            res = _cast_generic_stream(parsed.get("url", url), dev)

        if not res["ok"]:
            return res

        ok = _confirm_playback(dev)
        return {"ok": ok, "message": f"Casting to {dev}.", "data": {"device": dev, "url": url}}
    except Exception as e:
        log_error(f"[media.stream_youtube_to_chromecast_hd] {e}")
        return {"ok": False, "message": f"Error: {e}", "data": {}}


def play_spotify_playlist(target: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    dev = _resolve_audio_device(device_hint) or DEFAULT_SPEAKER or DEFAULT_CAST
    if not (HA_URL and HA_TOKEN and dev):
        return _todo("Configure Spotify integration in Home Assistant and set media.default_speaker or default_cast_device.")

    payload = {"entity_id": dev, "media_content_id": target.strip(), "media_content_type": "music"}
    status, text = _ha_call("media_player", "play_media", payload)
    if not (200 <= status < 300):
        return {"ok": False, "message": f"Failed to send play request to {dev}: {text}", "data": {}}

    _set_media_volume(dev, DEFAULT_VOL)
    ok = _confirm_playback(dev)
    return {"ok": ok, "message": f"Playing '{target}' on {dev}.", "data": {"device": dev, "target": target}}


def start_movie_in_app(title: str, app: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    dev = _resolve_cast_device(device_hint) or DEFAULT_CAST
    if not (HA_URL and HA_TOKEN and dev):
        return _todo("Set up AndroidTV/Google TV integration and media.default_cast_device in settings.yaml.")
    return _todo("Implement app launch via Home Assistant service (e.g., androidtv.adb_command or remote.send_command). "
                 "Then implement _find_media_in_app() and _play_media_in_app().")


def cast_camera_live(camera_name: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    dev = _resolve_cast_device(device_hint) or DEFAULT_CAST
    if not (HA_URL and HA_TOKEN and dev):
        return _todo("Configure HA and default cast device in settings.yaml > media.default_cast_device.")

    cam_entity = _resolve_camera_entity(camera_name)
    if not cam_entity:
        return {"ok": False, "message": f"Camera not found: {camera_name}", "data": {}}

    stream_url = _get_camera_stream_url(cam_entity)
    if not stream_url:
        return _todo("Enable camera streaming in HA. Some cameras need stream component. Check camera.get_stream.")

    res = _cast_generic_stream(stream_url, dev)
    if not res["ok"]:
        return res
    ok = _confirm_playback(dev)
    return {"ok": ok, "message": f"Casting {camera_name} to {dev}.", "data": {"device": dev, "camera": cam_entity}}


def play_podcast_episode(podcast_name: str, episode_hint: Optional[str] = None, device_hint: Optional[str] = None) -> Dict[str, Any]:
    dev = _resolve_audio_device(device_hint) or DEFAULT_SPEAKER or DEFAULT_CAST
    if not (HA_URL and HA_TOKEN and dev):
        return _todo("Set HA URL/token and media.default_speaker in settings.yaml.")

    search = _podcast_search(podcast_name, episode_hint)
    if not search.get("ok"):
        return search
    url = search["data"].get("stream_url")
    if not url:
        return {"ok": False, "message": "No playable episode stream found.", "data": search["data"]}
    return _play_podcast(url, dev)


# ---------- Internal / Atomic ----------

def _extract_url_from_text(text: str) -> Optional[str]:
    m = re.search(r"(https?://\S+)", text or "")
    return m.group(1) if m else None


def _parse_media_request(query_or_url: str) -> Dict[str, Any]:
    url = query_or_url.strip()
    if re.search(r"(youtu\.be/|youtube\.com/)", url, re.I):
        return {"type": "youtube", "url": url}
    return {"type": "url", "url": url}


def _resolve_cast_device(device_hint: Optional[str]) -> Optional[str]:
    if device_hint and "." in device_hint:
        return device_hint
    devmap = _device_map()
    if device_hint:
        return devmap.get(_norm(device_hint), DEFAULT_CAST)
    return DEFAULT_CAST


def _resolve_audio_device(device_hint: Optional[str]) -> Optional[str]:
    return _resolve_cast_device(device_hint) or DEFAULT_SPEAKER


def _ensure_device_on(entity_id: str) -> bool:
    status, _ = _ha_call("media_player", "turn_on", {"entity_id": entity_id})
    return 200 <= status < 300


def _cast_youtube(url: str, entity_id: str, quality: str = "1080p") -> Dict[str, Any]:
    payload = {"entity_id": entity_id, "media_content_id": url, "media_content_type": "video"}
    status, _ = _ha_call("media_player", "play_media", payload)
    ok = 200 <= status < 300
    if not ok:
        return _todo("Install/enable 'media_extractor' or YouTube integration in Home Assistant.")
    _set_media_volume(entity_id, DEFAULT_VOL)
    return {"ok": True, "message": "Casting YouTube.", "data": {"entity_id": entity_id, "url": url, "quality": quality}}


def _set_media_volume(entity_id: str, level: Optional[float] = None) -> None:
    if level is None:
        return
    try:
        _ha_call("media_player", "volume_set", {"entity_id": entity_id, "volume_level": float(level)})
    except Exception as e:
        log_error(f"[media._set_media_volume] {e}")


def _confirm_playback(entity_id: str) -> bool:
    try:
        time.sleep(1.2)
        st = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=HEADERS, timeout=5)
        if st.ok:
            return st.json().get("state") in {"playing", "on", "idle"}
    except Exception as e:
        log_error(f"[media._confirm_playback] {e}")
    return False


def _podcast_search(name: str, episode_hint: Optional[str]) -> Dict[str, Any]:
    return _todo("Podcast search not configured. Add PodcastIndex keys to .env and implement API call.")


def _play_podcast(stream_url: str, entity_id: str) -> Dict[str, Any]:
    status, _ = _ha_call("media_player", "play_media", {
        "entity_id": entity_id,
        "media_content_id": stream_url,
        "media_content_type": "audio",
    })
    ok = 200 <= status < 300
    if not ok:
        return {"ok": False, "message": "Failed to start podcast.", "data": {"entity_id": entity_id}}
    _set_media_volume(entity_id, DEFAULT_VOL)
    return {"ok": True, "message": "Podcast playing.", "data": {"entity_id": entity_id, "url": stream_url}}


def _find_media_in_app(title: str, app: str) -> Dict[str, Any]:
    return _todo("App search not implemented. Add media.app_map (app->package) and implement provider search API.")


def _play_media_in_app(media_id: str, entity_id: str) -> Dict[str, Any]:
    return _todo("App media play not implemented. Use appropriate HA service for your platform.")


def _cast_generic_stream(url: str, entity_id: str) -> Dict[str, Any]:
    status, _ = _ha_call("media_player", "play_media", {
        "entity_id": entity_id,
        "media_content_id": url,
        "media_content_type": "video",
    })
    ok = 200 <= status < 300
    return {
        "ok": ok,
        "message": "Casting stream." if ok else "Failed to cast stream.",
        "data": {"entity_id": entity_id, "url": url},
    }


def _resolve_camera_entity(name: str) -> Optional[str]:
    if name and name.startswith("camera."):
        return name
    devmap = settings.get("media", {}).get("camera_map", {}) or {}
    return devmap.get(_norm(name or ""))


def _get_camera_stream_url(entity_id: str) -> Optional[str]:
    return None


# ---------- HA HTTP helpers ----------

def _ha_call(domain: str, service: str, payload: Dict[str, Any]) -> tuple[int, str]:
    try:
        url = f"{HA_URL}/api/services/{domain}/{service}"
        r = requests.post(url, json=payload, headers=HEADERS, timeout=8)
        if r.ok:
            log_info(f"[HA call] {domain}.{service} -> {r.status_code}")
        else:
            log_error(f"[HA call] {domain}.{service} -> {r.status_code} {r.text}")
        return r.status_code, r.text
    except Exception as e:
        log_error(f"[HA call error] {domain}.{service}: {e}")
        return 0, str(e)


def _ha_call_detail(domain: str, service: str, payload: Dict[str, Any]) -> tuple[bool, Optional[int], Optional[str]]:
    try:
        url = f"{HA_URL}/api/services/{domain}/{service}"
        r = requests.post(url, json=payload, headers=HEADERS, timeout=8)
        if not r.ok:
            log_error(f"[HA call] {domain}.{service} -> {r.status_code} {r.text}")
        return (r.ok, r.status_code, r.text if not r.ok else "OK")
    except Exception as e:
        log_error(f"[HA call error] {domain}.{service}: {e}")
        return (False, None, str(e))


def _todo(msg: str) -> Dict[str, Any]:
    return {"ok": False, "message": f"TODO: {msg}", "data": {}}
