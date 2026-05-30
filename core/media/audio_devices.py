"""
Speakers registry.

A "speaker" in Ziggy v2 is one HA media_player entity that the user has
explicitly enabled as a music output. The user toggles which entities count;
Ziggy auto-classifies each into one of four supported classes:

    cast              — Chromecast, Nest Hub, Google TV, Cast group, Cast-enabled TVs
    sonos             — Sonos speakers
    spotify_connect   — Spotify-certified Wi-Fi speakers (live-detected per profile)
    smart_tv_app      — Smart TVs that can only launch an app via select_source

Entities that don't fit any of these are returned with class "unsupported"
and cannot be enabled — the speakers page greys them out.

Capability matrix is internal. The user only sees the friendly label and a
toggle.
"""
from __future__ import annotations

import os
import threading
from datetime import datetime, timezone
from typing import Optional

import yaml

from core.media.flag import require_enabled
from core.logger_module import log_info

_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "config", "speakers.yaml")
)
_LOCK = threading.Lock()

VALID_CLASSES = ("cast", "sonos", "spotify_connect", "smart_tv_app", "unsupported")

# What each class can do — used by the automation builder to filter the
# service + mode pickers. Read-only metadata.
CLASS_CAPABILITIES: dict[str, dict] = {
    "cast": {
        "spotify_play_uri":   True,
        "spotify_search":     True,
        "spotify_playlists":  True,
        "ytmusic_play":       True,
        "ytmusic_search":     True,
        "open_app":           False,
    },
    "sonos": {
        "spotify_play_uri":   True,
        "spotify_search":     True,
        "spotify_playlists":  True,
        "ytmusic_play":       False,    # no clean path
        "ytmusic_search":     False,
        "open_app":           False,
    },
    "spotify_connect": {
        "spotify_play_uri":   True,     # via Spotify Web API transfer_playback
        "spotify_search":     True,
        "spotify_playlists":  True,
        "ytmusic_play":       False,
        "ytmusic_search":     False,
        "open_app":           False,
    },
    "smart_tv_app": {
        "spotify_play_uri":   False,    # TV can only launch the app, not pick a track
        "spotify_search":     False,
        "spotify_playlists":  False,
        "ytmusic_play":       False,
        "ytmusic_search":     False,
        "open_app":           True,
    },
    "unsupported": {
        "spotify_play_uri":   False,
        "spotify_search":     False,
        "spotify_playlists":  False,
        "ytmusic_play":       False,
        "ytmusic_search":     False,
        "open_app":           False,
    },
}


# ----------------------------- HA feature bits ----------------------------
# Stable bit values from HA's MediaPlayerEntityFeature enum.
_FEAT_PAUSE       = 1 << 0
_FEAT_PREVIOUS    = 1 << 4
_FEAT_NEXT        = 1 << 5
_FEAT_TURN_ON     = 1 << 7
_FEAT_TURN_OFF    = 1 << 8
_FEAT_PLAY_MEDIA  = 1 << 9
_FEAT_VOLUME_STEP = 1 << 10
_FEAT_SELECT_SRC  = 1 << 11
_FEAT_VOLUME_SET  = 1 << 2


# ----------------------------- IO -----------------------------------------

