"""
Resolves a device hint (e.g. "my monitor", "living room tv", "kitchen speaker")
to a TargetDevice describing how to reach that output.

Feature-flagged: when features.rouge is False the resolver behaves identically
to the old _resolve_cast_device helper — every target maps to a HA media_player
entity. No behaviour change for existing code paths.

When features.rouge is True:
  1. Check target_registry in settings.yaml (static HA devices and named targets)
  2. Check display_registry (active browser tabs that sent display_hello)
  3. Fall back to legacy device_map lookup

Usage:
    from services.target_resolver import resolve, TargetDevice
    target = resolve("my monitor", required_capability="video")
    if target.type == "browser_display":
        await manager.push_to_display(target.ws_id, {...})
    else:
        # HA media_player path
        _ha_call("media_player", "play_media", {"entity_id": target.ha_entity, ...})
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TargetDevice:
    name: str
    type: str                        # "ha_media_player" | "browser_display" | "speaker"
    ha_entity: Optional[str] = None  # HA entity_id (ha_media_player / speaker targets)
    ws_id: Optional[str] = None      # WebSocket client_id (browser_display targets)
    room: Optional[str] = None
    supports_video: bool = True
    supports_audio: bool = True
    supports_images: bool = True


class TargetCapabilityError(ValueError):
    """Raised when the resolved target cannot handle the required capability."""


def _rouge_enabled() -> bool:
    from core.settings_loader import settings
    return bool(settings.get("features", {}).get("rouge", False))


def resolve(hint: Optional[str], required_capability: Optional[str] = None) -> TargetDevice:
    """
    Resolve a hint string to a TargetDevice.

    required_capability: "video" | "audio" | "images" — raises TargetCapabilityError
    if the resolved device doesn't support it.
    """
    target = _rouge_resolve(hint) if _rouge_enabled() else _legacy_resolve(hint)

    if required_capability:
        cap_map = {
            "video":  target.supports_video,
            "audio":  target.supports_audio,
            "images": target.supports_images,
        }
        if not cap_map.get(required_capability, True):
            raise TargetCapabilityError(
                f"'{target.name}' does not support {required_capability}. "
                "Choose a different target."
            )

    return target


# ---------------------------------------------------------------------------
# Legacy path (rouge disabled)
# ---------------------------------------------------------------------------

def _legacy_resolve(hint: Optional[str]) -> TargetDevice:
    from core.settings_loader import settings
    media = settings.get("media", {}) or {}
    devmap = {k.strip().lower(): v for k, v in (media.get("device_map") or {}).items()}
    default = media.get("default_cast_device")
    entity = (devmap.get(hint.strip().lower()) if hint else None) or default
    return TargetDevice(
        name=hint or "default",
        type="ha_media_player",
        ha_entity=entity,
    )


# ---------------------------------------------------------------------------
# Rouge path (rouge enabled)
# ---------------------------------------------------------------------------

def _rouge_resolve(hint: Optional[str]) -> TargetDevice:
    from core.settings_loader import settings
    from services.display_registry import registry as disp_reg

    hint_norm = (hint or "").strip().lower()

    # 1. Static target_registry entries (HA devices + named displays)
    target_reg: dict = settings.get("target_registry", {}) or {}
    for tid, tdata in target_reg.items():
        names = [tdata.get("name", "").lower(), tid.lower()]
        names += [a.lower() for a in (tdata.get("aliases") or [])]
        if hint_norm in names:
            return TargetDevice(
                name=tdata.get("name", tid),
                type=tdata.get("type", "ha_media_player"),
                ha_entity=tdata.get("ha_entity"),
                room=tdata.get("room"),
                supports_video=tdata.get("supports_video", True),
                supports_audio=tdata.get("supports_audio", True),
                supports_images=tdata.get("supports_images", True),
            )

    # 2. Active browser display clients
    display = disp_reg.resolve(hint_norm)
    if display:
        return TargetDevice(
            name=display["name"],
            type="browser_display",
            ws_id=display["ws_id"],
            room=display.get("room"),
            supports_video=True,
            supports_audio=False,
            supports_images=True,
        )

    # 3. Legacy fallback (device_map)
    return _legacy_resolve(hint)
