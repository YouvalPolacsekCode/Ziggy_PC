from __future__ import annotations
from core.intent_utils import ok, err
from core.logger_module import log_info
from services.home_automation import resolve_entity
from services.ha_automations import save_automation, list_automations, delete_automation, toggle_automation


# Maps Ziggy-friendly aliases and raw HA domains → HA domain used for entity resolution.
# Built once at import time from the domain registry + legacy aliases.
def _build_device_type_map() -> dict[str, str]:
    mapping: dict[str, str] = {
        # Ziggy legacy aliases — kept for backward compatibility
        "ac":           "climate",
        "tv":           "media_player",
        "thermostat":   "climate",
        "blinds":       "cover",
        "curtains":     "cover",
        "garage":       "cover",
        "shutter":      "cover",
        "shutoff":      "valve",
        "water":        "valve",
        "alarm":        "alarm_control_panel",
        "robot":        "vacuum",
        "mower":        "lawn_mower",
    }
    # Auto-add every controllable domain from the registry (domain maps to itself)
    try:
        from services.domain_registry import controllable_domains
        for d in controllable_domains():
            mapping.setdefault(d, d)
    except Exception:
        pass
    return mapping


_DEVICE_TYPE_MAP: dict[str, str] = _build_device_type_map()


def _resolve_action_entity(params: dict) -> tuple[str | None, str]:
    room = (params.get("action_room") or "").replace(" ", "_").lower()
    raw_type = (params.get("action_device_type") or "light").lower().strip()

    # Resolve alias → HA domain
    ha_domain = _DEVICE_TYPE_MAP.get(raw_type, raw_type)
    entity_id = params.get("action_entity_id") or resolve_entity(room, ha_domain)

    # "tv" fallback: try media_player if not found under the "tv" alias
    if not entity_id and raw_type == "tv":
        entity_id = resolve_entity(room, "media_player")

    return entity_id, room


def _service_for_domain(domain: str, requested_service: str) -> str:
    """
    Return the full HA service call string for an automation action.

    Universal services (turn_on, turn_off, toggle) route through homeassistant.*
    so they work across all domains.  Domain-specific services (open_valve,
    close_valve, lock, unlock, start, dock, …) use domain.service directly.
    """
    _UNIVERSAL = {"turn_on", "turn_off", "toggle"}
    if requested_service in _UNIVERSAL:
        return f"homeassistant.{requested_service}"
    return f"{domain}.{requested_service}"


def _resolve_trigger_entity(raw: str) -> str:
    """If raw looks like a room name rather than an HA entity ID, resolve it to
    a temperature sensor entity.  Returns raw unchanged when it already looks
    like an entity ID (contains a dot) or when resolution fails."""
    if not raw or "." in raw:
        return raw
    room_key = raw.replace(" ", "_").lower()
    resolved = resolve_entity(room_key, "temperature") or resolve_entity(room_key, "sensor")
    return resolved or raw


