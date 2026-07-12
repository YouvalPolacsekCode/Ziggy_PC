from __future__ import annotations
from core.intent_utils import ok, err, wrap, normalize_room
from core.result_utils import L
from services.home_automation import get_sensor_state, get_global_sensor, get_all_temperatures, get_all_states
from services.presence_store import load_persons as _load_presence, home_person_names as _presence_home_names

_ACTIVE_DOMAINS = {"light", "switch", "media_player", "fan", "climate", "cover", "lock", "vacuum"}


async def handle_get_temperature(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_sensor_state(normalize_room(params), "temperature"))


async def handle_get_humidity(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_sensor_state(normalize_room(params), "humidity"))


async def handle_report_all_temperatures(params: dict, *, source: str = "unknown") -> dict:
    return get_all_temperatures()


async def handle_get_internet_speed(params: dict, *, source: str = "unknown") -> dict:
    dl = get_global_sensor("internet_download")
    ul = get_global_sensor("internet_upload")
    if dl.get("ok") and ul.get("ok"):
        return ok(L(f"Download: {dl['message']}, Upload: {ul['message']}",
                    f"הורדה: {dl['message']}, העלאה: {ul['message']}"))
    return err(L("Couldn't read internet speed from Home Assistant.",
                 "לא הצלחתי לקרוא את מהירות האינטרנט."))


async def handle_get_internet_status(params: dict, *, source: str = "unknown") -> dict:
    status = get_global_sensor("internet_status")
    if status.get("ok"):
        state = status["data"].get("state", "unknown")
        connected = state in ("on", "true", "connected")
        msg = L("Internet is connected.", "האינטרנט מחובר.") if connected \
            else L("Internet appears to be down.", "נראה שהאינטרנט מנותק.")
        ip = get_global_sensor("internet_ip")
        if ip.get("ok"):
            msg += L(f" External IP: {ip['message']}.",
                     f" כתובת IP חיצונית: {ip['message']}.")
        return ok(msg)
    return err(L("Couldn't check internet status.", "לא הצלחתי לבדוק את מצב האינטרנט."))


async def handle_get_sun_times(params: dict, *, source: str = "unknown") -> dict:
    rising = get_global_sensor("sun_rising")
    setting = get_global_sensor("sun_setting")
    parts = []
    if rising.get("ok"):
        parts.append(L(f"Sunrise: {rising['data'].get('state', '?')}",
                       f"זריחה: {rising['data'].get('state', '?')}"))
    if setting.get("ok"):
        parts.append(L(f"Sunset: {setting['data'].get('state', '?')}",
                       f"שקיעה: {setting['data'].get('state', '?')}"))
    if parts:
        return ok(", ".join(parts))
    return err(L("Couldn't get sun times.", "לא הצלחתי לקבל את זמני הזריחה והשקיעה."))


def _check_person_by_name(name: str) -> dict | None:
    """Find a person by name in Ziggy presence registry, then HA person.* entities."""
    name_lower = name.lower().replace(" ", "").replace("'", "")

    # Check Ziggy-native registry first
    for p in _load_presence():
        if name_lower in p["name"].lower().replace(" ", "").replace("'", ""):
            home = p.get("state") == "home"
            return ok(L(f"{p['name']} is {'home' if home else 'away'}.",
                        f"{p['name']} {'בבית' if home else 'לא בבית'}."))

    # Fall back to HA person.* entities
    for entity in get_all_states():
        entity_id: str = entity.get("entity_id", "")
        if not entity_id.startswith("person."):
            continue
        friendly = entity.get("attributes", {}).get("friendly_name", "").lower().replace(" ", "")
        slug = entity_id.split(".", 1)[1].lower().replace("_", "")
        if name_lower in slug or name_lower in friendly:
            home = entity.get("state", "").lower() == "home"
            return ok(L(f"{name.capitalize()} is {'home' if home else 'away'}.",
                        f"{name.capitalize()} {'בבית' if home else 'לא בבית'}."))

    return None


