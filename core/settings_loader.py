import os
import sys
import threading
import yaml
from dotenv import load_dotenv

load_dotenv()

_REPO_CONFIG  = os.path.join(os.path.dirname(__file__), '..', 'config/settings.yaml')
_HOME_CONFIG  = os.path.expanduser("~/.ziggy/home.yaml")
_SECRETS_FILE = os.path.join(os.path.dirname(__file__), '..', 'config/secrets.yaml')

_REQUIRED_KEYS = [
    ("home_assistant", "url"),
    ("home_assistant", "token"),
    ("openai", "api_key"),
]


def _validate(data: dict) -> None:
    # In cloud mode (HOME_TYPE=cloud or CLOUD_MODE=true), HA and OpenAI are
    # configured by the home owner after provisioning — not at boot time.
    if os.getenv("CLOUD_MODE", "").lower() in ("1", "true", "yes") or \
       data.get("home", {}).get("type") == "cloud":
        return

    missing = []
    for section, key in _REQUIRED_KEYS:
        if not (data.get(section) or {}).get(key):
            missing.append(f"{section}.{key}")
    if missing:
        print(
            f"\n[Ziggy] WARNING: Missing config keys: {', '.join(missing)}. "
            f"HA-dependent features will be unavailable until configured in Settings.\n",
            file=sys.stderr,
        )


def _config_path() -> str:
    if os.getenv("ZIGGY_CONFIG_PATH"):
        return os.getenv("ZIGGY_CONFIG_PATH")
    if os.path.exists(_HOME_CONFIG):
        return _HOME_CONFIG
    return _REPO_CONFIG


def _deep_merge(base: dict, override: dict) -> dict:
    # Recursively merge `override` into `base`. Dict values are merged
    # key-by-key; everything else is replaced. Used to layer secrets.yaml
    # on top of settings.yaml without clobbering unrelated sections.
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v
    return base


def _load_secrets_file() -> dict:
    # Optional config/secrets.yaml — untracked, owned by the operator.
    # Provides a YAML-shaped secrets layer for values that don't fit cleanly
    # into env vars (multi-line keys, structured secrets). Env vars still
    # win over this file; this file wins over settings.yaml.
    if not os.path.exists(_SECRETS_FILE):
        return {}
    try:
        with open(_SECRETS_FILE, 'r', encoding='utf-8') as f:
            return yaml.safe_load(f) or {}
    except Exception as e:
        print(f"\n[Ziggy] WARNING: Failed to read {_SECRETS_FILE}: {e}\n",
              file=sys.stderr)
        return {}


