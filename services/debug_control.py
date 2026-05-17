"""
Thin compatibility shim for the old verbose toggle.
New code should use core.debug_bus directly.
"""
from core.settings_loader import settings, save_settings


def is_verbose() -> bool:
    return settings.get("debug", {}).get("verbose", False)


def toggle_verbose(value: bool) -> bool:
    from core.debug_bus import bus
    settings.setdefault("debug", {})["verbose"] = value
    save_settings(settings)
    # Mirror into the debug bus: verbose=True → "verbose" level, False → "off"
    bus.set_level("verbose" if value else "off")
    return value