async def handle_is_someone_home(params: dict, *, source: str = "unknown") -> dict:
    name = params.get("name")
    # Use room only if explicitly provided — don't call normalize_room which logs
    # a spurious error when the user just asks "who's home?" with no room.
    _room_raw = params.get("room") or params.get("area") or params.get("location")
    room = _room_raw.replace(" ", "_").lower() if _room_raw else None

    # Named person — try person.* entity first, then room motion sensor
    if name:
        person_result = _check_person_by_name(name)
        if person_result:
            return person_result
        # Fall back to motion sensor for the room associated with the name
        room_guess = room or name.lower().replace(" ", "_").replace("'", "") + "_room"
        motion = get_sensor_state(room_guess, "motion")
        if motion.get("ok"):
            state = motion["data"].get("state", "unknown")
            occupied = state.lower() == "on"
            return ok(L(f"{name.capitalize()}'s room is {'occupied' if occupied else 'empty'} (motion sensor).",
                        f"החדר של {name.capitalize()} {'תפוס' if occupied else 'ריק'} (חיישן תנועה)."))
        return err(L(f"No person or motion sensor found for '{name}'.",
                     f"לא נמצא אדם או חיישן תנועה עבור '{name}'."))

    # Room check — use motion sensor
    if room:
        motion = get_sensor_state(room, "motion")
        if motion.get("ok"):
            state = motion["data"].get("state", "unknown")
            occupied = state.lower() == "on"
            room_label = room.replace('_', ' ')
            return ok(L(f"{room_label.title()} is {'occupied' if occupied else 'empty'}.",
                        f"{room_label} {'תפוס' if occupied else 'ריק'}."))
        return err(L(f"No motion sensor configured for {room}.",
                     f"אין חיישן תנועה מוגדר ב{room}."))

    # No name/room — check Ziggy presence registry first, HA person.* as fallback
    ziggy_persons = _load_presence()
    if ziggy_persons:
        home_names = _presence_home_names()
        if home_names:
            return ok(L(f"Home: {', '.join(home_names)}.",
                        f"בבית: {', '.join(home_names)}."))
        return ok(L("Nobody is home.", "אף אחד לא בבית."))

    # Fall back to HA person.* entities
    all_states = get_all_states()
    persons = [e for e in all_states if e.get("entity_id", "").startswith("person.")]
    if not persons:
        result = get_global_sensor("person_home")
        if result.get("ok"):
            state = result["data"].get("state", "unknown")
            home = state.lower() == "home"
            return ok(L(f"You are {'home' if home else 'away'}.",
                        f"אתה {'בבית' if home else 'לא בבית'}."))
        return err(L("Couldn't check presence.", "לא הצלחתי לבדוק נוכחות."))
    home_persons = [e.get("attributes", {}).get("friendly_name") or e["entity_id"].split(".")[1]
                    for e in persons if e.get("state", "").lower() == "home"]
    if home_persons:
        return ok(L(f"Home: {', '.join(home_persons)}.",
                    f"בבית: {', '.join(home_persons)}."))
    return ok(L("Nobody is home.", "אף אחד לא בבית."))


async def handle_list_active_devices(params: dict, *, source: str = "unknown") -> dict:
    all_states = get_all_states()
    active = [
        e for e in all_states
        if e.get("entity_id", "").split(".")[0] in _ACTIVE_DOMAINS
        and e.get("state") == "on"
    ]
    if not active:
        return ok(L("No devices are currently active.", "אין מכשירים פעילים כרגע."))
    lines = []
    for e in active:
        name = e.get("attributes", {}).get("friendly_name") or e["entity_id"].split(".")[1].replace("_", " ").title()
        lines.append(f"- {name}")
    word = "device" if len(active) == 1 else "devices"
    header = L(f"{len(active)} active {word}:",
               f"{len(active)} מכשירים פעילים:")
    return ok(header + "\n" + "\n".join(lines), data={"devices": active})


HANDLERS = {
    "get_temperature": handle_get_temperature,
    "get_humidity": handle_get_humidity,
    "report_all_temperatures": handle_report_all_temperatures,
    "get_internet_speed": handle_get_internet_speed,
    "get_internet_status": handle_get_internet_status,
    "get_sun_times": handle_get_sun_times,
    "is_someone_home": handle_is_someone_home,
    "list_active_devices": handle_list_active_devices,
}
