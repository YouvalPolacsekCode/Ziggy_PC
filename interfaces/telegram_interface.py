from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters
import asyncio
import openai
import inspect

from core.settings_loader import settings, save_settings
from core.action_parser import handle_intent
from core.logger_module import log_info, log_error
from core.intent_parser import quick_parse

TELEGRAM_TOKEN = settings["telegram"]["token"]
openai.api_key = settings["openai"]["api_key"]

def is_verbose():
    return settings.get("debug", {}).get("verbose", False)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("👋 Ziggy is active and listening!")

async def toggle_debug(update: Update, context: ContextTypes.DEFAULT_TYPE):
    current = settings["debug"].get("verbose", False)
    settings["debug"]["verbose"] = not current
    save_settings(settings)
    status = "ON 🟢" if settings["debug"]["verbose"] else "OFF ⚫"
    await update.message.reply_text(f"Verbose debug mode is now: {status}")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text.strip().lower()
    chat_id = update.effective_chat.id

    if is_verbose():
        log_info(f"[Telegram] User: {user_text}")

    # Protect against repeated shutdown/restart
    recent_command = context.chat_data.get("last_command", "")
    protected_commands = ["shutdown ziggy", "restart ziggy"]

    if user_text in protected_commands and user_text == recent_command:
        await update.message.reply_text("⚠️ Command ignored to prevent repeat execution.")
        return
    context.chat_data["last_command"] = user_text

    try:
        intent_data = quick_parse(user_text)

        if intent_data and intent_data.get("intent") != "chat_with_gpt":
            if inspect.iscoroutinefunction(handle_intent):
                response = await handle_intent(intent_data)
            else:
                response = handle_intent(intent_data)

            if isinstance(response, list):
                for chunk in response:
                    await update.message.reply_text(chunk)
            else:
                await update.message.reply_text(response)
        else:
            completion = openai.ChatCompletion.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": (
                        "You are Ziggy, an AI assistant running on Youval's PC. "
                        "You can control smart home devices, manage tasks, run system tools, and more. "
                        "Keep replies short, smart, and user-friendly."
                    )},
                    {"role": "user", "content": user_text}
                ],
                temperature=0.6,
                max_tokens=150
            )
            reply = completion.choices[0].message["content"].strip()
            await update.message.reply_text(reply)

            if is_verbose():
                log_info(f"[Telegram] GPT Reply: {reply}")

    except Exception as e:
        log_error(f"[Telegram] Error: {e}")
        await update.message.reply_text("⚠️ Oops, something went wrong.")

def start_telegram_bot():
    if not TELEGRAM_TOKEN:
        print("[Telegram] TELEGRAM_TOKEN missing from settings.yaml")
        return

    print("[Telegram] Initializing bot...")

    async def run_bot():
        app = Application.builder().token(TELEGRAM_TOKEN).build()
        app.add_handler(CommandHandler("start", start))
        app.add_handler(CommandHandler("debug", toggle_debug))
        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

        print("[Telegram] Starting polling...")
        await app.initialize()
        await app.start()
        await app.updater.start_polling()
        await asyncio.Event().wait()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_bot())
