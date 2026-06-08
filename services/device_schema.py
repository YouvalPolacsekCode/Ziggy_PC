"""Ziggy-native device + capability schema.

This is the vocabulary the BRAIN should eventually speak: Ziggy device ids,
Ziggy room names, Ziggy device types, and Ziggy capability verbs — none of
which expose HA entity_ids or HA service names. Today, the brain and the
edge run in the same process, but the contract is drawn here so the cut
to a remote brain is mechanical.

The opposite side of this seam — translation back to HA entity_ids and to
IR codeset names — lives in services.device_translator. This module only
defines the language.

ZiggyDeviceId
-------------
An opaque, stable, prefixed identifier string. Today's encoding:
    ha:<entity_id>     — device is backed by a Home Assistant entity
    ir:<ir_device_id>  — device is IR-only (Broadlink-driven, no HA entity)
    unconfigured:<room>:<type>  — placeholder row with no transport yet

The brain treats these as opaque. A future migration could switch the
encoding to UUIDs without changing the contract.

ZiggyCapability
---------------
A verb. The set of verbs a device exposes is derived from its
domain/codeset by device_translator, not declared here.

The transport-shape of a capability (whether it goes through HA WS, REST,
or Broadlink IR) is the edge's problem. The brain just emits the verb.
"""
from __future__ import annotations

from dataclasses import dataclass, field


# ── Connection statuses (mirror services.device_registry constants) ────────
CONNECTED    = "connected"
UNCLAIMED    = "unclaimed"
UNCONFIGURED = "unconfigured"
LOST         = "lost"
IR_ONLY      = "ir_only"


# ── Capability vocabulary ───────────────────────────────────────────────────
#
# These verbs are the brain's surface area. They are intentionally close to
# HA service names because the user already speaks them ("turn on", "set
# temperature"); the abstraction is in making them transport-agnostic. The
# edge maps each verb to the right call (HA call_service for Wi-Fi devices,
# Broadlink send for IR devices) inside device_translator.route_command.
#
# Adding a new verb here is half a feature — the edge must also know how to
# execute it. See device_translator._VERB_TO_HA_SERVICE for the current
# mapping table.
CAP_TURN_ON         = "turn_on"
CAP_TURN_OFF        = "turn_off"
CAP_TOGGLE          = "toggle"
CAP_SET_BRIGHTNESS  = "set_brightness"
CAP_SET_COLOR       = "set_color"
CAP_SET_TEMPERATURE = "set_temperature"
CAP_SET_HVAC_MODE   = "set_hvac_mode"
CAP_SET_FAN_MODE    = "set_fan_mode"
CAP_SET_SOURCE      = "set_source"
CAP_VOLUME_UP       = "volume_up"
CAP_VOLUME_DOWN     = "volume_down"
CAP_MUTE            = "mute"
CAP_PLAY            = "play"
CAP_PAUSE           = "pause"
CAP_STOP            = "stop"
CAP_OPEN            = "open"
CAP_CLOSE           = "close"
CAP_LOCK            = "lock"
CAP_UNLOCK          = "unlock"


@dataclass(frozen=True)
class ZiggyDevice:
    """The Ziggy-native shape of a single device.

    What the brain sees:
      id, room, device_type, name, capabilities, status

    What the edge keeps for its own use (do not send across the boundary
    when the brain moves remote — these are HA/IR transport details):
      ha_entity_id, ir_device_id
    """
    id: str                                  # ZiggyDeviceId (prefixed string)
    room: str | None                          # Ziggy room key (e.g. "living_room") or None
    device_type: str                          # Ziggy type (currently == HA domain when HA-backed)
    name: str                                 # Human display name
    capabilities: tuple[str, ...]             # Tuple of capability verbs supported
    status: str                               # connected | unconfigured | lost | ir_only | unclaimed
    # ── Edge-only fields (not part of the brain contract) ──────────────────
    ha_entity_id: str | None = None
    ir_device_id: str | None = None
    tags: tuple[str, ...] = field(default_factory=tuple)

    def for_brain(self) -> dict:
        """Brain-facing dict (no HA/IR transport leaks)."""
        return {
            "id": self.id,
            "room": self.room,
            "device_type": self.device_type,
            "name": self.name,
            "capabilities": list(self.capabilities),
            "status": self.status,
            "tags": list(self.tags),
        }


# ── Selectors ───────────────────────────────────────────────────────────────
#
# A selector is a brain-facing way to address a SET of devices without
# enumerating them. The edge expands selectors locally (device_translator
# .expand_selector) using the live registry — never by asking the brain to
# enumerate, since the brain doesn't see the registry.
#
# Forms accepted today:
#     "all"                         → every controllable device
#     "all_<type>"                  → e.g. "all_lights" — every device of this type
#     {"type": "light"}             → all lights
#     {"room": "bedroom"}           → all devices in this room
#     {"room": "bedroom", "type": "light"}  → bedroom lights
#     {"id": "ha:light.x"}          → single device (degenerate selector)

ZiggySelector = str | dict
