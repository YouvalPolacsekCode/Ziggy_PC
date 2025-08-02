import yaml
import os

def load_settings():
    settings_path = os.path.join(os.path.dirname(__file__), '..', 'config/settings.yaml')
    with open(settings_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

def save_settings(settings_data):
    settings_path = os.path.join(os.path.dirname(__file__), '..', 'config/settings.yaml')
    with open(settings_path, 'w', encoding='utf-8') as f:
        yaml.dump(settings_data, f, allow_unicode=True, default_flow_style=False)

settings = load_settings()

# Expose HA_URL and HEADERS for Home Assistant
HA_URL = settings["home_assistant"]["url"]
HA_TOKEN = settings["home_assistant"]["token"]

HEADERS = {
    "Authorization": f"Bearer {HA_TOKEN}",
    "Content-Type": "application/json"
}
