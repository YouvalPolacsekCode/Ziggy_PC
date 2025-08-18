"""
Home Assistant service helpers and device utilities.

This module centralizes HTTP calls to your Home Assistant (HA) instance and
exposes both:
1) Generic helpers (preferred for new code):
   - call_service(domain, service, data) -> dict
   - get_state(entity_id) -> dict
2) Backward-compatible specific helpers you already use in Ziggy:
   - toggle_light(entity_id, turn_on=True) -> (status_code, text)
   - get_light_state(entity_id) -> Optional[dict]
   - set_light_color(entity_id, rgb_color=None, color_temp=None) -> (status_code, text)
   - set_light_brightness(entity_id, brightness) -> (status_code, text)
   - set_ac_temperature(entity_id, temperature) -> (status_code, text)
   - set_tv_source(entity_id, source) -> (status_code, text)
   - get_sensor_state(room, sensor_type) -> dict
   - get_binary_sensor_state(room, device_type) -> dict

New skills should prefer the generic helpers so behavior is consistent and
responses are structured.

Requirements:
- settings["home_assistant"]["url"] and settings["home_assistant"]["token"]
  must be defined by core.settings_loader.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple, Union

import requests

from core.settings_loader import settings
from core.logger_module import log_info, log_error

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------

HA_URL: str = settings["home_assistant"]["url"].rstrip("/")
HA_TOKEN: str = settings["home_assistant"]["token"]

HEADERS: Dict[str, str] = {
    "Authorization": f"Bearer {HA_TOKEN}",
    "Content-Type": "application/json",
}

room_aliases: Dict[str, str] = settings.get("room_aliases", {})
device_map: Dict[str, Dict[str, str]] = settings.get("device_map", {})

DEFAULT_TIMEOUT: int = 10


# -----------------------------------------------------------------------------
# Internal utilities
# -----------------------------------------------------------------------------

def _ha_endpoint(path: str) -> str:
    """Build a full HA endpoint from a relative API path."""
    return f"{HA_URL}{path}"


# -----------------------------------------------------------------------------
# Generic helpers (preferred)
# -----------------------------------------------------------------------------

def call_service(domain: str, service: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Call a Home Assistant service.

    Args:
        domain: e.g., "media_player", "light", "climate".
        service: e.g., "turn_on", "play_media".
        data: JSON payload (should include required keys like "entity_id").

    Returns:
        {"ok": bool, "message": str, "data": Optional[Any]}
    """
    endpoint = _ha_endpoint(f"/api/services/{domain}/{service}")
    try:
        resp = requests.post(endpoint, headers=HEADERS, json=data, timeout=DEFAULT_TIMEOUT)
        if resp.status_code == 200:
            try:
                payload = resp.json()
            except Exception:
                payload = None
            log_info(f"[HA] {domain}.{service} OK | data={data}")
            return {"ok": True, "message": "service call ok", "data": payload}
        log_error(f"[HA] {domain}.{service} failed: {resp.status_code} - {resp.text}")
        return {"ok": False, "message": f"HA {domain}.{service} error {resp.status_code}: {resp.text}"}
    except Exception as e:
        log_error(f"[HA] Exception in call_service({domain}.{service}): {e}")
        return {"ok": False, "message": f"HA service exception: {e}"}


def get_state(entity_id: str) -> Dict[str, Any]:
    """
    Fetch the state and attributes of an entity.

    Returns:
        {"ok": bool, "message": str, "data": {"state": str, "attributes": dict}} or error dict
    """
    endpoint = _ha_endpoint(f"/api/states/{entity_id}")
    try:
        resp = requests.get(endpoint, headers=HEADERS, timeout=DEFAULT_TIMEOUT)
        if resp.status_code == 200:
            js = resp.json()
            data = {"state": js.get("state"), "attributes": js.get("attributes", {})}
            log_info(f"[HA] State {entity_id}: {data['state']}")
            return {"ok": True, "message": "ok", "data": data}
        log_error(f"[HA] Failed to fetch state of {entity_id}: {resp.status_code} - {resp.text}")
        return {"ok": False, "message": f"HA state error {resp.status_code}: {resp.text}"}
    except Exception as e:
        log_error(f"[HA] Exception in get_state({entity_id}): {e}")
        return {"ok": False, "message": f"HA state exception: {e}"}


# -----------------------------------------------------------------------------
# Entity resolution helpers
# -----------------------------------------------------------------------------

def resolve_entity(room: str, sensor_type: str) -> Optional[str]:
    """
    Resolve an entity_id from a room alias and sensor/device type using settings.device_map.
    """
    room_key = (room or "").lower().replace("_", " ").strip()
    normalized_room = room_aliases.get(room_key, room_key)
    normalized_type = (sensor_type or "").lower()

    room_devices = device_map.get(normalized_room, {})
    entity_id = room_devices.get(normalized_type)

    if not entity_id:
        log_error(f"[HA] No entity_id found in device_map for {normalized_room} + {normalized_type}")
    return entity_id


# -----------------------------------------------------------------------------
# Light helpers (backward-compatible signatures)
# -----------------------------------------------------------------------------

