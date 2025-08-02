from services.mqtt_client import publish

publish("zigbee2mqtt/livingroom_light/set", '{"state": "ON"}')
publish("zigbee2mqtt/livingroom_light/set", '{"brightness": 128}')
publish("zigbee2mqtt/livingroom_light/set", '{"color": {"r": 255, "g": 100, "b": 50}}')
publish("zigbee2mqtt/bedroom_plug/set", '{"state": "OFF"}')