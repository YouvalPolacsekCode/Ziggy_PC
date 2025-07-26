from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters
import asyncio
import openai
from core.settings_loader import settings, save_settings

TELEGRAM_TOKEN = settings["telegram"]["token"]
VERBOSE = settings.get("debug", {}).get("verbose", False)
openai.api_key = settings["openai"]["api_key"]

def is_verbose():
    return settings.get("debug", {}).get("verbose", False)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Ziggy is running on PC!")

async def toggle_debug(update: Update, context: ContextTypes.DEFAULT_TYPE):
    current = settings["debug"].get("verbose", False)
    settings["debug"]["verbose"] = not current
    save_settings(settings)
    status = "ON 🟢" if settings["debug"]["verbose"] else "OFF ⚫"
    await update.message.reply_text(f"Verbose debug mode is now: {status}")

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_text = update.message.text
    if is_verbose():
        print(f"[Telegram] Received: {user_text}")

    try:
        completion = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are Ziggy, a smart home AI assistant created by Youval. "
                        "You run on a personal computer and respond to both voice and Telegram commands. "
                        "You can control devices, answer questions, manage tasks, and engage in natural conversation. "
                        "Keep responses clear, concise, and helpful. Use a friendly and confident tone. "
                        "You don’t remember anything between sessions unless explicitly told to."
                    )
                },
                {"role": "user", "content": user_text}
            ],
            temperature=0.7,
            max_tokens=100
        )

        reply = completion.choices[0].message["content"].strip()
        await update.message.reply_text(reply)

        if is_verbose():
            print(f"[Telegram] Replied with: {reply}")

    except Exception as e:
        print(f"[Telegram] Error generating reply: {e}")
        await update.message.reply_text("⚠️ Sorry, I had trouble thinking of a reply.")

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
