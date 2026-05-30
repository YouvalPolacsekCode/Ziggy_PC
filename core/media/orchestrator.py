"""
Media orchestrator (v2).

Single entry point used by:
  - the automation action runner (services/local_automation_actions.py)
  - the REST router (backend/routers/media_router.py) — for "test play" buttons
  - the tablet hub widget — for pause/skip/resume

It takes a Ziggy-native verb ("play X from Spotify on speaker Y, member Z")
and dispatches to the right adapter based on the speaker's class:

    cast / sonos        → HA media_player.play_media with the service URI
    spotify_connect     → Spotify Web API transfer_playback (the speaker
                          appears in the member's Spotify Connect device list)
    smart_tv_app        → HA media_player.select_source('Spotify') etc.

Every public function refuses to run when the media_music flag is off.
"""
from __future__ import annotations

from typing import Optional

from core.media.flag import require_enabled
from core.media import audio_devices as speakers_registry
from core.media.adapters import ha as ha_adapter
from core.media.adapters import spotify as spotify_adapter
from core.media.adapters import youtube_music as ytm_adapter
from core.logger_module import log_info, log_error


# ----------------------------- Play -------------------------------------

async def play(
    *,
    speaker_entity: str,
    service: str,                 # "spotify" | "ytmusic"
    profile: str,
    mode: str = "uri",            # "uri" | "search" | "open_app"
    uri: Optional[str] = None,
    query: Optional[str] = None,
    volume: Optional[int] = None, # 0..100
) -> dict:
    require_enabled()
    speaker = speakers_registry.get_speaker(speaker_entity)
    if not speaker:
        return {"ok": False, "reason": "speaker_not_registered"}
    if not speaker.get("enabled"):
        return {"ok": False, "reason": "speaker_not_enabled"}

    klass = speaker.get("class") or "unsupported"
    caps  = speaker.get("capabilities") or {}

    # ---- Validate the service/mode is supported by this class ----
    if mode == "open_app":
        if not caps.get("open_app"):
            return {"ok": False, "reason": "open_app_not_supported_on_speaker"}
        source = _service_to_app_source(service, caps.get("app_sources") or [])
        if not source:
            return {"ok": False, "reason": "app_not_in_source_list"}
        ok, msg = await ha_adapter.select_source(speaker_entity, source)
        return _vol_then(ok, msg, speaker_entity, volume, label=f"open {service}")

    if service == "spotify":
        if not caps.get("spotify_play_uri"):
            return {"ok": False, "reason": "spotify_not_supported_on_speaker"}
        if not spotify_adapter._ensure_token(profile):  # noqa: SLF001
            return {"ok": False, "reason": "spotify_not_authenticated_for_profile"}

        if mode == "search":
            if not query:
                return {"ok": False, "reason": "missing_query"}
            uri = await _spotify_resolve_query_to_uri(profile, query)
            if not uri:
                return {"ok": False, "reason": "spotify_no_results"}
        elif mode == "uri":
            if not uri:
                return {"ok": False, "reason": "missing_uri"}
        else:
            return {"ok": False, "reason": f"unsupported_mode:{mode}"}

        # For spotify_connect speakers, prefer Spotify Web API transfer_playback
        # so the song actually starts even when HA's integration can't drive it.
        if klass == "spotify_connect":
            ok, msg = await _spotify_play_via_connect(profile, speaker, uri)
        else:
            ok, msg = await ha_adapter.play_uri(speaker_entity, uri, content_type="music")
        return _vol_then(ok, msg, speaker_entity, volume, label=f"spotify {mode}")

    if service == "ytmusic":
        if not caps.get("ytmusic_play"):
            return {"ok": False, "reason": "ytmusic_not_supported_on_speaker"}
        if not ytm_adapter.is_member_connected(profile):
            return {"ok": False, "reason": "ytmusic_not_authenticated_for_profile"}

        if mode == "search":
            if not query:
                return {"ok": False, "reason": "missing_query"}
            uri = await ytm_adapter.search_to_stream_url(profile, query)
            if not uri:
                return {"ok": False, "reason": "ytmusic_no_results"}
        elif mode == "uri":
            if not uri:
                return {"ok": False, "reason": "missing_uri"}
        else:
            return {"ok": False, "reason": f"unsupported_mode:{mode}"}

        # YT Music plays via HA Cast — the URI is a YouTube/YT Music URL.
        ok, msg = await ha_adapter.play_uri(speaker_entity, uri, content_type="music")
        return _vol_then(ok, msg, speaker_entity, volume, label=f"ytmusic {mode}")

    return {"ok": False, "reason": f"unsupported_service:{service}"}


