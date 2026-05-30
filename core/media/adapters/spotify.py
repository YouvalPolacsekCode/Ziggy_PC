"""
Spotify adapter — per-member OAuth, search, and Connect playback.

Implements the Authorization Code flow against the Spotify Web API. Tokens
are stored per member via core.media.secrets so each household member has
their own account / library / playlists.

Key design points:
  - Premium-only: Spotify's playback API refuses control for free accounts.
    We detect this on first use and surface a clear error.
  - Tokens auto-refresh on demand.
  - Search uses the catalog of the active member's market.
  - "Play on speaker X" first finds the Spotify Connect device matching X
    (by name); if not present, we fall back to play_media via HA, which
    works for any Spotify-Connect-capable speaker exposed to HA.
  - All public functions raise FeatureDisabledError if media_music is off.

Configuration: client_id + client_secret + redirect_uri come from
settings.media.spotify.{client_id, client_secret, redirect_uri}. These are
NOT secrets in the Ziggy sense (they are the app's identity); per-member
tokens are the secrets.
"""
from __future__ import annotations

import asyncio
import base64
import time
import urllib.parse
from typing import Any, Optional

import requests

from core.media.flag import require_enabled
from core.media import secrets as media_secrets
from core.settings_loader import settings
from core.logger_module import log_error, log_info

_SCOPES = " ".join([
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-library-read",
    "user-read-private",
])

_AUTH_URL  = "https://accounts.spotify.com/authorize"
_TOKEN_URL = "https://accounts.spotify.com/api/token"
_API_BASE  = "https://api.spotify.com/v1"
_SERVICE   = "spotify"


def _app() -> dict:
    """Read app-level Spotify credentials from settings.media.spotify."""
    media = settings.get("media") or {}
    sp = media.get("spotify") or {}
    return {
        "client_id":     sp.get("client_id", ""),
        "client_secret": sp.get("client_secret", ""),
        "redirect_uri":  sp.get("redirect_uri", ""),
    }


def is_app_configured() -> bool:
    a = _app()
    return bool(a["client_id"] and a["client_secret"] and a["redirect_uri"])


# ----------------------------- OAuth --------------------------------------

def authorize_url(member: str, state: str) -> str:
    """URL the browser should send the member to in order to grant access."""
    require_enabled()
    if not is_app_configured():
        raise RuntimeError("spotify_app_not_configured")
    a = _app()
    params = {
        "client_id":     a["client_id"],
        "response_type": "code",
        "redirect_uri":  a["redirect_uri"],
        "scope":         _SCOPES,
        "state":         f"{member}|{state}",
        "show_dialog":   "true",
    }
    return f"{_AUTH_URL}?{urllib.parse.urlencode(params)}"


def _basic_auth_header() -> dict:
    a = _app()
    raw = f"{a['client_id']}:{a['client_secret']}".encode("utf-8")
    return {"Authorization": "Basic " + base64.b64encode(raw).decode("ascii")}


def exchange_code(member: str, code: str) -> dict:
    """Exchange an authorization code for tokens and persist them for `member`."""
    require_enabled()
    a = _app()
    r = requests.post(
        _TOKEN_URL,
        data={
            "grant_type":   "authorization_code",
            "code":         code,
            "redirect_uri": a["redirect_uri"],
        },
        headers={**_basic_auth_header(), "Content-Type": "application/x-www-form-urlencoded"},
        timeout=12,
    )
    if not r.ok:
        log_error(f"[media.spotify] token exchange failed: {r.status_code} {r.text}")
        raise RuntimeError(f"spotify_token_exchange_failed_{r.status_code}")
    body = r.json()
    tokens = _normalize_token_response(body)
    media_secrets.write_secret(_SERVICE, member, tokens)
    return {"ok": True, "member": member, "scope": tokens.get("scope")}


def _normalize_token_response(body: dict, refresh_token: Optional[str] = None) -> dict:
    expires_in = int(body.get("expires_in") or 3600)
    return {
        "access_token":  body.get("access_token"),
        "refresh_token": body.get("refresh_token") or refresh_token,
        "scope":         body.get("scope"),
        "token_type":    body.get("token_type", "Bearer"),
        "expires_at":    int(time.time()) + expires_in - 60,  # refresh 1 min early
    }


