from __future__ import annotations
from services import media_manager


async def handle_stream_youtube(params: dict, *, source: str = "unknown") -> dict:
    return await media_manager.stream_youtube_to_chromecast_hd(
        input_text=params.get("input_text", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_spotify_playlist(params: dict, *, source: str = "unknown") -> dict:
    return await media_manager.play_spotify_playlist(
        target=params.get("target", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_start_movie(params: dict, *, source: str = "unknown") -> dict:
    return await media_manager.start_movie_in_app(
        title=params.get("title", ""),
        app=params.get("app", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_cast_camera(params: dict, *, source: str = "unknown") -> dict:
    return await media_manager.cast_camera_live(
        camera_name=params.get("camera_name", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_play_podcast(params: dict, *, source: str = "unknown") -> dict:
    return await media_manager.play_podcast_episode(
        podcast_name=params.get("podcast_name", ""),
        episode_hint=params.get("episode_hint"),
        device_hint=params.get("device_hint"),
    )


HANDLERS = {
    "media_stream_youtube": handle_stream_youtube,
    "media_spotify_playlist": handle_spotify_playlist,
    "media_start_movie_in_app": handle_start_movie,
    "media_cast_camera_live": handle_cast_camera,
    "media_play_podcast_episode": handle_play_podcast,
}