def _load_raw() -> dict:
    if not os.path.exists(_PATH):
        return {"speakers": []}
    try:
        with open(_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if "speakers" not in data or not isinstance(data["speakers"], list):
            data["speakers"] = []
        return data
    except Exception:
        return {"speakers": []}


def _save_raw(data: dict) -> None:
    os.makedirs(os.path.dirname(_PATH), exist_ok=True)
    with _LOCK, open(_PATH, "w", encoding="utf-8") as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


# ----------------------------- Public API ---------------------------------

def list_enabled_speakers() -> list[dict]:
    """Return only the speakers the user has flipped on. Used by automations."""
    require_enabled()
    return [s for s in _load_raw().get("speakers") or [] if s.get("enabled")]


def list_all_speakers() -> list[dict]:
    """Return every registered speaker, enabled or not. Used by the settings page."""
    require_enabled()
    return list(_load_raw().get("speakers") or [])


def get_speaker(entity_id: str) -> Optional[dict]:
    require_enabled()
    for s in list_all_speakers():
        if s.get("entity_id") == entity_id:
            return s
    return None


def set_speaker_enabled(entity_id: str, enabled: bool, *, display_name: Optional[str] = None,
                        klass: Optional[str] = None, room: Optional[str] = None,
                        capabilities: Optional[dict] = None) -> dict:
    """Upsert a speaker row with the given enabled state. The other fields are
    written if provided so the frontend can pass the freshly-classified payload
    in one call."""
    require_enabled()
    if klass and klass not in VALID_CLASSES:
        raise ValueError(f"class must be one of {VALID_CLASSES}")
    if klass == "unsupported" and enabled:
        raise ValueError("unsupported speakers cannot be enabled")

    data = _load_raw()
    rows = data.get("speakers") or []
    found = None
    for r in rows:
        if r.get("entity_id") == entity_id:
            found = r
            break
    if found is None:
        found = {"entity_id": entity_id, "created_at": datetime.now(timezone.utc).isoformat()}
        rows.append(found)
    found["enabled"] = bool(enabled)
    if display_name is not None: found["display_name"] = display_name
    if klass is not None:        found["class"] = klass
    if room is not None:         found["room"] = room
    if capabilities is not None: found["capabilities"] = capabilities

    data["speakers"] = rows
    _save_raw(data)
    log_info(f"[media.speakers] {entity_id} enabled={enabled} class={found.get('class')}")
    return found


def remove_speaker(entity_id: str) -> bool:
    require_enabled()
    data = _load_raw()
    rows = data.get("speakers") or []
    new_rows = [r for r in rows if r.get("entity_id") != entity_id]
    if len(new_rows) == len(rows):
        return False
    data["speakers"] = new_rows
    _save_raw(data)
    return True


# ----------------------------- Classifier ---------------------------------

def classify_ha_entity(entity_id: str, attributes: dict) -> dict:
    """Return {class, capabilities, display_name, room?} for an HA media_player.

    Pure function of the HA entity's attributes — no IO. Used by the speakers
    page to decide which class label and toggle state to show for each
    discovered entity.
    """
    attrs = attributes or {}
    feats = int(attrs.get("supported_features") or 0)
    can_play_media = bool(feats & _FEAT_PLAY_MEDIA)

    app_name   = str(attrs.get("app_name") or "").lower()
    src_list   = [str(s).lower() for s in (attrs.get("source_list") or []) if s]
    integration = str(attrs.get("integration") or "").lower()
    manuf      = str(attrs.get("manufacturer") or "").lower()
    dev_class  = str(attrs.get("device_class") or "").lower()
    friendly   = attrs.get("friendly_name") or entity_id

    # ---- Sonos ----
    if "sonos" in integration or "sonos" in manuf or entity_id.startswith("media_player.sonos"):
        klass = "sonos"
    # ---- Cast (Chromecast, Google Cast, Cast-enabled TV) ----
    elif (
        "cast" in integration or "google cast" in app_name or "chromecast" in app_name
        or any("cast" in s for s in src_list[:3])
        or entity_id.startswith("media_player.chromecast")
    ):
        klass = "cast"
    # ---- Smart TV with an app launcher but no play_media ----
    elif dev_class == "tv" and not can_play_media and any("spotify" in s for s in src_list):
        klass = "smart_tv_app"
    # ---- Smart TV that DOES support play_media (treat as Cast-equivalent) ----
    elif dev_class == "tv" and can_play_media:
        klass = "cast"
    # ---- Generic Wi-Fi speaker with play_media — likely Spotify Connect ----
    elif can_play_media and not dev_class:
        klass = "spotify_connect"
    else:
        klass = "unsupported"

    caps = dict(CLASS_CAPABILITIES.get(klass, CLASS_CAPABILITIES["unsupported"]))

    # Surface transport bits so the hub widget can render the right buttons.
    caps["supports_play_pause"]   = bool(feats & _FEAT_PAUSE)
    caps["supports_next"]         = bool(feats & _FEAT_NEXT)
    caps["supports_previous"]     = bool(feats & _FEAT_PREVIOUS)
    caps["supports_volume_set"]   = bool(feats & _FEAT_VOLUME_SET)
    caps["supports_volume_step"]  = bool(feats & _FEAT_VOLUME_STEP)
    caps["supports_select_source"] = bool(feats & _FEAT_SELECT_SRC)

    # Sources the TV can launch — used when class=smart_tv_app to decide which
    # apps are reachable. We hold onto the raw list so the automation builder
    # can offer "Open Spotify on bedroom TV" etc.
    if klass == "smart_tv_app":
        caps["app_sources"] = [s for s in (attrs.get("source_list") or []) if isinstance(s, str)]

    return {
        "entity_id":    entity_id,
        "display_name": friendly,
        "class":        klass,
        "capabilities": caps,
    }


def classify_and_merge_discovery(ha_states: list[dict]) -> list[dict]:
    """Walk a list of HA media_player state dicts and merge with the speakers
    registry so the frontend gets one consistent row per entity: classification
    + the user's enabled toggle + the saved display_name/room overrides."""
    require_enabled()
    saved_by_id = {s.get("entity_id"): s for s in list_all_speakers()}
    out: list[dict] = []
    for st in ha_states:
        ent = st.get("entity_id") or ""
        if not ent.startswith("media_player."):
            continue
        cls = classify_ha_entity(ent, st.get("attributes") or {})
        saved = saved_by_id.get(ent) or {}
        out.append({
            **cls,
            "display_name": saved.get("display_name") or cls["display_name"],
            "room":         saved.get("room"),
            "enabled":      bool(saved.get("enabled", False)),
            "state":        st.get("state"),
        })
    # Also include rows we have saved but that HA didn't return (offline at
    # discovery time) — so the user can still see / disable them.
    seen = {r["entity_id"] for r in out}
    for ent, saved in saved_by_id.items():
        if ent in seen:
            continue
        out.append({
            "entity_id":    ent,
            "display_name": saved.get("display_name") or ent,
            "class":        saved.get("class") or "unsupported",
            "capabilities": saved.get("capabilities") or {},
            "room":         saved.get("room"),
            "enabled":      bool(saved.get("enabled", False)),
            "state":        "unavailable",
        })
    return out
