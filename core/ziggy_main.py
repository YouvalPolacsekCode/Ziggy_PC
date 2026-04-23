#!/usr/bin/env python3
import os
import sys
import threading
import time
import signal
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from core.settings_loader import settings
from core.shared_flags import shutdown_event
from core.logger_module import log_info
from interfaces.voice_interface import start_voice_interface
from interfaces.telegram_interface import start_telegram_bot, send_reminder_message
from interfaces.dashboard import start_dashboard
from services.mqtt_client import start_mqtt
from services.task_manager import start_reminder_thread
from backend.server import start_api_server

os.environ["FFPLAY_PATH"] = settings.get("audio", {}).get("ffplay_path", "ffplay")


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

    if settings.get("features", {}).get("voice", True):
        threads.append(threading.Thread(
            target=thread_wrapper("Voice", start_voice_interface),
            name="Voice",
            daemon=True,
        ))

    threads.append(threading.Thread(
        target=thread_wrapper("Telegram", start_telegram_bot),
        name="Telegram",
        daemon=True,
    ))

    if settings.get("debug", {}).get("enable_dashboard", False):
        threads.append(threading.Thread(
            target=thread_wrapper("Dashboard", start_dashboard),
            name="Dashboard",
            daemon=True,
        ))

    if settings.get("features", {}).get("zigbee_support", False):
        threads.append(threading.Thread(
            target=thread_wrapper("MQTT", start_mqtt),
            name="MQTT",
            daemon=True,
        ))

    threads.append(threading.Thread(
        target=thread_wrapper("Reminder", lambda: start_reminder_thread(send_reminder_message)),
        name="Reminder",
        daemon=True,
    ))

    if settings.get("sensor_alerts", {}).get("enabled", True):
        from services.sensor_alerts import start_sensor_alerts
        threads.append(threading.Thread(
            target=thread_wrapper("SensorAlerts", lambda: start_sensor_alerts(send_reminder_message)),
            name="SensorAlerts",
            daemon=True,
        ))

    if settings.get("web_interface", {}).get("enabled", True):
        threads.append(threading.Thread(
            target=thread_wrapper("API", start_api_server),
            name="API",
            daemon=True,
        ))

    for t in threads:
        t.start()

    try:
        count = 0
        while not shutdown_event.is_set():
            count += 1
            if count % 6 == 0:
                active_names = [t.name for t in threading.enumerate()]
                log_info(f"[Main] Ziggy still running. Active threads: {active_names}")
            time.sleep(10)
    except KeyboardInterrupt:
        log_info("[Main] 🔌 KeyboardInterrupt received. Exiting Ziggy.")

    log_info("[Main] 📴 Ziggy has been shut down.")


if __name__ == "__main__":
    print("💡 Ziggy launched via ziggy_main.py")
    main()
