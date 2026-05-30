"""
Media / music REST API (v2).

Surfaces:
  Settings page  → speakers list, per-member Spotify + YT Music connect.
  Automation builder → search + playlists for the picker; classification info.
  Tablet hub widget → speakers state + transport controls.

Every route refuses to serve when the media_music flag is off, returning 404
with body {"ok": false, "reason": "feature_disabled"}. The flag is checked
per request so toggling it in Settings → Feature flags takes effect without
a server restart.
"""
from __future__ import annotations

import secrets as _stdlib_secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from core.media import flag as media_flag
from core.media import audio_devices as speakers_registry
from core.media import profiles as profile_registry
from core.media import orchestrator
from core.media.adapters import ha as ha_adapter
from core.media.adapters import spotify as spotify_adapter
from core.media.adapters import youtube_music as ytm_adapter
from .auth_deps import get_current_user, require_role


router = APIRouter(prefix="/api/media")


# ----------------------------- Flag gate ----------------------------------

async def _require_media_enabled() -> None:
    if not media_flag.is_enabled():
        raise HTTPException(status_code=404, detail=media_flag.disabled_response())


# In-memory map of OAuth state tokens → member (Spotify only — YT Music has
# no OAuth round-trip). Lost on restart; user just clicks Connect again.
_OAUTH_STATES: dict[str, str] = {}


# ============================================================================
# Capability probe
# ============================================================================

@router.get("/capabilities")
async def get_capabilities(_user: dict = Depends(get_current_user)):
    """Single endpoint the frontend pings to know if media is on + what
    services are usable at the app level. Always reachable so the UI knows
    when to hide its mounts."""
    enabled = media_flag.is_enabled()
    if not enabled:
        return {"enabled": False}
    return {
        "enabled":                 True,
        "spotify_app_configured":  spotify_adapter.is_app_configured(),
        "ytmusic_app_configured":  ytm_adapter.is_app_configured(),
    }


# ============================================================================
# Speakers
# ============================================================================

@router.get("/speakers")
async def list_speakers(_user: dict = Depends(get_current_user), __=Depends(_require_media_enabled)):
    """Live, classified list of every HA media_player entity merged with the
    user's enabled toggles."""
    ha_states = await ha_adapter.all_media_players()
    return {"speakers": speakers_registry.classify_and_merge_discovery(ha_states)}


class SpeakerPatch(BaseModel):
    enabled:      Optional[bool] = None
    display_name: Optional[str]  = None
    room:         Optional[str]  = None


@router.patch("/speakers/{entity_id:path}")
async def patch_speaker(entity_id: str, body: SpeakerPatch,
                        _user: dict = Depends(get_current_user),
                        __=Depends(_require_media_enabled)):
    # We need the live classification so we can store class+capabilities
    # alongside the user's enabled toggle.
    state = await ha_adapter.get_state(entity_id)
    if state is None and body.enabled is True:
        raise HTTPException(404, "ha_entity_not_found")
    cls = speakers_registry.classify_ha_entity(entity_id, (state or {}).get("attributes") or {}) if state else {}
    payload = body.model_dump(exclude_none=True)
    try:
        saved = speakers_registry.set_speaker_enabled(
            entity_id,
            enabled=payload.get("enabled", False),
            display_name=payload.get("display_name") or cls.get("display_name"),
            klass=cls.get("class"),
            room=payload.get("room"),
            capabilities=cls.get("capabilities"),
        )
        return {"speaker": saved}
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.delete("/speakers/{entity_id:path}")
async def delete_speaker(entity_id: str,
                         _user: dict = Depends(require_role("admin")),
                         __=Depends(_require_media_enabled)):
    if not speakers_registry.remove_speaker(entity_id):
        raise HTTPException(404, "speaker_not_found")
    return {"ok": True}


# ============================================================================
# Profiles
# ============================================================================

@router.get("/profiles")
async def list_profiles(_user: dict = Depends(get_current_user),
                        __=Depends(_require_media_enabled)):
    """Augment profile_registry rows with YT Music status (the profile
    module only knows about spotify natively; YT Music status comes from
    its adapter)."""
    base = profile_registry.list_profiles()
    for p in base:
        services = p.setdefault("services", {})
        services["ytmusic"] = {
            "configured":   ytm_adapter.is_member_connected(p["name"]),
            "parental_safe": False,
        }
    return {"profiles": base}


# ============================================================================
# Spotify per-member OAuth
# ============================================================================

@router.get("/spotify/status")
async def spotify_status(member: str,
                         _user: dict = Depends(get_current_user),
                         __=Depends(_require_media_enabled)):
    return spotify_adapter.status(member)


@router.post("/spotify/connect/start")
async def spotify_connect_start(payload: dict,
                                _user: dict = Depends(get_current_user),
                                __=Depends(_require_media_enabled)):
    member = (payload or {}).get("member")
    if not member or not profile_registry.has_profile(member):
        raise HTTPException(400, "unknown_member")
    if not spotify_adapter.is_app_configured():
        raise HTTPException(400, "spotify_app_not_configured")
    state = _stdlib_secrets.token_urlsafe(16)
    _OAUTH_STATES[state] = member
    return {"authorize_url": spotify_adapter.authorize_url(member, state)}


@router.get("/spotify/callback")
async def spotify_callback(request: Request):
    if not media_flag.is_enabled():
        return JSONResponse(status_code=404, content=media_flag.disabled_response())
    params = dict(request.query_params)
    if "error" in params:
        return JSONResponse(400, {"ok": False, "error": params.get("error")})
    code  = params.get("code")
    state = params.get("state") or ""
    member = _OAUTH_STATES.pop(state, None)
    if not member:
        return JSONResponse(400, {"ok": False, "error": "bad_or_expired_state"})
    if not code:
        return JSONResponse(400, {"ok": False, "error": "missing_code"})
    try:
        spotify_adapter.exchange_code(member, code)
    except Exception as e:
        return JSONResponse(502, {"ok": False, "error": str(e)})
    return RedirectResponse("/settings/music?spotify=connected", status_code=302)


