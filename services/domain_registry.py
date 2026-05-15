"""
Single source of truth for HA domain metadata.

To add support for a new device type:
  1. Add an entry to DOMAIN_REGISTRY below.
  2. Add the matching entry to frontend/src/lib/domainRegistry.js.

That's it. No other files need to change — icons, grouping, voice control,
state restore, safety confirmations, and capability detection all derive from here.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DomainAction:
    service: str              # HA service name within this domain (e.g. "open_valve")
    label: str                # Button / voice label: "Open", "Close", "Start"
    confirm: bool = False     # Require user confirmation before executing
    feature_bit: int = 0      # supported_features bit that gates this action (0 = always show)


@dataclass(frozen=True)
class ChipDef:
    """
    Describes an attribute-driven mode chip row rendered inside GenericControls.

    Example: humidifier.available_modes → chip row that calls set_mode.
    """
    attr: str          # Entity attribute containing the list of options (e.g. "available_modes")
    service: str       # HA service to call when a chip is selected (e.g. "set_mode")
    param: str         # Service parameter that receives the selected value (e.g. "mode")
    current_attr: str  # Entity attribute that holds the current value (e.g. "mode")
    label: str = ""    # Optional label prefix shown above the chips


@dataclass(frozen=True)
class DomainMeta:
    label: str                               # Human label: "Valve", "Light"
    icon: str                                # Emoji icon shown in UI
    group: str                               # Group bucket: "lights" | "climate" | "media" |
                                             #   "switches" | "sensors" | "security" | "other"
    controllable: bool = True                # Counts in active/total device metrics
    toggleable: bool = True                  # Shows binary on/off toggle in card header
    active_states: tuple[str, ...] = ("on",) # States that count as "active/on"
    restore_on_reconnect: bool = True        # Auto-restore last state after power-loss reconnect
    safety_level: str = "none"              # "none" | "confirm" | "double_confirm"
    # Maps action key → DomainAction.  Defines both voice vocabulary and UI buttons.
    actions: dict[str, DomainAction] = field(default_factory=dict)
    # Maps HA state value → human display label.
    state_labels: dict[str, str] = field(default_factory=dict)
    # One-liner hint passed to GPT so it can route voice commands to this domain.
    voice_hint: str = ""
    # supported_features bit that gates the position slider (0 = never show slider).
    position_feature_bit: int = 0
    # Attribute-driven mode chip rows rendered after the action buttons.
    chips: tuple[ChipDef, ...] = field(default_factory=tuple)


DOMAIN_REGISTRY: dict[str, DomainMeta] = {

    # ── Lights ────────────────────────────────────────────────────────────────
    "light": DomainMeta(
        label="Light", icon="💡", group="lights",
        active_states=("on",), restore_on_reconnect=True,
        actions={
            "turn_on":  DomainAction("turn_on",  "Turn On"),
            "turn_off": DomainAction("turn_off", "Turn Off"),
            "toggle":   DomainAction("toggle",   "Toggle"),
        },
        state_labels={"on": "On", "off": "Off"},
        voice_hint="a smart light or lamp",
    ),

    # ── Switches ──────────────────────────────────────────────────────────────
    "switch": DomainMeta(
        label="Switch", icon="🔌", group="switches",
        active_states=("on",), restore_on_reconnect=True,
        actions={
            "turn_on":  DomainAction("turn_on",  "Turn On"),
            "turn_off": DomainAction("turn_off", "Turn Off"),
            "toggle":   DomainAction("toggle",   "Toggle"),
        },
        state_labels={"on": "On", "off": "Off"},
        voice_hint="a smart plug or switch",
    ),

    "input_boolean": DomainMeta(
        label="Toggle", icon="🔘", group="switches",
        active_states=("on",), restore_on_reconnect=False,
        actions={
            "turn_on":  DomainAction("turn_on",  "Turn On"),
            "turn_off": DomainAction("turn_off", "Turn Off"),
            "toggle":   DomainAction("toggle",   "Toggle"),
        },
        state_labels={"on": "On", "off": "Off"},
        voice_hint="a virtual toggle or helper switch",
    ),

    # ── Climate ───────────────────────────────────────────────────────────────
    "climate": DomainMeta(
        label="Climate", icon="🌡️", group="climate",
        toggleable=True,
        active_states=("heat", "cool", "heat_cool", "auto", "fan_only", "dry"),
        restore_on_reconnect=True,
        actions={
            "turn_on":  DomainAction("turn_on",  "Turn On"),
            "turn_off": DomainAction("turn_off", "Turn Off"),
        },
        state_labels={
            "off": "Off", "heat": "Heating", "cool": "Cooling",
            "heat_cool": "Heat/Cool", "auto": "Auto", "fan_only": "Fan", "dry": "Dry",
        },
        # Chips driven by entity attributes — rendered only when the attribute is non-empty
        chips=(
            ChipDef(attr="hvac_modes",    service="set_hvac_mode",   param="hvac_mode",   current_attr="hvac_mode",   label="Mode"),
            ChipDef(attr="fan_modes",     service="set_fan_mode",    param="fan_mode",    current_attr="fan_mode",    label="Fan"),
            ChipDef(attr="preset_modes",  service="set_preset_mode", param="preset_mode", current_attr="preset_mode", label="Preset"),
            ChipDef(attr="swing_modes",   service="set_swing_mode",  param="swing_mode",  current_attr="swing_mode",  label="Swing"),
        ),
        voice_hint="an air conditioner or thermostat",
    ),

    "fan": DomainMeta(
        label="Fan", icon="💨", group="climate",
        active_states=("on",), restore_on_reconnect=True,
        actions={
            "turn_on":  DomainAction("turn_on",  "Turn On"),
            "turn_off": DomainAction("turn_off", "Turn Off"),
            "toggle":   DomainAction("toggle",   "Toggle"),
        },
        state_labels={"on": "On", "off": "Off"},
        chips=(
            ChipDef(attr="preset_modes", service="set_preset_mode", param="preset_mode", current_attr="preset_mode", label="Preset"),
        ),
        voice_hint="a smart fan",
    ),

    "humidifier": DomainMeta(
        label="Humidifier", icon="💧", group="climate",
        active_states=("on",), restore_on_reconnect=True,
        actions={
            "turn_on":  DomainAction("turn_on",  "Turn On"),
            "turn_off": DomainAction("turn_off", "Turn Off"),
        },
        state_labels={"on": "On", "off": "Off"},
        chips=(
            ChipDef(attr="available_modes", service="set_mode", param="mode", current_attr="mode", label="Mode"),
        ),
        voice_hint="a humidifier or dehumidifier",
    ),

    # ── Media ─────────────────────────────────────────────────────────────────
    "media_player": DomainMeta(
        label="Media Player", icon="📺", group="media",
        toggleable=True,
        active_states=("on", "playing", "paused", "idle"),
        restore_on_reconnect=False,
        actions={
            "turn_on":  DomainAction("turn_on",  "Turn On"),
            "turn_off": DomainAction("turn_off", "Turn Off"),
        },
        state_labels={"playing": "Playing", "paused": "Paused", "idle": "Idle", "off": "Off", "on": "On"},
        voice_hint="a TV, speaker, or media player",
    ),

    # ── Security ──────────────────────────────────────────────────────────────
    "lock": DomainMeta(
        label="Lock", icon="🔒", group="security",
        toggleable=False,
        active_states=("locked",),
        restore_on_reconnect=False,
        safety_level="confirm",
        actions={
            "lock":   DomainAction("lock",   "Lock"),
            "unlock": DomainAction("unlock", "Unlock", confirm=True),
            # feature_bit=1 = LockEntityFeature.OPEN (door latch / electric strike)
            "open":   DomainAction("open",   "Open Latch", confirm=True, feature_bit=1),
        },
        state_labels={
            "locked": "Locked", "unlocked": "Unlocked",
            "locking": "Locking…", "unlocking": "Unlocking…",
        },
        voice_hint="a door lock or deadbolt",
    ),

    "cover": DomainMeta(
        label="Cover", icon="🪟", group="cover",
        toggleable=False,
        active_states=("open", "opening"),
        restore_on_reconnect=False,
        actions={
            # feature_bit values from CoverEntityFeature: OPEN=1, CLOSE=2, STOP=8
            "open_cover":  DomainAction("open_cover",  "Open",  feature_bit=1),
            "close_cover": DomainAction("close_cover", "Close", feature_bit=2),
            "stop_cover":  DomainAction("stop_cover",  "Stop",  feature_bit=8),
        },
        state_labels={
            "open": "Open", "closed": "Closed",
            "opening": "Opening…", "closing": "Closing…",
        },
        position_feature_bit=4,   # CoverEntityFeature.SET_POSITION = 4
        voice_hint="blinds, curtains, or a garage door",
    ),

    "alarm_control_panel": DomainMeta(
        label="Alarm", icon="🚨", group="security",
        toggleable=False,
        active_states=("armed_away", "armed_home", "armed_night", "armed_vacation", "triggered"),
        restore_on_reconnect=False,
        safety_level="confirm",
        actions={
            # feature_bit values from AlarmControlPanelEntityFeature:
            # ARM_HOME=1, ARM_AWAY=2, ARM_NIGHT=4, ARM_VACATION=8, ARM_CUSTOM_BYPASS=16, TRIGGER=32
            "alarm_arm_away":   DomainAction("alarm_arm_away",          "Arm Away",     confirm=True, feature_bit=2),
            "alarm_arm_home":   DomainAction("alarm_arm_home",          "Arm Home",     feature_bit=1),
            "alarm_arm_night":  DomainAction("alarm_arm_night",         "Arm Night",    feature_bit=4),
            "alarm_arm_vacation":DomainAction("alarm_arm_vacation",     "Arm Vacation", feature_bit=8),
            "alarm_disarm":     DomainAction("alarm_disarm",            "Disarm",       confirm=True),
        },
        state_labels={
            "disarmed": "Disarmed", "arming": "Arming…",
            "armed_away": "Armed Away", "armed_home": "Armed Home",
            "armed_night": "Armed Night", "armed_vacation": "Armed Vacation",
            "triggered": "TRIGGERED",
        },
        voice_hint="a security alarm panel",
    ),

    "camera": DomainMeta(
        label="Camera", icon="📷", group="security",
        controllable=False, toggleable=False,
        restore_on_reconnect=False,
        actions={},
        voice_hint="a security camera",
    ),

    # ── Valve — water shutoff / irrigation ────────────────────────────────────
    "valve": DomainMeta(
        label="Valve", icon="🚰", group="water",
        toggleable=False,
        active_states=("open", "opening"),
        restore_on_reconnect=False,  # NEVER auto-restore — could flood or cut supply at the wrong moment
        safety_level="confirm",
        actions={
            # ValveEntityFeature: OPEN=1, CLOSE=2, STOP=8
            "open_valve":  DomainAction("open_valve",  "Open",   feature_bit=1),
            "close_valve": DomainAction("close_valve", "Close",  confirm=True, feature_bit=2),
            "stop_valve":  DomainAction("stop_valve",  "Stop",   feature_bit=8),
            "toggle":      DomainAction("toggle",      "Toggle"),
        },
        state_labels={
            "open": "Open", "closed": "Closed",
            "opening": "Opening…", "closing": "Closing…",
        },
        position_feature_bit=4,   # ValveEntityFeature.SET_POSITION = 4
        voice_hint="a water valve or plumbing shutoff",
    ),

    # ── Sensors ───────────────────────────────────────────────────────────────
    "sensor": DomainMeta(
        label="Sensor", icon="📊", group="sensors",
        controllable=False, toggleable=False,
        restore_on_reconnect=False,
        actions={},
        voice_hint="a sensor (temperature, humidity, energy, etc.)",
    ),

    "binary_sensor": DomainMeta(
        label="Binary Sensor", icon="🔍", group="sensors",
        controllable=False, toggleable=False,
        restore_on_reconnect=False,
        actions={},
        voice_hint="a door, motion, or presence sensor",
    ),

    # ── Appliances ────────────────────────────────────────────────────────────
    "vacuum": DomainMeta(
        label="Vacuum", icon="🤖", group="other",
        toggleable=False,
        active_states=("cleaning", "returning"),
        restore_on_reconnect=False,
        actions={
            # VacuumEntityFeature: START=8192, PAUSE=4, STOP=8, RETURN_HOME=16, LOCATE=512
            "start":          DomainAction("start",          "Start",  feature_bit=8192),
            "pause":          DomainAction("pause",          "Pause",  feature_bit=4),
            "stop":           DomainAction("stop",           "Stop",   feature_bit=8),
            "return_to_base": DomainAction("return_to_base", "Dock",   feature_bit=16),
            "locate":         DomainAction("locate",         "Locate", feature_bit=512),
        },
        state_labels={
            "cleaning": "Cleaning", "docked": "Docked",
            "paused": "Paused", "idle": "Idle", "returning": "Returning",
        },
        chips=(
            ChipDef(attr="fan_speed_list", service="set_fan_speed", param="fan_speed", current_attr="fan_speed", label="Speed"),
        ),
        voice_hint="a robot vacuum cleaner",
    ),

    "lawn_mower": DomainMeta(
        label="Lawn Mower", icon="🌿", group="other",
        toggleable=False,
        active_states=("mowing", "returning"),
        restore_on_reconnect=False,
        actions={
            # LawnMowerEntityFeature: START_MOWING=1, PAUSE=2, DOCK=4
            "start_mowing": DomainAction("start_mowing", "Start", feature_bit=1),
            "pause":        DomainAction("pause",        "Pause", feature_bit=2),
            "dock":         DomainAction("dock",         "Dock",  feature_bit=4),
        },
        state_labels={
            "mowing": "Mowing", "docked": "Docked",
            "paused": "Paused", "returning": "Returning",
        },
        voice_hint="a robot lawn mower",
    ),

    "water_heater": DomainMeta(
        label="Water Heater", icon="🔥", group="water",
        toggleable=False,
        active_states=("on", "heat_pump", "electric", "gas", "performance", "eco"),
        restore_on_reconnect=False,
        actions={
            "turn_on":  DomainAction("turn_on",  "Turn On"),
            "turn_off": DomainAction("turn_off", "Turn Off"),
        },
        state_labels={"on": "On", "off": "Off", "eco": "Eco", "performance": "Performance"},
        chips=(
            ChipDef(attr="operation_list", service="set_operation_mode", param="operation_mode", current_attr="current_operation", label="Mode"),
        ),
        voice_hint="a smart water heater",
    ),
}


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def get(domain: str) -> DomainMeta | None:
    """Return metadata for a domain, or None if unknown."""
    return DOMAIN_REGISTRY.get(domain)


def controllable_domains() -> frozenset[str]:
    """Domains that can receive commands (shown in active/total metrics)."""
    return frozenset(k for k, v in DOMAIN_REGISTRY.items() if v.controllable)


def restore_domains() -> frozenset[str]:
    """Domains whose last state should be re-applied after a power-loss reconnect."""
    return frozenset(k for k, v in DOMAIN_REGISTRY.items() if v.restore_on_reconnect)


def voice_controllable() -> dict[str, DomainMeta]:
    """Domains with voice actions defined — used to build the control_device GPT tool."""
    return {k: v for k, v in DOMAIN_REGISTRY.items() if v.controllable and v.actions}
