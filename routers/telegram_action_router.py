from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from services.task_manager import list_tasks, get_all_tasks
from core.action_parser import handle_intent
from ui.ziggy_buttons import (
    get_main_menu, get_task_menu, get_home_menu, get_system_menu,
    get_memory_menu, get_core_menu, get_datetime_menu, get_lights_menu,
    get_ac_menu, get_tv_menu, get_sensors_menu, get_room_selection_menu,
    get_color_selection_menu, get_priority_menu
)
from core.logger_module import log_error
from core.memory import list_memory

INTENT_CALLBACKS = {
    "remove_tasks": {"intent": "remove_tasks", "params": {}},
    "remove_last_task": {"intent": "remove_last_task", "params": {}},
    "toggle_light": {"intent": "toggle_light", "params": {"room": "living room", "turn_on": True}},
    "set_light_color": {"intent": "set_light_color", "params": {"room": "bedroom", "color": "blue"}},
    "control_tv": {"intent": "control_tv", "params": {"turn_on": True}},
    "get_wifi_status": {"intent": "get_wifi_status", "params": {}},
    "restart_ziggy": {"intent": "restart_ziggy", "params": {}},
    "get_ip_address": {"intent": "get_ip_address", "params": {}},
    "remember_memory": {"intent": "remember_memory", "params": {"key": "mood", "value": "happy"}},
    "recall_memory": {"intent": "recall_memory", "params": {"key": "mood"}},
    "delete_memory": {"intent": "delete_memory", "params": {"key": "mood"}},
    "chat_with_gpt": {"intent": "chat_with_gpt", "params": {"text": "How are you?"}},
    "ziggy_identity": {"intent": "ziggy_identity", "params": {}},
    "ziggy_help": {"intent": "ziggy_help", "params": {}}
}

