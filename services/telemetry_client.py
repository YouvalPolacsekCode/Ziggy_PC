"""Edge telemetry poster — fires every 5 minutes (Prompt 2 §C, chunk 2.4).

Companion to relay/app/routers/telemetry.py. Single entry point:

    post_once(settings=..., timeout_s=...) -> dict

Collects what we can, posts what we collected, drops on failure. The
relay is the source of truth for retention — there is no local
spool/retry. Skipped intervals just become gaps in the daily aggregate.

Payload fields (every one is best-effort; absent means "couldn't read
this tick"):

    ha_version             from GET <ha_url>/api/config
    ziggy_version          env ZIGGY_VERSION → settings.version → "0.0.0+local"
    uptime_s               process uptime since import
    sensors                [{entity_id, battery, state}] from HA states,
                           filtered to device_class=battery; capped at 200
    disk                   {used_gb, total_gb} for the filesystem at "/"
    cpu_pct                psutil.cpu_percent(interval=None) — non-blocking
    mem_pct                psutil.virtual_memory().percent
    containers             [{name, state}] from docker — only when the SDK
                           imports and the socket is reachable
    last_automation_trigger
                           ISO-8601 of the most recent automation_traces
                           seen via HA's /api/services/logbook (best-effort)
    collected_at           ISO-8601 of when we built this payload
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Optional

import requests

from core.relay_signing import sign as sign_signature

log = logging.getLogger(__name__)

# Process-import time. Uptime is computed against this — close enough to
# "service uptime" for telemetry, since this module imports near server start.
_PROCESS_START_S = time.time()

# Cap on sensors emitted in a single telemetry post. A hub with a thousand
# entities will still report something useful; the aggregate cares about
# the count, not the full list.
MAX_SENSORS_REPORTED = 200


# ---------------------------------------------------------------------------
# Version sources
# ---------------------------------------------------------------------------

def _get_ziggy_version(settings: Optional[dict]) -> str:
    """ZIGGY_VERSION env wins, then settings.version, then default fallback.

    Matches the convention in services/backup_engine.py — same fallback
    string so a hub with neither configured reports consistently.
    """
    env = os.getenv("ZIGGY_VERSION", "").strip()
    if env:
        return env
    if isinstance(settings, dict):
        v = settings.get("version")
        if isinstance(v, str) and v.strip():
            return v.strip()
    return "0.0.0+local"


def _get_ha_version(ha_cfg: dict, *, timeout_s: float) -> Optional[str]:
    """GET <ha_url>/api/config → 'version' field. None on any failure."""
    ha_url = ha_cfg.get("url")
    ha_token = ha_cfg.get("token")
    if not ha_url or not ha_token:
        return None
    try:
        resp = requests.get(
            ha_url.rstrip("/") + "/api/config",
            headers={"Authorization": f"Bearer {ha_token}"},
            timeout=timeout_s,
        )
        if resp.status_code != 200:
            return None
        data = resp.json()
        v = data.get("version")
        return v if isinstance(v, str) else None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# System metrics (psutil)
# ---------------------------------------------------------------------------

def _collect_system_metrics() -> dict:
    """Disk / CPU / mem snapshot. Each key independent — partial dicts are fine."""
    out: dict[str, Any] = {}
    try:
        import psutil  # type: ignore
    except ImportError:
        return out
    try:
        d = psutil.disk_usage("/")
        out["disk"] = {
            "used_gb":  round(d.used / (1024 ** 3), 2),
            "total_gb": round(d.total / (1024 ** 3), 2),
        }
    except Exception:
        pass
    try:
        # interval=None returns the value since the previous call without
        # blocking — first call after import yields 0.0, which is a known
        # quirk; the 5-minute cadence quickly washes that out of aggregates.
        out["cpu_pct"] = float(psutil.cpu_percent(interval=None))
    except Exception:
        pass
    try:
        out["mem_pct"] = float(psutil.virtual_memory().percent)
    except Exception:
        pass
    return out


# ---------------------------------------------------------------------------
# Sensors (HA states API)
# ---------------------------------------------------------------------------

def _collect_sensors(ha_cfg: dict, *, timeout_s: float) -> Optional[list]:
    """Return battery-bearing sensors. None if HA unreachable.

    Filters to entities with device_class=battery or with a numeric
    battery_level attribute. Caps at MAX_SENSORS_REPORTED — typical
    home stays well under that.
    """
    ha_url = ha_cfg.get("url")
    ha_token = ha_cfg.get("token")
    if not ha_url or not ha_token:
        return None
    try:
        resp = requests.get(
            ha_url.rstrip("/") + "/api/states",
            headers={"Authorization": f"Bearer {ha_token}"},
            timeout=timeout_s,
        )
        if resp.status_code != 200:
            return None
        states = resp.json()
        if not isinstance(states, list):
            return None
    except Exception:
        return None

    out: list[dict] = []
    for entity in states:
        if not isinstance(entity, dict):
            continue
        attrs = entity.get("attributes") or {}
        dev_class = attrs.get("device_class")
        batt_attr = attrs.get("battery_level")
        is_battery_sensor = (dev_class == "battery") or isinstance(batt_attr, (int, float))
        if not is_battery_sensor:
            continue
        # For a battery device_class sensor, the entity's state IS the level.
        battery: Optional[float] = None
        if dev_class == "battery":
            try:
                battery = float(entity.get("state"))
            except (TypeError, ValueError):
                battery = None
        if battery is None and isinstance(batt_attr, (int, float)):
            battery = float(batt_attr)
        out.append({
            "entity_id": entity.get("entity_id"),
            "state":     entity.get("state"),
            "battery":   battery,
        })
        if len(out) >= MAX_SENSORS_REPORTED:
            break
    return out


def _collect_last_automation_trigger() -> Optional[str]:
    """Best-effort: most recent automation last_triggered across HA states.

    Reading the global states list twice in one tick is wasteful — but
    this collector is tolerant of HA being unreachable (returns None)
    and runs on a 5-minute cadence, so the cost is bounded.
    """
    try:
        from core.settings_loader import settings as _settings
        ha_cfg = _settings.get("home_assistant") or {}
        ha_url = ha_cfg.get("url")
        ha_token = ha_cfg.get("token")
        if not ha_url or not ha_token:
            return None
        resp = requests.get(
            ha_url.rstrip("/") + "/api/states",
            headers={"Authorization": f"Bearer {ha_token}"},
            timeout=8,
        )
        if resp.status_code != 200:
            return None
        latest: Optional[str] = None
        for ent in resp.json() or []:
            if not isinstance(ent, dict):
                continue
            eid = ent.get("entity_id", "")
            if not eid.startswith("automation."):
                continue
            lt = (ent.get("attributes") or {}).get("last_triggered")
            if isinstance(lt, str) and (latest is None or lt > latest):
                latest = lt
        return latest
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Containers (docker SDK if available)
# ---------------------------------------------------------------------------

def _collect_containers() -> Optional[list]:
    """List containers + their state. None if docker isn't reachable."""
    try:
        import docker  # type: ignore
    except ImportError:
        return None
    try:
        client = docker.from_env()
        return [
            {"name": c.name, "state": c.status}
            for c in client.containers.list(all=True)
        ]
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Payload assembly + POST
# ---------------------------------------------------------------------------

