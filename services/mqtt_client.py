import paho.mqtt.client as mqtt
import os
import yaml
from core.logger_module import log_info
from core.debug_bus import bus as _dbus, BASIC, VERBOSE

# Load MQTT settings from YAML config. Defensive .get() throughout —
# secrets (password) live in config/secrets.yaml and may legitimately be
# absent when the operator hasn't configured the MQTT integration yet.
# Backend's settings panel matches this pattern (admin_router.py uses
# mqtt.get("password", "")); previously this module was the odd one out
# and crashed at import time with a KeyError, blocking the whole boot.
with open("config/settings.yaml", "r", encoding="utf-8") as f:
    settings = yaml.safe_load(f) or {}

_mqtt_cfg   = settings.get("mqtt") or {}
MQTT_BROKER = _mqtt_cfg.get("host", "")
MQTT_PORT   = _mqtt_cfg.get("port", 1883)
MQTT_USER   = _mqtt_cfg.get("username", "")
MQTT_PASS   = _mqtt_cfg.get("password", "")

client = mqtt.Client()

# Attach callbacks
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        log_info("[MQTT] Connected successfully")
        client.subscribe("ziggy/in")
        log_info("[MQTT] Subscribed to ziggy/in")
        _dbus.emit("ws", BASIC, "mqtt_connected",
                   broker=MQTT_BROKER, port=MQTT_PORT, result="ok")
    else:
        log_info(f"[MQTT] Failed to connect, return code {rc}")
        _dbus.emit("ws", BASIC, "mqtt_connect_failed",
                   broker=MQTT_BROKER, return_code=rc, result="error",
                   suggestion=f"Check MQTT broker at {MQTT_BROKER}:{MQTT_PORT} and credentials.")

def on_message(client, userdata, msg):
    message = msg.payload.decode()
    log_info(f"[MQTT] Received on {msg.topic}: {message}")
    _dbus.emit("ws", VERBOSE, "mqtt_message_received",
               topic=msg.topic, payload=message[:200])

def on_disconnect(client, userdata, rc):
    log_info("[MQTT] Disconnected, trying to reconnect...")
    _dbus.emit("ws", BASIC, "mqtt_disconnected",
               return_code=rc, result="disconnected" if rc == 0 else "error")

# Setup and run
def start_mqtt():
    # Skip cleanly if the operator hasn't configured a broker yet — the
    # thread wrapper in ziggy_main.py just sees us exit and moves on.
    # Without this guard, an unconfigured kit would have crashed (or
    # hung in a tight reconnect loop) at boot.
    if not MQTT_BROKER:
        log_info("[MQTT] No broker configured — MQTT thread idle.")
        _dbus.emit("ws", BASIC, "mqtt_skipped",
                   result="not_configured",
                   suggestion="Set mqtt.host in config/settings.yaml "
                              "and mqtt.password in config/secrets.yaml.")
        return

    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.on_connect = on_connect
    client.on_message = on_message
    client.on_disconnect = on_disconnect

    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
        log_info("[MQTT] loop_forever started")
        client.loop_forever()
    except Exception as e:
        log_info(f"[MQTT] Connection error: {e}")

# Global publish function
def publish(topic, message):
    result = client.publish(topic, message)
    log_info(f"[MQTT] Publish to {topic}: {message} (Result: {result.rc})")
    if result.rc != mqtt.MQTT_ERR_SUCCESS:
        log_info(f"[MQTT] Publish failed with code {result.rc}")
    else:
        log_info(f"[MQTT] Message published to {topic}")