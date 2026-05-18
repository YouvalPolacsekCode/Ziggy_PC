from __future__ import annotations
from core.intent_utils import ok, wrap
from services.system_tools import (
    get_time, get_date, get_day_of_week,
    restart_ziggy, shutdown_ziggy, get_system_status,
    get_ip_address, get_disk_usage, get_wifi_status,
    get_network_adapters, ping_test,
)


async def handle_get_time(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_time())


async def handle_get_date(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_date())


async def handle_get_day_of_week(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_day_of_week())


async def handle_get_system_status(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_system_status())


async def handle_get_ip_address(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_ip_address())


async def handle_get_disk_usage(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_disk_usage())


async def handle_get_wifi_status(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_wifi_status())


async def handle_get_network_adapters(params: dict, *, source: str = "unknown") -> dict:
    return wrap(get_network_adapters())


async def handle_ping_test(params: dict, *, source: str = "unknown") -> dict:
    return wrap(ping_test(params.get("domain", "google.com")))


async def handle_restart_ziggy(params: dict, *, source: str = "unknown") -> dict:
    return wrap(restart_ziggy())


async def handle_shutdown_ziggy(params: dict, *, source: str = "unknown") -> dict:
    return wrap(shutdown_ziggy())


async def handle_ziggy_status(params: dict, *, source: str = "unknown") -> dict:
    sys_status = get_system_status()
    return ok("I'm Ziggy, your home assistant. Feeling sharp and ready!\n\nHere's how I'm doing:\n" + str(sys_status))


async def handle_ziggy_identity(params: dict, *, source: str = "unknown") -> dict:
    return ok("I'm Ziggy, built by Youval to make your home smarter and life easier.")


async def handle_ziggy_help(params: dict, *, source: str = "unknown") -> dict:
    return ok(
        "I can help with lights, AC, TV, tasks, notes, sensors, web search, news, stocks, recipes, "
        "emails, events, memory, and system info. Try: 'Turn on the living room lights', "
        "'What's the temperature in Roni's room?', 'Add task feed the cat', 'Search the web for...'"
    )


async def handle_ziggy_chat(params: dict, *, source: str = "unknown") -> dict:
    return ok("Did you know octopuses have three hearts and blue blood?")