def load_settings() -> dict:
    path = _config_path()
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = yaml.safe_load(f) or {}
    except FileNotFoundError:
        cloud = os.getenv("CLOUD_MODE", "").lower() in ("1", "true", "yes")
        if cloud:
            data = {}  # first boot: env vars supply all config; file created on first save
        else:
            print(
                f"\n[Ziggy] FATAL: Config file not found: {path}\n"
                f"Create {_HOME_CONFIG} or set ZIGGY_CONFIG_PATH.\n",
                file=sys.stderr,
            )
            sys.exit(1)

    # Layer config/secrets.yaml on top (operator-owned, untracked).
    _deep_merge(data, _load_secrets_file())

    # Environment variables override YAML values so secrets stay out of source control.
    ha = data.setdefault("home_assistant", {})
    if os.getenv("HA_URL"):
        ha["url"] = os.getenv("HA_URL")
    if os.getenv("HA_TOKEN"):
        ha["token"] = os.getenv("HA_TOKEN")

    # MQTT env override (mirrors HA_URL pattern). Needed because a hub's HA VM
    # DHCP lease can shift and hosts don't have MQTT_URL forwarded any other way.
    mqtt = data.setdefault("mqtt", {})
    if os.getenv("MQTT_URL"):
        mqtt["url"] = os.getenv("MQTT_URL")

    oai = data.setdefault("openai", {})
    if os.getenv("OPENAI_API_KEY"):
        oai["api_key"] = os.getenv("OPENAI_API_KEY")

    serp = data.setdefault("serpapi", {})
    if os.getenv("SERPAPI_API_KEY"):
        serp["api_key"] = os.getenv("SERPAPI_API_KEY")

    # Cloud home identity — set when provisioned via relay
    home = data.setdefault("home", {})
    if os.getenv("HOME_ID"):
        home["id"] = os.getenv("HOME_ID")
    if os.getenv("HOME_NAME"):
        home["name"] = os.getenv("HOME_NAME")
    if os.getenv("HOME_TYPE"):
        home["type"] = os.getenv("HOME_TYPE")

    relay = data.setdefault("relay", {})
    if os.getenv("RELAY_URL"):
        relay["url"] = os.getenv("RELAY_URL")
    if os.getenv("RELAY_SECRET"):
        relay["secret"] = os.getenv("RELAY_SECRET")
    if os.getenv("TUNNEL_URL"):
        relay["tunnel_url"] = os.getenv("TUNNEL_URL")

    # HA installer (Prompt 4) — cloud topology bind-mounts the host's
    # docker-compose.yml at /host/docker-compose.yml; the provisioner
    # template exports ZIGGY_HOST_COMPOSE_FILE so the installer reads
    # the right path without per-home settings.yaml edits. Local-dev
    # hubs leave this unset and use ha.compose_file from settings.yaml.
    ha_install = data.setdefault("ha", {})
    if os.getenv("ZIGGY_HOST_COMPOSE_FILE"):
        ha_install["compose_file"] = os.getenv("ZIGGY_HOST_COMPOSE_FILE")

    # SMTP / email — credentials never belong in tracked YAML.
    email = data.setdefault("email", {})
    if os.getenv("SMTP_HOST"):
        email["host"] = os.getenv("SMTP_HOST")
    if os.getenv("SMTP_PORT"):
        email["port"] = int(os.getenv("SMTP_PORT"))
    if os.getenv("SMTP_USERNAME"):
        email["username"] = os.getenv("SMTP_USERNAME")
    if os.getenv("SMTP_PASSWORD"):
        email["password"] = os.getenv("SMTP_PASSWORD")
    if os.getenv("SMTP_FROM_ADDRESS"):
        email["from_address"] = os.getenv("SMTP_FROM_ADDRESS")
    if os.getenv("SMTP_FROM_NAME"):
        email["from_name"] = os.getenv("SMTP_FROM_NAME")

    # Azure Cognitive Services (neural TTS).
    voice = data.setdefault("voice", {})
    azure = voice.setdefault("azure", {})
    if os.getenv("AZURE_SPEECH_KEY"):
        azure["speech_key"] = os.getenv("AZURE_SPEECH_KEY")
    if os.getenv("AZURE_SPEECH_REGION"):
        azure["speech_region"] = os.getenv("AZURE_SPEECH_REGION")

    # ElevenLabs (premium neural TTS, Hebrew-first).
    elevenlabs = voice.setdefault("elevenlabs", {})
    if os.getenv("ELEVENLABS_API_KEY"):
        elevenlabs["api_key"] = os.getenv("ELEVENLABS_API_KEY")

    # Cartesia Sonic (primary TTS — native Hebrew voices).
    cartesia = voice.setdefault("cartesia", {})
    if os.getenv("CARTESIA_API_KEY"):
        cartesia["api_key"] = os.getenv("CARTESIA_API_KEY")

    # IFTTT webhook key.
    ifttt = data.setdefault("ifttt", {})
    if os.getenv("IFTTT_WEBHOOK_KEY"):
        ifttt["webhook_key"] = os.getenv("IFTTT_WEBHOOK_KEY")

    _validate(data)
    _dev_safety_check(data)
    return data


