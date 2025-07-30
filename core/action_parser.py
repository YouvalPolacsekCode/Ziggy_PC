from services.home_automation import (
    toggle_light,
    set_light_color,
    set_light_brightness,
    get_sensor_state,
    set_ac_temperature,
    set_tv_source
)
from services.task_manager import add_task, list_tasks, remove_task
from services.file_manager import create_note, read_notes
from services.system_tools import (
    get_time,
    get_date,
    restart_ziggy,
    shutdown_ziggy,
    get_system_status,
    get_ip_address,
    get_disk_usage,
    get_wifi_status,
    get_network_adapters,
    ping_test
)
from core.logger_module import log_info, log_error
import asyncio

def normalize_room(params: dict) -> str:
    room = params.get("room") or params.get("area") or params.get("location")
    if not room:
        log_error(f"[Intent Handler] ❗Missing room/location in params: {params}")
        return "unknown"
    return room.replace(" ", "_").lower()

async def handle_intent(intent_result, **kwargs):
    intent = intent_result.get("intent")
    params = intent_result.get("params", {})
    source = kwargs.get("source", "unknown")

    log_info(f"[Intent Handler] Received intent: {intent} from {source} with params: {params}")

    try:
        if intent == "toggle_light":
            room = normalize_room(params)
            if room == "unknown":
                return "Missing room name."
            entity_id = f"light.{room}_light"

            if "turn_on" not in params:
                status = params.get("status", "").lower()
                if status == "on":
                    params["turn_on"] = True
                elif status == "off":
                    params["turn_on"] = False
                else:
                    params["turn_on"] = True

            toggle_light(entity_id, params["turn_on"])
            return f"{'Turning on' if params['turn_on'] else 'Turning off'} {room.replace('_', ' ')} light"

        if intent == "set_light_color":
            room = normalize_room(params)
            color = params.get("color", "white").lower()
            if room == "unknown":
                return "Missing room name."
            entity_id = f"light.{room}_light"
            color_map = {
                "red": (255, 0, 0), "green": (0, 255, 0), "blue": (0, 0, 255),
                "yellow": (255, 223, 160), "white": (255, 255, 255),
                "orange": (255, 165, 0), "purple": (128, 0, 128),
                "pink": (255, 105, 180)
            }
            rgb = color_map.get(color, (255, 255, 255))
            toggle_light(entity_id, True)
            set_light_color(entity_id, rgb_color=rgb)
            return f"{room.capitalize()} light color set to {color}."

        if intent == "set_light_brightness":
            room = normalize_room(params)
            brightness = int(params.get("brightness", 100))
            entity_id = f"light.{room}_light"
            toggle_light(entity_id, True)
            set_light_brightness(entity_id, brightness)
            return f"{room.capitalize()} light brightness set to {brightness}%."

        if intent == "adjust_light_brightness":
            return "Brightness adjustment is not yet implemented. Try 'set light brightness to 70' instead."

        if intent == "get_temperature":
            room = normalize_room(params)
            return get_sensor_state(room, "temperature")

        if intent == "get_humidity":
            room = normalize_room(params)
            return get_sensor_state(room, "humidity")

        if intent == "control_ac":
            toggle_light("switch.ac_main", params.get("turn_on", True))
            return f"{'Turning on' if params.get('turn_on') else 'Turning off'} the AC."

        if intent == "set_ac_temperature":
            temp = int(params.get("temperature", 24))
            set_ac_temperature("climate.ac_main", temp)
            return f"Setting AC temperature to {temp}°C."

        if intent == "control_tv":
            action = params.get("turn_on")
            if action is None:
                action_text = params.get("action", "").lower()
                if "off" in action_text:
                    action = False
                elif "on" in action_text:
                    action = True
                else:
                    return "Please specify whether to turn the TV on or off."

            toggle_light("media_player.living_room_tv", action)
            return f"{'Turning on' if action else 'Turning off'} the TV."

        if intent == "set_tv_source":
            source = int(params.get("source", 1))
            set_tv_source("media_player.living_room_tv", source)
            return f"Switching TV to source {source}."

        if intent == "get_time":
            return get_time()

        if intent == "get_date":
            return get_date()

        #if intent == "restart_ziggy":
        #    return restart_ziggy()

        if intent == "shutdown_ziggy":
            return shutdown_ziggy()

        if intent == "get_system_status":
            return get_system_status()

        if intent == "get_ip_address":
            return get_ip_address()

        if intent == "get_disk_usage":
            return get_disk_usage()

        if intent == "get_wifi_status":
            return get_wifi_status()

        if intent == "get_network_adapters":
            return get_network_adapters()

        if intent == "ping_test":
            domain = params.get("domain", "google.com")
            return ping_test(domain)

        if intent == "add_task":
            return add_task(params.get("task", "Unnamed task"))

        if intent == "list_tasks":
            tasks = list_tasks()
            return "\n".join(tasks) if tasks else "No tasks found."

        if intent == "remove_task":
            return remove_task(params.get("task", ""))

        if intent == "create_note":
            return create_note(params.get("note", ""))

        if intent == "read_notes":
            return read_notes()

        if intent == "ziggy_status":
            status = get_system_status()
            return f"I'm Ziggy, your home assistant. Feeling sharp and ready!\n\nHere's how I'm doing:\n{status}"

        if intent == "ziggy_identity":
            return "I'm Ziggy, built by Youval to make your home smarter and life easier."

        if intent == "ziggy_help":
            return (
                "I can help you with lights, AC, TV, tasks, notes, sensors, and system actions. "
                "Try saying 'Turn on the living room light', 'What's the temperature in Roni's room?', or 'Add task feed the cat'."
            )

        if intent == "ziggy_chat":
            return "Here’s something interesting: Did you know octopuses have three hearts?"

        if intent == "confirm_yes":
            return "✅ Got it."

        if intent == "confirm_no":
            return "❌ Okay, cancelled."

        if intent == "chat_with_gpt":
            return params.get("text", "Let's chat!")

    except Exception as e:
        log_info(f"[Intent Handler] Exception: {e}")
        return f"⚠️ Error while handling intent '{intent}': {str(e)}"

    log_info(f"[Intent Handler] Unrecognized intent: {intent}")
    return "🤖 I'm not sure how to help with that yet."