async def handle_debug_mode(params: dict, *, source: str = "unknown") -> dict:
    from core.debug_bus import bus, _LEVEL_NAMES, _LEVEL_VALUES
    from core.settings_loader import settings, save_settings

    action = params.get("action", "status")
    level  = params.get("level")
    scope  = params.get("scope", "")
    limit  = int(params.get("limit") or 10)

    if action == "enable":
        new_level = level or "verbose"
        bus.set_level(new_level)
        settings.setdefault("debug", {})["level"] = new_level
        save_settings(settings)
        return ok(f"Debug mode enabled at level **{new_level}**. Open /ops/debug to see live events.")

    if action == "disable":
        bus.set_level("off")
        settings.setdefault("debug", {})["level"] = "off"
        save_settings(settings)
        return ok("Debug mode disabled.")

    if action == "set_level":
        if not level or level not in _LEVEL_VALUES:
            return ok("Valid levels: off, basic, verbose, trace. Example: 'set debug to verbose'.")
        bus.set_level(level)
        settings.setdefault("debug", {})["level"] = level
        save_settings(settings)
        return ok(f"Debug level set to **{level}**.")

    if action == "status":
        cfg = bus.get_config()
        lvl = cfg["level"]
        scopes = cfg["scopes"] or ["all"]
        buffered = cfg["buffered"]
        return ok(
            f"Debug is **{lvl}**. Scopes: {', '.join(scopes)}. "
            f"{buffered} events buffered. Open **/ops/debug** to explore."
        )

    if action == "show_failures":
        events = bus.get_events(limit=limit, scope=scope or None, result="error")
        if not events:
            events = bus.get_events(limit=limit, scope=scope or None, result="exception")
        if not events:
            return ok("No failed actions in the debug buffer. Make sure debug is enabled (try 'enable debug').")
        lines = []
        for ev in reversed(events[-limit:]):
            d = ev.get("data", {})
            ts = ev["ts"][11:19]
            msg = d.get("message") or d.get("error") or ev["step"]
            suggestion = d.get("suggestion", "")
            lines.append(f"• [{ts}] **{ev['scope']}** › {ev['step']}: {msg}")
            if suggestion:
                lines.append(f"  → {suggestion}")
        return ok("**Recent failures:**\n" + "\n".join(lines))

    if action == "show_recent":
        events = bus.get_events(limit=limit, scope=scope or None)
        if not events:
            return ok("No events in debug buffer. Enable debug first: 'enable debug mode'.")
        lines = []
        for ev in events[-limit:]:
            d = ev.get("data", {})
            ts = ev["ts"][11:19]
            result = d.get("result", "")
            flag = "✓" if result == "ok" else ("✗" if result in ("error", "exception") else "·")
            lines.append(f"{flag} [{ts}] [{ev['scope']}] {ev['step']}")
        return ok(f"**Last {len(lines)} debug events:**\n" + "\n".join(lines))

    if action == "explain_last":
        # Find the most recent intent_result event
        all_events = bus.get_events(limit=200)
        result_events = [
            e for e in reversed(all_events)
            if e["scope"] == "intent" and e["step"] in ("intent_result", "intent_exception", "intent_unrecognized")
        ]
        if not result_events:
            return ok("No recent intent results in debug buffer. Enable debug and send a command first.")

        ev = result_events[0]
        d = ev.get("data", {})
        req_id = ev.get("request_id")
        intent = d.get("intent", "unknown")
        result = d.get("result", "unknown")
        msg = d.get("message", "")
        duration = d.get("duration_ms")

        # Gather all events for the same request
        chain = [e for e in all_events if e.get("request_id") == req_id] if req_id else [ev]
        steps = [e["step"] for e in chain]

        explanation = [f"**Last action:** {intent}"]
        explanation.append(f"**Result:** {result}" + (f" ({duration}ms)" if duration else ""))
        if msg:
            explanation.append(f"**Message:** {msg}")
        if d.get("suggestion"):
            explanation.append(f"**Suggestion:** {d['suggestion']}")
        explanation.append(f"**Pipeline:** {' → '.join(steps)}")
        if req_id:
            explanation.append(f"**Request ID:** `{req_id}` (filter in /debug for full trace)")

        return ok("\n".join(explanation))

    return ok(f"Unknown debug action: {action}")


async def handle_list_rooms(params: dict, *, source: str = "unknown") -> dict:
    from core.settings_loader import settings
    rooms = []
    # 1. Rooms with actual devices in the device_map — most relevant
    device_map = settings.get("device_map", {})
    if device_map:
        rooms = sorted(r.replace("_", " ").title() for r in device_map.keys())
    # 2. Fall back to personal room_aliases display names if device_map is empty
    if not rooms:
        personal = settings.get("room_aliases", {})
        # Keys are the display names (Living Room, Bedroom, etc.)
        rooms = sorted(set(personal.keys()))
    if not rooms:
        return ok("No rooms configured yet. Add rooms in Settings.")
    return ok(f"Your rooms: {', '.join(rooms)}.")


HANDLERS = {
    "get_time": handle_get_time,
    "get_date": handle_get_date,
    "get_day_of_week": handle_get_day_of_week,
    "get_system_status": handle_get_system_status,
    "get_ip_address": handle_get_ip_address,
    "get_disk_usage": handle_get_disk_usage,
    "get_wifi_status": handle_get_wifi_status,
    "get_network_adapters": handle_get_network_adapters,
    "ping_test": handle_ping_test,
    "restart_ziggy": handle_restart_ziggy,
    "shutdown_ziggy": handle_shutdown_ziggy,
    "ziggy_status": handle_ziggy_status,
    "ziggy_identity": handle_ziggy_identity,
    "ziggy_help": handle_ziggy_help,
    "ziggy_chat": handle_ziggy_chat,
    "debug_mode": handle_debug_mode,
    "list_rooms": handle_list_rooms,
}
