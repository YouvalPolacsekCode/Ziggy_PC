"""
Entity filtering and name normalization for the HA entity browser.

Filtering removes system/internal entities that Ziggy has no use for.
Normalization converts raw HA names into clean, human-readable labels.
"""

from __future__ import annotations

import re
from typing import Any

# Entire domains that are never useful in Ziggy as devices.
# Data from these entities is still accessible via state_cache and direct get_state() calls.
HIDDEN_DOMAINS: frozenset[str] = frozenset({
    "button",         # Zigbee "identify" buttons
    "number",         # Zigbee hardware config params (transition times, start-up levels)
    "select",         # Zigbee startup behavior options
    "update",         # Firmware / add-on update trackers
    "stt",            # HA speech-to-text internals
    "tts",            # HA text-to-speech internals
    "conversation",   # HA assistant internal
    "zone",           # Home zone geography
    "sun",            # sun.sun — sub-sensors handled by pattern below
    "automation",     # HA automations are not devices; deleted automations would appear as "lost"
    "script",         # HA scripts are not devices either
    "scene",          # HA scenes are not physical devices
    "group",          # HA entity groups are virtual, not physical
    "timer",          # HA helper timer — not a physical device
    "counter",        # HA helper counter
    "input_select",   # HA input helpers — UI controls, not hardware
    "input_number",
    "input_text",
    "input_datetime",
    "input_button",
    # HA data sources — useful in automations/routines by entity_id, not as room devices
    "calendar",       # Google Calendar, birthdays, holidays
    "weather",        # weather.forecast_home
    "todo",           # shopping list etc. — accessed via home_automation helpers
    "person",         # HA person/presence tracking
    "device_tracker", # phone GPS, etc. — presence data, not a room device
    "remote",         # IR blaster infrastructure and auto-created media_player companions
})

# Entity ID substrings that indicate noise within otherwise useful domains
_HIDDEN_PATTERNS: list[re.Pattern] = [
    re.compile(p) for p in [
        r"_battery$",
        r"_firmware$",
        r"_device_temperature$",
        r"_identify$",
        r"^binary_sensor\.backups_",
        r"^binary_sensor\.remote_ui",
        r"^sensor\.backup_",
        r"^sensor\.sun_next_",         # all HA sun sub-sensors — data available via global_sensors, not devices
        r"^sensor\.phone_",            # HA Companion app sensors (battery, charger, etc.)
        r"^(sensor|binary_sensor)\.sagemcom_", # router integration entities (speed, IP, WAN status)
    ]
]

# Known verbose hardware prefixes → short friendly replacements
_NAME_REPLACEMENTS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"Sagemcom F@?ST\s*\d+\s*", re.IGNORECASE), "Router "),
    (re.compile(r"\bTemp\b\s*(?=Temp|Temperature|Humidity|Pressure)", re.IGNORECASE), ""),
    (re.compile(r"\bTemp\b", re.IGNORECASE), "Temperature"),
    (re.compile(r"\bLumi\s+lumi\.\S+\s*", re.IGNORECASE), ""),
]


def _should_hide(entity_id: str) -> bool:
    domain = entity_id.split(".")[0]
    if domain in HIDDEN_DOMAINS:
        return True
    return any(p.search(entity_id) for p in _HIDDEN_PATTERNS)


def normalize_name(entity_id: str, friendly_name: str | None) -> str:
    """Return a clean, human-readable display name for an entity."""
    raw = (friendly_name or "").strip() or _name_from_entity_id(entity_id)

    for pattern, replacement in _NAME_REPLACEMENTS:
        raw = pattern.sub(replacement, raw)

    # Fix camelCase / PascalCase run-together names (e.g. "YouvalPolacsek")
    raw = re.sub(r"([a-z])([A-Z])", r"\1 \2", raw)

    # Collapse multiple spaces
    raw = re.sub(r"\s{2,}", " ", raw).strip()

    return raw.title() if raw == raw.upper() else _title_preserve(raw)


def _name_from_entity_id(entity_id: str) -> str:
    """Derive a readable name from an entity_id when friendly_name is absent."""
    slug = entity_id.split(".", 1)[-1]
    return slug.replace("_", " ").strip()


def _title_preserve(text: str) -> str:
    """Title-case while keeping all-caps abbreviations (IP, TV, WAN, etc.) uppercase."""
    _ALL_CAPS = {"ip", "tv", "wan", "lan", "ir", "ac", "pc", "uu", "id"}
    words = text.split()
    result = []
    for w in words:
        if w.lower() in _ALL_CAPS:
            result.append(w.upper())
        else:
            result.append(w[0].upper() + w[1:] if w else w)
    return " ".join(result)


def filter_entities(
    entities: list[dict[str, Any]],
    extra_hidden_domains: list[str] | None = None,
    extra_hidden_patterns: list[str] | None = None,
) -> list[dict[str, Any]]:
    """
    Filter out system/noise entities and attach a normalized display_name to each.

    extra_hidden_domains / extra_hidden_patterns come from settings.yaml so users
    can extend the defaults without touching code.
    """
    extra_domains = frozenset(extra_hidden_domains or [])
    extra_patterns = [re.compile(p) for p in (extra_hidden_patterns or [])]

    result = []
    for e in entities:
        eid = e.get("entity_id", "")
        if _should_hide(eid):
            continue
        if eid.split(".")[0] in extra_domains:
            continue
        if any(p.search(eid) for p in extra_patterns):
            continue
        result.append({
            **e,
            "display_name": normalize_name(eid, e.get("friendly_name")),
        })
    return result
