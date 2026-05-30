"""
YouTube Music adapter.

YT Music has no official public API and no OAuth flow. We use the unofficial
`ytmusicapi` library, which authenticates by browser-extracted request
headers (cookie + auth) that the user pastes from a logged-in browser
session. Headers expire and need re-pasting periodically — there's no
refresh.

What this adapter does:
  - Stores per-member request-headers JSON via core.media.secrets (0600).
  - Searches the user's account catalog and library.
  - Lists the user's personal playlists.
  - Resolves a search or playlist URL into a YouTube URL that HA's Cast
    integration can play on a Chromecast / Google Cast device.

Playback is always via HA Cast — YT Music has no Connect protocol of its own.
"""
from __future__ import annotations

import asyncio
from typing import Any, Optional

from core.media.flag import require_enabled
from core.media import secrets as media_secrets
from core.logger_module import log_error, log_info

_SERVICE = "ytmusic"


# ----------------------------- Lazy ytmusicapi --------------------------

def _ytm_cls():
    try:
        from ytmusicapi import YTMusic   # type: ignore
        return YTMusic
    except Exception as e:
        log_error(f"[media.ytmusic] ytmusicapi not installed: {e}")
        return None


# ----------------------------- Auth -------------------------------------

def is_app_configured() -> bool:
    """ytmusicapi has no app-level credentials — only per-member cookie
    headers. Treat the package being importable as 'configured'."""
    return _ytm_cls() is not None


def is_member_connected(member: str) -> bool:
    try:
        require_enabled()
    except Exception:
        return False
    return media_secrets.has_secret(_SERVICE, member)


def connect(member: str, headers_json: str) -> dict:
    """Persist a member's request-headers JSON. The frontend passes the raw
    string the user pasted from their browser (the same JSON ytmusicapi's
    setup helper produces)."""
    require_enabled()
    if not headers_json or not isinstance(headers_json, str):
        raise ValueError("headers_json must be a non-empty JSON string")
    import json as _json
    try:
        parsed = _json.loads(headers_json)
    except Exception as e:
        raise ValueError(f"headers_json is not valid JSON: {e}")
    media_secrets.write_secret(_SERVICE, member, {"headers": parsed})
    log_info(f"[media.ytmusic] connected member={member}")
    return {"ok": True, "member": member}


def disconnect(member: str) -> bool:
    require_enabled()
    return media_secrets.delete_secret(_SERVICE, member)


def status(member: str) -> dict:
    try:
        require_enabled()
    except Exception:
        return {"configured": False, "app_configured": False}
    return {
        "configured":     media_secrets.has_secret(_SERVICE, member),
        "app_configured": is_app_configured(),
    }


# ----------------------------- Client per request -----------------------

def _client_for(member: str):
    """Build a YTMusic client from the member's stored headers. Created on
    demand; not cached because ytmusicapi clients are cheap and we don't
    want stale auth living in memory longer than necessary."""
    cls = _ytm_cls()
    if cls is None:
        return None
    tokens = media_secrets.read_secret(_SERVICE, member)
    if not tokens or "headers" not in tokens:
        return None
    # ytmusicapi.YTMusic accepts a dict via `auth=` since v1.x — pass the
    # headers dict directly. (Older API expected a file path; the dict
    # signature has been stable for years.)
    try:
        return cls(auth=tokens["headers"])
    except Exception as e:
        log_error(f"[media.ytmusic] client init failed for {member}: {e}")
        return None


# ----------------------------- Public verbs -----------------------------

async def search(member: str, query: str, *, limit: int = 8) -> list[dict]:
    """Songs-only search. Returns list of {videoId, title, artist, album, art}."""
    require_enabled()
    return await asyncio.to_thread(_search_sync, member, query, limit)


def _search_sync(member: str, query: str, limit: int) -> list[dict]:
    client = _client_for(member)
    if client is None:
        return []
    try:
        rows = client.search(query, filter="songs", limit=limit) or []
    except Exception as e:
        log_error(f"[media.ytmusic] search failed: {e}")
        return []
    out: list[dict] = []
    for r in rows:
        vid = r.get("videoId")
        if not vid:
            continue
        out.append({
            "videoId":  vid,
            "title":    r.get("title"),
            "artist":   ", ".join(a.get("name", "") for a in (r.get("artists") or [])),
            "album":    (r.get("album") or {}).get("name") if isinstance(r.get("album"), dict) else None,
            "duration": r.get("duration"),
            "art":      ((r.get("thumbnails") or [{}])[-1] or {}).get("url"),
        })
    return out


async def list_playlists(member: str) -> list[dict]:
    """The user's personal library playlists."""
    require_enabled()
    return await asyncio.to_thread(_list_playlists_sync, member)


def _list_playlists_sync(member: str) -> list[dict]:
    client = _client_for(member)
    if client is None:
        return []
    try:
        rows = client.get_library_playlists(limit=100) or []
    except Exception as e:
        log_error(f"[media.ytmusic] list_playlists failed: {e}")
        return []
    out: list[dict] = []
    for r in rows:
        pid = r.get("playlistId")
        if not pid:
            continue
        out.append({
            "playlistId": pid,
            "title":      r.get("title"),
            "count":      r.get("count"),
            "art":        ((r.get("thumbnails") or [{}])[-1] or {}).get("url"),
        })
    return out


async def search_to_stream_url(member: str, query: str) -> Optional[str]:
    """Top hit for `query` → a YouTube URL HA Cast can play."""
    rows = await search(member, query, limit=1)
    if not rows:
        return None
    return f"https://music.youtube.com/watch?v={rows[0]['videoId']}"


def playlist_uri(playlist_id: str) -> str:
    """Convert a YT Music playlistId into a URL HA Cast can launch as a queue."""
    return f"https://music.youtube.com/playlist?list={playlist_id}"


def video_uri(video_id: str) -> str:
    return f"https://music.youtube.com/watch?v={video_id}"
