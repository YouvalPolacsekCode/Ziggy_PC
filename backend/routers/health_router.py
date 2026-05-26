"""
/api/health — structured system health snapshot.

GET  /api/health          — live health state (cheap, reads in-memory cache only)
POST /api/health/reload-zigbee — reload the Zigbee coordinator integration via HA services

GET response fields:
  ha_connected          bool   — HA WebSocket is authenticated and live
  offline_count         int    — physical devices currently reporting unavailable/unknown
  offline_with_deps     list   — devices that are offline AND used by enabled automations
  battery_warnings      list   — devices / sensors reporting battery < threshold
  coordinator_warning   bool   — ≥3 physical devices offline simultaneously
  coordinator_title     str    — friendly name of the coordinator integration
  coordinator_entry_id  str    — config entry id used by the reload endpoint (empty = not found)
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter

from core.errors import ErrorCode, ZiggyError

router = APIRouter()

# Supported Zigbee coordinator integration domains, in preference order.
# ZHA is the native HA integration; deCONZ covers ConBee/RaspBee; zigbee2mqtt
# covers the official Zigbee2MQTT HA integration.
_COORDINATOR_DOMAINS = ("zha", "deconz", "zigbee2mqtt")

# Cached coordinator entry — populated on first health request that detects coordinator_warning.
_coordinator_entry_cache: dict | None = None  # {"entry_id": str, "title": str} | None
_coordinator_cache_checked: bool = False


async def _discover_coordinator_entry() -> dict | None:
    """Return the first recognised Zigbee coordinator config entry from HA, or None.

    Detects the coordinator by scanning the HA entity registry for entities
    whose platform matches a known Zigbee integration.  This works on all HA
    versions because config/entity_registry/list is a stable WS command.
    """
    global _coordinator_entry_cache, _coordinator_cache_checked
    if _coordinator_cache_checked:
        return _coordinator_entry_cache
    try:
        from services.ha_areas import _ws
        from core.logger_module import log_info, log_error
        res, = await _ws({"type": "config/entity_registry/list"})
        entities = res.get("result") or []
        domain_rank = {d: i for i, d in enumerate(_COORDINATOR_DOMAINS)}
        # Find the best-ranked platform among all registered entities
        best_rank = len(_COORDINATOR_DOMAINS)
        best_entry_id = None
        best_platform = None
        for e in entities:
            platform = e.get("platform") or ""
            if platform in domain_rank and domain_rank[platform] < best_rank:
                best_rank = domain_rank[platform]
                best_entry_id = e.get("config_entry_id")
                best_platform = platform
        if best_entry_id and best_platform:
            title = {"zha": "Zigbee Home Automation", "deconz": "deCONZ", "zigbee2mqtt": "Zigbee2MQTT"}.get(best_platform, best_platform.upper())
            _coordinator_entry_cache = {"entry_id": best_entry_id, "title": title}
            log_info(f"[Health] coordinator found via entity registry: {_coordinator_entry_cache}")
        else:
            platforms = sorted({e.get("platform") for e in entities if e.get("platform")})
            log_error(f"[Health] no Zigbee coordinator found — platforms in entity registry: {platforms}")
    except Exception as e:
        from core.logger_module import log_error
        log_error(f"[Health] _discover_coordinator_entry failed: {e}")
    _coordinator_cache_checked = True
    return _coordinator_entry_cache

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

    # Apply the same extra filters the Devices page uses, otherwise the
    # Dashboard's "13 offline" claim mismatches the 7 the user can actually
    # see and act on. Build the lazy filter set once outside the loop.
    try:
        from services.entity_filter import filter_entities
        ef = settings.get("entity_filter", {}) or {}
        _ef_extra_hidden = (ef.get("extra_hidden_domains") or [],
                            ef.get("extra_hidden_patterns") or [])
        # filter_entities expects entity records, so we'll apply it once
        # over the candidate offline set below rather than per-entity here.
    except Exception:
        filter_entities = None
        _ef_extra_hidden = ([], [])

    # ── Group collapse: count physical devices, not entities. A Switcher
    #    boiler exposes 4 entities (switch + 3 sensors); if all four are
    #    unavailable, that's ONE offline device on the Devices page card —
    #    not four. Use the same grouping the FE renders from.
    primary_by_eid: dict[str, str] = {}   # eid → its group's primary_entity_id
    try:
        from services.device_groups import build_groups, get_cached_registry_async
        import services.device_registry as _dr
        if not _dr._initialized:
            _dr.init()
        from backend.routers.device_router import _enrich_devices_with_ha_state
        enriched = _enrich_devices_with_ha_state(_dr.get_all())
        registry = await get_cached_registry_async()
        for g in build_groups(enriched, registry):
            primary = g.get("primary_entity_id")
            if not primary:
                continue
            for ge in (g.get("entities") or []):
                eid = ge.get("entity_id")
                if eid:
                    primary_by_eid[eid] = primary
    except Exception:
        pass

    offline_all:       list[dict] = []
    offline_with_deps: list[dict] = []
    battery_warnings:  list[dict] = []
    _offline_primaries_seen: set[str] = set()   # dedupe groups → one count per physical device

    for eid, entry in state_cache.items():
        if _entity_should_hide(eid):
            continue

        state = entry.get("state", "")
        attrs = entry.get("attributes", {}) or {}
        name  = attrs.get("friendly_name") or eid.split(".")[-1].replace("_", " ").title()

        # ── Offline detection ────────────────────────────────────────────────
        if state in ("unavailable", "unknown"):
            # When this entity belongs to a multi-entity group, attribute
            # the offline status to the group's primary so the count
            # matches the one-card-per-device rendering. If the primary is
            # itself online, we still surface the sibling so the user can
            # see WHICH sub-sensor is down on the Info tab.
            primary = primary_by_eid.get(eid, eid)
            is_primary_row = primary == eid
            if is_primary_row:
                if primary in _offline_primaries_seen:
                    continue   # already counted via a sibling that hit us first
                _offline_primaries_seen.add(primary)
            else:
                # Sibling offline. Only count it ONCE per group, regardless
                # of how many siblings are unavailable.
                if primary in _offline_primaries_seen:
                    continue
                _offline_primaries_seen.add(primary)

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

    # Last filter pass: drop anything the user has configured to hide on the
    # Devices page (extra_hidden_domains / patterns). _should_hide() above
    # only knows about built-in patterns; this matches the Devices fetch.
    if filter_entities is not None and (_ef_extra_hidden[0] or _ef_extra_hidden[1]):
        try:
            kept = filter_entities(
                [{"entity_id": r["entity_id"]} for r in offline_all],
                extra_hidden_domains=_ef_extra_hidden[0],
                extra_hidden_patterns=_ef_extra_hidden[1],
            )
            kept_ids = {e["entity_id"] for e in kept}
            offline_all       = [r for r in offline_all       if r["entity_id"] in kept_ids]
            offline_with_deps = [r for r in offline_with_deps if r["entity_id"] in kept_ids]
        except Exception:
            pass

    coordinator_warning = len(offline_all) >= 3

    # Discover coordinator entry when warning is active (lazy, cached after first hit)
    coordinator_entry_id = ""
    coordinator_title    = ""
    if coordinator_warning:
        coord = await _discover_coordinator_entry()
        if coord:
            coordinator_entry_id = coord["entry_id"]
            coordinator_title    = coord["title"]

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
    """Reload the Zigbee coordinator integration via HA's homeassistant.reload_config_entry service.

    Supports ZHA, deCONZ, and Zigbee2MQTT. Discovers the entry_id dynamically.
    Safe to call: HA reloads the integration gracefully without device data loss.
    """
    global _coordinator_cache_checked  # allow retry on explicit reload request

    # Always re-discover on an explicit reload request (clears cache so fresh lookup happens)
    _coordinator_cache_checked = False
    coord = await _discover_coordinator_entry()

    if not coord:
        raise ZiggyError(
            code=ErrorCode.NOT_CONFIGURED,
            message=(
                "No Zigbee coordinator was found in the home hub. "
                "Devices may be offline or pairing isn't set up yet."
            ),
            log_message="reload_zigbee: no coordinator entry discovered",
        )

    entry_id = coord["entry_id"]
    title    = coord["title"]

    try:
        from services.home_automation import call_service
        result = call_service("homeassistant", "reload_config_entry", {"entry_id": entry_id})
        if result.get("ok"):
            from core.logger_module import log_info
            log_info(f"[Health] Coordinator reload triggered for entry '{entry_id}' ({title})")
            return {"ok": True, "message": "Reconnecting devices. This may take a moment."}
        raise ZiggyError(
            code=ErrorCode.HA_SERVICE_FAILED,
            message="The home hub couldn't reload the Zigbee coordinator.",
            log_message=f"reload_zigbee: HA returned error: {result.get('message')}",
            details={"entry_id": entry_id, "upstream_message": result.get("message")},
        )
    except ZiggyError:
        raise
    except Exception as e:
        raise ZiggyError(
            code=ErrorCode.HA_UNAVAILABLE,
            log_message=f"reload_zigbee unexpected failure: {type(e).__name__}: {e}",
            details={"entry_id": entry_id, "cause": repr(e)},
            cause=e,
        )


@router.get("/api/health/debug-coordinator")
async def debug_coordinator():
    """Return Zigbee coordinator discovery result for diagnostics."""
    global _coordinator_cache_checked
    _coordinator_cache_checked = False  # force fresh lookup
    coord = await _discover_coordinator_entry()
    # Also return which platforms exist in entity registry
    try:
        from services.ha_areas import _ws
        res, = await _ws({"type": "config/entity_registry/list"})
        entities = res.get("result") or []
        platforms = sorted({e.get("platform") for e in entities if e.get("platform")})
    except Exception:
        platforms = []
    return {
        "coordinator_found": coord,
        "all_entity_platforms": platforms,
    }