async def handle_telegram_button(query, context):
    data = query.data
    chat_id = query.message.chat_id

    try:
        # Menu navigation
        menu_map = {
            "main_menu": (get_main_menu, "🏠 Main Menu:"),
            "menu_tasks": (get_task_menu, "📅 Task Manager:"),
            "menu_home": (get_home_menu, "💡 Home Automation:"),
            "menu_lights": (get_lights_menu, "💡 Light Controls:"),
            "menu_ac": (get_ac_menu, "❄️ AC Controls:"),
            "menu_tv": (get_tv_menu, "📺 TV Controls:"),
            "menu_sensors": (get_sensors_menu, "🌡️ Sensor Readings:"),
            "menu_system": (get_system_menu, "🛠 System Tools:"),
            "menu_memory": (get_memory_menu, "🧠 Memory Management:"),
            "menu_core": (get_core_menu, "🤖 Ziggy Core:"),
            "menu_datetime": (get_datetime_menu, "🕐 Date & Time:")
        }

        if data in menu_map:
            menu_fn, title = menu_map[data]
            await query.edit_message_text(title, reply_markup=menu_fn(), parse_mode=None)
            return True

        # ================= Task Manager =================
        if data == "add_task":
            context.chat_data["pending_action"] = "add_task"
            await query.edit_message_text("📝 Please type the task you want to add:", reply_markup=get_task_menu(), parse_mode=None)
            return True

        elif data == "list_tasks":
            tasks = list_tasks(formatted=True)
            msg = tasks if tasks and tasks != "📭 No tasks yet." else "📭 No tasks found."
            await query.edit_message_text(msg, reply_markup=get_task_menu(), parse_mode=None)
            return True

        elif data == "mark_task_done":
            tasks = get_all_tasks()
            if not tasks:
                await query.edit_message_text("📭 No tasks to mark as done.", reply_markup=get_task_menu(), parse_mode=None)
                return True
            context.chat_data["pending_action"] = "mark_task_done"
            keyboard = [[InlineKeyboardButton(f"✅ {t['task'][:50]}", callback_data=f"MARK_{i}")]
                        for i, t in enumerate(tasks) if not t.get("done")]
            keyboard.append([InlineKeyboardButton("⬅️ Back", callback_data="menu_tasks")])
            await query.edit_message_text("✅ Select a task to mark as done:", reply_markup=InlineKeyboardMarkup(keyboard), parse_mode=None)
            return True

        elif data == "remove_task":
            tasks = get_all_tasks()
            if not tasks:
                await query.edit_message_text("📭 No tasks to remove.", reply_markup=get_task_menu(), parse_mode=None)
                return True
            context.chat_data["pending_action"] = "remove_task_select"
            keyboard = [[InlineKeyboardButton(f"🗑 {t['task'][:50]}", callback_data=f"REMOVE_{t['task'][:64]}")] for t in tasks]
            keyboard.append([InlineKeyboardButton("⬅️ Back", callback_data="menu_tasks")])
            await query.edit_message_text("🗑 Select a task to remove:", reply_markup=InlineKeyboardMarkup(keyboard), parse_mode=None)
            return True

        elif data.startswith("MARK_"):
            task_index = int(data[5:])
            response = await handle_intent({"intent": "mark_task_done", "params": {"task": str(task_index)}}, source="telegram")
            await query.edit_message_text(f"✅ {response}", reply_markup=get_task_menu(), parse_mode=None)
            return True

        elif data.startswith("REMOVE_"):
            task_name = data[7:]
            response = await handle_intent({"intent": "remove_task", "params": {"task": task_name}}, source="telegram")
            await query.edit_message_text(f"🗑 {response}", reply_markup=get_task_menu(), parse_mode=None)
            return True

        # ================= Home Automation =================
        elif data == "toggle_light":
            await query.edit_message_text("💡 Select room for light control:", reply_markup=get_room_selection_menu("light_toggle"), parse_mode=None)
            return True

        elif data.startswith("light_toggle_"):
            room = data[13:]
            response = await handle_intent({"intent": "toggle_light", "params": {"room": room, "turn_on": True}}, source="telegram")
            await query.edit_message_text(response, reply_markup=get_lights_menu(), parse_mode=None)
            return True

        elif data == "set_light_color":
            context.chat_data["pending_action"] = "set_light_color_room"
            await query.edit_message_text("🎨 Select room for color change:", reply_markup=get_room_selection_menu("color_room"), parse_mode=None)
            return True

        elif data.startswith("color_room_"):
            context.chat_data["selected_room"] = data[11:]
            await query.edit_message_text("🎨 Select color:", reply_markup=get_color_selection_menu(), parse_mode=None)
            return True

        elif data.startswith("color_"):
            color = data[6:]
            room = context.chat_data.get("selected_room", "living_room")
            response = await handle_intent({"intent": "set_light_color", "params": {"room": room, "color": color}}, source="telegram")
            await query.edit_message_text(response, reply_markup=get_lights_menu(), parse_mode=None)
            return True

        elif data == "adjust_light_brightness":
            context.chat_data["pending_action"] = "adjust_light_brightness"
            await query.edit_message_text("🔆 Select room and type brightness level (0-100):", reply_markup=get_room_selection_menu("brightness"), parse_mode=None)
            return True

        elif data == "control_ac":
            response = await handle_intent({"intent": "control_ac", "params": {"turn_on": True}}, source="telegram")
            await query.edit_message_text(response, reply_markup=get_ac_menu(), parse_mode=None)
            return True

        elif data == "set_ac_temperature":
            context.chat_data["pending_action"] = "set_ac_temperature"
            await query.edit_message_text("🌡️ Please type the desired temperature (e.g., 22):", parse_mode=None)
            return True

        elif data == "control_tv":
            response = await handle_intent({"intent": "control_tv", "params": {"turn_on": True}}, source="telegram")
            await query.edit_message_text(response, reply_markup=get_tv_menu(), parse_mode=None)
            return True

        elif data == "set_tv_source":
            context.chat_data["pending_action"] = "set_tv_source"
            await query.edit_message_text("📡 Please type the TV source number (e.g., 1, 2, 3):", parse_mode=None)
            return True

        elif data in ["get_temperature", "get_humidity"]:
            await query.edit_message_text("🌡️ Select room:", reply_markup=get_room_selection_menu(data), parse_mode=None)
            return True

        elif data.startswith("get_temperature_") or data.startswith("get_humidity_"):
            parts = data.split("_", 2)
            intent = {"intent": f"{parts[0]}_{parts[1]}", "params": {"room": parts[2]}}
            response = await handle_intent(intent, source="telegram")
            await query.edit_message_text(response, reply_markup=get_sensors_menu(), parse_mode=None)
            return True

        # ================= System Tools =================
        elif data in ["get_system_status", "get_ip_address", "get_disk_usage", "get_wifi_status", "get_network_adapters", "restart_ziggy", "shutdown_ziggy"]:
            response = await handle_intent({"intent": data, "params": {}}, source="telegram")
            await query.edit_message_text(response, reply_markup=get_system_menu(), parse_mode=None)
            return True

        elif data == "ping_test":
            context.chat_data["pending_action"] = "ping_test"
            await query.edit_message_text("📡 Please type the domain to ping (e.g., google.com):", parse_mode=None)
            return True

        # ================= Memory =================
        elif data == "remember_memory":
            context.chat_data["pending_action"] = "remember_memory"
            await query.edit_message_text("💾 Please type what you want me to remember in format: key = value", parse_mode=None)
            return True

        elif data == "recall_memory":
            context.chat_data["pending_action"] = "recall_memory"
            await query.edit_message_text("📤 Please type the key you want me to recall:", parse_mode=None)
            return True

        elif data == "delete_memory":
            context.chat_data["pending_action"] = "delete_memory"
            await query.edit_message_text("🗑️ Please type the key you want me to forget:", parse_mode=None)
            return True

        elif data == "list_memory":
            memory = list_memory()
            if not memory:
                msg = "🧠 No memories stored yet."
            else:
                msg = "🧠 Your Memories:\n\n" + "\n".join([f"🔹 {k}: {v}" for k, v in memory.items()])
            await query.edit_message_text(msg, reply_markup=get_memory_menu(), parse_mode=None)
            return True

        # ================= Ziggy Core =================
        elif data in ["ziggy_identity", "ziggy_help", "ziggy_status", "ziggy_chat"]:
            response = await handle_intent({"intent": data, "params": {}}, source="telegram")
            await query.edit_message_text(response, reply_markup=get_core_menu(), parse_mode=None)
            return True

        elif data == "chat_with_gpt":
            context.chat_data["pending_action"] = "chat_with_gpt"
            await query.edit_message_text("💬 Please type your message for GPT:", parse_mode=None)
            return True

        # ================= Static Intent Map =================
        elif data in INTENT_CALLBACKS:
            response = await handle_intent(INTENT_CALLBACKS[data], source="telegram")
            await query.edit_message_text(response, parse_mode=None)
            return True

    except Exception as e:
        log_error(f"[Telegram] Button error: {e}")
        await query.edit_message_text("⚠️ Failed to process button.", reply_markup=get_main_menu(), parse_mode=None)

    return False
