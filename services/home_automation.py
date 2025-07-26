import requests
from core.settings_loader import settings
from core.logger_module import log_info, log_error

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


def get_sensor_state(room: str, sensor_type: str):
    """
    Fetch the value of a temperature or humidity sensor for a given room.
    Expected entity format: sensor.{room}_{sensor_type}
    """
    entity_id = f"sensor.{room}_{sensor_type}"
    try:
        response = requests.get(
            f"{HA_URL}/api/states/{entity_id}",
            headers=HEADERS
        )
        if response.status_code == 200:
            data = response.json()
            value = data.get("state")
            unit = data.get("attributes", {}).get("unit_of_measurement", "")
            log_info(f"[HA] {sensor_type.capitalize()} in {room}: {value} {unit}")
            return f"The {sensor_type} in {room} is {value} {unit}."
        else:
            log_error(f"[HA] Failed to fetch sensor state: {response.status_code} {response.text}")
            return f"Couldn't get {sensor_type} data for {room}."
    except Exception as e:
        log_error(f"[HA] Exception fetching sensor state: {e}")
        return f"Error while reading {sensor_type} sensor in {room}."
