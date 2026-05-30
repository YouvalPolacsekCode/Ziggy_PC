"""
Service-specific adapters for the media subsystem.

Each adapter wraps one playback/catalog service behind a small shared
interface used by core.media.orchestrator. Adapters are loaded lazily so a
missing dependency (no Plex token, no Spotify configured) never breaks
boot — the orchestrator just won't pick that adapter.
"""