async def handle_create_automation(params: dict, *, source: str = "unknown") -> dict:
    # Guard: both room and device type must be present before we attempt entity resolution.
    # Without them the handler would silently hallucinate a device (e.g. defaulting to
    # "light in bathroom" for "create a morning routine").
    if not params.get("action_room") and not params.get("action_entity_id"):
        return ok(
            "Which room and device should this automation control, and when should it trigger? "
            "Example: 'turn on the living room light every day at 7 am'."
        )

    entity_id, room = _resolve_action_entity(params)
    if not entity_id:
        device_type = params.get("action_device_type", "light")
        return err(f"No {device_type} found for {room.replace('_', ' ')}. "
                   f"Check that a {device_type} is configured in the device registry for this room.")

    trigger_type = params.get("trigger_type", "time")
    trigger: dict = {"type": trigger_type}
    if trigger_type == "time":
        trigger["time"] = params.get("trigger_time", "08:00")
    elif trigger_type == "state":
        raw = params.get("trigger_entity_id") or ""
        # State triggers need an exact HA entity ID (domain.object_id contains a dot).
        # Room names like "office" are not valid — ask the user to be specific.
        if not raw or "." not in raw:
            return err(
                f"Please specify the exact entity to watch for state changes "
                f"(e.g. binary_sensor.office_door, sensor.office_motion). "
                f"'{raw}' doesn't look like a valid entity ID."
            )
        trigger["entity_id"] = raw
        trigger["state"] = params.get("trigger_state", "on")
    elif trigger_type == "numeric_state":
        raw_sensor = params.get("trigger_entity_id") or ""
        resolved = _resolve_trigger_entity(raw_sensor)
        # A valid HA entity ID always contains a dot (domain.object_id).
        # If resolution returned the raw value without a dot it means the
        # sensor couldn't be found in the device registry.
        if not resolved or "." not in resolved:
            hint = f" (tried to resolve '{raw_sensor}' but found no sensor entity)" if raw_sensor else ""
            return err(
                f"I couldn't find the sensor to watch{hint}. "
                f"Please check that a temperature sensor is configured for this room, "
                f"or provide the exact entity ID (e.g. sensor.office_temperature)."
            )
        trigger["entity_id"] = resolved
        if params.get("trigger_above") is not None:
            trigger["above"] = params["trigger_above"]
        if params.get("trigger_below") is not None:
            trigger["below"] = params["trigger_below"]
    elif trigger_type in ("sunrise", "sunset"):
        if params.get("trigger_offset"):
            trigger["offset"] = params["trigger_offset"]

    service_action = params.get("action_service", "turn_on")
    # Determine the HA domain of the resolved entity so we can call domain-specific services
    entity_domain = entity_id.split(".")[0] if entity_id and "." in entity_id else "homeassistant"
    full_service = _service_for_domain(entity_domain, service_action)

    # Build a human-readable default name when GPT didn't supply one.
    # "turn_on office light at 14:00" → "Office light on at 14:00"
    if not params.get("name"):
        verb = "on" if service_action == "turn_on" else "off" if service_action == "turn_off" else service_action
        device = (params.get("action_device_type") or "device").replace("_", " ")
        room_display = room.replace("_", " ").title()
        if trigger_type == "time":
            default_name = f"{room_display} {device} {verb} at {params.get('trigger_time', '?')}"
        elif trigger_type in ("sunrise", "sunset"):
            default_name = f"{room_display} {device} {verb} at {trigger_type}"
        else:
            default_name = f"{room_display} {device} {verb}"
    else:
        default_name = params["name"]

    automation_data = {
        "name": default_name,
        "description": params.get("description", "Created by Ziggy"),
        "trigger": trigger,
        "actions": [{"type": "call_service", "entity_id": entity_id, "service": full_service}],
    }

    result = save_automation(automation_data)
    if result.get("ok"):
        name = automation_data["name"]
        log_info(f"[Automation] Created '{name}' id={result.get('id')} source={result.get('source')}")
        return ok(f"Done! '{name}' has been set up.")
    return err(f"Failed to create automation: {result.get('error', 'unknown error')}")


async def handle_list_automations(params: dict, *, source: str = "unknown") -> dict:
    autos = list_automations()
    if not autos:
        return ok("No automations found.")
    lines = [f"- {a['name']} ({'on' if a['enabled'] else 'off'})" for a in autos]
    word = "automation" if len(autos) == 1 else "automations"
    return ok(f"You have {len(autos)} {word}:\n" + "\n".join(lines), data={"automations": autos})


async def handle_delete_automation(params: dict, *, source: str = "unknown") -> dict:
    auto_id = params.get("automation_id") or params.get("id", "")
    if not auto_id:
        autos = list_automations()
        if not autos:
            return ok("You have no automations to delete.")
        names = ", ".join(f"'{a['name']}'" for a in autos[:5])
        more = f" (and {len(autos) - 5} more)" if len(autos) > 5 else ""
        return ok(f"Which automation should I delete? Your automations: {names}{more}.")
    ok_ = delete_automation(auto_id)
    return ok(f"Automation '{auto_id}' deleted.") if ok_ else err(f"Could not delete automation '{auto_id}'.")


async def handle_toggle_automation(params: dict, *, source: str = "unknown") -> dict:
    auto_id = params.get("automation_id") or params.get("id", "")
    enable = params.get("enable", True)
    if not auto_id:
        autos = list_automations()
        if not autos:
            return ok("You have no automations to enable or disable.")
        names = ", ".join(f"'{a['name']}'" for a in autos[:5])
        action = "enable" if enable else "disable"
        return ok(f"Which automation should I {action}? Your automations: {names}.")
    ok_ = toggle_automation(auto_id, enable)
    state = "enabled" if enable else "disabled"
    return ok(f"Automation '{auto_id}' {state}.") if ok_ else err(f"Could not toggle automation '{auto_id}'.")


