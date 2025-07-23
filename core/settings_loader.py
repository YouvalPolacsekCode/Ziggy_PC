import yaml
import os

def load_settings():
    settings_path = os.path.join(os.path.dirname(__file__), '..', 'config/settings.yaml')
    with open(settings_path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)

settings = load_settings()
