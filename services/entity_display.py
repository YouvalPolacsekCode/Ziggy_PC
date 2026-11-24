"""
Human-readable device labels for text Ziggy *generates* about a device
(suggestions, notifications, wizard prefill), resolved from a stable
entity_id at render time.

This is not a new naming store. It composes the sources the rest of the app
already uses, in the same precedence /api/ha/entities applies them:

  1. Ziggy rename      — settings.yaml `entity_names` (PATCH /api/ha/entity/{id}/name)
  2. HA friendly_name  — live state cache, cleaned by entity_filter.normalize_name
  3. Registry name     — services.device_registry entry `name`
  4. Entity slug       — normalize_name's slug fallback ("switch.kitchen_plug" → "Kitchen Plug")
  5. Generic label     — room + device type ("the kitchen switch", "the device")

Every tier is rejected if it is really an identifier: an entity_id, a Zigbee
IEEE address (0xa4c1…, a4:c1:…), a UUID or a long hex id. Z2M names unnamed
devices after their IEEE address, and the registry stores the entity_id as the
name of an unclaimed device, so tiers 2–4 regularly hold an id and must be
checked rather than trusted. Nothing here ever invents a proper name: when no
tier yields a real name, the result is a generic description.

Callers keep the entity_id for execution; only the label is resolved here, so
renaming a device changes what is displayed and never what is targeted.
"""
from __future__ import annotations

import re
from typing import Optional

from services.entity_filter import normalize_name

# ---------------------------------------------------------------------------
# Identifier detection
# ---------------------------------------------------------------------------

# HA entity_id: "<domain>.<object_id>". Matched against the known domain set so
# ordinary prose with a full stop ("on. Want") is never mistaken for one.
_HA_DOMAINS = (
    "alarm_control_panel", "automation", "binary_sensor", "button", "calendar",
    "camera", "climate", "counter", "cover", "device_tracker", "event", "fan",
    "group", "humidifier", "image", "input_boolean", "input_button",
    "input_datetime", "input_number", "input_select", "input_text", "lawn_mower",
    "light", "lock", "media_player", "notify", "number", "person", "remote",
    "scene", "script", "select", "sensor", "siren", "sun", "switch", "text",
    "timer", "todo", "update", "vacuum", "valve", "water_heater", "weather",
    "zone",
)
_ENTITY_ID_RE = re.compile(
    r"\b(?:" + "|".join(_HA_DOMAINS) + r")\.[a-z0-9_]+\b", re.IGNORECASE
)
# Zigbee IEEE as Z2M prints it, optionally with an endpoint suffix: 0xa4c138dd4d2e1b8c_1
_HEX_PREFIXED_RE = re.compile(r"\b0x[0-9a-f]{6,}(?:_[0-9a-z]+)?\b", re.IGNORECASE)
# Colon/dash separated IEEE or MAC: a4:c1:38:dd:4d:2e:1b:8c
_SEPARATED_HEX_RE = re.compile(r"\b(?:[0-9a-f]{2}[:\-]){5,7}[0-9a-f]{2}\b", re.IGNORECASE)
_UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.IGNORECASE
)
# Bare long hex (HA device/config-entry ids, unprefixed IEEE). Must contain a
# digit so a real word made of a–f letters can never match.
_LONG_HEX_RE = re.compile(r"\b(?=[0-9a-f]*\d)[0-9a-f]{12,}\b", re.IGNORECASE)

_ID_PATTERNS = (_ENTITY_ID_RE, _HEX_PREFIXED_RE, _SEPARATED_HEX_RE, _UUID_RE, _LONG_HEX_RE)

GENERIC_DEVICE_PHRASE = "the device"


def looks_like_internal_id(text: Optional[str]) -> bool:
    """True when `text` contains anything that is an identifier, not a name."""
    if not text:
        return False
    return any(p.search(text) for p in _ID_PATTERNS)


def scrub_internal_ids(text: Optional[str], replacement: str = GENERIC_DEVICE_PHRASE) -> str:
    """Last line of defence for generated prose: replace any identifier that
    is still present with a generic phrase. A preceding "the " is absorbed so
    "the switch.0xa4…" becomes "the device", not "the the device"."""
    if not text:
        return text or ""
    out = text
    for p in _ID_PATTERNS:
        out = re.sub(r"(?:\bthe\s+)?" + p.pattern, replacement, out, flags=re.IGNORECASE)
    return out


# ---------------------------------------------------------------------------
# Name sources (each lazily imported and failure-tolerant — a lookup failure
# must degrade to a generic label, never to an exception or an id)
# ---------------------------------------------------------------------------

def _custom_name(entity_id: str) -> Optional[str]:
    try:
        from core.settings_loader import settings
        names = settings.get("entity_names") or {}
        name = names.get(entity_id)
        return str(name).strip() if name else None
    except Exception:
        return None


