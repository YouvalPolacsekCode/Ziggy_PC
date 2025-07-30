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

def toggle_light(entity_id: str, turn_on: bool = True):
    """
    Turn a Home Assistant light on or off.
    """
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
    """
    Get the current state of a Home Assistant light.
    """
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
    """
    Set RGB color or color temperature for a Home Assistant light.
    """
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
    """
    Set brightness for a Home Assistant light (0–100%).
    """
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
    """
    Set temperature for a Home Assistant climate (AC) entity.
    """
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
    """
    Change the input source of a media_player (TV).
    Requires source list to be pre-configured in Home Assistant.
    """
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
    """
    Fetch the value of a sensor (e.g., temperature, humidity, door, motion) for a given room.
    First attempts direct entity_id lookup, then falls back to searching by friendly name.
    """
    DOMAIN_MAP = {
        "temperature": "sensor",
        "humidity": "sensor",
        "pressure": "sensor",
        "motion": "binary_sensor",
        "door": "binary_sensor",
        "window": "binary_sensor",
    }

    room_aliases = settings.get("room_aliases", {})
    sensor_type = sensor_type.lower()
    domain = DOMAIN_MAP.get(sensor_type, "sensor")

    room_key = room.lower().replace("_", " ").strip()
    normalized_room = room_aliases.get(room_key, room.replace(" ", "_").lower())
    entity_id = f"{domain}.{normalized_room}_{sensor_type}"

    try:
        response = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=HEADERS)
        if response.status_code == 200:
            data = response.json()
            value = data.get("state")
            unit = data.get("attributes", {}).get("unit_of_measurement", "")
            log_info(f"[HA] {sensor_type.capitalize()} in {room}: {value} {unit} [direct]")
            return f"The {sensor_type} in {room} is {value} {unit}.".strip()
        else:
            log_error(f"[HA] Direct fetch failed: {response.status_code} {response.text}")
    except Exception as e:
        log_error(f"[HA] Exception in direct fetch: {e}")

    try:
        all_states = requests.get(f"{HA_URL}/api/states", headers=HEADERS)
        if all_states.status_code == 200:
            sensors = all_states.json()
            room_match = room.replace("_", " ").lower()
            for sensor in sensors:
                if not sensor["entity_id"].startswith(domain):
                    continue
                attrs = sensor.get("attributes", {})
                friendly = attrs.get("friendly_name", "").lower()
                if room_match in friendly and sensor_type in sensor["entity_id"]:
                    value = sensor.get("state")
                    unit = attrs.get("unit_of_measurement", "")
                    log_info(f"[HA Fallback] Matched {sensor['entity_id']} for {sensor_type} in {room_match}: {value} {unit}")
                    return f"The {sensor_type} in {room_match} is {value} {unit}.".strip()
            log_error(f"[HA Fallback] No match found for {room_match} + {sensor_type}")
        else:
            log_error(f"[HA] Failed to fetch all states: {all_states.status_code} {all_states.text}")
    except Exception as e:
        log_error(f"[HA] Exception in fallback lookup: {e}")

    return f"Couldn't get {sensor_type} data for {room}."

def get_binary_sensor_state(room: str, device_type: str):
    """
    Get state of a binary sensor (e.g., motion, door, window) for a given room.
    """
    room_aliases = settings.get("room_aliases", {})
    room_key = room.lower().replace("_", " ").strip()
    normalized_room = room_aliases.get(room_key, room.replace(" ", "_").lower())

    entity_id = f"binary_sensor.{normalized_room}_{device_type}"

    try:
        response = requests.get(f"{HA_URL}/api/states/{entity_id}", headers=HEADERS)
        if response.status_code == 200:
            data = response.json()
            state = data.get("state")
            log_info(f"[HA] Binary {device_type} in {room}: {state}")
            return f"The {device_type} sensor in {room} is {state}."
        else:
            log_error(f"[HA] Binary fetch failed: {response.status_code} {response.text}")
    except Exception as e:
        log_error(f"[HA] Exception in binary fetch: {e}")

    return f"Couldn't get {device_type} sensor state in {room}."
