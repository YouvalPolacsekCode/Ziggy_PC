"""
Ziggy-managed HA template binary_sensors for room occupancy fusion.

The bedroom-orchestra and similar smart-room patterns need a single
"is the room occupied" entity that fuses several signals (motion, presence,
door contact, etc.).  HA's `template` integration is the right primitive but
it's YAML-configured, not REST-creatable, so Ziggy maintains its own packages
file and reloads template entities after each change.

HA prerequisite (one-time, done as part of Ziggy's HA provisioning):
  configuration.yaml must include `packages: !include_dir_named packages`
  under `homeassistant:`.

Layout:
  {ha_config_dir}/packages/ziggy_occupancy_sensors.yaml

Reload:
  POST /api/services/template/reload   (no body, no restart needed)
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional
import os
import re
import yaml
import requests

from core.settings_loader import settings
from core.logger_module import log_info, log_error


_PACKAGES_SUBDIR = "packages"
_PACKAGE_FILENAME = "ziggy_occupancy_sensors.yaml"
_DEFAULT_DELAY_OFF_SECONDS = 30  # damps flicker when all sensors briefly go quiet


def _ha_config_dir() -> Optional[Path]:
    """Resolve HA config dir from the same source backup_engine uses."""
    backup_cfg = (settings.get("backup") or {})
    raw = backup_cfg.get("ha_config_dir") or os.environ.get("HA_CONFIG_DIR")
    if not raw:
        return None
    p = Path(raw)
    return p if p.is_dir() else None


def _ha_url() -> str:
    return (settings.get("home_assistant") or {}).get("url", "").rstrip("/")


def _ha_headers() -> dict:
    token = (settings.get("home_assistant") or {}).get("token") or os.environ.get("HA_TOKEN", "")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _slug(name: str) -> str:
    """HA unique_id slug — lowercase ASCII + underscores. Returns '' for input
    that has no ASCII content (e.g. pure Hebrew). Callers must validate non-empty.
    HA entity_ids do not accept non-ASCII; Hebrew belongs in friendly_name, not the slug."""
    s = re.sub(r"[^a-z0-9_]+", "_", name.lower().replace(" ", "_")).strip("_")
    if s and s[0].isdigit():
        s = f"z_{s}"
    return s


def _build_state_template(sensor_entities: list[str]) -> str:
    """OR-of-sensors template. Each clause: states('entity') == 'on'.
    Empty list returns 'false' so the sensor always reports clear."""
    clean = [e.strip() for e in sensor_entities if e and "." in e]
    if not clean:
        return "false"
    clauses = [f"states('{eid}') == 'on'" for eid in clean]
    return "{{ " + " or ".join(clauses) + " }}"


def _load_package(path: Path) -> dict:
    if not path.exists():
        return {"template": []}
    try:
        with path.open("r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        if "template" not in data or not isinstance(data["template"], list):
            data["template"] = []
        return data
    except Exception as e:
        log_error(f"[template_sensors] failed to load {path}: {e}")
        return {"template": []}


def _save_package(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        # allow_unicode preserves Hebrew friendly_names verbatim
        yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True)


def _reload_template_entities() -> tuple[bool, str]:
    """Live-reload HA's YAML-based templates. No restart needed."""
    url = _ha_url()
    if not url:
        return False, "HA URL not configured"
    try:
        resp = requests.post(
            f"{url}/api/services/template/reload",
            headers=_ha_headers(),
            json={},
            timeout=10,
        )
        if resp.status_code in (200, 201):
            return True, ""
        return False, f"HA {resp.status_code}: {resp.text}"
    except Exception as e:
        return False, str(e)