def _friendly_name(entity_id: str) -> Optional[str]:
    """HA friendly_name from the live WS state cache only — no network I/O,
    so rendering a suggestion list can never block on HA."""
    try:
        from services.home_automation import _state_from_cache
        cached = _state_from_cache(entity_id)
    except Exception:
        return None
    if not cached:
        return None
    raw = ((cached.get("attributes") or {}).get("friendly_name") or "").strip()
    return normalize_name(entity_id, raw) if raw else None


def _registry_info(entity_id: str) -> Optional[dict]:
    try:
        from services.device_registry import get_device_info
        return get_device_info(entity_id)
    except Exception:
        return None


def _registry_name(entity_id: str, info: Optional[dict]) -> Optional[str]:
    name = ((info or {}).get("name") or "").strip()
    if not name or name == entity_id:
        return None
    return name


def _slug_name(entity_id: str) -> Optional[str]:
    return normalize_name(entity_id, None) or None


def _room_of(info: Optional[dict]) -> Optional[str]:
    room = (info or {}).get("room")
    if not room or room == "global":
        return None
    return str(room)


def _room_words(room: str) -> str:
    return room.replace("_", " ").strip()


# device_type (registry) or HA domain → plain noun. Unknown types fall back to
# "device" rather than leaking a raw device_class.
_TYPE_NOUNS = {
    "light": "light", "switch": "switch", "outlet": "plug", "plug": "plug",
    "climate": "AC", "ac": "AC", "fan": "fan", "cover": "blinds",
    "blind": "blinds", "shutter": "shutters", "curtain": "curtains",
    "garage": "garage door", "lock": "lock", "tv": "TV",
    "media_player": "media player", "speaker": "speaker", "remote": "remote",
    "vacuum": "vacuum", "water_heater": "water heater", "boiler": "water heater",
    "valve": "valve", "humidifier": "humidifier", "siren": "siren",
    "camera": "camera", "motion": "motion sensor", "occupancy": "presence sensor",
    "presence": "presence sensor", "door": "door sensor", "window": "window sensor",
    "opening": "contact sensor", "contact": "contact sensor",
    "temperature": "temperature sensor", "humidity": "humidity sensor",
    "input_boolean": "switch",
}


def _type_noun(entity_id: str, info: Optional[dict]) -> str:
    dtype = str((info or {}).get("device_type") or "").lower()
    domain = entity_id.split(".", 1)[0].lower() if "." in entity_id else ""
    return _TYPE_NOUNS.get(dtype) or _TYPE_NOUNS.get(domain) or "device"


def generic_label(entity_id: Optional[str], info: Optional[dict] = None) -> str:
    """A description, never a name: "the kitchen switch", "the plug", "the device"."""
    if not entity_id:
        return GENERIC_DEVICE_PHRASE
    if info is None:
        info = _registry_info(entity_id)
    noun = _type_noun(entity_id, info)
    room = _room_of(info)
    if room and not looks_like_internal_id(room):
        return f"the {_room_words(room)} {noun}"
    return f"the {noun}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_name(entity_id: Optional[str], info: Optional[dict] = None) -> Optional[str]:
    """The best real name for an entity, or None when every source is empty
    or is itself an identifier. Never returns an id, never invents a name."""
    if not entity_id:
        return None
    if info is None:
        info = _registry_info(entity_id)
    for candidate in (
        _custom_name(entity_id),
        _friendly_name(entity_id),
        _registry_name(entity_id, info),
        _slug_name(entity_id),
    ):
        if candidate and not looks_like_internal_id(candidate):
            return candidate
    return None


def _is_ambiguous(entity_id: str, name: str) -> bool:
    """True when another registry device resolves to the same name."""
    try:
        from services.device_registry import get_all
        others = get_all()
    except Exception:
        return False
    target = name.casefold()
    for d in others:
        other = d.get("entity_id")
        if not other or other == entity_id:
            continue
        other_name = resolve_name(other, d)
        if other_name and other_name.casefold() == target:
            return True
    return False


def _with_article(name: str) -> str:
    low = name.casefold()
    if low.startswith("the ") or "'s " in low or low.startswith(("my ", "our ")):
        return name
    return f"the {name}"


def device_phrase(entity_id: Optional[str]) -> tuple[str, Optional[str]]:
    """(phrase, room) for slotting into "turn on X".

    Uses the device's real name verbatim (the user's casing is kept). When two
    devices share that name, the room is appended so the sentence says which
    one: "the Lamp in the bedroom". Falls back to a generic label.
    """
    if not entity_id:
        return GENERIC_DEVICE_PHRASE, None
    info = _registry_info(entity_id)
    room = _room_of(info)
    name = resolve_name(entity_id, info)
    if not name:
        return generic_label(entity_id, info), room
    phrase = _with_article(name)
    if room and not looks_like_internal_id(room):
        room_txt = _room_words(room)
        if room_txt.casefold() not in name.casefold() and _is_ambiguous(entity_id, name):
            phrase = f"{phrase} in the {room_txt}"
    return phrase, room
