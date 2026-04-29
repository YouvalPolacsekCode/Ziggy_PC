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
}
