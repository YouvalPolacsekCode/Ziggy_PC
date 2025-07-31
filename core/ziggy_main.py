#!/usr/bin/env python3
import os
import sys
import threading
import time
import signal
from dotenv import load_dotenv
import yaml
import openai

# Ensure current directory is in path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
load_dotenv()

# Load settings
with open("config/settings.yaml", "r", encoding="utf-8") as f:
    settings = yaml.safe_load(f)

openai.api_key = settings["openai"]["api_key"]
os.environ["FFPLAY_PATH"] = settings["audio"]["ffplay_path"]

# Global shutdown event
from core.shared_flags import shutdown_event

# Import Ziggy modules
from interfaces.voice_interface import start_voice_interface
from interfaces.telegram_interface import start_telegram_bot, send_reminder_message
from interfaces.dashboard import start_dashboard
from services.mqtt_client import start_mqtt
from services.task_manager import start_reminder_thread
from core.logger_module import log_info

# Handle SIGTERM (used in restart or external kill)
def handle_sigterm(signum, frame):
    log_info("[Main] 🛑 SIGTERM received. Shutting down Ziggy gracefully.")
    shutdown_event.set()

signal.signal(signal.SIGTERM, handle_sigterm)

def main():
    log_info("🚀 Ziggy startup initiated...")

    def thread_wrapper(name, target):
        def run():
            log_info(f"[Thread:{name}] Starting...")
            try:
                target()
            except Exception as e:
                log_info(f"[Thread:{name}] Exception: {e}")
            log_info(f"[Thread:{name}] Exited.")
        return run

    threads = []

    if settings["features"].get("voice", True):
        threads.append(threading.Thread(
            target=thread_wrapper("Voice", start_voice_interface),
            name="Voice",
            daemon=True
        ))

    if settings["features"].get("telegram", False) and settings["telegram"].get("enabled", False):
        threads.append(threading.Thread(
            target=thread_wrapper("Telegram", start_telegram_bot),
            name="Telegram",
            daemon=True
        ))

    if settings["debug"].get("enable_dashboard", False):
        threads.append(threading.Thread(
            target=thread_wrapper("Dashboard", start_dashboard),
            name="Dashboard",
            daemon=True
        ))

    if settings["features"].get("zigbee_support", False):
        threads.append(threading.Thread(
            target=thread_wrapper("MQTT", start_mqtt),
            name="MQTT",
            daemon=True
        ))  

    # ✅ Start reminder thread as a named thread
    threads.append(threading.Thread(
        target=thread_wrapper("Reminder", lambda: start_reminder_thread(send_reminder_message)),
        name="Reminder",
        daemon=True
    ))


    for t in threads:
        t.start()

    # Keep main thread alive until shutdown
    try:
        count = 0
        while not shutdown_event.is_set():
            count += 1
            if count % 6 == 0:  # every 60 seconds
                active_names = [t.name for t in threading.enumerate()]
                log_info(f"[Main] Ziggy still running. Active threads: {active_names}")
            time.sleep(10)
    except KeyboardInterrupt:
        log_info("[Main] 🔌 KeyboardInterrupt received. Exiting Ziggy.")

    log_info("[Main] 📴 Ziggy has been shut down.")

if __name__ == "__main__":
    print("💡 Ziggy launched via ziggy_main.py")
    main()
