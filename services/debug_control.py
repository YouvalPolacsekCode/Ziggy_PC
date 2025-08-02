from core.settings_loader import settings, save_settings

def is_verbose():
    return settings.get("debug", {}).get("verbose", False)

def toggle_verbose(value: bool):
    settings["debug"]["verbose"] = value
    save_settings(settings)
    return value
