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
        r"^event\.backup_",            # HA 2026 backup integration ("automatic backup" event) — internal plumbing, never a user device
        r"^button\.backup_",           # HA backup manager buttons
        r"^update\.backup",            # backup update entity
        r"^sensor\.sun_next_",         # all HA sun sub-sensors — data available via global_sensors, not devices
        r"^sensor\.phone_",            # HA Companion app sensors (battery, charger, etc.)
        r"^(sensor|binary_sensor)\.sagemcom_", # router integration entities (speed, IP, WAN status)
        # Zigbee2MQTT per-device CONFIG switches + the coordinator's permit-join
        # toggle. These are HA/Z2M internals, never user-facing "devices" — they
        # were leaking into device lists (and the permission kid-allowlist) as
        # stray switches.
        r"_permit_join$",
        r"_do_not_disturb$",
        r"_child_lock$",
        r"_power_on_behavior$",
        # Aqara FP presence-sensor AI config toggles (ai_sensitivity_adaptive,
        # ai_interference_source_selfidentification, …). Z2M exposes these as
        # plain switches with no entity_category, so they masquerade as devices;
        # "_ai_" in a switch id is never a real controllable device.
        r"^switch\..*_ai_",
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


def is_hidden_entity(entity_id: str) -> bool:
    """Public single-entity predicate: True when this entity is a system/internal
    entity Ziggy hides from device lists — config switches (Z2M presence-sensor
    AI toggles, permit-join, child-lock…), firmware/battery sub-entities, helper
    domains, etc. Single source of truth (delegates to _should_hide) so the
    anomaly engine's "device left on" rule doesn't fire on config toggles that
    are always on by design."""
    return _should_hide(entity_id)


def normalize_name(entity_id: str, friendly_name: str | None) -> str:
    """Return a clean, human-readable display name for an entity.

    Three cases:

    1. The user provided a friendly_name in HA (the common case for any
       device they care about). Preserve their casing verbatim — modulo
       brand cleanup (`Sagemcom F@ST 5366` → `Router`) and whitespace
       collapse. A user who typed "Living room lamp" sees "Living room
       lamp"; one who typed "Living Room Lamp" sees that. Earlier this
       function force-title-cased every name, causing "Living room lamp"
       to render as "Living Room Lamp" on every surface that reads
       /api/ha/entities while /api/devices/grouped (no normalization)
       served the un-touched original — making the same device appear
       under two different casings on Devices/Home vs Rooms/Detail.

    2. The friendly_name is all-caps screaming text the integration
       defaulted to (e.g. some Tuya devices ship "TS0505B"). Treat that
       as effectively unstyled and title-case it.

    3. There's no friendly_name at all. Derive from the entity_id slug
       and title-case (every surface needs SOMETHING to render).
    """
    user_supplied = bool((friendly_name or "").strip())
    raw = (friendly_name or "").strip() or _name_from_entity_id(entity_id)

    for pattern, replacement in _NAME_REPLACEMENTS:
        raw = pattern.sub(replacement, raw)

    # Fix camelCase / PascalCase run-together names (e.g. "YouvalPolacsek")
    raw = re.sub(r"([a-z])([A-Z])", r"\1 \2", raw)

    # Collapse multiple spaces
    raw = re.sub(r"\s{2,}", " ", raw).strip()

    if not raw:
        return raw

    # User-typed names: trust the user. Only override when the entire
    # string is all-caps (case 2) — that's almost never intentional and
    # usually the manufacturer's slug leaking through.
    if user_supplied:
        has_alpha = any(c.isalpha() for c in raw)
        if has_alpha and raw == raw.upper():
            return _title_preserve(raw)
        return raw

    # Slug-derived fallback: title-case for readability.
    return _title_preserve(raw)


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
