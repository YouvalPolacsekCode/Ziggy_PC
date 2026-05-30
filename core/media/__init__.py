"""
Ziggy media subsystem (Phase 1 + Phase 2).

Everything in this package is gated by the `media_music` feature flag.
Modules check `is_enabled()` before touching disk, network, or external
services. The legacy services/media_manager.py and core/handlers/media_handler.py
remain untouched — this package is additive.

Public entry points used elsewhere in Ziggy:
  - core.media.flag.is_enabled()
  - core.media.orchestrator.play / pause / resume / volume / state
  - core.media.audio_devices.list_devices / classify / upsert / delete
  - core.media.favorites.list_favorites / upsert / delete
  - core.media.profiles.resolve_profile
"""
from __future__ import annotations

from .flag import is_enabled, FeatureDisabledError

__all__ = ["is_enabled", "FeatureDisabledError"]
