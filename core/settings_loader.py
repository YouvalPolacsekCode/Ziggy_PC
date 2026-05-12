import os
import sys
import threading
import yaml
from dotenv import load_dotenv

load_dotenv()

_REPO_CONFIG = os.path.join(os.path.dirname(__file__), '..', 'config/settings.yaml')
_HOME_CONFIG  = os.path.expanduser("~/.ziggy/home.yaml")

_REQUIRED_KEYS = [
    ("home_assistant", "url"),
    ("home_assistant", "token"),
    ("openai", "api_key"),
]


def _validate(data: dict) -> None:
    missing = []
    for section, key in _REQUIRED_KEYS:
        if not (data.get(section) or {}).get(key):
            missing.append(f"{section}.{key}")
    if missing:
        print(
            f"\n[Ziggy] FATAL: Missing required config keys: {', '.join(missing)}\n"
            f"Set them in {_config_path()} or via environment variables "
            f"(HA_URL, HA_TOKEN, OPENAI_API_KEY).\n",
            file=sys.stderr,
        )
        sys.exit(1)


def _config_path() -> str:
    if os.getenv("ZIGGY_CONFIG_PATH"):
        return os.getenv("ZIGGY_CONFIG_PATH")
    if os.path.exists(_HOME_CONFIG):
        return _HOME_CONFIG
    return _REPO_CONFIG


def load_settings() -> dict:
    path = _config_path()
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or {}
    except FileNotFoundError:
        print(
            f"\n[Ziggy] FATAL: Config file not found: {path}\n"
            f"Create {_HOME_CONFIG} or set ZIGGY_CONFIG_PATH.\n",
            file=sys.stderr,
        )
        sys.exit(1)

    # Environment variables override YAML values so secrets stay out of source control.
    ha = data.setdefault("home_assistant", {})
    if os.getenv("HA_URL"):
        ha["url"] = os.getenv("HA_URL")
    if os.getenv("HA_TOKEN"):
        ha["token"] = os.getenv("HA_TOKEN")

    oai = data.setdefault("openai", {})
    if os.getenv("OPENAI_API_KEY"):
        oai["api_key"] = os.getenv("OPENAI_API_KEY")

    tg = data.setdefault("telegram", {})
    if os.getenv("TELEGRAM_BOT_TOKEN"):
        tg["token"] = os.getenv("TELEGRAM_BOT_TOKEN")
    if os.getenv("TELEGRAM_ALLOWED_USERS"):
        tg["allowed_users"] = [
            int(x) for x in os.getenv("TELEGRAM_ALLOWED_USERS", "").split(",")
            if x.strip().isdigit()
        ]

    mqtt = data.setdefault("mqtt", {})
    if os.getenv("MQTT_HOST"):
        mqtt["host"] = os.getenv("MQTT_HOST")
    if os.getenv("MQTT_PORT"):
        mqtt["port"] = int(os.getenv("MQTT_PORT"))
    if os.getenv("MQTT_USERNAME"):
        mqtt["username"] = os.getenv("MQTT_USERNAME")
    if os.getenv("MQTT_PASSWORD"):
        mqtt["password"] = os.getenv("MQTT_PASSWORD")

    serp = data.setdefault("serpapi", {})
    if os.getenv("SERPAPI_API_KEY"):
        serp["api_key"] = os.getenv("SERPAPI_API_KEY")

    _validate(data)
    return data


_save_lock = threading.Lock()


def save_settings(settings_data: dict) -> None:
    path = _config_path()
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with _save_lock:
        with open(path, 'w', encoding='utf-8') as f:
            yaml.dump(settings_data, f, allow_unicode=True, default_flow_style=False)


settings = load_settings()
