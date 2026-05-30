"""
Per-member media secrets store.

Spotify (and later Apple/YT Music) access tokens are stored as one JSON file
per member under config/secrets/media/. The directory is created with 0700 and
each file is written with 0600. The legacy config/secrets.yaml is left alone.

Files are never written or read while the media_music flag is off.
"""
from __future__ import annotations

import json
import os
import stat
import threading
from typing import Any, Optional

from core.media.flag import require_enabled
from core.logger_module import log_error, log_info

_BASE_DIR = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "config", "secrets", "media")
)
_LOCK = threading.Lock()


def _ensure_dir() -> None:
    if not os.path.isdir(_BASE_DIR):
        os.makedirs(_BASE_DIR, mode=0o700, exist_ok=True)
    try:
        os.chmod(_BASE_DIR, 0o700)
    except OSError:
        pass


def _safe_name(name: str) -> str:
    keep = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
    return "".join(c if c in keep else "_" for c in (name or "")).strip("_") or "anon"


def _path_for(service: str, member: str) -> str:
    return os.path.join(_BASE_DIR, f"{_safe_name(service)}_{_safe_name(member)}.json")


def has_secret(service: str, member: str) -> bool:
    require_enabled()
    return os.path.exists(_path_for(service, member))


def read_secret(service: str, member: str) -> Optional[dict]:
    require_enabled()
    path = _path_for(service, member)
    if not os.path.exists(path):
        return None
    try:
        with _LOCK, open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log_error(f"[media.secrets] failed to read {path}: {e}")
        return None


def write_secret(service: str, member: str, data: dict) -> None:
    require_enabled()
    _ensure_dir()
    path = _path_for(service, member)
    with _LOCK:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        try:
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)  # 0600
        except OSError:
            pass
    log_info(f"[media.secrets] wrote {service} secret for member={member}")


def delete_secret(service: str, member: str) -> bool:
    require_enabled()
    path = _path_for(service, member)
    if os.path.exists(path):
        try:
            os.remove(path)
            log_info(f"[media.secrets] deleted {service} secret for member={member}")
            return True
        except OSError as e:
            log_error(f"[media.secrets] failed to delete {path}: {e}")
    return False


def list_members(service: str) -> list[str]:
    """Return member names that have a stored secret for the given service."""
    require_enabled()
    if not os.path.isdir(_BASE_DIR):
        return []
    prefix = f"{_safe_name(service)}_"
    out: list[str] = []
    for entry in os.listdir(_BASE_DIR):
        if entry.startswith(prefix) and entry.endswith(".json"):
            out.append(entry[len(prefix):-len(".json")])
    return out


def info(service: str, member: str) -> dict[str, Any]:
    """Non-secret diagnostic info about a stored secret (presence + scopes only)."""
    require_enabled()
    data = read_secret(service, member) or {}
    return {
        "configured": bool(data),
        "expires_at": data.get("expires_at"),
        "scope":      data.get("scope"),
    }
