from __future__ import annotations
from core.intent_utils import ok, err, normalize_room
from core.conversation_context import set_context
from services.home_automation import (
    toggle_light, set_light_color, set_light_brightness, resolve_entity,
    toggle_all_lights_in_room, turn_off_everything, turn_off_all_lights,
)


_COLOR_MAP = {
    "red": (255, 0, 0), "green": (0, 255, 0), "blue": (0, 0, 255),
    "yellow": (255, 223, 160), "white": (255, 255, 255),
    "orange": (255, 165, 0), "purple": (128, 0, 128), "pink": (255, 105, 180),
}


async def handle_toggle_light(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    if room == "unknown":
        return err("Missing room name.")
    entity_id = resolve_entity(room, "light")
    if not entity_id:
        return err(f"No light configured for {room.replace('_', ' ')}.")
    if "turn_on" not in params:
        params["turn_on"] = (params.get("status") or "").lower() != "off"
    toggle_light(entity_id, params["turn_on"])
    action = "Turning on" if params["turn_on"] else "Turning off"
    set_context(room=room, device_type="light", entity_id=entity_id,
                action="on" if params["turn_on"] else "off", intent="toggle_light")
    return ok(f"{action} {room.replace('_', ' ')} light.")


async def handle_set_light_color(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    if room == "unknown":
        return err("Missing room name.")
    entity_id = resolve_entity(room, "light")
    if not entity_id:
        return err(f"No light configured for {room.replace('_', ' ')}.")
    color = (params.get("color") or "white").lower()
    rgb = _COLOR_MAP.get(color, (255, 255, 255))
    toggle_light(entity_id, True)
    set_light_color(entity_id, rgb_color=rgb)
    set_context(room=room, device_type="light", entity_id=entity_id, action="color", intent="set_light_color")
    return ok(f"{room.replace('_', ' ').title()} light color set to {color}.")


async def handle_set_light_brightness(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    entity_id = resolve_entity(room, "light")
    if not entity_id:
        return err(f"No light configured for {room.replace('_', ' ')}.")
    try:
        brightness = int(params.get("brightness", 100))
    except Exception:
        return err("Please provide a valid brightness number (0-100).")
    toggle_light(entity_id, True)
    set_light_brightness(entity_id, brightness)
    set_context(room=room, device_type="light", entity_id=entity_id, action="brightness", intent="adjust_light_brightness")
    return ok(f"{room.replace('_', ' ').title()} light brightness set to {brightness}%.")


async def handle_toggle_all_lights_in_room(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    if room == "unknown":
        return err("Please specify a room.")
    turn_on = params.get("turn_on", True)
    return toggle_all_lights_in_room(room, turn_on)


async def handle_turn_off_everything(params: dict, *, source: str = "unknown") -> dict:
    return turn_off_everything()


async def handle_turn_off_all_lights(params: dict, *, source: str = "unknown") -> dict:
    return turn_off_all_lights()


HANDLERS = {
    "toggle_light": handle_toggle_light,
    "set_light_color": handle_set_light_color,
    "set_light_brightness": handle_set_light_brightness,
    "adjust_light_brightness": handle_set_light_brightness,
    "toggle_all_lights_in_room": handle_toggle_all_lights_in_room,
    "turn_off_everything": handle_turn_off_everything,
    "turn_off_all_lights": handle_turn_off_all_lights,
}
