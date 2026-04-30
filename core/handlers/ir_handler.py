"""
IR device intent handlers.

Routes voice/text commands through the intent pipeline to HA Broadlink blasters
via ir_manager. Handles:
  - ir_send_command        : TV power/volume/navigation/HDMI, AC mode/fan, fan speed, etc.
  - ir_set_ac_temperature  : AC temperature (discrete IR codes per degree)
  - ir_learn_command       : puts blaster in 20-second learning mode
  - ir_send_channel        : channel number dispatch (digit codes + digit_ok)
  - ir_play_sequence       : named macro sequences (e.g. "netflix", "sleep_mode")

GPT sends one of these intents after seeing ir_manager's device list in the system prompt.
"""
from __future__ import annotations

from core.intent_utils import ok, err, normalize_room
from core.conversation_context import set_context
from core.logger_module import log_info, log_error
from services.ir_manager import (
    resolve_ir_device,
    send_ir_command,
    send_ac_temperature,
    send_channel,
    send_sequence,
    start_learning,
    get_ir_device,
    get_device_state,
    mark_command_learned,
)


# ---------------------------------------------------------------------------
# Action normalisation — maps GPT's natural language action strings to the
# standard logical command names used in ir_manager's command maps.
# GPT is guided by the tool description, so these are mostly fallback aliases.
# ---------------------------------------------------------------------------

_TV_ACTION_ALIASES: dict[str, str] = {
    # power
    "on": "power", "off": "power", "toggle": "power",
    "turn on": "power", "turn off": "power",
    # volume
    "volume up": "volume_up", "louder": "volume_up", "raise volume": "volume_up",
    "increase volume": "volume_up", "vol up": "volume_up",
    "volume down": "volume_down", "quieter": "volume_down", "lower volume": "volume_down",
    "decrease volume": "volume_down", "vol down": "volume_down",
    "silence": "mute", "unmute": "mute",
    # sources
    "hdmi 1": "hdmi_1", "hdmi1": "hdmi_1", "hdmi one": "hdmi_1",
    "hdmi 2": "hdmi_2", "hdmi2": "hdmi_2", "hdmi two": "hdmi_2",
    "hdmi 3": "hdmi_3", "hdmi3": "hdmi_3", "hdmi three": "hdmi_3",
    # navigation
    "up": "nav_up", "down": "nav_down", "left": "nav_left", "right": "nav_right",
    "enter": "nav_ok", "select": "nav_ok", "confirm": "nav_ok", "ok": "nav_ok",
    "go back": "back", "return": "back",
    # channels
    "channel up": "channel_up", "next channel": "channel_up",
    "channel down": "channel_down", "previous channel": "channel_down",
}

_AC_ACTION_ALIASES: dict[str, str] = {
    "on": "power", "off": "power", "toggle": "power",
    "turn on": "power", "turn off": "power",
    "cool": "mode_cool", "cooling": "mode_cool", "air con": "mode_cool",
    "heat": "mode_heat", "heating": "mode_heat", "warm": "mode_heat",
    "fan only": "mode_fan", "fan mode": "mode_fan",
    "dehumidify": "mode_dry", "dry mode": "mode_dry",
    "low": "fan_low", "fan low": "fan_low",
    "medium": "fan_medium", "fan medium": "fan_medium", "fan med": "fan_medium",
    "high": "fan_high", "fan high": "fan_high",
    "swing": "swing_on", "swing on": "swing_on", "swing off": "swing_off",
}

_FAN_ACTION_ALIASES: dict[str, str] = {
    "on": "power", "off": "power", "toggle": "power",
    "low": "speed_low", "slow": "speed_low",
    "medium": "speed_medium",
    "high": "speed_high", "fast": "speed_high",
    "oscillate": "oscillate", "rotate": "oscillate",
}

_SOUNDBAR_ACTION_ALIASES: dict[str, str] = {
    "on": "power", "off": "power", "toggle": "power",
    "louder": "volume_up", "quieter": "volume_down",
    "silence": "mute", "unmute": "mute",
    "hdmi": "input_hdmi", "optical": "input_optical",
    "bluetooth": "input_bluetooth", "bt": "input_bluetooth",
}

