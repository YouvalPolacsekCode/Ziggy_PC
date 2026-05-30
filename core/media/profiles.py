"""
Music profile resolution.

Each household member can have their own music profiles (Spotify, YT Music,
Apple Music). Roni's profile is curated household_favorites_only with
parental_safe: true. Profiles are declared in config/contacts.yaml under
each contact's `music_profiles:` block.

This module:
  - Reads music_profiles from settings (contacts)
  - Resolves "which member's account?" given an intent context
  - Exposes a non-secret summary for the Music Settings UI
"""
from __future__ import annotations

from typing import Optional

from core.media.flag import require_enabled
from core.media import secrets as media_secrets
from core.settings_loader import settings


GUEST = "guest"


def _contacts() -> dict:
    raw = settings.get("contacts") or {}
    if isinstance(raw, dict):
        return raw
    return {}


def list_profiles() -> list[dict]:
    """Return [{name, music_profiles, household_favorites_only, parental_safe}] for each contact."""
    require_enabled()
    out: list[dict] = []
    for name, entry in _contacts().items():
        if not isinstance(entry, dict):
            continue
        mp = entry.get("music_profiles") or {}
        if not isinstance(mp, dict):
            mp = {}
        services_status = {}
        for svc in ("spotify", "ytmusic", "apple_music"):
            svc_cfg = mp.get(svc) or {}
            services_status[svc] = {
                "configured": media_secrets.has_secret(svc, name),
                "parental_safe": bool(svc_cfg.get("parental_safe", False)),
            }
        out.append({
            "name": name,
            "services": services_status,
            "household_favorites_only": bool(mp.get("household_favorites_only", False)),
            "parental_safe":            bool(mp.get("parental_safe", False)),
        })
    return out


def has_profile(member: str) -> bool:
    require_enabled()
    if not member:
        return False
    return member in _contacts()


def household_default() -> str:
    """The configured household default profile, falling back to first contact, falling back to GUEST."""
    require_enabled()
    media_cfg = settings.get("media") or {}
    default = media_cfg.get("household_default_profile")
    if default and has_profile(default):
        return default
    for name in _contacts().keys():
        return name
    return GUEST


def room_default(room: Optional[str]) -> Optional[str]:
    if not room:
        return None
    require_enabled()
    media_cfg = settings.get("media") or {}
    room_defaults = (media_cfg.get("room_defaults") or {}).get(room) or {}
    candidate = room_defaults.get("default_profile")
    if candidate and has_profile(candidate):
        return candidate
    return None


def resolve_profile(
    *,
    explicit: Optional[str] = None,
    room:     Optional[str] = None,
    session_member: Optional[str] = None,
) -> str:
    """Pick the active member profile in priority order.

    1. Explicit (caller named a member, e.g. "play Roni's morning playlist")
    2. Session member (frontend session user, Telegram contact, etc.)
    3. Room default (configured in media.room_defaults)
    4. Household default
    5. GUEST
    """
    require_enabled()
    if explicit and has_profile(explicit):
        return explicit
    if session_member and has_profile(session_member):
        return session_member
    rd = room_default(room)
    if rd:
        return rd
    return household_default()


def is_parental_safe(member: str) -> bool:
    require_enabled()
    entry = _contacts().get(member) or {}
    mp = entry.get("music_profiles") or {}
    return bool(mp.get("parental_safe", False))


def is_household_favorites_only(member: str) -> bool:
    require_enabled()
    entry = _contacts().get(member) or {}
    mp = entry.get("music_profiles") or {}
    return bool(mp.get("household_favorites_only", False))
