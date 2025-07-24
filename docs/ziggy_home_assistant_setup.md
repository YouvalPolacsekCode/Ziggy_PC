# Ziggy Home Assistant Integration Guide

## 1. Enable Zigbee/MQTT in Ziggy
- In `config/settings.yaml`, ensure:

features:
  zigbee_support: true
  smart_home: true
  mqtt: true

mqtt:
  broker_address: "your_mqtt_broker_address"
  broker_port: 1883
  username: "your_mqtt_username" # Optional
  password: "your_mqtt_password" # Optional

## 2. Add Home Assistant Automations
- Use `docs/home_assistant_automation_template.yaml` as a template.
- For each device/event, duplicate the automation block and set the correct `entity_id`, `to`, and `payload`.

## 3. Reload Automations in Home Assistant
- After editing your automations, reload automations in Home Assistant for changes to take effect.

## 4. Add More Devices
- To add a new device, repeat step 2 for each device.
- Example:

  - alias: "Send Bedroom Light On to Ziggy"
    trigger:
      platform: state
      entity_id: light.bedroom
      to: "on"
    action:
      - service: mqtt.publish
        data:
          topic: "ziggy/in"
          payload: "Bedroom light turned on"

## 5. Test Integration
- Trigger device events in Home Assistant and verify Ziggy receives and logs the event.

---

**You can add as many automations/devices as you want by duplicating the template block.**
