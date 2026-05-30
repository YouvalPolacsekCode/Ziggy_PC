"""
Feature-flag gate for the media subsystem.

Single source of truth for "is the media_music feature on right now". Every
public entry point in core.media.* checks is_enabled() before doing any work
so the system behaves as if the feature does not exist when the flag is off.
"""
from __future__ import annotations

from core.settings_loader import settings

FLAG_KEY = "media_music"
DEFAULT = False


class FeatureDisabledError(RuntimeError):
    """Raised when a media call is made while the media_music flag is off."""

    def __init__(self, msg: str = "media_music feature is disabled"):
        super().__init__(msg)


def is_enabled() -> bool:
    return bool((settings.get("features") or {}).get(FLAG_KEY, DEFAULT))


def require_enabled() -> None:
    if not is_enabled():
        raise FeatureDisabledError()


def disabled_response() -> dict:
    """Standard shape returned by handlers/endpoints when flag is off."""
    return {"ok": False, "reason": "feature_disabled", "feature": FLAG_KEY}