# ----------------------------- Transport (hub widget) --------------------

async def pause(speaker_entity: str) -> dict:
    require_enabled()
    ok, msg = await ha_adapter.pause(speaker_entity)
    return {"ok": ok, "msg": msg}


async def resume(speaker_entity: str) -> dict:
    require_enabled()
    ok, msg = await ha_adapter.resume(speaker_entity)
    return {"ok": ok, "msg": msg}


async def next_track(speaker_entity: str) -> dict:
    require_enabled()
    ok, msg = await ha_adapter.next_track(speaker_entity)
    return {"ok": ok, "msg": msg}


async def previous_track(speaker_entity: str) -> dict:
    require_enabled()
    ok, msg = await ha_adapter.previous_track(speaker_entity)
    return {"ok": ok, "msg": msg}


async def set_volume(speaker_entity: str, level_0_to_100: int) -> dict:
    require_enabled()
    lvl = max(0.0, min(1.0, int(level_0_to_100) / 100.0))
    ok, msg = await ha_adapter.set_volume(speaker_entity, lvl)
    return {"ok": ok, "msg": msg}


# ----------------------------- State (hub widget) ------------------------

async def state_all() -> list[dict]:
    """Live state of every enabled speaker. Used by the tablet hub widget."""
    require_enabled()
    out: list[dict] = []
    for sp in speakers_registry.list_enabled_speakers():
        st = await ha_adapter.get_state(sp["entity_id"])
        attrs = (st or {}).get("attributes") or {}
        out.append({
            "entity_id":    sp["entity_id"],
            "display_name": sp.get("display_name") or sp["entity_id"],
            "room":         sp.get("room"),
            "class":        sp.get("class"),
            "state":        (st or {}).get("state") or "unavailable",
            "title":        attrs.get("media_title"),
            "artist":       attrs.get("media_artist"),
            "album":        attrs.get("media_album_name"),
            "art":          attrs.get("entity_picture"),
            "volume":       attrs.get("volume_level"),
            "muted":        attrs.get("is_volume_muted"),
        })
    return out


# ----------------------------- Internals ---------------------------------

def _service_to_app_source(service: str, source_list: list[str]) -> Optional[str]:
    """Find the exact source name in the TV's source_list that matches a service."""
    needle = "spotify" if service == "spotify" else service.lower()
    for s in source_list:
        if needle in s.lower():
            return s
    return None


async def _spotify_resolve_query_to_uri(profile: str, query: str) -> Optional[str]:
    code, body = await spotify_adapter.search(profile, query, kind="track", limit=1)
    if code != 200 or not isinstance(body, dict):
        return None
    items = (body.get("tracks") or {}).get("items") or []
    if not items:
        return None
    return items[0].get("uri")


async def _spotify_play_via_connect(profile: str, speaker: dict, uri: str) -> tuple[bool, str]:
    """For Spotify Connect speakers we must drive the Spotify Web API directly —
    HA's generic media_player.play_media doesn't always work for these."""
    friendly = speaker.get("display_name") or speaker.get("entity_id")
    device_id = await spotify_adapter.find_device_id(profile, friendly or "")
    if not device_id:
        return False, "spotify_connect_device_not_visible"
    code, body = await spotify_adapter.play(profile, uri, device_id=device_id)
    if 200 <= code < 300:
        return True, "ok"
    return False, f"spotify_http_{code}"


def _vol_then(ok: bool, msg: str, entity: str, volume: Optional[int], *, label: str) -> dict:
    """Set volume after a successful playback start. Volume failure does not
    fail the whole operation — we still consider playback started."""
    if ok and volume is not None:
        try:
            lvl = max(0.0, min(1.0, int(volume) / 100.0))
            # Fire-and-forget volume so we don't block the response.
            import asyncio as _asyncio
            _asyncio.create_task(ha_adapter.set_volume(entity, lvl))
        except Exception as e:
            log_error(f"[media.orchestrator] volume set failed: {e}")
    log_info(f"[media.orchestrator] {label} on {entity}: ok={ok} msg={msg}")
    return {"ok": ok, "msg": msg, "target": entity}