def create_occupancy_sensor(
    room: str,
    sensor_entities: list[str],
    friendly_name: Optional[str] = None,
    delay_off_seconds: int = _DEFAULT_DELAY_OFF_SECONDS,
) -> dict:
    """Create or replace a template binary_sensor that ORs the given sensors.

    Args:
        room: Room slug, e.g. "bedroom" or "חדר_שינה". Used for unique_id.
        sensor_entities: List of HA entity_ids whose `on` state means "occupied".
        friendly_name: Display name (Hebrew supported, e.g. "תפוסה - חדר שינה").
                       Defaults to "{Room} Occupied" if omitted.
        delay_off_seconds: Linger time after all sensors clear, to damp flicker.

    Returns:
        {"ok": bool, "entity_id": str, "message"|"error": str}
    """
    if not room or not sensor_entities:
        return {"ok": False, "error": "room and sensor_entities are required"}

    room_slug = _slug(room)
    if not room_slug:
        return {"ok": False, "error": (
            f"Room name '{room}' has no ASCII characters Ziggy can use for the HA entity_id. "
            f"HA requires ASCII slugs. Pass the room as its ASCII slug (e.g. 'bedroom') "
            f"and use friendly_name for the Hebrew display label."
        )}

    cfg_dir = _ha_config_dir()
    if cfg_dir is None:
        return {"ok": False, "error": (
            "HA config dir not configured. Set settings.backup.ha_config_dir "
            "or HA_CONFIG_DIR env var so Ziggy can write template sensors."
        )}

    slug = f"{room_slug}_occupied"
    entity_id = f"binary_sensor.{slug}"
    name = friendly_name or f"{room.replace('_', ' ').title()} Occupied"

    entry = {
        "binary_sensor": [{
            "name": name,
            "unique_id": slug,
            "device_class": "occupancy",
            "state": _build_state_template(sensor_entities),
            "delay_off": {"seconds": max(0, int(delay_off_seconds))},
        }]
    }

    package_path = cfg_dir / _PACKAGES_SUBDIR / _PACKAGE_FILENAME
    pkg = _load_package(package_path)
    # Replace any existing entry with the same unique_id, else append.
    new_template: list = []
    replaced = False
    for block in pkg.get("template", []):
        if not isinstance(block, dict):
            continue
        block_entries = block.get("binary_sensor") or []
        if any(isinstance(e, dict) and e.get("unique_id") == slug for e in block_entries):
            new_template.append(entry)
            replaced = True
        else:
            new_template.append(block)
    if not replaced:
        new_template.append(entry)
    pkg["template"] = new_template

    try:
        _save_package(package_path, pkg)
    except Exception as e:
        return {"ok": False, "error": f"failed to write {package_path}: {e}"}

    reloaded, reload_err = _reload_template_entities()
    msg = f"Created occupancy sensor {entity_id} from {len(sensor_entities)} signal(s)"
    if not reloaded:
        msg += f" — file saved, but template reload failed ({reload_err}). Restart HA or call template.reload manually."
    log_info(f"[template_sensors] {msg}")
    return {"ok": True, "entity_id": entity_id, "message": msg}


def list_occupancy_sensors() -> list[dict]:
    """Return all Ziggy-managed occupancy sensors currently defined."""
    cfg_dir = _ha_config_dir()
    if cfg_dir is None:
        return []
    pkg = _load_package(cfg_dir / _PACKAGES_SUBDIR / _PACKAGE_FILENAME)
    out: list[dict] = []
    for block in pkg.get("template", []):
        if not isinstance(block, dict):
            continue
        for e in (block.get("binary_sensor") or []):
            if isinstance(e, dict) and e.get("unique_id"):
                out.append({
                    "entity_id": f"binary_sensor.{e['unique_id']}",
                    "name": e.get("name", e["unique_id"]),
                    "state_template": e.get("state", ""),
                })
    return out


def delete_occupancy_sensor(entity_id: str) -> dict:
    """Remove the named sensor from the packages file and reload templates."""
    cfg_dir = _ha_config_dir()
    if cfg_dir is None:
        return {"ok": False, "error": "HA config dir not configured"}
    slug = entity_id.split(".", 1)[-1] if "." in entity_id else entity_id
    package_path = cfg_dir / _PACKAGES_SUBDIR / _PACKAGE_FILENAME
    if not package_path.exists():
        return {"ok": False, "error": f"no Ziggy template sensors defined yet"}
    pkg = _load_package(package_path)
    new_template: list = []
    removed = False
    for block in pkg.get("template", []):
        if not isinstance(block, dict):
            new_template.append(block)
            continue
        entries = block.get("binary_sensor") or []
        kept = [e for e in entries if not (isinstance(e, dict) and e.get("unique_id") == slug)]
        if len(kept) != len(entries):
            removed = True
        if kept:
            new_template.append({"binary_sensor": kept})
    if not removed:
        return {"ok": False, "error": f"sensor {entity_id} not found"}
    pkg["template"] = new_template
    try:
        _save_package(package_path, pkg)
    except Exception as e:
        return {"ok": False, "error": f"failed to write {package_path}: {e}"}
    reloaded, reload_err = _reload_template_entities()
    msg = f"Removed {entity_id}"
    if not reloaded:
        msg += f" — file saved, but template reload failed ({reload_err})."
    return {"ok": True, "message": msg}
