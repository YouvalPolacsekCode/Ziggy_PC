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
}

# IR-based AC devices are detected separately from HA states.
CAP_IR_AC = "ir_ac_control"

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

    # IR devices that act as AC controllers
    for dev in (ir_devices or []):
        if (dev.get("type") or "").lower() in ("ac", "air_conditioner", "split"):
            dev_id = dev.get("id") or dev.get("room", "")
            if dev_id:
                cap_map[CAP_IR_AC].append(dev_id)

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
    }
    found = [CAP_LABELS.get(c, c.replace("_", " ")) for c in capabilities if cap_map.get(c)]
    if not found:
        return "Based on your devices"
    if len(found) == 1:
        return f"You have a {found[0]}"
    return f"You have {', '.join(found[:-1])} and {found[-1]}"