def _build_payload(settings: dict, *, timeout_s: float) -> dict:
    """Assemble the JSON body. Each collector is independent — partial OK."""
    ha_cfg = settings.get("home_assistant") or {}
    payload: dict[str, Any] = {
        "ziggy_version": _get_ziggy_version(settings),
        "uptime_s":      int(time.time() - _PROCESS_START_S),
        "collected_at":  datetime.now(timezone.utc).isoformat(),
    }
    ha_v = _get_ha_version(ha_cfg, timeout_s=timeout_s)
    if ha_v is not None:
        payload["ha_version"] = ha_v
    sensors = _collect_sensors(ha_cfg, timeout_s=timeout_s)
    if sensors is not None:
        payload["sensors"] = sensors
    sysm = _collect_system_metrics()
    payload.update(sysm)
    containers = _collect_containers()
    if containers is not None:
        payload["containers"] = containers
    lat = _collect_last_automation_trigger()
    if lat is not None:
        payload["last_automation_trigger"] = lat
    return payload


def _build_url(relay_url: str, home_id: str) -> str:
    """v1: device_id == home_id (see relay/app/routers/ota.py)."""
    return f"{relay_url.rstrip('/')}/api/devices/{home_id}/telemetry"


class TelemetryPostResult(dict):
    """{ok, reason, status, payload_bytes} — same shape pattern as OtaPollResult."""


def post_once(
    *,
    settings: Optional[dict] = None,
    timeout_s: float = 15.0,
    _http_post: Optional[Any] = None,
    _build_payload_fn: Optional[Any] = None,
) -> TelemetryPostResult:
    """Single 5-min tick. Returns a result dict; never raises.

    Test seams:
      _http_post         callable(url, headers, content, timeout) → response
      _build_payload_fn  callable(settings, timeout_s) → dict (skips real
                         psutil/HA/docker collection — keeps unit tests fast
                         and deterministic)
    """
    post_fn = _http_post or _real_http_post
    builder = _build_payload_fn or _build_payload

    try:
        if settings is None:
            from core.settings_loader import settings as global_settings
            settings = global_settings
        home_id = (settings.get("home") or {}).get("id")
        relay_cfg = settings.get("relay") or {}
        relay_url = relay_cfg.get("url")
        secret = relay_cfg.get("secret")

        if not home_id or not relay_url or not secret:
            log.debug("telemetry post skipped — relay not fully configured")
            return TelemetryPostResult(
                ok=False, reason="missing_config", status=None, payload_bytes=0,
            )

        payload = builder(settings, timeout_s=timeout_s)
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        url = _build_url(relay_url, home_id)
        headers = {
            "Content-Type":      "application/json",
            "X-Ziggy-Signature": sign_signature(secret, body),
        }

        try:
            resp = post_fn(url, headers=headers, content=body, timeout=timeout_s)
        except Exception as e:
            log.warning("telemetry POST network error: %s: %s", type(e).__name__, e)
            return TelemetryPostResult(
                ok=False, reason="network_error", status=None, payload_bytes=len(body),
            )

        if 200 <= resp.status_code < 300:
            return TelemetryPostResult(
                ok=True, reason="posted", status=resp.status_code,
                payload_bytes=len(body),
            )
        log.warning("telemetry POST non-2xx: status=%d body=%s",
                    resp.status_code, getattr(resp, "text", "")[:200])
        return TelemetryPostResult(
            ok=False, reason=f"http_{resp.status_code}",
            status=resp.status_code, payload_bytes=len(body),
        )
    except Exception as e:
        # Defense-in-depth — same contract as ota_client.poll_once.
        log.error("telemetry post crashed: %s: %s", type(e).__name__, e, exc_info=True)
        return TelemetryPostResult(
            ok=False, reason="unexpected_error", status=None, payload_bytes=0,
        )


def _real_http_post(url: str, *, headers: dict, content: bytes, timeout: float):
    return requests.post(url, headers=headers, data=content, timeout=timeout)