def _refresh(member: str, tokens: dict) -> Optional[dict]:
    rt = tokens.get("refresh_token")
    if not rt:
        return None
    r = requests.post(
        _TOKEN_URL,
        data={"grant_type": "refresh_token", "refresh_token": rt},
        headers={**_basic_auth_header(), "Content-Type": "application/x-www-form-urlencoded"},
        timeout=12,
    )
    if not r.ok:
        log_error(f"[media.spotify] token refresh failed: {r.status_code} {r.text}")
        return None
    new_tokens = _normalize_token_response(r.json(), refresh_token=rt)
    media_secrets.write_secret(_SERVICE, member, new_tokens)
    return new_tokens


def _ensure_token(member: str) -> Optional[str]:
    tokens = media_secrets.read_secret(_SERVICE, member)
    if not tokens:
        return None
    if int(time.time()) >= int(tokens.get("expires_at") or 0):
        tokens = _refresh(member, tokens)
        if not tokens:
            return None
    return tokens.get("access_token")


def disconnect(member: str) -> bool:
    require_enabled()
    return media_secrets.delete_secret(_SERVICE, member)


def status(member: str) -> dict:
    require_enabled()
    return {
        "configured": media_secrets.has_secret(_SERVICE, member),
        "app_configured": is_app_configured(),
    }


# ----------------------------- HTTP helpers -------------------------------

def _request_sync(member: str, method: str, path: str, **kwargs) -> tuple[int, Any]:
    token = _ensure_token(member)
    if not token:
        return 401, {"error": "not_authenticated"}
    headers = kwargs.pop("headers", {}) or {}
    headers["Authorization"] = f"Bearer {token}"
    try:
        url = path if path.startswith("http") else f"{_API_BASE}{path}"
        r = requests.request(method, url, headers=headers, timeout=10, **kwargs)
        if r.status_code == 204:
            return 204, None
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, r.text
    except Exception as e:
        log_error(f"[media.spotify] request error: {e}")
        return 0, {"error": str(e)}


async def _request(member: str, method: str, path: str, **kwargs) -> tuple[int, Any]:
    return await asyncio.to_thread(_request_sync, member, method, path, **kwargs)


# ----------------------------- API verbs ----------------------------------

async def me(member: str) -> tuple[int, Any]:
    return await _request(member, "GET", "/me")


async def is_premium(member: str) -> bool:
    code, body = await me(member)
    if code != 200 or not isinstance(body, dict):
        return False
    return (body.get("product") or "").lower() == "premium"


async def search(member: str, query: str, kind: str = "track,playlist,album", limit: int = 8) -> tuple[int, Any]:
    """kind: comma-separated of track,playlist,album,artist."""
    params = {"q": query, "type": kind, "limit": min(50, max(1, limit))}
    return await _request(member, "GET", "/search", params=params)


async def list_playlists(member: str, limit: int = 50) -> tuple[int, Any]:
    return await _request(member, "GET", "/me/playlists", params={"limit": min(50, limit)})


async def list_devices(member: str) -> tuple[int, Any]:
    return await _request(member, "GET", "/me/player/devices")


async def find_device_id(member: str, name_or_id: str) -> Optional[str]:
    """Match a Spotify Connect device by id or case-insensitive name substring."""
    if not name_or_id:
        return None
    code, body = await list_devices(member)
    if code != 200 or not isinstance(body, dict):
        return None
    needle = name_or_id.strip().lower()
    devices = body.get("devices") or []
    for d in devices:
        if d.get("id") == name_or_id:
            return d.get("id")
    for d in devices:
        if needle in (d.get("name") or "").lower():
            return d.get("id")
    return None


async def play(member: str, uri: str, device_id: Optional[str] = None) -> tuple[int, Any]:
    """Start playback of a track/playlist/album URI on Spotify Connect."""
    body: dict = {}
    if uri.startswith("spotify:track:") or uri.startswith("spotify:episode:"):
        body["uris"] = [uri]
    else:
        body["context_uri"] = uri
    params = {"device_id": device_id} if device_id else None
    return await _request(member, "PUT", "/me/player/play", params=params, json=body)


async def pause(member: str, device_id: Optional[str] = None) -> tuple[int, Any]:
    params = {"device_id": device_id} if device_id else None
    return await _request(member, "PUT", "/me/player/pause", params=params)


async def transfer_playback(member: str, device_id: str, play: bool = True) -> tuple[int, Any]:
    return await _request(member, "PUT", "/me/player", json={"device_ids": [device_id], "play": play})


async def currently_playing(member: str) -> tuple[int, Any]:
    return await _request(member, "GET", "/me/player/currently-playing")
