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

    threads = []

    if settings["features"].get("voice", True):
        threads.append(threading.Thread(target=start_voice_interface))

    if settings["features"].get("telegram", False) and settings["telegram"].get("enabled", False):
        threads.append(threading.Thread(target=start_telegram_bot))

    if settings["debug"].get("enable_dashboard", False):
        threads.append(threading.Thread(target=start_dashboard))

    if settings["features"].get("zigbee_support", False):
        threads.append(threading.Thread(target=start_mqtt))

    for t in threads:
        t.start()
    for t in threads:
        t.join()

if __name__ == "__main__":
    main()