async def _resolve_room_id(room_name: str) -> str:
    """Resolve a human room name to the ID the frontend uses.

    HA areas → HA area_id (e.g. 'a1b2c3d4')
    Ziggy-native rooms → normalized slug (e.g. 'office')

    This must match what Rooms.jsx stores as r.id and uses in its filter:
      all.filter(a => (a.rooms || []).includes(roomId))
    """
    slug = room_name.lower().replace(" ", "_")
    try:
        from services.ha_areas import get_areas
        areas = await get_areas()
        for area in (areas or []):
            area_slug = (area.get("name") or "").lower().replace(" ", "_")
            if area_slug == slug:
                return area.get("id", slug)
    except Exception:
        pass
    return slug  # Ziggy-native room — slug IS the ID


def _find_automation(name_query: str) -> tuple[dict | None, str]:
    """Return (automation_dict, error_message). error_message is empty on success."""
    query = name_query.lower().strip()
    if not query:
        return None, "Please specify which automation to update."
    autos = list_automations()
    matches = [a for a in autos if query in (a.get("name") or "").lower()]
    if not matches:
        return None, f"No automation found matching '{name_query}'. Use 'list automations' to see exact names."
    if len(matches) > 1:
        names = ", ".join(f"'{a['name']}'" for a in matches[:4])
        return None, f"Multiple automations match '{name_query}': {names}. Please be more specific."
    return matches[0], ""


