"""
Home Assistant service helpers and device utilities.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple, Union

import requests
from requests.adapters import HTTPAdapter

from core.settings_loader import settings
from core.logger_module import log_info, log_error
from core.debug_bus import bus, BASIC, VERBOSE, TRACE

DEFAULT_TIMEOUT: int = 10

# Shared session: keeps a TCP/TLS connection pool open to HA so successive
# calls (e.g. resolve-entity → set-state → read-state) reuse the same socket.
# Without this, every _session.post() opens a fresh connection — adding
# ~30–60 ms per HA call on local network from the handshake alone.
_session = requests.Session()
_session.mount("http://",  HTTPAdapter(pool_connections=10, pool_maxsize=20))
_session.mount("https://", HTTPAdapter(pool_connections=10, pool_maxsize=20))


def _ha_url() -> str:
    return settings["home_assistant"]["url"].rstrip("/")


def _headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {settings['home_assistant']['token']}",
        "Content-Type": "application/json",
    }


def _room_aliases() -> Dict[str, str]:
    return settings.get("room_aliases", {})


def _resolve_room(room_key: str) -> str:
    from services.room_alias_bank import resolve_room
    return resolve_room(room_key, settings.get("room_aliases", {}))


def _device_map() -> Dict[str, Dict[str, str]]:
    return settings.get("device_map", {})


def _ha_endpoint(path: str) -> str:
    return f"{_ha_url()}{path}"


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------

def call_service(domain: str, service: str, data: Dict[str, Any]) -> Dict[str, Any]:
    import time as _time
    endpoint = _ha_endpoint(f"/api/services/{domain}/{service}")
    bus.emit("ha", VERBOSE, "ha_service_call",
             domain=domain, service=service, payload=data, endpoint=endpoint)
    t0 = _time.perf_counter()
    try:
        resp = _session.post(endpoint, headers=_headers(), json=data, timeout=DEFAULT_TIMEOUT)
        duration_ms = round((_time.perf_counter() - t0) * 1000, 1)
        if resp.status_code == 200:
            try:
                payload = resp.json()
            except Exception:
                payload = None
            log_info(f"[HA] {domain}.{service} OK | data={data}")
            bus.emit("ha", BASIC, "ha_service_ok",
                     domain=domain, service=service, duration_ms=duration_ms,
                     result="ok")
            return {"ok": True, "message": "service call ok", "data": payload}
        log_error(f"[HA] {domain}.{service} failed: {resp.status_code} - {resp.text}")
        bus.emit("ha", BASIC, "ha_service_error",
                 domain=domain, service=service, duration_ms=duration_ms,
                 status_code=resp.status_code, body=resp.text[:200],
                 result="error",
                 suggestion=f"Check HA logs for {domain}.{service} errors.")
        return {"ok": False, "message": f"HA {domain}.{service} error {resp.status_code}: {resp.text}"}
    except requests.exceptions.ReadTimeout:
        # HA blocks the REST until the device handler returns. Hitting our
        # timeout almost always means the physical device didn't ack — it's
        # offline, on a flaky link, or its integration is misbehaving. HA
        # itself is fine (state reads still work).
        duration_ms = round((_time.perf_counter() - t0) * 1000, 1)
        entity = (data or {}).get("entity_id", "")
        log_error(f"[HA] Device timeout on {domain}.{service} (entity={entity}) after {duration_ms}ms")
        bus.emit("ha", BASIC, "ha_service_timeout",
                 domain=domain, service=service, duration_ms=duration_ms,
                 entity_id=entity, result="timeout",
                 suggestion="Device did not respond. Check power, WiFi/Zigbee link, or the integration.")
        label = entity.split(".", 1)[1].replace("_", " ") if entity else f"{domain}.{service}"
        return {"ok": False, "message": f"{label} did not respond — check it's powered and online"}
    except requests.exceptions.ConnectionError as e:
        duration_ms = round((_time.perf_counter() - t0) * 1000, 1)
        log_error(f"[HA] Connection error to HA on {domain}.{service}: {e}")
        bus.emit("ha", BASIC, "ha_service_connection_error",
                 domain=domain, service=service, duration_ms=duration_ms,
                 error=str(e), result="connection_error",
                 suggestion="Home Assistant is unreachable. Check the HA URL and that HA is running.")
        return {"ok": False, "message": "Home Assistant is unreachable"}
    except Exception as e:
        duration_ms = round((_time.perf_counter() - t0) * 1000, 1)
        log_error(f"[HA] Exception in call_service({domain}.{service}): {e}")
        bus.emit("ha", BASIC, "ha_service_exception",
                 domain=domain, service=service, duration_ms=duration_ms,
                 error=str(e), error_type=type(e).__name__,
                 result="exception",
                 suggestion="Check HA connectivity and token validity.")
        return {"ok": False, "message": f"HA service exception: {e}"}


_missing_entities: set[str] = set()  # suppress repeated 404 log noise


def _state_from_cache(entity_id: str) -> Optional[Dict[str, Any]]:
    """Return a cached state if the HA WS subscriber has one.

    The subscriber maintains a live state cache that is fresher than any
    REST poll — it's updated on every state_changed event. Reading from it
    avoids a 100–200 ms HA REST round-trip when we just need the current
    value. Returns None if the cache hasn't been seeded yet (e.g. HA boot,
    subscriber not yet connected).
    """
    try:
        from services.ha_subscriber import state_cache
        entry = state_cache.get(entity_id)
        if entry is None:
            return None
        return {"state": entry.get("state"), "attributes": entry.get("attributes", {})}
    except Exception:
        return None


def get_state(entity_id: str) -> Dict[str, Any]:
    import time as _time
    # Try the live HA WS state cache first — it's continuously updated by
    # ha_subscriber on every state_changed event, so it's at least as fresh
    # as a REST poll and 100–200 ms cheaper.
    cached = _state_from_cache(entity_id)
    if cached is not None:
        bus.emit("ha", TRACE, "ha_state_cache_hit", entity_id=entity_id)
        return {"ok": True, "message": "ok (cache)", "data": cached}

    endpoint = _ha_endpoint(f"/api/states/{entity_id}")
    bus.emit("ha", TRACE, "ha_state_query", entity_id=entity_id)
    t0 = _time.perf_counter()
    try:
        resp = _session.get(endpoint, headers=_headers(), timeout=DEFAULT_TIMEOUT)
        duration_ms = round((_time.perf_counter() - t0) * 1000, 1)
        if resp.status_code == 200:
            js = resp.json()
            data = {"state": js.get("state"), "attributes": js.get("attributes", {})}
            _missing_entities.discard(entity_id)
            log_info(f"[HA] State {entity_id}: {data['state']}")
            bus.emit("ha", VERBOSE, "ha_state_ok",
                     entity_id=entity_id, state=data["state"], duration_ms=duration_ms,
                     result="ok")
            return {"ok": True, "message": "ok", "data": data}
        if resp.status_code == 404:
            if entity_id not in _missing_entities:
                log_info(f"[HA] Entity not found: {entity_id}")
                _missing_entities.add(entity_id)
            bus.emit("ha", BASIC, "ha_entity_not_found",
                     entity_id=entity_id, duration_ms=duration_ms,
                     result="not_found",
                     suggestion=f"Entity '{entity_id}' not found in HA. Check entity ID in device settings.")
        else:
            log_error(f"[HA] Failed to fetch state of {entity_id}: {resp.status_code} - {resp.text}")
            bus.emit("ha", BASIC, "ha_state_error",
                     entity_id=entity_id, status_code=resp.status_code,
                     duration_ms=duration_ms, result="error")
        return {"ok": False, "message": f"HA state error {resp.status_code}: {resp.text}"}
    except Exception as e:
        log_error(f"[HA] Exception in get_state({entity_id}): {e}")
        return {"ok": False, "message": f"HA state exception: {e}"}


def get_all_states() -> List[Dict[str, Any]]:
    """Fetch all HA entity states."""
    try:
        resp = _session.get(_ha_endpoint("/api/states"), headers=_headers(), timeout=DEFAULT_TIMEOUT)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        log_error(f"[HA] get_all_states: {e}")
    return []


# ---------------------------------------------------------------------------
# Entity resolution
# ---------------------------------------------------------------------------

def resolve_entity(room: str, sensor_type: str) -> Optional[str]:
    """
    Resolve room + device_type to an HA entity_id.

    Resolution order:
      1. DeviceRegistry in-memory table (built from HomeConfig + YAML seed + IR devices)
      2. HA areas fallback: find an entity in the matching HA area by domain
      3. None — callers should surface a clear "not configured" message
    """
    room_key = (room or "").lower().replace("_", " ").strip()
    normalized_room = _resolve_room(room_key)
    normalized_type = (sensor_type or "").lower()

    # --- Path 1: DeviceRegistry ---
    try:
        from services.device_registry import get_entity, _initialized
        if _initialized:
            entity_id = get_entity(normalized_room, normalized_type)
            if entity_id:
                return entity_id
    except Exception as e:
        log_error(f"[HA] DeviceRegistry lookup failed: {e}")

    # --- Path 2: HA areas fallback (sync wrapper around async get_areas) ---
    try:
        import asyncio
        from services.ha_areas import get_areas
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Can't await in sync context — skip gracefully
            pass
        else:
            areas = loop.run_until_complete(get_areas())
            for area in areas:
                area_name_norm = area["name"].lower().replace(" ", "_")
                if area_name_norm == normalized_room:
                    for eid in area["entities"]:
                        if eid.startswith(f"{normalized_type}.") or eid.split(".")[0] == normalized_type:
                            log_info(f"[HA] Resolved via HA area fallback: {eid}")
                            return eid
    except Exception as e:
        log_error(f"[HA] HA areas fallback failed: {e}")

    log_info(f"[HA] Entity not found: {normalized_room} + {normalized_type}")
    return None


def get_all_light_entities_in_room(room: str) -> List[str]:
    """Return all light entity_ids mapped to a room (any key containing 'light')."""
    room_key = (room or "").lower().replace("_", " ").strip()
    normalized_room = _resolve_room(room_key)
    room_devices = _device_map().get(normalized_room, {})
    return [v for k, v in room_devices.items() if "light" in k.lower() and v]


# ---------------------------------------------------------------------------
# Bulk room control
# ---------------------------------------------------------------------------

def toggle_all_lights_in_room(room: str, turn_on: bool) -> Dict[str, Any]:
    """Turn on or off all lights mapped under a room in device_map.

    HA accepts a list of entity_ids in a single service call; one round-trip
    here used to be N round-trips, ~150 ms each.
    """
    entities = get_all_light_entities_in_room(room)
    if not entities:
        return {
            "ok": False,
            "message": f"No lights configured for {room.replace('_', ' ')}. "
                       f"Add light entries under device_map.{room} in settings.yaml.",
        }
    service = "turn_on" if turn_on else "turn_off"
    result = call_service("light", service, {"entity_id": entities})

    verb = "Turned on" if turn_on else "Turned off"
    if not result.get("ok"):
        return {"ok": False, "message": f"Failed to {service.replace('_', ' ')} lights in {room.replace('_', ' ')}: {result.get('message')}"}
    return {"ok": True, "message": f"{verb} all lights in {room.replace('_', ' ')} ({len(entities)} lights)."}


def turn_off_all_lights() -> Dict[str, Any]:
    """Turn off every light entity reported by HA (lights only — no media players)."""
    try:
        all_states = get_all_states()
    except Exception:
        all_states = []
    light_ids = [
        s["entity_id"] for s in all_states
        if s.get("entity_id", "").startswith("light.")
        and s.get("state") not in ("off", "unavailable", "unknown")
    ]
    if not light_ids:
        return {"ok": True, "message": "All lights are already off."}
    # One HA call with the full entity list instead of N sequential calls.
    result = call_service("light", "turn_off", {"entity_id": light_ids})
    if not result.get("ok"):
        return {"ok": False, "message": f"Failed to turn off lights: {result.get('message')}"}
    return {"ok": True, "message": f"All lights turned off ({len(light_ids)} light{'s' if len(light_ids) != 1 else ''})."}


def turn_off_everything() -> Dict[str, Any]:
    """Turn off every light and media_player configured in device_map.

    Groups by domain so we issue at most one call per domain — lights and
    media players in parallel HA-side, instead of N sequential round-trips.
    """
    light_ids: List[str] = []
    media_ids: List[str] = []
    for room_devices in _device_map().values():
        for dtype, entity_id in room_devices.items():
            if not entity_id:
                continue
            dtype_l = dtype.lower()
            if "light" in dtype_l:
                light_ids.append(entity_id)
            elif dtype_l in ("tv", "media_player"):
                media_ids.append(entity_id)

    turned_off = 0
    errors: List[str] = []
    if light_ids:
        r = call_service("light", "turn_off", {"entity_id": light_ids})
        if r.get("ok"):
            turned_off += len(light_ids)
        else:
            errors.append(f"lights: {r.get('message')}")
    if media_ids:
        r = call_service("media_player", "turn_off", {"entity_id": media_ids})
        if r.get("ok"):
            turned_off += len(media_ids)
        else:
            errors.append(f"media: {r.get('message')}")

    if errors:
        return {"ok": turned_off > 0, "message": f"Turned off {turned_off} devices. Some errors: {errors}"}
    return {"ok": True, "message": f"Everything off. Turned off {turned_off} device(s)."}


# ---------------------------------------------------------------------------
# Light helpers
# ---------------------------------------------------------------------------

def toggle_light(entity_id: str, turn_on: bool = True) -> Tuple[int, str]:
    action = "turn_on" if turn_on else "turn_off"
    endpoint = _ha_endpoint(f"/api/services/light/{action}")
    try:
        response = _session.post(endpoint, headers=_headers(), json={"entity_id": entity_id}, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] {action.upper()} sent to {entity_id}")
        else:
            log_error(f"[HA] Failed to {action} {entity_id}: {response.status_code} - {response.text}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in toggle_light: {e}")
        return 500, str(e)


def get_light_state(entity_id: str) -> Optional[dict]:
    try:
        response = _session.get(_ha_endpoint(f"/api/states/{entity_id}"), headers=_headers(), timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            state_data = response.json()
            log_info(f"[HA] State of {entity_id}: {state_data['state']}")
            return state_data
        log_error(f"[HA] Failed to fetch state of {entity_id}: {response.status_code}")
        return None
    except Exception as e:
        log_error(f"[HA] Exception in get_light_state: {e}")
        return None


def set_light_color(entity_id: str, rgb_color: Optional[tuple] = None, color_temp: Optional[int] = None) -> Tuple[int, str]:
    payload: Dict[str, Any] = {"entity_id": entity_id}
    if rgb_color:
        payload["rgb_color"] = list(rgb_color)
    if color_temp is not None:
        payload["color_temp"] = color_temp
    try:
        response = _session.post(_ha_endpoint("/api/services/light/turn_on"), headers=_headers(), json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] Color change sent to {entity_id}: {payload}")
        else:
            log_error(f"[HA] Failed color change {entity_id}: {response.status_code}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_light_color: {e}")
        return 500, str(e)


def set_light_brightness(entity_id: str, brightness: int) -> Tuple[int, str]:
    payload = {"entity_id": entity_id, "brightness_pct": max(0, min(int(brightness), 100))}
    try:
        response = _session.post(_ha_endpoint("/api/services/light/turn_on"), headers=_headers(), json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] Brightness {brightness}% for {entity_id}")
        else:
            log_error(f"[HA] Failed brightness {entity_id}: {response.status_code}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_light_brightness: {e}")
        return 500, str(e)


# ---------------------------------------------------------------------------
# Climate / Media helpers
# ---------------------------------------------------------------------------

def set_ac_temperature(entity_id: str, temperature: int) -> Tuple[int, str]:
    payload = {"entity_id": entity_id, "temperature": int(temperature)}
    try:
        response = _session.post(_ha_endpoint("/api/services/climate/set_temperature"), headers=_headers(), json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] AC temp {temperature}°C for {entity_id}")
        else:
            log_error(f"[HA] Failed AC temp {entity_id}: {response.status_code}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_ac_temperature: {e}")
        return 500, str(e)


def set_tv_source(entity_id: str, source: Union[int, str]) -> Tuple[int, str]:
    payload = {"entity_id": entity_id, "source": str(source)}
    try:
        response = _session.post(_ha_endpoint("/api/services/media_player/select_source"), headers=_headers(), json=payload, timeout=DEFAULT_TIMEOUT)
        if response.status_code == 200:
            log_info(f"[HA] TV source {source} for {entity_id}")
        else:
            log_error(f"[HA] Failed TV source {entity_id}: {response.status_code}")
        return response.status_code, response.text
    except Exception as e:
        log_error(f"[HA] Exception in set_tv_source: {e}")
        return 500, str(e)


# ---------------------------------------------------------------------------
# Sensor helpers
# ---------------------------------------------------------------------------

def get_sensor_state(room: str, sensor_type: str) -> Dict[str, Any]:
    sensor_type_l = (sensor_type or "").lower()
    entity_id = resolve_entity(room, sensor_type_l)
    if not entity_id:
        return {"ok": False, "message": f"Missing {sensor_type_l} sensor mapping for {room}.", "data": {}}

    # Cache-first: ha_subscriber's live cache updates on every state change,
    # so it's at least as fresh as a REST poll, with ~100–200 ms shaved off.
    cached = _state_from_cache(entity_id)
    if cached is not None:
        value = cached.get("state")
        attrs = cached.get("attributes") or {}
        unit = attrs.get("unit_of_measurement", "")
        room_label = room.replace("_", " ").title()
        if value in ("unavailable", "unknown", None):
            friendly = f"The {sensor_type_l} in {room_label} is currently unavailable."
        else:
            unit_str = f" {unit}" if unit else ""
            friendly = f"The {sensor_type_l} in {room_label} is {value}{unit_str}."
        return {"ok": True, "message": friendly,
                "data": {"room": room, "entity_id": entity_id, "value": value,
                         "unit": unit, "attributes": attrs}}

    try:
        resp = _session.get(_ha_endpoint(f"/api/states/{entity_id}"), headers=_headers(), timeout=DEFAULT_TIMEOUT)
        if resp.status_code != 200:
            log_error(f"[HA] Fetch failed: {resp.status_code}")
            return {"ok": False, "message": f"Couldn't get {sensor_type_l} data for {room}.", "data": {"status": resp.status_code}}
        data = resp.json()
        value = data.get("state")
        attrs = data.get("attributes", {}) or {}
        unit = attrs.get("unit_of_measurement", "")
        room_label = room.replace("_", " ").title()
        if value in ("unavailable", "unknown", None):
            friendly = f"The {sensor_type_l} in {room_label} is currently unavailable."
        else:
            # Use non-breaking space before unit so "25.36 °C" never wraps
            # across lines on narrow mobile screens.
            unit_str = f" {unit}" if unit else ""
            friendly = f"The {sensor_type_l} in {room_label} is {value}{unit_str}."
        return {"ok": True, "message": friendly, "data": {"room": room, "entity_id": entity_id, "value": value, "unit": unit, "attributes": attrs}}
    except Exception as e:
        log_error(f"[HA] Exception in get_sensor_state({room}, {sensor_type_l}): {e}")
        return {"ok": False, "message": f"Couldn't get {sensor_type_l} data for {room}.", "data": {"details": str(e)}}


def get_binary_sensor_state(room: str, device_type: str) -> Dict[str, Any]:
    return get_sensor_state(room, device_type)


def get_all_temperatures() -> Dict[str, Any]:
    """Read temperature from all HA sensor entities, supplemented by device_map entries."""
    results = {}

    # Primary: scan all HA temperature sensor states directly
    try:
        all_states = get_all_states()
        for s in all_states:
            eid = s.get("entity_id", "")
            attrs = s.get("attributes", {}) or {}
            if not eid.startswith("sensor."):
                continue
            if attrs.get("device_class") != "temperature":
                continue
            state = s.get("state", "unknown")
            if state in ("unavailable", "unknown"):
                continue
            unit = attrs.get("unit_of_measurement", "°C")
            name = (attrs.get("friendly_name") or eid.split(".", 1)[1]).replace("_", " ").title()
            results[name] = f"{state} {unit}"
    except Exception:
        pass

    # Fallback: device_map rooms that weren't found above
    for room, devices in _device_map().items():
        if "temperature" not in devices:
            continue
        label = room.replace("_", " ").title()
        if label not in results:
            r = get_sensor_state(room, "temperature")
            if r.get("ok"):
                results[label] = r.get("message", "unavailable")

    if not results:
        return {"ok": False, "message": "No temperature sensors found.", "data": {}}
    lines = [f"{name}: {v}" for name, v in sorted(results.items())]
    return {"ok": True, "message": "\n".join(lines), "data": results}


# ---------------------------------------------------------------------------
# Global sensor helpers
# ---------------------------------------------------------------------------

def get_global_sensor(key: str) -> Dict[str, Any]:
    entity_id = settings.get("global_sensors", {}).get(key)
    if not entity_id:
        return {"ok": False, "message": f"No entity configured for global sensor '{key}'.", "data": {}}
    result = get_state(entity_id)
    if not result.get("ok"):
        return result
    state_val = result["data"].get("state", "unknown")
    attrs = result["data"].get("attributes", {})
    unit = attrs.get("unit_of_measurement", "")
    return {"ok": True, "message": f"{state_val} {unit}".strip(), "data": {"entity_id": entity_id, "state": state_val, "unit": unit, "attributes": attrs}}


# ---------------------------------------------------------------------------
# HA Todo / Shopping list helpers
# ---------------------------------------------------------------------------

def add_todo_item(item: str, list_key: str = "shopping_list") -> Dict[str, Any]:
    entity_id = settings.get("todo", {}).get(list_key)
    if not entity_id:
        return {"ok": False, "message": f"No todo list configured for '{list_key}'.", "data": {}}
    result = call_service("todo", "add_item", {"entity_id": entity_id, "item": item})
    if result.get("ok"):
        return {"ok": True, "message": f"Added '{item}' to the shopping list.", "data": {}}
    return result


def get_todo_items(list_key: str = "shopping_list") -> Dict[str, Any]:
    entity_id = settings.get("todo", {}).get(list_key)
    if not entity_id:
        return {"ok": False, "message": f"No todo list configured for '{list_key}'.", "data": {}}
    try:
        resp = _session.get(_ha_endpoint(f"/api/states/{entity_id}"), headers=_headers(), timeout=DEFAULT_TIMEOUT)
        if resp.status_code != 200:
            return {"ok": False, "message": f"Couldn't fetch shopping list ({resp.status_code}).", "data": {}}
        js = resp.json()
        count = js.get("state", "0")
        attrs = js.get("attributes", {})
        items = attrs.get("items") or []
        if items:
            names = [i.get("summary", str(i)) for i in items if isinstance(i, dict)]
            msg = "Shopping list: " + ", ".join(names) if names else f"Shopping list has {count} items."
        else:
            msg = f"The shopping list has {count} item(s). Open Home Assistant to see the full list."
        return {"ok": True, "message": msg, "data": {"items": items, "count": count}}
    except Exception as e:
        log_error(f"[HA] Exception in get_todo_items: {e}")
        return {"ok": False, "message": "Couldn't fetch the shopping list.", "data": {"details": str(e)}}