@router.post("/spotify/disconnect")
async def spotify_disconnect(payload: dict,
                             _user: dict = Depends(get_current_user),
                             __=Depends(_require_media_enabled)):
    member = (payload or {}).get("member")
    if not member:
        raise HTTPException(400, "missing_member")
    return {"ok": spotify_adapter.disconnect(member)}


@router.get("/spotify/search")
async def spotify_search(member: str, q: str, kind: str = "track,playlist,album",
                         limit: int = 8,
                         _user: dict = Depends(get_current_user),
                         __=Depends(_require_media_enabled)):
    code, body = await spotify_adapter.search(member, q, kind=kind, limit=limit)
    if code != 200:
        raise HTTPException(code or 502, body)
    return body


@router.get("/spotify/playlists")
async def spotify_playlists(member: str,
                            _user: dict = Depends(get_current_user),
                            __=Depends(_require_media_enabled)):
    code, body = await spotify_adapter.list_playlists(member)
    if code != 200:
        raise HTTPException(code or 502, body)
    return body


# ============================================================================
# YouTube Music — per-member cookie auth
# ============================================================================

@router.get("/ytmusic/status")
async def ytmusic_status(member: str,
                         _user: dict = Depends(get_current_user),
                         __=Depends(_require_media_enabled)):
    return ytm_adapter.status(member)


@router.post("/ytmusic/connect")
async def ytmusic_connect(payload: dict,
                          _user: dict = Depends(get_current_user),
                          __=Depends(_require_media_enabled)):
    """Body: { member, headers_json }. headers_json is the raw JSON string the
    user pastes from their logged-in YT Music browser session (the same shape
    ytmusicapi's `setup` helper produces)."""
    member  = (payload or {}).get("member")
    headers = (payload or {}).get("headers_json")
    if not member or not profile_registry.has_profile(member):
        raise HTTPException(400, "unknown_member")
    try:
        return ytm_adapter.connect(member, headers)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/ytmusic/disconnect")
async def ytmusic_disconnect(payload: dict,
                             _user: dict = Depends(get_current_user),
                             __=Depends(_require_media_enabled)):
    member = (payload or {}).get("member")
    if not member:
        raise HTTPException(400, "missing_member")
    return {"ok": ytm_adapter.disconnect(member)}


@router.get("/ytmusic/search")
async def ytmusic_search(member: str, q: str, limit: int = 8,
                         _user: dict = Depends(get_current_user),
                         __=Depends(_require_media_enabled)):
    rows = await ytm_adapter.search(member, q, limit=limit)
    return {"songs": rows}


@router.get("/ytmusic/playlists")
async def ytmusic_playlists(member: str,
                            _user: dict = Depends(get_current_user),
                            __=Depends(_require_media_enabled)):
    rows = await ytm_adapter.list_playlists(member)
    return {"playlists": rows}


# ============================================================================
# Play / transport — used by automations + hub widget "test play" + tablet
# ============================================================================

class PlayBody(BaseModel):
    speaker_entity: str
    service: str                     # spotify | ytmusic
    profile: str
    mode: str = "uri"                 # uri | search | open_app
    uri: Optional[str] = None
    query: Optional[str] = None
    volume: Optional[int] = None


@router.post("/play")
async def play(body: PlayBody,
               _user: dict = Depends(get_current_user),
               __=Depends(_require_media_enabled)):
    return await orchestrator.play(**body.model_dump(exclude_none=True))


class TransportBody(BaseModel):
    speaker_entity: str


@router.post("/pause")
async def pause(body: TransportBody,
                _user: dict = Depends(get_current_user),
                __=Depends(_require_media_enabled)):
    return await orchestrator.pause(body.speaker_entity)


@router.post("/resume")
async def resume(body: TransportBody,
                 _user: dict = Depends(get_current_user),
                 __=Depends(_require_media_enabled)):
    return await orchestrator.resume(body.speaker_entity)


@router.post("/next")
async def nxt(body: TransportBody,
              _user: dict = Depends(get_current_user),
              __=Depends(_require_media_enabled)):
    return await orchestrator.next_track(body.speaker_entity)


@router.post("/previous")
async def prv(body: TransportBody,
              _user: dict = Depends(get_current_user),
              __=Depends(_require_media_enabled)):
    return await orchestrator.previous_track(body.speaker_entity)


class VolumeBody(BaseModel):
    speaker_entity: str
    level: int  # 0..100


@router.post("/volume")
async def volume(body: VolumeBody,
                 _user: dict = Depends(get_current_user),
                 __=Depends(_require_media_enabled)):
    return await orchestrator.set_volume(body.speaker_entity, body.level)


@router.get("/state")
async def state(_user: dict = Depends(get_current_user),
                __=Depends(_require_media_enabled)):
    return {"items": await orchestrator.state_all()}


# ============================================================================
# Admin diagnostics — same as before, minus favorites
# ============================================================================

@router.get("/diagnostics")
async def diagnostics(_user: dict = Depends(require_role("super_admin")),
                      __=Depends(_require_media_enabled)):
    return {
        "feature_enabled":          True,
        "speakers":                 speakers_registry.list_all_speakers(),
        "profiles":                 profile_registry.list_profiles(),
        "spotify_app_configured":   spotify_adapter.is_app_configured(),
        "ytmusic_app_configured":   ytm_adapter.is_app_configured(),
    }
