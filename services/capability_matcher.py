"""
Maps live HA entity states and IR devices to Ziggy automation capability tags.
Used by the automation template suggestion engine to determine which templates
can run given the user's actual devices.

Capability tags are deliberately coarse-grained (not room-specific) so that
the template engine can ask "does the user have a door sensor?" without needing
to know which room it lives in.
"""
from __future__ import annotations

from typing import Optional


# ---------------------------------------------------------------------------
# Capability rules
# ---------------------------------------------------------------------------

# Maps capability name → list of callable predicates.
# An entity satisfies a capability if ANY predicate returns True.
# Predicates receive the full HA state dict.

def _dc(state: dict, cls: str | tuple) -> bool:
    """Return True if state's device_class matches cls (str or tuple of strs)."""
    dc = state.get("attributes", {}).get("device_class") or ""
    return dc in ((cls,) if isinstance(cls, str) else cls)


_CAPABILITY_RULES: dict[str, list] = {
    "climate_control": [
        lambda e: e["entity_id"].startswith("climate."),
    ],
    "light_on_off": [
        lambda e: e["entity_id"].startswith("light."),
    ],
    "light_dimmable": [
        lambda e: e["entity_id"].startswith("light.")
            and "brightness" in (e.get("attributes") or {}),
    ],
    "motion_sensor": [
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, "motion"),
    ],
    "presence_sensor": [
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, ("presence", "occupancy")),
    ],
    "phone_presence": [
        lambda e: e["entity_id"].startswith("device_tracker."),
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, ("presence", "occupancy")),
    ],
    "door_sensor": [
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, ("door", "opening")),
    ],
    "window_sensor": [
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, "window"),
    ],
    "leak_sensor": [
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, "moisture"),
    ],
    "smart_plug": [
        lambda e: e["entity_id"].startswith("switch."),
    ],
    "energy_monitoring": [
        lambda e: e["entity_id"].startswith("sensor.")
            and _dc(e, ("power", "energy")),
    ],
    "media_player": [
        lambda e: e["entity_id"].startswith("media_player."),
    ],
    "room_temperature": [
        lambda e: e["entity_id"].startswith("sensor.")
            and _dc(e, "temperature"),
    ],
    "humidity": [
        lambda e: e["entity_id"].startswith("sensor.")
            and _dc(e, "humidity"),
    ],

    # ── New `has_*` buckets (Prompt 2 infrastructure) ─────────────────────
    # Added additively so new templates can opt in to the explicit naming
    # without breaking any existing template that uses the older keys.
    # Where semantics overlap an existing bucket (e.g. has_motion_sensor ≡
    # motion_sensor) the predicate is duplicated rather than aliased so
    # detect_capabilities() can populate both lists in one pass without an
    # extra post-processing step.
    "has_motion_sensor": [
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, "motion"),
    ],
    "has_door_sensor": [
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, ("door", "opening")),
    ],
    "has_window_sensor": [
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, "window"),
    ],
    "has_mmwave_sensor": [
        # mmWave radar sensors expose occupancy device_class in Z2M.
        lambda e: e["entity_id"].startswith("binary_sensor.")
            and _dc(e, "occupancy"),
    ],
    "has_smart_plug": [
        lambda e: e["entity_id"].startswith("switch."),
    ],
    "has_energy_monitoring_plug": [
        # A smart plug paired with a power/energy sensor on the same device:
        # we approximate by checking that both a switch entity and a power
        # sensor exist (the matcher runs per-entity, so the same device is
        # captured by both buckets; templates that require it should also
        # require has_smart_plug to ensure same-device intent).
        lambda e: e["entity_id"].startswith("sensor.")
            and _dc(e, ("power", "energy")),
    ],
    "has_power_monitoring": [
        lambda e: e["entity_id"].startswith("sensor.")
            and _dc(e, ("power", "energy")),
    ],
    "has_dimmable_light": [
        lambda e: e["entity_id"].startswith("light.")
            and "brightness" in (e.get("attributes") or {}),
    ],
    "has_color_temp_light": [
        # color_temp tunable lights expose either color_temp or supported_color_modes
        # containing color_temp. Both shapes show up in the wild (HA core vs Z2M).
        lambda e: e["entity_id"].startswith("light.") and (
            "color_temp" in (e.get("attributes") or {})
            or "color_temp_kelvin" in (e.get("attributes") or {})
            or "color_temp" in ((e.get("attributes") or {}).get("supported_color_modes") or [])
        ),
    ],
    "has_climate_entity": [
        lambda e: e["entity_id"].startswith("climate."),
    ],
    "has_weather_entity": [
        lambda e: e["entity_id"].startswith("weather."),
    ],
}

# IR-based AC devices are detected separately from HA states.
CAP_IR_AC = "ir_ac_control"
# New broader IR-blaster bucket (Prompt 2): any IR blaster device, regardless
# of whether it's been mapped to an AC. Used by templates that send arbitrary
# IR commands (TV, fan, projector, etc.).
CAP_IR_BLASTER = "has_ir_blaster"
# Zone-based presence (Prompt 2): person entities tracked by Ziggy's own
# presence_engine (not HA Companion). Derived from list_persons() rather
# than HA states.
CAP_ZONE_PRESENCE = "has_zone_presence"

