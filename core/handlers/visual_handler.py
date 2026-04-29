from __future__ import annotations
from services import visual_manager


async def handle_cast_album(params: dict, *, source: str = "unknown") -> dict:
    return visual_manager.cast_photo_album(
        source=params.get("source", ""),
        album_name=params.get("album_name", ""),
        device_hint=params.get("device_hint", ""),
    )


async def handle_cast_calendar(params: dict, *, source: str = "unknown") -> dict:
    return visual_manager.cast_today_calendar(device_hint=params.get("device_hint", ""))


async def handle_cast_camera(params: dict, *, source: str = "unknown") -> dict:
    return visual_manager.cast_security_camera(
        camera_name=params.get("camera_name", ""),
        device_hint=params.get("device_hint", ""),
    )


async def handle_image_slideshow(params: dict, *, source: str = "unknown") -> dict:
    return visual_manager.cast_image_slideshow(
        criteria_or_folder=params.get("criteria_or_folder", ""),
        device_hint=params.get("device_hint", ""),
        duration=params.get("duration"),
    )


HANDLERS = {
    "visual_cast_album": handle_cast_album,
    "visual_cast_calendar": handle_cast_calendar,
    "visual_cast_camera": handle_cast_camera,
    "visual_image_slideshow": handle_image_slideshow,
}
