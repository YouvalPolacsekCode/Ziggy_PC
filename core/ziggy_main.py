#!/usr/bin/env python3
import os
import sys
import threading
from dotenv import load_dotenv
import yaml
import openai

# Add Ziggy root directory to Python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Load .env variables if needed
load_dotenv()

# Load settings.yaml
with open("config/settings.yaml", "r", encoding="utf-8") as f:
    settings = yaml.safe_load(f)

# Set OpenAI API key and audio player path from settings
openai.api_key = settings["openai"]["api_key"]
os.environ["FFPLAY_PATH"] = settings["audio"]["ffplay_path"]

# Ziggy imports
from interfaces.voice_interface import start_voice_interface
from interfaces.telegram_interface import start_telegram_bot
from interfaces.dashboard import start_dashboard
from services.mqtt_client import start_mqtt
from core.logger_module import log_info

def main():
    log_info("Ziggy startup initiated...")

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
        threads.append(threading.Thread(target=thread_wrapper("Voice", start_voice_interface), daemon=True))

    if settings["features"].get("telegram", False) and settings["telegram"].get("enabled", False):
        threads.append(threading.Thread(target=thread_wrapper("Telegram", start_telegram_bot), daemon=True))

    if settings["debug"].get("enable_dashboard", False):
        threads.append(threading.Thread(target=thread_wrapper("Dashboard", start_dashboard), daemon=True))

    if settings["features"].get("zigbee_support", False):
        threads.append(threading.Thread(target=thread_wrapper("MQTT", start_mqtt), daemon=True))

    for t in threads:
        t.start()

    # Main thread stays alive, print status every 10 seconds
    try:
        while True:
            log_info("[Main] Ziggy running. Threads: " + str([t.name for t in threads]))
            import time
            time.sleep(10)
    except KeyboardInterrupt:
        log_info("[Main] KeyboardInterrupt received. Exiting Ziggy.")

if __name__ == "__main__":
    main()
