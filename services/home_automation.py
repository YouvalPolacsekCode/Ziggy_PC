import requests
from core.settings_loader import settings
from core.logger_module import log_info, log_error

# Home Assistant setup
HA_URL = settings["home_assistant"]["url"].rstrip("/")
HA_TOKEN = settings["home_assistant"]["token"]
HEADERS = {
    "Authorization": f"Bearer {HA_TOKEN}",
    "Content-Type": "application/json"
}

# Device Mapping
room_aliases = settings.get("room_aliases", {})
device_map = settings.get("device_map", {})

def resolve_entity(room: str, sensor_type: str) -> str | None:
    room_key = room.lower().replace("_", " ").strip()
    normalized_room = room_aliases.get(room_key, room_key)
    normalized_type = sensor_type.lower()

    room_devices = device_map.get(normalized_room, {})
    entity_id = room_devices.get(normalized_type)

    if not entity_id:
        log_error(f"[HA] No entity_id found in device_map for {normalized_room} + {normalized_type}")
    return entity_id

def toggle_light(entity_id: str, turn_on: bool = True):
    action = "turn_on" if turn_on else "turn_off"
    endpoint = f"{HA_URL}/api/services/light/{action}"
    payload = {"entity_id": entity_id}

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload)
        if response.status_code == 200:
            log_info(f"[HA] {action.upper()} sent to {entity_id}")
        else:
            log_error(f"[HA] Failed to {action} {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in toggle_light: {e}")
        return 500, str(e)

def get_light_state(entity_id: str):
    try:
        endpoint = f"{HA_URL}/api/states/{entity_id}"
        response = requests.get(endpoint, headers=HEADERS)
        if response.status_code == 200:
            state_data = response.json()
            log_info(f"[HA] State of {entity_id}: {state_data['state']}")
            return state_data
        else:
            log_error(f"[HA] Failed to fetch state of {entity_id}: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        log_error(f"[HA] Exception in get_light_state: {e}")
        return None

def set_light_color(entity_id: str, rgb_color=None, color_temp=None):
    endpoint = f"{HA_URL}/api/services/light/turn_on"
    payload = {"entity_id": entity_id}
    if rgb_color:
        payload["rgb_color"] = rgb_color
    if color_temp:
        payload["color_temp"] = color_temp

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload)
        if response.status_code == 200:
            log_info(f"[HA] Color change sent to {entity_id}: {payload}")
        else:
            log_error(f"[HA] Failed to change color of {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_light_color: {e}")
        return 500, str(e)

def set_light_brightness(entity_id: str, brightness: int):
    endpoint = f"{HA_URL}/api/services/light/turn_on"
    payload = {
        "entity_id": entity_id,
        "brightness_pct": max(0, min(brightness, 100))
    }

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload)
        if response.status_code == 200:
            log_info(f"[HA] Brightness set to {brightness}% for {entity_id}")
        else:
            log_error(f"[HA] Failed to set brightness for {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_light_brightness: {e}")
        return 500, str(e)

def set_ac_temperature(entity_id: str, temperature: int):
    endpoint = f"{HA_URL}/api/services/climate/set_temperature"
    payload = {
        "entity_id": entity_id,
        "temperature": temperature
    }

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload)
        if response.status_code == 200:
            log_info(f"[HA] AC temperature set to {temperature}°C for {entity_id}")
        else:
            log_error(f"[HA] Failed to set AC temp for {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_ac_temperature: {e}")
        return 500, str(e)

def set_tv_source(entity_id: str, source: int):
    endpoint = f"{HA_URL}/api/services/media_player/select_source"
    payload = {
        "entity_id": entity_id,
        "source": str(source)
    }

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload)
        if response.status_code == 200:
            log_info(f"[HA] TV source set to {source} for {entity_id}")
        else:
            log_error(f"[HA] Failed to set TV source for {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_tv_source: {e}")
        return 500, str(e)

def get_sensor_state(room: str, sensor_type: str):
    sensor_type = sensor_type.lower()
    entity_id = resolve_entity(room, sensor_type)
    if not entity_id:
        return f"Couldn't get {sensor_type} data for {room}."

    try:
        response = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=HEADERS)
        if response.status_code == 200:
            data = response.json()
            value = data.get("state")
            unit = data.get("attributes", {}).get("unit_of_measurement", "")
            log_info(f"[HA] {sensor_type.capitalize()} in {room}: {value} {unit}")
            return f"The {sensor_type} in {room} is {value} {unit}.".strip()
        else:
            log_error(f"[HA] Fetch failed: {response.status_code} {response.text}")
    except Exception as e:
        log_error(f"[HA] Exception in fetch: {e}")

    return f"Couldn't get {sensor_type} data for {room}."

def get_binary_sensor_state(room: str, device_type: str):
    return get_sensor_state(room, device_type)