_ALIASES_BY_TYPE: dict[str, dict[str, str]] = {
    "tv":       _TV_ACTION_ALIASES,
    "ac":       _AC_ACTION_ALIASES,
    "fan":      _FAN_ACTION_ALIASES,
    "soundbar": _SOUNDBAR_ACTION_ALIASES,
}


def _normalize_action(raw: str, device_type: str) -> str:
    """
    Normalise GPT's raw action string to a standard logical command name.
    Try exact match first, then alias lookup, then return the cleaned raw value.
    """
    clean = raw.strip().lower().replace("-", "_")
    # Underscored form already valid → return as-is
    table = _ALIASES_BY_TYPE.get(device_type, {})
    # Check alias table (space-separated GPT output → underscore logical name)
    spaced = raw.strip().lower()
    if spaced in table:
        return table[spaced]
    # Normalise spaces to underscores and check again
    underscored = spaced.replace(" ", "_")
    if underscored in table:
        return table[underscored]
    return clean


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

async def handle_ir_send_command(params: dict, *, source: str = "unknown") -> dict:
    """
    Handle generic IR command: power, volume, mute, HDMI switch, navigation, AC mode/fan, fan speed.
    GPT sets device_type ("tv", "ac", "fan", "soundbar", "projector") and action.
    For TV power commands, checks the linked HA entity state first to avoid double-toggling.
    """
    raw_room = (params.get("room") or "").strip()
    room = normalize_room({"room": raw_room}) if raw_room else None
    device_type = (params.get("device_type") or "tv").lower().strip()
    raw_action = (params.get("action") or "").strip()

    if not raw_action:
        return err("Please specify an action (e.g. 'power', 'volume up', 'mute').")

    device, error = resolve_ir_device(room, device_type)
    if not device:
        return err(error)

    action = _normalize_action(raw_action, device_type)
    log_info(f"[IR] send_command: device={device['id']} raw={raw_action!r} → {action!r}")

    # For TV power: verify current state so we don't double-toggle.
    # If user says "turn on" and TV is already on (per HA entity), skip IR.
    if device_type == "tv" and action == "power":
        intended_on = raw_action.lower() in ("on", "turn on")
        intended_off = raw_action.lower() in ("off", "turn off")
        if intended_on or intended_off:
            current_state = get_device_state(device)
            room_str = (device.get("room") or "").replace("_", " ")
            if intended_on and current_state == "on":
                return ok(f"{device['name']} in {room_str} is already on.")
            if intended_off and current_state == "off":
                return ok(f"{device['name']} in {room_str} is already off.")

    result = send_ir_command(device["id"], action)
    if result.get("ok"):
        room_str = (device.get("room") or "").replace("_", " ")
        set_context(room=device.get("room") or room, device_type=device_type,
                    entity_id=device["id"], action=action, intent="ir_send_command")
        return ok(f"Sent {raw_action} to {device['name']} in {room_str}.")

    # Command not found — give a helpful message
    return err(
        result.get("message") or f"Couldn't send '{raw_action}' to {device['name']}.",
        details=str(result.get("data") or ""),
    )


async def handle_ir_set_ac_temperature(params: dict, *, source: str = "unknown") -> dict:
    """
    Set AC temperature via IR discrete codes. GPT extracts temperature and optional mode.
    """
    raw_room = (params.get("room") or "").strip()
    room = normalize_room({"room": raw_room}) if raw_room else None
    raw_mode = (params.get("mode") or "").strip().lower()

    try:
        temperature = int(params["temperature"])
    except (KeyError, ValueError, TypeError):
        return err("Please specify a valid temperature (e.g. 'set AC to 24').")

    if not (10 <= temperature <= 35):
        return err(
            f"{temperature}°C doesn't look right. "
            "Please give a temperature between 16 and 30."
        )

    device, error = resolve_ir_device(room, "ac")
    if not device:
        return err(error)

    mode = raw_mode if raw_mode else None
    result = send_ac_temperature(device["id"], temperature, mode=mode)
    if result.get("ok"):
        set_context(room=device.get("room") or room, device_type="ac",
                    entity_id=device["id"], action="temperature", intent="ir_set_ac_temperature")
        return result
    return err(result.get("message") or "Couldn't set AC temperature.")


