from telegram import Update
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, filters
)
import asyncio
import openai
import inspect

from core.settings_loader import settings, save_settings
from core.action_parser import handle_intent
from core.logger_module import log_info, log_error
from core.intent_parser import quick_parse
from services.task_manager import start_reminder_thread
from core.memory import append_chat, get_chat_history, load_long_term_memory

from ui.ziggy_buttons import (
    get_main_menu, get_task_menu, get_home_menu,
    get_system_menu, get_memory_menu, get_core_menu
)

from routers.telegram_action_router import handle_telegram_button

TELEGRAM_TOKEN = settings["telegram"]["token"]
openai.api_key = settings["openai"]["api_key"]

telegram_bot_instance = None
telegram_loop = None

def is_verbose():
    return settings.get("debug", {}).get("verbose", False)

def send_reminder_message(message: str):
    global telegram_bot_instance, telegram_loop
    chat_id = settings["telegram"].get("default_chat_id") or 316341835

    if not telegram_bot_instance or not chat_id or not telegram_loop or not telegram_loop.is_running():
        log_error("[Telegram] ❗ Reminder cannot be sent (missing bot, chat ID, or event loop).")
        return

    async def send():
        try:
            await telegram_bot_instance.send_message(chat_id=chat_id, text=message, parse_mode="MarkdownV2")
            log_info(f"[Telegram] Reminder sent: {message}")
        except Exception as e:
            log_error(f"[Telegram] Failed to send reminder: {e}")

    try:
        asyncio.run_coroutine_threadsafe(send(), telegram_loop)
    except Exception as e:
        log_error(f"[Telegram] Failed to schedule reminder coroutine: {e}")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    log_info("[Telegram] /start command triggered")

    settings["telegram"]["default_chat_id"] = chat_id
    save_settings(settings)

    await update.message.reply_text("👋 Ziggy is active and listening!", reply_markup=get_main_menu(), parse_mode="MarkdownV2")
    log_info(f"[Telegram] Registered chat ID: {chat_id}")

async def send_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    log_info("[Telegram] /menu command triggered")
    await update.message.reply_text("Here’s the main menu:", reply_markup=get_main_menu(), parse_mode="MarkdownV2")

async def toggle_debug(update: Update, context: ContextTypes.DEFAULT_TYPE):
    current = settings["debug"].get("verbose", False)
    settings["debug"]["verbose"] = not current
    save_settings(settings)
    status = "ON 🟢" if settings["debug"]["verbose"] else "OFF ⚫"
    await update.message.reply_text(f"Verbose mode: {status}", parse_mode="MarkdownV2")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text.strip()
    chat_id = update.effective_chat.id

    log_info(f"[Telegram] Incoming message: {user_text}")

    # 🔹 Multi-step input check
    pending_action = context.chat_data.get("pending_action")

    if pending_action == "add_task":
        context.chat_data["pending_action"] = None
        intent_data = {"intent": "add_task", "params": {"task": user_text}}
        response = await handle_intent(intent_data, source="telegram")
        await update.message.reply_text(f"✅ Task added: {user_text}\n\n{response}", reply_markup=get_task_menu(), parse_mode="MarkdownV2")
        return

    if pending_action == "remove_task_select":
        context.chat_data["pending_action"] = None
        intent_data = {"intent": "remove_task", "params": {"task": user_text}}
        response = await handle_intent(intent_data, source="telegram")
        await update.message.reply_text(f"🗑 Removed: {user_text}\n\n{response}", reply_markup=get_task_menu(), parse_mode="MarkdownV2")
        return

    # 🔸 Prevent repeated destructive commands
    recent_command = context.chat_data.get("last_command", "")
    if user_text.lower() in ["shutdown ziggy", "restart ziggy"] and user_text.lower() == recent_command:
        await update.message.reply_text("⚠️ Command ignored to prevent repeat execution.", parse_mode="MarkdownV2")
        return
    context.chat_data["last_command"] = user_text.lower()

    # 🔍 Intent parsing
    try:
        intent_data = quick_parse(user_text)

        if intent_data:
            response = await handle_intent(intent_data, source="telegram") \
                if inspect.iscoroutinefunction(handle_intent) else handle_intent(intent_data)

            append_chat("user", user_text)
            append_chat("assistant", response if isinstance(response, str) else str(response))

            if isinstance(response, list):
                for chunk in response:
                    await update.message.reply_text(chunk, parse_mode=None)  # ✅ Add parse_mode here
            else:
                await update.message.reply_text(response, parse_mode=None)

        # 🧠 Fallback to GPT chat mode
        memory = load_long_term_memory()
        memory_facts = ", ".join(f"{k}: {v}" for k, v in memory.items())
        chat_history = get_chat_history()[-10:] + [{"role": "user", "content": user_text}]

        system_prompt = (
            f"You are Ziggy, a smart home assistant.\n"
            f"Known facts: {memory_facts}\n"
            f"Reply clearly. Ask questions if unsure of the user's intent."
        )

        completion = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[{"role": "system", "content": system_prompt}] + chat_history,
            temperature=0.6,
            max_tokens=300
        )

        reply = completion.choices[0].message["content"].strip()
        append_chat("user", user_text)
        append_chat("assistant", reply)
        await update.message.reply_text(reply, parse_mode="MarkdownV2")

    except Exception as e:
        log_error(f"[Telegram] Error: {e}")
        await update.message.reply_text("⚠️ Something went wrong.", parse_mode="MarkdownV2")

async def button_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data

    try:
        menu_map = {
            "main_menu": (get_main_menu, "Main Menu:"),
            "menu_tasks": (get_task_menu, "📅 Task Manager:"),
            "menu_home": (get_home_menu, "💡 Home Automation:"),
            "menu_system": (get_system_menu, "🛠 System Tools:"),
            "menu_memory": (get_memory_menu, "🧠 Memory:"),
            "menu_core": (get_core_menu, "🤖 Ziggy Core:")
        }

        if data in menu_map:
            menu_fn, title = menu_map[data]
            await query.edit_message_text(title, reply_markup=menu_fn(), parse_mode='MarkdownV2')
        else:
            handled = await handle_telegram_button(query, context)
            if not handled:
                await query.edit_message_text("⚠️ Unknown action.", parse_mode='MarkdownV2')

    except Exception as e:
        log_error(f"[Telegram] Button error: {e}")
        await query.edit_message_text("⚠️ Failed to process button.", parse_mode='MarkdownV2')

def start_telegram_bot():
    global telegram_bot_instance, telegram_loop

    if not TELEGRAM_TOKEN:
        print("[Telegram] ❗ TELEGRAM_TOKEN not found.")
        return

    async def run_bot():
        global telegram_bot_instance, telegram_loop
        app = Application.builder().token(TELEGRAM_TOKEN).build()
        telegram_bot_instance = app.bot
        telegram_loop = asyncio.get_running_loop()

        await app.bot.delete_webhook(drop_pending_updates=True)

        app.add_handler(CommandHandler("start", start))
        app.add_handler(CommandHandler("menu", send_menu))
        app.add_handler(CommandHandler("debug", toggle_debug))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
        app.add_handler(CallbackQueryHandler(button_callback))

        await app.initialize()
        await app.start()
        await app.updater.start_polling()

        start_reminder_thread(send_reminder_message)
        await asyncio.Event().wait()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_bot())
