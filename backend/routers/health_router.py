"""
/api/health — structured system health snapshot.

GET  /api/health          — live health state (cheap, reads in-memory cache only)
POST /api/health/reload-zigbee — reload the ZHA integration via HA services

GET response fields:
  ha_connected          bool   — HA WebSocket is authenticated and live
  offline_count         int    — physical devices currently reporting unavailable/unknown
  offline_with_deps     list   — devices that are offline AND used by enabled automations
  battery_warnings      list   — devices / sensors reporting battery < threshold
  coordinator_warning   bool   — ≥3 physical devices offline simultaneously
  coordinator_title     str    — friendly name of the ZHA integration ("Zigbee Home Automation")
  coordinator_entry_id  str    — ZHA config entry id (used by reload endpoint)
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

router = APIRouter()

# Cached ZHA entry — populated on first health request that detects coordinator_warning.
# Ziggy supports exactly one coordinator per home so a single entry_id is sufficient.
_zha_entry_cache: dict | None = None  # {"entry_id": str, "title": str} | None
_zha_cache_checked: bool = False


async def _discover_zha_entry() -> dict | None:
    """Return the ZHA config entry dict from HA, or None. Cached after first successful lookup."""
    global _zha_entry_cache, _zha_cache_checked
    if _zha_cache_checked:
        return _zha_entry_cache
    try:
        from services.ha_areas import _ws
        res, = await _ws({"type": "config_entries/list"})
        entries = res.get("result") or []
        for entry in entries:
            if entry.get("domain") == "zha":
                _zha_entry_cache = {
                    "entry_id": entry["entry_id"],
                    "title":    entry.get("title", "Zigbee Home Automation"),
                }
                break
    except Exception:
        pass
    _zha_cache_checked = True
    return _zha_entry_cache

# Use entity_filter as the single source of truth for what counts as a "real" device.
# This ensures offline_count matches exactly the entities visible on the Devices page,
# rather than inflating the count with battery sensors, ZHA config entities (number/select),
# phone sensors, router sensors, IR blaster helpers, etc.
from services.entity_filter import _should_hide as _entity_should_hide

_BATTERY_THRESHOLD_DEFAULT = 20


@router.get("/api/health")
async def get_health():
    # ── Imports are deferred to avoid circular issues at import time ──────────
    try:
        from services.ha_subscriber import state_cache, ha_connected
    except ImportError:
        state_cache, ha_connected = {}, False

    try:
        from services.anomaly_engine import get_automation_deps
        deps = get_automation_deps()
    except Exception:
        deps = {}

    try:
        from core.settings_loader import settings
        batt_threshold: int = int(
            settings.get("anomaly_engine", {}).get("anom08_battery_threshold", _BATTERY_THRESHOLD_DEFAULT)
        )
        ha_url: str = settings.get("home_assistant", {}).get("url", "").rstrip("/")
    except Exception:
        batt_threshold = _BATTERY_THRESHOLD_DEFAULT
        ha_url = ""

    offline_all:       list[dict] = []
    offline_with_deps: list[dict] = []
    battery_warnings:  list[dict] = []

    for eid, entry in state_cache.items():
        if _entity_should_hide(eid):
            continue

        state = entry.get("state", "")
        attrs = entry.get("attributes", {}) or {}
        name  = attrs.get("friendly_name") or eid.split(".")[-1].replace("_", " ").title()

        # ── Offline detection ────────────────────────────────────────────────
        if state in ("unavailable", "unknown"):
            auto_names = deps.get(eid, [])
            record = {
                "entity_id":       eid,
                "name":            name,
                "ha_state":        state,
                "automation_deps": auto_names,
            }
            offline_all.append(record)
            if auto_names:
                offline_with_deps.append(record)

        # ── Battery detection ────────────────────────────────────────────────
        battery: int | None = None
        if attrs.get("device_class") == "battery":
            try:
                battery = int(float(state))
            except (ValueError, TypeError):
                pass
        else:
            for key in ("battery_level", "battery", "battery_percent"):
                if key in attrs:
                    try:
                        battery = int(attrs[key])
                        break
                    except (ValueError, TypeError):
                        pass

        if battery is not None and 0 <= battery < batt_threshold:
            battery_warnings.append({
                "entity_id": eid,
                "name":      name,
                "battery":   battery,
            })

    coordinator_warning = len(offline_all) >= 3

    # Discover ZHA entry when coordinator warning is active (lazy, cached after first hit)
    coordinator_entry_id = ""
    coordinator_title    = ""
    if coordinator_warning:
        zha = await _discover_zha_entry()
        if zha:
            coordinator_entry_id = zha["entry_id"]
            coordinator_title    = zha["title"]

    return {
        "ha_connected":         ha_connected,
        "offline_count":        len(offline_all),
        "offline_devices":      offline_all[:20],
        "offline_with_deps":    offline_with_deps[:10],
        "battery_warnings":     sorted(battery_warnings, key=lambda x: x["battery"])[:10],
        "coordinator_warning":  coordinator_warning,
        "coordinator_entry_id": coordinator_entry_id,
        "coordinator_title":    coordinator_title,
    }


@router.post("/api/health/reload-zigbee")
async def reload_zigbee():
    """Reload the single ZHA integration via HA's homeassistant.reload_config_entry service.

    Discovers the ZHA entry_id dynamically — no hardcoding needed.
    Safe to call: HA reloads the integration gracefully without device data loss.
    """
    global _zha_cache_checked  # allow retry on explicit reload request

    # Always re-discover on an explicit reload request (clears cache so fresh lookup happens)
    _zha_cache_checked = False
    zha = await _discover_zha_entry()

    if not zha:
        return {"ok": False, "error": "No ZHA integration found in Home Assistant. Is ZHA installed and configured?"}

    entry_id = zha["entry_id"]
    title    = zha["title"]

    try:
        from services.home_automation import call_service
        result = call_service("homeassistant", "reload_config_entry", {"entry_id": entry_id})
        if result.get("ok"):
            from core.logger_module import log_info
            log_info(f"[Health] ZHA reload triggered for entry '{entry_id}' ({title})")
            return {"ok": True, "message": f"Reloading '{title}'. Zigbee devices will reconnect shortly."}
        return {"ok": False, "error": result.get("message", "HA returned an error during reload.")}
    except Exception as e:
        return {"ok": False, "error": str(e)}
