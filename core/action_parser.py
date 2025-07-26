from services.home_automation import toggle_light, set_light_color, get_sensor_state
from services.task_manager import add_task, list_tasks, remove_task
from services.file_manager import create_note, read_notes
from services.system_tools import get_time, get_date, restart_ziggy, shutdown_ziggy
from core.logger_module import log_info
import asyncio

async def handle_intent(intent_result, **kwargs):
    intent = intent_result.get("intent")
    params = intent_result.get("params", {})
    source = kwargs.get("source", "unknown")

    # Normalize common aliases (e.g. GPT might return "location" instead of "room")
    if "location" in params and "room" not in params:
        params["room"] = params.pop("location")

    log_info(f"[Intent Handler] Received intent: {intent} from {source} with params: {params}")

    try:
        if intent == "toggle_light":
            room = params.get("room")
            if not room:
                return "Missing room name."
            entity_id = f"light.{room}_light"
            toggle_light(entity_id, params.get("turn_on", True))
            return f"{'Turning on' if params.get('turn_on') else 'Turning off'} {room} light"

        if intent == "set_light_color":
            room = params.get("room")
            color = params.get("color", "white").lower()
            if not room:
                return "Missing room name."
            entity_id = f"light.{room}_light"
            color_map = {
                "red": (255, 0, 0),
                "green": (0, 255, 0),
                "blue": (0, 0, 255),
                "yellow": (255, 223, 160),
                "white": (255, 255, 255),
                "orange": (255, 165, 0),
                "purple": (128, 0, 128),
                "pink": (255, 105, 180)
            }
            rgb = color_map.get(color, (255, 255, 255))
            toggle_light(entity_id, True)
            set_light_color(entity_id, rgb_color=rgb)
            return f"{room.capitalize()} light color set to {color}."

        if intent == "get_temperature":
            room = params.get("room", "unknown")
            value = get_sensor_state(room, "temperature")
            return f"The temperature in {room} is {value}°C."

        if intent == "get_humidity":
            room = params.get("room", "unknown")
            value = get_sensor_state(room, "humidity")
            return f"The humidity in {room} is {value}%."

        if intent == "control_ac":
            toggle_light("switch.ac_main", params.get("turn_on", True))
            return f"{'Turning on' if params.get('turn_on') else 'Turning off'} the AC."

        if intent == "control_tv":
            toggle_light("switch.tv_main", params.get("turn_on", True))
            return f"{'Turning on' if params.get('turn_on') else 'Turning off'} the TV."

        if intent == "get_time":
            return get_time()

        if intent == "get_date":
            return get_date()

        if intent == "restart_ziggy":
            return restart_ziggy()

        if intent == "shutdown_ziggy":
            return shutdown_ziggy()

        if intent == "add_task":
            task = params.get("task", "Unnamed task")
            return add_task(task)

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
            return "I'm Ziggy, your home assistant. Feeling sharp and ready!"

        if intent == "ziggy_identity":
            return "I'm Ziggy, built by Youval to make your home smarter and life easier."

        if intent == "chat_with_gpt":
            return params.get("text", "Let's chat!")

    except Exception as e:
        log_info(f"[Intent Handler] Exception: {e}")
        return f"⚠️ Error while handling intent '{intent}': {str(e)}"

    log_info(f"[Intent Handler] Unrecognized intent: {intent}")
    return "🤖 I'm not sure how to help with that yet."
