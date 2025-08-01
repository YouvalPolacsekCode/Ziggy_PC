from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from services.task_manager import list_tasks, get_all_tasks
from core.action_parser import handle_intent
from ui.ziggy_buttons import get_main_menu, get_task_menu
from core.logger_module import log_error

INTENT_CALLBACKS = {
    "remove_tasks": {"intent": "remove_tasks", "params": {}},
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
        # ➕ Add Task (text input)
        if data == "add_task":
            context.chat_data["pending_action"] = "add_task"
            await query.edit_message_text("📝 Please type the task you want to add:")
            return True

        # 📋 List Tasks
        elif data == "list_tasks":
            tasks = list_tasks(formatted=True)
            if not tasks:
                await query.edit_message_text("📭 No tasks found.", reply_markup=get_task_menu())
            else:
                await query.edit_message_text("📝 Your Tasks:\n- " + "\n- ".join(tasks), reply_markup=get_task_menu())
            return True

        # 🗑 Select Task to Remove
        elif data == "remove_task":
            tasks = get_all_tasks()
            if not tasks:
                await query.edit_message_text("📭 No tasks to remove.", reply_markup=get_task_menu())
                return True
            context.chat_data["pending_action"] = "remove_task_select"
            keyboard = [[InlineKeyboardButton(t["task"], callback_data="TASK_" + t["task"][:64])] for t in tasks]
            keyboard.append([InlineKeyboardButton("⬅️ Back", callback_data="menu_tasks")])
            markup = InlineKeyboardMarkup(keyboard)
            await query.edit_message_text("🗑 Select a task to remove:", reply_markup=markup)
            return True

        # 🧹 Remove Selected Task
        elif data.startswith("TASK_"):
            task_name = data[5:]
            intent = {"intent": "remove_task", "params": {"task": task_name}}
            response = await handle_intent(intent, source="telegram")
            await query.edit_message_text(f"🗑 Removed: {task_name}\n\n{response}", reply_markup=get_task_menu())
            return True

        # 🔁 Fallback to static intent map
        elif data in INTENT_CALLBACKS:
            intent = INTENT_CALLBACKS[data]
            response = await handle_intent(intent, source="telegram")
            await query.edit_message_text(text=response)
            return True

    except Exception as e:
        log_error(f"[Telegram] Button error: {e}")
        await query.edit_message_text("⚠️ Failed to process button.")

    return False
