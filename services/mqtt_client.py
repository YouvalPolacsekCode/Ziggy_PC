import paho.mqtt.client as mqtt
import os
import yaml
from core.logger_module import log_info

# Load MQTT settings from YAML config
with open("config/settings.yaml", "r", encoding="utf-8") as f:
    settings = yaml.safe_load(f)

MQTT_BROKER = settings["mqtt"]["host"]
MQTT_PORT = settings["mqtt"].get("port", 1883)
MQTT_USER = settings["mqtt"]["username"]
MQTT_PASS = settings["mqtt"]["password"]

client = mqtt.Client()

# Attach callbacks
def on_connect(client, userdata, flags, rc):
    if rc == 0:
        log_info("[MQTT] Connected successfully")
        client.subscribe("ziggy/in")
        log_info("[MQTT] Subscribed to ziggy/in")
    else:
        log_info(f"[MQTT] Failed to connect, return code {rc}")

def on_message(client, userdata, msg):
    message = msg.payload.decode()
    log_info(f"[MQTT] Received on {msg.topic}: {message}")
    # Optional debug file logging
    with open("logs/mqtt_debug.log", "a", encoding="utf-8") as f:
        f.write(f"{msg.topic}: {message}\n")

def on_disconnect(client, userdata, rc):
    log_info("[MQTT] Disconnected, trying to reconnect...")

# Setup and run
def start_mqtt():
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