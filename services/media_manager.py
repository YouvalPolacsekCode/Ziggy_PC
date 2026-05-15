# services/media_manager.py
from __future__ import annotations

import asyncio
import re
import subprocess
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

    # LG WebOS fallback
    if "webos" in entity_id.lower() or "lg_" in entity_id.lower():
        status2, text2 = _ha_call("webostv", service, {"entity_id": entity_id})
        if 200 <= status2 < 300:
            log_info(f"[media_manager] Fallback webostv.{service} succeeded for {entity_id}")
            return 200, "OK (webostv fallback)"

    # IR blaster fallback — when the TV is physically off, HA can't reach it over the network.
    # If an IR TV device is configured for this room, fire the IR power command instead.
    ir_result = _try_ir_power_fallback(entity_id, turn_on)
    if ir_result:
        return 200, "OK (IR fallback)"

    if status == 500:
        msg = (
            "The TV is off and unreachable over the network. "
            "No IR device is configured for this TV — set one up in the Devices panel."
        )
        log_error(f"[media_manager] TV turn_on failed (500) for {entity_id}, no IR fallback available")
        return 502, msg

    log_error(f"[media_manager] set_tv_power failed: {status} {text}")
    return 502, text


def _try_ir_power_fallback(entity_id: str, turn_on: bool) -> bool:
    """
    Look up an IR TV device for the same room as entity_id and send an IR power command.
    Returns True if the IR command was sent successfully.
    """
    try:
        from services.ir_manager import resolve_ir_device, send_ir_command
        room = _room_for_entity(entity_id)
        if not room:
            return False
        ir_device, _ = resolve_ir_device(room, "tv")
        if not ir_device:
            return False
        result = send_ir_command(ir_device["id"], "power")
        if result.get("ok"):
            log_info(f"[media_manager] IR power fallback succeeded for {entity_id} in {room}")
            return True
    except Exception as e:
        log_error(f"[media_manager] IR fallback error: {e}")
    return False


def _room_for_entity(entity_id: str) -> Optional[str]:
    """Find which room key in device_map contains this entity_id."""
    dm = settings.get("device_map", {}) or {}
    for room, devices in dm.items():
        if entity_id in (devices or {}).values():
            return room
    return None


def set_tv_source(source: str, alias: Optional[str] = None) -> tuple[int, str]:
    entity_id = _resolve_cast_device(alias) or DEFAULT_CAST
    if not entity_id:
        return 400, "No media device configured."
    ok, status, text = _ha_call_detail("media_player", "select_source", {"entity_id": entity_id, "source": source})
    return (200, "OK") if ok else (status or 500, text or "HA call failed")


# ---------- Public Scenarios ----------