def _dev_safety_check(data: dict) -> None:
    """Warn loudly if a hub-typed config carries cloud relay credentials.

    Catches the common drift case: a developer copies the production
    settings.yaml to their Mac for testing, forgets to strip the `relay:`
    block, and the dev process starts polling the cloud relay / staging
    OTA manifests. This is additive — it doesn't disable anything, just
    makes the leak visible at startup.

    Silent for cloud-typed homes (which are SUPPOSED to talk to the relay)
    and inside pytest runs (which set CLOUD_MODE explicitly or use stubs).
    """
    if os.getenv("PYTEST_CURRENT_TEST"):
        return
    home = data.get("home") or {}
    if home.get("type") != "hub":
        return
    relay = data.get("relay") or {}
    leaks = [k for k in ("url", "secret", "tunnel_url") if relay.get(k)]
    if not leaks:
        return
    print(
        "\n[Ziggy] DEV WARNING: home.type=hub but relay config is populated: "
        f"{', '.join(leaks)}.\n"
        "        This hub will poll the cloud relay and may stage OTA manifests\n"
        "        intended for cloud homes. If this is a developer machine,\n"
        "        remove the `relay:` block from your active config file\n"
        "        (see docs/DEPLOYMENT.md § Config layering).\n",
        file=sys.stderr,
    )


_save_lock = threading.Lock()
_secrets_lock = threading.Lock()

# Keys that must NEVER be written to the tracked settings.yaml. The in-memory
# `settings` dict keeps them (so callers reading e.g. settings["openai"]["api_key"]
# still work for the running process), but save_settings() strips them on disk.
# Persistence path for these keys is config/secrets.yaml via save_secrets().
_SECRET_PATHS: list[tuple[str, ...]] = [
    ("home_assistant", "token"),
    ("openai", "api_key"),
    ("serpapi", "api_key"),
    ("email", "password"),
    ("voice", "azure", "speech_key"),
    ("voice", "elevenlabs", "api_key"),
    ("voice", "cartesia", "api_key"),
    ("ifttt", "webhook_key"),
    ("relay", "secret"),
]

# Top-level sections that are dropped entirely on save. Their persistent
# home is no longer settings.yaml:
#   users  — password hashes + session tokens now live in user_files/auth.db
#   auth   — legacy single-user shape (predates the users[] list); superseded
#            by users → auth.db. The in-memory dict still keeps it during
#            transition so any straggling read paths don't NPE, but the
#            on-disk YAML stops persisting it as of this commit.
_SECRET_TOPLEVEL_KEYS: list[str] = ["users", "auth"]


def _strip_secret_paths(data: dict) -> dict:
    # Deep-copy + remove every _SECRET_PATHS entry plus every entry in
    # _SECRET_TOPLEVEL_KEYS. Used right before persisting to settings.yaml
    # so secrets never round-trip through tracked config.
    import copy
    out = copy.deepcopy(data)
    for path in _SECRET_PATHS:
        node = out
        for key in path[:-1]:
            if not isinstance(node, dict):
                node = None
                break
            node = node.get(key)
            if node is None:
                break
        if isinstance(node, dict):
            node.pop(path[-1], None)
    for key in _SECRET_TOPLEVEL_KEYS:
        out.pop(key, None)
    return out


def _atomic_yaml_write(path: str, data: dict) -> None:
    # Atomic-rename pattern: write to a sibling tmp file then rename. Avoids
    # partial files when two writers race or the process is killed mid-write.
    tmp = path + ".tmp"
    with open(tmp, 'w', encoding='utf-8') as f:
        yaml.dump(data, f, allow_unicode=True, default_flow_style=False)
    os.replace(tmp, path)


def save_settings(settings_data: dict) -> None:
    path = _config_path()
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    safe = _strip_secret_paths(settings_data)
    with _save_lock:
        _atomic_yaml_write(path, safe)


def save_secrets(updates: dict) -> None:
    # Merge `updates` into config/secrets.yaml (untracked). The on-disk file
    # is created if missing. Used by the admin UI to persist credentials
    # without ever touching settings.yaml.
    os.makedirs(os.path.dirname(os.path.abspath(_SECRETS_FILE)), exist_ok=True)
    with _secrets_lock:
        existing: dict = {}
        if os.path.exists(_SECRETS_FILE):
            try:
                with open(_SECRETS_FILE, 'r', encoding='utf-8') as f:
                    existing = yaml.safe_load(f) or {}
            except Exception:
                existing = {}
        _deep_merge(existing, updates or {})
        _atomic_yaml_write(_SECRETS_FILE, existing)


settings = load_settings()
