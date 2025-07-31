from telegram import Update, Bot
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters
import asyncio
import openai
import inspect

from core.settings_loader import settings, save_settings
from core.action_parser import handle_intent
from core.logger_module import log_info, log_error
from core.intent_parser import quick_parse
from services.task_manager import start_reminder_thread
from core.memory import (
    append_chat, get_chat_history,
    load_long_term_memory, remember
)

TELEGRAM_TOKEN = settings["telegram"]["token"]
openai.api_key = settings["openai"]["api_key"]

telegram_bot_instance = None
telegram_loop = None  # ✅ store event loop for thread-safe use

def is_verbose():
    return settings.get("debug", {}).get("verbose", False)

def send_reminder_message(message: str):
    global telegram_bot_instance, telegram_loop
    chat_id = settings["telegram"].get("default_chat_id") or 316341835

    if not telegram_bot_instance:
        log_error("[Telegram] Reminder bot is not initialized.")
        return

    if not chat_id:
        log_error("[Telegram] No default_chat_id set. Reminder skipped.")
        return

    if not telegram_loop or not telegram_loop.is_running():
        log_error("[Telegram] No running Telegram loop. Cannot send reminder.")
        return

    async def send():
        try:
            await telegram_bot_instance.send_message(chat_id=chat_id, text=message)
            log_info(f"[Telegram] Reminder sent: {message}")
        except Exception as e:
            log_error(f"[Telegram] Failed to send reminder async: {e}")

    try:
        asyncio.run_coroutine_threadsafe(send(), telegram_loop)
    except Exception as e:
        log_error(f"[Telegram] Failed to schedule reminder coroutine: {e}")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    settings["telegram"]["default_chat_id"] = chat_id
    save_settings(settings)

    await update.message.reply_text("👋 Ziggy is active and listening!")
    log_info(f"[Telegram] Registered default chat ID: {chat_id}")

async def toggle_debug(update: Update, context: ContextTypes.DEFAULT_TYPE):
    current = settings["debug"].get("verbose", False)
    settings["debug"]["verbose"] = not current
    save_settings(settings)
    status = "ON 🟢" if settings["debug"]["verbose"] else "OFF ⚫"
    await update.message.reply_text(f"Verbose debug mode is now: {status}")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text.strip()
    chat_id = update.effective_chat.id

    if is_verbose():
        log_info(f"[Telegram] User: {user_text}")

    recent_command = context.chat_data.get("last_command", "")
    protected_commands = ["shutdown ziggy", "restart ziggy"]
    if user_text.lower() in protected_commands and user_text.lower() == recent_command:
        await update.message.reply_text("⚠️ Command ignored to prevent repeat execution.")
        return
    context.chat_data["last_command"] = user_text.lower()

    try:
        intent_data = quick_parse(user_text)

        if intent_data:
            if inspect.iscoroutinefunction(handle_intent):
                response = await handle_intent(intent_data)
            else:
                response = handle_intent(intent_data)

            append_chat("user", user_text)
            append_chat("assistant", response if isinstance(response, str) else str(response))

            if isinstance(response, list):
                for chunk in response:
                    await update.message.reply_text(chunk)
            else:
                await update.message.reply_text(response)

        else:
            # 🔹 Chat fallback mode with memory and personality
            memory = load_long_term_memory()
            memory_facts = ", ".join(f"{k}: {v}" for k, v in memory.items())

            chat_history = get_chat_history()[-10:]
            chat_history.append({"role": "user", "content": user_text})

            system_prompt = (
                f"You are Ziggy, a smart home assistant created by {memory.get('user_name', 'the user')}.\n"
                f"You remember things like: {memory_facts}.\n"
                f"You speak clearly and respond helpfully. If you're unsure of the user's intent, ask follow-up questions.\n"
                "Reply as a friendly assistant, but don't make up actions Ziggy can't do."
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

            await update.message.reply_text(reply)

            if is_verbose():
                log_info(f"[Telegram] GPT Chat Reply: {reply}")

    except Exception as e:
        log_error(f"[Telegram] Error: {e}")
        await update.message.reply_text("⚠️ Oops, something went wrong.")

def start_telegram_bot():
    global telegram_bot_instance, telegram_loop

    if not TELEGRAM_TOKEN:
        print("[Telegram] TELEGRAM_TOKEN missing from settings.yaml")
        return

    print("[Telegram] Initializing bot...")

    async def run_bot():
        global telegram_bot_instance, telegram_loop
        app = Application.builder().token(TELEGRAM_TOKEN).build()
        telegram_bot_instance = app.bot
        telegram_loop = asyncio.get_running_loop()

        app.add_handler(CommandHandler("start", start))
        app.add_handler(CommandHandler("debug", toggle_debug))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

        print("[Telegram] Starting polling...")
        await app.initialize()
        await app.start()
        await app.updater.start_polling()

        start_reminder_thread(send_reminder_message)
        await asyncio.Event().wait()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_bot())