# Domains to skip when iterating (automations, scripts, etc. are not devices)
_SKIP_PREFIXES = (
    "automation.", "script.", "scene.", "group.", "person.",
    "sun.", "zone.", "timer.", "counter.", "input_",
)


def detect_capabilities(
    all_states: list[dict],
    ir_devices: list[dict] | None = None,
) -> dict[str, list[str]]:
    """
    Return {capability: [entity_id, ...]} for all detected capabilities.

    Only considers entities that are not in an error state (unavailable/unknown).
    """
    cap_map: dict[str, list[str]] = {cap: [] for cap in _CAPABILITY_RULES}
    cap_map[CAP_IR_AC] = []
    cap_map[CAP_IR_BLASTER] = []
    cap_map[CAP_ZONE_PRESENCE] = []

    for state in all_states:
        eid = state.get("entity_id", "")
        if any(eid.startswith(pfx) for pfx in _SKIP_PREFIXES):
            continue
        if state.get("state") in ("unavailable", "unknown"):
            continue
        for cap, rules in _CAPABILITY_RULES.items():
            try:
                if any(rule(state) for rule in rules):
                    cap_map[cap].append(eid)
            except Exception:
                pass

    # IR devices that act as AC controllers (legacy bucket)
    for dev in (ir_devices or []):
        if (dev.get("type") or "").lower() in ("ac", "air_conditioner", "split"):
            dev_id = dev.get("id") or dev.get("room", "")
            if dev_id:
                cap_map[CAP_IR_AC].append(dev_id)

    # Broader IR-blaster bucket: any IR device with at least one known command
    # or that's reachable. We treat presence of ANY IR device as sufficient.
    for dev in (ir_devices or []):
        dev_id = dev.get("id") or dev.get("name") or dev.get("room", "")
        if dev_id and dev_id not in cap_map[CAP_IR_BLASTER]:
            cap_map[CAP_IR_BLASTER].append(dev_id)

    # Zone-based presence: pull from presence_engine, not HA. Templates that
    # condition on "is home" or "in living room" can rely on this without
    # needing HA Companion. Imported lazily because presence_engine isn't a
    # core dependency of capability matching and may be unavailable in tests.
    try:
        from services.presence_engine import list_persons as _list_persons
        for person in (_list_persons() or []):
            pid = person.get("id") or person.get("person_id") or person.get("name")
            if pid:
                cap_map[CAP_ZONE_PRESENCE].append(pid)
    except Exception:
        # Never crash capability detection because presence_engine is
        # mid-init or unavailable; the bucket just stays empty.
        pass

    return cap_map


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def first_entity(cap_map: dict[str, list[str]], *capabilities: str) -> Optional[str]:
    """Return first entity found for the first capability that has any."""
    for cap in capabilities:
        entities = cap_map.get(cap, [])
        if entities:
            return entities[0]
    return None


def has_all(cap_map: dict[str, list[str]], *capabilities: str) -> bool:
    """Return True if ALL given capabilities have at least one entity."""
    return all(bool(cap_map.get(cap)) for cap in capabilities)


def has_any(cap_map: dict[str, list[str]], *capabilities: str) -> bool:
    """Return True if ANY given capability has at least one entity."""
    return any(bool(cap_map.get(cap)) for cap in capabilities)


def capability_summary(cap_map: dict[str, list[str]], capabilities: list[str]) -> str:
    """Return a human-readable 'why' string for matched capabilities."""
    CAP_LABELS: dict[str, str] = {
        "climate_control":  "smart AC/thermostat",
        "ir_ac_control":    "IR AC blaster",
        "light_on_off":     "smart lights",
        "light_dimmable":   "dimmable lights",
        "motion_sensor":    "motion sensor",
        "presence_sensor":  "presence sensor",
        "phone_presence":   "phone presence tracker",
        "door_sensor":      "door sensor",
        "window_sensor":    "window sensor",
        "leak_sensor":      "leak sensor",
        "smart_plug":       "smart plug",
        "energy_monitoring":"energy monitor",
        "media_player":     "media player",
        "room_temperature": "temperature sensor",
        "humidity":         "humidity sensor",
        # New `has_*` buckets
        "has_motion_sensor":           "motion sensor",
        "has_door_sensor":             "door sensor",
        "has_window_sensor":           "window sensor",
        "has_mmwave_sensor":           "mmWave presence sensor",
        "has_smart_plug":              "smart plug",
        "has_energy_monitoring_plug":  "energy-monitoring plug",
        "has_power_monitoring":        "power monitor",
        "has_dimmable_light":          "dimmable lights",
        "has_color_temp_light":        "color-temperature lights",
        "has_climate_entity":          "smart AC/thermostat",
        "has_weather_entity":          "weather data",
        "has_ir_blaster":              "IR blaster",
        "has_zone_presence":           "zone-tracked presence",
    }
    found = [CAP_LABELS.get(c, c.replace("_", " ")) for c in capabilities if cap_map.get(c)]
    if not found:
        return "Based on your devices"
    if len(found) == 1:
        return f"You have a {found[0]}"
    return f"You have {', '.join(found[:-1])} and {found[-1]}"