async def handle_ir_send_channel(params: dict, *, source: str = "unknown") -> dict:
    """
    Dispatch channel number via digit IR codes (digit_0..digit_9 + digit_ok).
    GPT provides channel (int or string like "12") and optional room.
    """
    raw_room = (params.get("room") or "").strip()
    room = normalize_room({"room": raw_room}) if raw_room else None

    raw_channel = params.get("channel")
    try:
        channel_number = int(str(raw_channel).strip())
    except (TypeError, ValueError):
        return err("Please specify a valid channel number (e.g. 'channel 12').")

    if not (0 <= channel_number <= 9999):
        return err(f"Channel {channel_number} is out of range.")

    device, error = resolve_ir_device(room, "tv")
    if not device:
        return err(error)

    log_info(f"[IR] send_channel: device={device['id']} channel={channel_number}")
    result = await send_channel(device["id"], channel_number)
    if result.get("ok"):
        room_str = (device.get("room") or "").replace("_", " ")
        return ok(f"Switched {device['name']} in {room_str} to channel {channel_number}.")
    return err(result.get("message") or f"Couldn't switch to channel {channel_number}.")


async def handle_ir_play_sequence(params: dict, *, source: str = "unknown") -> dict:
    """
    Play a named command sequence (macro) on an IR device.
    GPT provides sequence_name, optional device_type, and optional room.
    """
    raw_room = (params.get("room") or "").strip()
    room = normalize_room({"room": raw_room}) if raw_room else None
    device_type = (params.get("device_type") or "tv").lower().strip()
    sequence_name = (params.get("sequence_name") or "").strip().lower().replace(" ", "_")

    if not sequence_name:
        return err("Please specify a sequence name (e.g. 'netflix', 'sleep mode').")

    device, error = resolve_ir_device(room, device_type)
    if not device:
        return err(error)

    log_info(f"[IR] play_sequence: device={device['id']} sequence={sequence_name!r}")
    result = await send_sequence(device["id"], sequence_name)
    if result.get("ok"):
        room_str = (device.get("room") or "").replace("_", " ")
        display_name = sequence_name.replace("_", " ")
        return ok(f"Played '{display_name}' on {device['name']} in {room_str}.")
    return err(result.get("message") or f"Couldn't play sequence '{sequence_name}'.")


async def handle_ir_learn_command(params: dict, *, source: str = "unknown") -> dict:
    """
    Trigger Broadlink learning mode for a specific device + command.
    Used from the setup wizard (via API) and optionally from voice/Telegram.
    """
    device_id = (params.get("device_id") or "").strip()
    command_name = (params.get("command_name") or "").strip()

    if not device_id or not command_name:
        return err("Provide device_id and command_name to start learning.")

    device = get_ir_device(device_id)
    if not device:
        return err(f"Device '{device_id}' not found.")

    # Resolve logical command → HA command string
    command_map: dict = device.get("commands") or {}
    ha_command = command_map.get(command_name, command_name)

    result = start_learning(
        blaster_entity=device["blaster_entity_id"],
        device_namespace=device["ha_device_namespace"],
        ha_command=ha_command,
    )
    if result.get("ok"):
        mark_command_learned(device_id, command_name)

    return result


# ---------------------------------------------------------------------------
# Handler registry
# ---------------------------------------------------------------------------

HANDLERS = {
    "ir_send_command":        handle_ir_send_command,
    "ir_set_ac_temperature":  handle_ir_set_ac_temperature,
    "ir_learn_command":       handle_ir_learn_command,
    "ir_send_channel":        handle_ir_send_channel,
    "ir_play_sequence":       handle_ir_play_sequence,
}
