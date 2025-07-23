import paho.mqtt.client as mqtt
import os

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))

client = mqtt.Client()

def on_connect(client, userdata, flags, rc):
    print("[MQTT] Connected with result code", rc)
    client.subscribe("ziggy/in")

def on_message(client, userdata, msg):
    print(f"[MQTT] Received on {msg.topic}: {msg.payload.decode()}")

def start_mqtt():
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()

def publish(topic, message):
    client.publish(topic, message)