def toggle_light(entity_id: str, turn_on: bool = True) -> Tuple[int, str]:
    """
    Turn a light on or off.

    Returns:
        (status_code, text)
    """
    action = "turn_on" if turn_on else "turn_off"
    endpoint = _ha_endpoint(f"/api/services/light/{action}")
    payload = {"entity_id": entity_id}

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] {action.upper()} sent to {entity_id}")
        else:
            log_error(f"[HA] Failed to {action} {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in toggle_light: {e}")
        return 500, str(e)


def get_light_state(entity_id: str) -> Optional[dict]:
    """Get a light's full state object from HA."""
    try:
        endpoint = _ha_endpoint(f"/api/states/{entity_id}")
        response = requests.get(endpoint, headers=HEADERS, timeout=DEFAULT_TIMEOUT)
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


def set_light_color(entity_id: str,
                    rgb_color: Optional[tuple[int, int, int]] = None,
                    color_temp: Optional[int] = None) -> Tuple[int, str]:
    """
    Set a light's color or color temperature.

    Returns:
        (status_code, text)
    """
    endpoint = _ha_endpoint("/api/services/light/turn_on")
    payload: Dict[str, Any] = {"entity_id": entity_id}
    if rgb_color:
        payload["rgb_color"] = list(rgb_color)
    if color_temp is not None:
        payload["color_temp"] = color_temp

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] Color change sent to {entity_id}: {payload}")
        else:
            log_error(f"[HA] Failed to change color of {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_light_color: {e}")
        return 500, str(e)


def set_light_brightness(entity_id: str, brightness: int) -> Tuple[int, str]:
    """
    Set a light's brightness (percentage 0–100).

    Returns:
        (status_code, text)
    """
    endpoint = _ha_endpoint("/api/services/light/turn_on")
    payload = {"entity_id": entity_id, "brightness_pct": max(0, min(int(brightness), 100))}

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] Brightness set to {brightness}% for {entity_id}")
        else:
            log_error(f"[HA] Failed to set brightness for {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_light_brightness: {e}")
        return 500, str(e)


# -----------------------------------------------------------------------------
# Climate / Media helpers (backward-compatible signatures)
# -----------------------------------------------------------------------------

def set_ac_temperature(entity_id: str, temperature: int) -> Tuple[int, str]:
    """
    Set a climate device's target temperature (°C).

    Returns:
        (status_code, text)
    """
    endpoint = _ha_endpoint("/api/services/climate/set_temperature")
    payload = {"entity_id": entity_id, "temperature": int(temperature)}

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] AC temperature set to {temperature}°C for {entity_id}")
        else:
            log_error(f"[HA] Failed to set AC temp for {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_ac_temperature: {e}")
        return 500, str(e)


def set_tv_source(entity_id: str, source: Union[int, str]) -> Tuple[int, str]:
    """
    Select an input/source on a media_player entity.

    Args:
        entity_id: media_player.<name>
        source: HDMI index (int) or the exact source label (str) as the device knows it.

    Returns:
        (status_code, text)
    """
    endpoint = _ha_endpoint("/api/services/media_player/select_source")
    payload = {"entity_id": entity_id, "source": str(source)}

    try:
        response = requests.post(endpoint, headers=HEADERS, json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] TV source set to {source} for {entity_id}")
        else:
            log_error(f"[HA] Failed to set TV source for {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_tv_source: {e}")
        return 500, str(e)


# -----------------------------------------------------------------------------
# Sensor helpers (now return standard dicts)
# -----------------------------------------------------------------------------

def get_sensor_state(room: str, sensor_type: str) -> Dict[str, Any]:
    """
    Get a sensor value in a given room as a standard Ziggy result dict.

    Args:
        room: Room name or alias.
        sensor_type: Logical type in your device_map (e.g., "temperature", "humidity", "motion").

    Returns:
        {"ok": bool, "message": str, "data": {...}}
    """
    sensor_type_l = (sensor_type or "").lower()
    entity_id = resolve_entity(room, sensor_type_l)
    if not entity_id:
        return {"ok": False, "message": f"Missing {sensor_type_l} sensor mapping for {room}.", "data": {}}

    try:
        resp = requests.get(_ha_endpoint(f"/api/states/{entity_id}"), headers=HEADERS, timeout=DEFAULT_TIMEOUT)
        if resp.status_code != 200:
            log_error(f"[HA] Fetch failed: {resp.status_code} {resp.text}")
            return {"ok": False, "message": f"Couldn't get {sensor_type_l} data for {room}.", "data": {"status": resp.status_code}}

        data = resp.json()
        value = data.get("state")
        attrs = data.get("attributes", {}) or {}
        unit = attrs.get("unit_of_measurement", "")
        friendly = f"The {sensor_type_l} in {room} is {value} {unit}.".strip()
        return {"ok": True, "message": friendly, "data": {"room": room, "entity_id": entity_id, "value": value, "unit": unit, "attributes": attrs}}
    except Exception as e:
        log_error(f"[HA] Exception in get_sensor_state({room}, {sensor_type_l}): {e}")
        return {"ok": False, "message": f"Couldn't get {sensor_type_l} data for {room}.", "data": {"details": str(e)}}


def get_binary_sensor_state(room: str, device_type: str) -> Dict[str, Any]:
    """
    Alias for get_sensor_state for binary sensors. Returns a standard result dict.
    """
    return get_sensor_state(room, device_type)
