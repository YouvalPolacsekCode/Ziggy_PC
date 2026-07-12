from __future__ import annotations
from core.intent_utils import ok, err, normalize_room
from core.result_utils import L
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
        action_word = "turn on" if params.get("turn_on", True) else "turn off"
        action_word_he = "להדליק" if params.get("turn_on", True) else "לכבות"
        return ok(L(f"Which room's light should I {action_word}?",
                    f"באיזה חדר {action_word_he} את האור?"))
    entity_id = params.get("entity_id") or resolve_entity(room, "light")
    room_label = room.replace('_', ' ')
    if not entity_id:
        return err(L(f"No light configured for {room_label}.",
                     f"אין אור מוגדר ב{room_label}."))
    if "turn_on" not in params:
        params["turn_on"] = (params.get("status") or "").lower() != "off"
    toggle_light(entity_id, params["turn_on"])
    action = "Turning on" if params["turn_on"] else "Turning off"
    action_he = "מדליק" if params["turn_on"] else "מכבה"
    set_context(room=room, device_type="light", entity_id=entity_id,
                action="on" if params["turn_on"] else "off", intent="toggle_light")
    return ok(L(f"{action} {room_label} light.",
                f"{action_he} את האור ב{room_label}."))


async def handle_set_light_color(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    if room == "unknown":
        return err(L("Missing room name.", "חסר שם חדר."))
    entity_id = params.get("entity_id") or resolve_entity(room, "light")
    room_label = room.replace('_', ' ')
    if not entity_id:
        return err(L(f"No light configured for {room_label}.",
                     f"אין אור מוגדר ב{room_label}."))
    color = (params.get("color") or "white").lower()
    rgb = _COLOR_MAP.get(color, (255, 255, 255))
    toggle_light(entity_id, True)
    set_light_color(entity_id, rgb_color=rgb)
    set_context(room=room, device_type="light", entity_id=entity_id, action="color", intent="set_light_color")
    return ok(L(f"{room_label.title()} light color set to {color}.",
                f"צבע האור ב{room_label} הוגדר ל{color}."))


async def handle_set_light_brightness(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    entity_id = params.get("entity_id") or resolve_entity(room, "light")
    room_label = room.replace('_', ' ')
    if not entity_id:
        return err(L(f"No light configured for {room_label}.",
                     f"אין אור מוגדר ב{room_label}."))
    try:
        brightness = int(params.get("brightness", 100))
    except Exception:
        return err(L("Please provide a valid brightness number (0-100).",
                     "אנא ציינו מספר בהירות תקין (0-100)."))
    toggle_light(entity_id, True)
    set_light_brightness(entity_id, brightness)
    set_context(room=room, device_type="light", entity_id=entity_id, action="brightness", intent="adjust_light_brightness")
    return ok(L(f"{room_label.title()} light brightness set to {brightness}%.",
                f"בהירות האור ב{room_label} הוגדרה ל-{brightness}%."))


async def handle_toggle_all_lights_in_room(params: dict, *, source: str = "unknown") -> dict:
    room = normalize_room(params)
    if room == "unknown":
        return err(L("Please specify a room.", "אנא ציינו חדר."))
    turn_on = params.get("turn_on", True)
    return toggle_all_lights_in_room(room, turn_on)


async def handle_turn_off_everything(params: dict, *, source: str = "unknown") -> dict:
    from core.conversation_context import clear_context
    clear_context()
    return turn_off_everything()


async def handle_turn_off_all_lights(params: dict, *, source: str = "unknown") -> dict:
    from core.conversation_context import set_bulk_context
    from services.home_automation import get_all_states
    from services.device_registry import get_device_info

    # Snapshot which lights are currently on so we can restore exactly those.
    try:
        on_lights = [
            s["entity_id"] for s in get_all_states()
            if s.get("entity_id", "").startswith("light.")
            and s.get("state") not in ("off", "unavailable", "unknown")
        ]
    except Exception:
        on_lights = []

    result = turn_off_all_lights()

    if result.get("ok") and on_lights:
        # Build per-device context entries with the exact tool call needed to restore each.
        bulk_devices = []
        for eid in on_lights:
            info = get_device_info(eid) or {}
            room = info.get("room") or eid.split(".")[0]
            bulk_devices.append({
                "room":        room,
                "device_type": "light",
                "action":      "off",
                "tool":        "toggle_light",
                "tool_params": {"room": room, "turn_on": True},
            })
        set_bulk_context(bulk_devices)

    return result


HANDLERS = {
    "toggle_light": handle_toggle_light,
    "set_light_color": handle_set_light_color,
    "set_light_brightness": handle_set_light_brightness,
    "adjust_light_brightness": handle_set_light_brightness,
    "toggle_all_lights_in_room": handle_toggle_all_lights_in_room,
    "turn_off_everything": handle_turn_off_everything,
    "turn_off_all_lights": handle_turn_off_all_lights,
}