async def handle_update_automation(params: dict, *, source: str = "unknown") -> dict:
    auto, error = _find_automation(params.get("automation_name") or "")
    if error:
        return err(error)

    auto_id = auto["id"]

    # Load the full current config so we can merge instead of overwrite
    from services.ha_automations import get_automation_for_ui
    current = get_automation_for_ui(auto_id) or auto

    # ── Name / description ────────────────────────────────────────────────────
    name = params.get("new_name") or current.get("name", "")
    description = params.get("description") if "description" in params else current.get("description", "")

    # ── Trigger merge ─────────────────────────────────────────────────────────
    trigger = dict(current.get("trigger") or {})
    new_type = params.get("trigger_type")
    if new_type:
        # Full trigger replacement
        trigger = {"type": new_type}
        if new_type == "time":
            trigger["time"] = params.get("trigger_time") or current.get("trigger", {}).get("time", "08:00")
        elif new_type == "state":
            trigger["entity_id"] = _resolve_trigger_entity(params.get("trigger_entity_id") or "")
            trigger["state"] = params.get("trigger_state") or "on"
        elif new_type == "numeric_state":
            raw = params.get("trigger_entity_id") or ""
            resolved = _resolve_trigger_entity(raw)
            if not resolved or "." not in resolved:
                return err(f"Couldn't find a sensor for '{raw}'. Provide the exact entity ID.")
            trigger["entity_id"] = resolved
            if params.get("trigger_above") is not None:
                trigger["above"] = params["trigger_above"]
            if params.get("trigger_below") is not None:
                trigger["below"] = params["trigger_below"]
        elif new_type in ("sunrise", "sunset"):
            if params.get("trigger_offset"):
                trigger["offset"] = params["trigger_offset"]
    else:
        # Partial trigger field updates — keep existing type, patch only what changed
        if params.get("trigger_time"):
            trigger["time"] = params["trigger_time"]
        if params.get("trigger_entity_id"):
            trigger["entity_id"] = _resolve_trigger_entity(params["trigger_entity_id"])
        if params.get("trigger_state"):
            trigger["state"] = params["trigger_state"]
        if params.get("trigger_above") is not None:
            trigger["above"] = params["trigger_above"]
        if params.get("trigger_below") is not None:
            trigger["below"] = params["trigger_below"]
        if params.get("trigger_offset"):
            trigger["offset"] = params["trigger_offset"]

    # ── Action merge ──────────────────────────────────────────────────────────
    actions = list(current.get("actions") or [])
    action_room = params.get("action_room")
    action_dtype = params.get("action_device_type")
    action_svc = params.get("action_service")
    if action_room or action_dtype or action_svc:
        existing_action = actions[0] if actions else {}
        existing_entity = existing_action.get("entity_id", "")

        # If only room changed (no explicit device type), inherit the device type
        # from the current action's entity domain so we don't accidentally switch
        # from AC to light just because action_device_type was omitted.
        if not action_dtype and existing_entity and "." in existing_entity:
            # Inherit the device type from the current action's entity domain.
            # Use the reverse of _DEVICE_TYPE_MAP: prefer the Ziggy-friendly alias
            # so GPT keeps speaking the same language, but fall back to the raw domain.
            domain = existing_entity.split(".")[0]
            _reverse_alias = {v: k for k, v in _DEVICE_TYPE_MAP.items() if k != v}
            action_dtype = _reverse_alias.get(domain, domain)

        if action_room or action_dtype:
            entity_id, _ = _resolve_action_entity({
                "action_room": action_room or "",
                "action_device_type": action_dtype or "",
            })
        else:
            entity_id = existing_entity

        if not entity_id:
            return err(f"Couldn't find a {action_dtype or 'device'} in {action_room or 'that room'}.")
        service = action_svc or (existing_entity and existing_action.get("service", "homeassistant.turn_on").split(".")[-1]) or "turn_on"
        update_domain = entity_id.split(".")[0] if entity_id and "." in entity_id else "homeassistant"
        actions = [{"type": "call_service", "entity_id": entity_id, "service": _service_for_domain(update_domain, service)}]

    # ── Room assignment merge ─────────────────────────────────────────────────
    from services.local_automation_actions import get_automation_meta, save_automation_meta
    meta = get_automation_meta(auto_id)
    rooms = list(meta.get("rooms") or current.get("rooms") or [])
    if "room" in params:
        room_val = params["room"]
        if room_val == "" or room_val is None:
            # Explicit empty → unassign from all rooms
            rooms = []
        else:
            room_id = await _resolve_room_id(room_val)
            if room_id not in rooms:
                rooms.append(room_id)

    updated = {
        "name": name,
        "description": description,
        "trigger": trigger,
        "actions": actions,
        "rooms": rooms,
    }

    result = save_automation(updated, auto_id=auto_id)
    if result.get("ok"):
        log_info(f"[Automation] Updated '{name}' id={auto_id}")
        return ok(f"Done! '{name}' has been updated.")
    return err(f"Failed to update automation: {result.get('error', 'unknown error')}")


async def handle_assign_automation_to_room(params: dict, *, source: str = "unknown") -> dict:
    name_query = (params.get("automation_name") or "").lower().strip()
    room = (params.get("room") or "").strip()
    if not name_query:
        return err("Please specify which automation to assign.")
    if not room:
        return err("Please specify which room to assign it to.")

    # Find the best-matching automation by name substring
    autos = list_automations()
    matches = [a for a in autos if name_query in (a.get("name") or "").lower()]
    if not matches:
        return err(f"No automation found matching '{name_query}'. Try listing automations to see exact names.")
    if len(matches) > 1:
        names = ", ".join(f"'{a['name']}'" for a in matches[:4])
        return err(f"Multiple automations match '{name_query}': {names}. Please be more specific.")

    auto = matches[0]
    auto_id = auto["id"]

    from services.local_automation_actions import save_automation_meta, get_automation_meta
    meta = get_automation_meta(auto_id)
    existing_rooms = list(meta.get("rooms") or [])
    room_id = await _resolve_room_id(room)
    if room_id not in existing_rooms:
        existing_rooms.append(room_id)
    meta["rooms"] = existing_rooms
    save_automation_meta(auto_id, meta)

    log_info(f"[Automation] Assigned '{auto['name']}' ({auto_id}) to room '{room_id}'")
    return ok(f"Done! '{auto['name']}' is now assigned to {room}.")


HANDLERS = {
    "create_automation": handle_create_automation,
    "list_automations": handle_list_automations,
    "delete_automation": handle_delete_automation,
    "toggle_automation": handle_toggle_automation,
    "update_automation": handle_update_automation,
    "assign_automation_to_room": handle_assign_automation_to_room,
}