async def stream_youtube_to_chromecast_hd(input_text: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    try:
        raw = _extract_url_from_text(input_text) or input_text.strip()
        parsed = _parse_media_request(raw)

        if parsed.get("type") == "youtube":
            play_url = parsed["url"]
        elif parsed.get("type") == "search":
            play_url = _youtube_search_url(parsed["query"])
            if not play_url:
                return {"ok": False, "message": f"Could not find a YouTube video for '{parsed['query']}'.", "data": {}}
        else:
            play_url = parsed.get("url", raw)

        from services.target_resolver import resolve, TargetCapabilityError
        try:
            target = resolve(device_hint, required_capability="video")
        except TargetCapabilityError as e:
            return {"ok": False, "message": str(e), "data": {}}

        if target.type == "browser_display":
            if not target.ws_id:
                return {"ok": False, "message": f"Display '{target.name}' is not currently connected.", "data": {}}
            from backend.ws_manager import manager
            sent = await manager.push_to_display(target.ws_id, {"type": "youtube", "url": play_url, "fullscreen": True})
            if not sent:
                return {"ok": False, "message": f"Could not reach '{target.name}' — is the browser open?", "data": {}}
            return {"ok": True, "message": f"Playing on {target.name}.", "data": {"device": target.name, "url": play_url}}

        # HA media_player path
        dev = target.ha_entity or DEFAULT_CAST
        if not (HA_URL and HA_TOKEN and dev):
            return _todo("Home Assistant URL/token/default media_player not set. "
                         "Set HA_BASE_URL, HA_TOKEN in .env and media.default_cast_device in settings.yaml.")
        if not _ensure_device_on(dev):
            return {"ok": False, "message": f"Failed to turn on {dev}.", "data": {}}

        res = _cast_youtube(play_url, dev)
        if not res["ok"]:
            return res

        ok = await _confirm_playback(dev)
        return {"ok": ok, "message": f"Casting to {dev}.", "data": {"device": dev, "url": play_url}}
    except Exception as e:
        log_error(f"[media.stream_youtube_to_chromecast_hd] {e}")
        return {"ok": False, "message": f"Error: {e}", "data": {}}


async def play_spotify_playlist(target: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    from services.target_resolver import resolve
    t = resolve(device_hint, required_capability="audio")
    dev = t.ha_entity or DEFAULT_SPEAKER or DEFAULT_CAST
    if not (HA_URL and HA_TOKEN and dev):
        return _todo("Configure Spotify integration in Home Assistant and set media.default_speaker or default_cast_device.")

    payload = {"entity_id": dev, "media_content_id": target.strip(), "media_content_type": "music"}
    status, text = _ha_call("media_player", "play_media", payload)
    if not (200 <= status < 300):
        return {"ok": False, "message": f"Failed to send play request to {dev}: {text}", "data": {}}

    _set_media_volume(dev, DEFAULT_VOL)
    ok = await _confirm_playback(dev)
    return {"ok": ok, "message": f"Playing '{target}' on {t.name}.", "data": {"device": dev, "target": target}}


async def start_movie_in_app(title: str, app: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    """Launch a streaming app on a smart TV via HA source selection.
    Note: 'title' is accepted but ignored — no title search is available without
    Plex or platform-specific APIs. This launches the app only."""
    from services.target_resolver import resolve, TargetCapabilityError
    try:
        target = resolve(device_hint, required_capability="video")
    except TargetCapabilityError as e:
        return {"ok": False, "message": str(e), "data": {}}

    if target.type == "browser_display":
        return {"ok": False, "message": "Cannot launch streaming apps on a browser display. Use a smart TV target.", "data": {}}

    dev = target.ha_entity or DEFAULT_CAST
    if not (HA_URL and HA_TOKEN and dev):
        return _todo("Set up AndroidTV/Google TV integration and media.default_cast_device in settings.yaml.")

    ok, status, text = _ha_call_detail("media_player", "select_source", {"entity_id": dev, "source": app})
    if ok:
        note = "" if not title else f" (title search not supported — browse {app} manually for '{title}')"
        return {"ok": True, "message": f"Launched {app} on {target.name}.{note}", "data": {"device": dev, "app": app}}
    return {"ok": False, "message": f"Could not launch {app} on {target.name}: {text}", "data": {}}


async def cast_camera_live(camera_name: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    from services.target_resolver import resolve, TargetCapabilityError
    from services.camera_utils import resolve_camera_entity, ha_camera_stream_url, ziggy_camera_stream_url
    try:
        target = resolve(device_hint, required_capability="video")
    except TargetCapabilityError as e:
        return {"ok": False, "message": str(e), "data": {}}

    cam_entity = resolve_camera_entity(camera_name)
    if not cam_entity:
        return {"ok": False, "message": f"Camera not found: '{camera_name}'. Add it to settings.media.camera_map.", "data": {}}

    if target.type == "browser_display":
        if not target.ws_id:
            return {"ok": False, "message": f"Display '{target.name}' is not currently connected.", "data": {}}
        from backend.ws_manager import manager
        # Use Ziggy proxy URL so the HA token is never sent to the browser
        proxy_url = ziggy_camera_stream_url(cam_entity)
        sent = await manager.push_to_display(target.ws_id, {"type": "camera", "stream_url": proxy_url, "camera_name": camera_name})
        if not sent:
            return {"ok": False, "message": f"Could not reach '{target.name}' — is the browser open?", "data": {}}
        return {"ok": True, "message": f"Showing {camera_name} on {target.name}.", "data": {"device": target.name, "camera": cam_entity}}

    # HA cast path — HA-to-HA stream, raw URL is fine here (server-side only)
    stream_url = ha_camera_stream_url(cam_entity)
    if not stream_url:
        return _todo("Enable camera streaming in HA. Check HA stream component and camera entity.")

    dev = target.ha_entity or DEFAULT_CAST
    if not (HA_URL and HA_TOKEN and dev):
        return _todo("Configure HA and default cast device in settings.yaml > media.default_cast_device.")

    res = _cast_generic_stream(stream_url, dev)
    if not res["ok"]:
        return res
    ok = await _confirm_playback(dev)
    return {"ok": ok, "message": f"Casting {camera_name} to {target.name}.", "data": {"device": dev, "camera": cam_entity}}


async def play_podcast_episode(podcast_name: str, episode_hint: Optional[str] = None, device_hint: Optional[str] = None) -> Dict[str, Any]:
    from services.target_resolver import resolve
    target = resolve(device_hint, required_capability="audio")
    dev = target.ha_entity or DEFAULT_SPEAKER or DEFAULT_CAST
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
    if url.startswith("http"):
        return {"type": "url", "url": url}
    return {"type": "search", "query": url}


def _youtube_search_url(query: str) -> Optional[str]:
    """Resolve a search query to the first YouTube result URL using yt-dlp."""
    try:
        result = subprocess.run(
            ["yt-dlp", "--no-playlist", "--print", "webpage_url", f"ytsearch1:{query}"],
            capture_output=True, text=True, timeout=20,
        )
        if result.returncode == 0:
            url = result.stdout.strip().split("\n")[0]
            if url.startswith("http"):
                log_info(f"[media] yt-dlp resolved '{query}' → {url}")
                return url
        log_error(f"[media._youtube_search_url] yt-dlp returned code {result.returncode}: {result.stderr.strip()}")
    except FileNotFoundError:
        log_error("[media._youtube_search_url] yt-dlp not found. Install with: pip install yt-dlp")
    except Exception as e:
        log_error(f"[media._youtube_search_url] {e}")
    return None


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


async def _confirm_playback(entity_id: str) -> bool:
    try:
        await asyncio.sleep(1.2)
        st = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=HEADERS, timeout=5)
        if st.ok:
            return st.json().get("state") in {"playing", "on", "idle"}
    except Exception as e:
        log_error(f"[media._confirm_playback] {e}")
    return False


def _podcast_search(name: str, episode_hint: Optional[str]) -> Dict[str, Any]:
    """Search iTunes for a podcast episode. Free, no API key required."""
    try:
        query = f"{name} {episode_hint}".strip() if episode_hint else name
        r = requests.get(
            "https://itunes.apple.com/search",
            params={"term": query, "entity": "podcastEpisode", "limit": 5},
            timeout=12,
        )
        if not r.ok:
            return {"ok": False, "message": f"Podcast search failed (HTTP {r.status_code}).", "data": {}}
        results = r.json().get("results", [])
        if not results:
            return {"ok": False, "message": f"No podcast episodes found for '{name}'.", "data": {}}
        ep = results[0]
        stream_url = ep.get("episodeUrl") or ep.get("previewUrl")
        if not stream_url:
            return {"ok": False, "message": "Episode found but no playable stream URL.", "data": ep}
        log_info(f"[media] podcast resolved: {ep.get('trackName')}")
        return {"ok": True, "message": ep.get("trackName", name), "data": {"stream_url": stream_url, "episode": ep}}
    except Exception as e:
        log_error(f"[media._podcast_search] {e}")
        return {"ok": False, "message": f"Podcast search error: {e}", "data": {}}


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
