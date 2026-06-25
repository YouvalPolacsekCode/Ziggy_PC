"""
/api/health — structured system health snapshot.

GET  /api/health                       — live health state (cheap, reads in-memory cache only)
POST /api/health/reload-zigbee         — reload the Zigbee coordinator integration via HA services
POST /api/health/recover               — user-tapped Retry: re-check + reload-if-needed, no cooldown
POST /api/health/acknowledge-offline   — user-tapped "It's OK, I know" on 50–80% device-offline warning

Legacy fields (kept for backwards-compat with older FE caches):
  ha_connected          bool   — HA WebSocket is authenticated and live
  offline_count         int    — physical devices currently reporting unavailable/unknown
  offline_with_deps     list   — devices that are offline AND used by enabled automations
  battery_warnings      list   — devices / sensors reporting battery < threshold
  coordinator_warning   bool   — ≥3 physical devices offline simultaneously
  coordinator_title     str    — friendly name of the coordinator integration
  coordinator_entry_id  str    — config entry id used by the reload endpoint (empty = not found)

NEW layered field:
  system_health         dict   — structured failure model produced by services.ha_health
                                 (level / primary / ha / zigbee / devices / recovery / ack).
                                 The Dashboard banner renders off this; the legacy fields above
                                 stay populated so the existing flag-based UI keeps working.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Body, Depends

from core.debug_bus import bus as _dbus, BASIC
from core.errors import ErrorCode, ZiggyError
from .auth_deps import require_role

router = APIRouter()

# Bucket-B promotions in PROMPT_SECURITY_HARDENING_V2:
# - reload-zigbee restarts the Zigbee coordinator integration. Structural.
# - debug-coordinator is a diagnostic; admin tier matches the rest of the
#   debug surface (debug_router is super_admin; this lower-tier diagnostic
#   stays admin per the kit-shape rubric — the kit owner needs it).
# Per-handler emits with auth_added=True populate the 30-day audit window.

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

    Fallback path: Z2M deployed as an HA add-on (the canonical setup post
    ZHA→Z2M cut-over) publishes via MQTT discovery, so its entities have
    platform="mqtt" — not "zigbee2mqtt". The standard scan misses them.
    When the standard scan finds nothing, look explicitly for the Z2M
    bridge's connection-state entity (a guaranteed-present indicator
    auto-published by Z2M on startup) and report its MQTT config entry
    as the coordinator.
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
        # Z2M-as-HA-add-on fallback. The bridge connection-state entity is the
        # one Z2M always publishes — independent of any device having been
        # paired — so its absence cleanly means "no Z2M either."
        if not best_entry_id:
            z2m_bridge = next(
                (e for e in entities
                 if e.get("entity_id") == "binary_sensor.zigbee2mqtt_bridge_connection_state"),
                None,
            )
            if z2m_bridge and z2m_bridge.get("config_entry_id"):
                best_entry_id = z2m_bridge["config_entry_id"]
                best_platform = "zigbee2mqtt"
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

    # ── Layered system_health (new) ──────────────────────────────────────────
    # Always computed (cheap when HA is healthy: returns the LEVEL_OK shape).
    # The recovery state machine + cached coordinator query live inside
    # services.ha_health, so this call is non-blocking even when HA is down.
    try:
        from services import ha_health
        offline_primary_ids: set[str] = {r["entity_id"] for r in offline_all}
        # `_offline_primaries_seen` already collapsed multi-entity groups, so
        # primary IDs are the right denominator alongside the group count.
        # We approximate total_devices by the group count we built above; if
        # device_groups wasn't available, fall back to "0" so share thresholds
        # are skipped (compute() guards on MIN_DEVICES_FOR_SHARE).
        total_devices = len(primary_by_eid) if primary_by_eid else 0
        coord_state_obj = (await ha_health.fetch_coordinator_state()) if ha_connected else None
        system_health = ha_health.compute_system_health(
            ha_connected=ha_connected,
            offline_primary_ids=offline_primary_ids,
            total_devices=total_devices,
            coordinator=coord_state_obj,
        )
    except Exception as e:
        # Never let system_health computation crash the whole /api/health
        # response — the legacy fields above are still useful by themselves.
        from core.logger_module import log_error
        log_error(f"[Health] system_health compute failed: {e}")
        system_health = None

    return {
        "ha_connected":         ha_connected,
        "offline_count":        len(offline_all),
        "offline_devices":      offline_all[:20],
        "offline_with_deps":    offline_with_deps[:10],
        "battery_warnings":     sorted(battery_warnings, key=lambda x: x["battery"])[:10],
        "coordinator_warning":  coordinator_warning,
        "coordinator_entry_id": coordinator_entry_id,
        "coordinator_title":    coordinator_title,
        "system_health":        system_health,
    }


@router.post("/api/health/reload-zigbee")
async def reload_zigbee(_user: dict = Depends(require_role("admin"))):
    """Reload the Zigbee coordinator integration via HA's homeassistant.reload_config_entry service.

    Supports ZHA, deCONZ, and Zigbee2MQTT. Discovers the entry_id dynamically.
    Safe to call: HA reloads the integration gracefully without device data loss.
    """
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/health/reload-zigbee",
               user=_user.get("username"), auth_added=True)
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


@router.post("/api/health/recover")
async def health_recover(_user: dict = Depends(require_role("admin"))):
    """User-tapped 'Retry' on the system-health banner.

    Re-checks the coordinator state, runs ONE reload attempt if unhealthy
    (bypassing the auto-recovery cooldown — this is an explicit user ask),
    and returns the latest health snapshot.
    """
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/health/recover",
               user=_user.get("username"), auth_added=True)
    from services import ha_health
    try:
        result = await ha_health.trigger_recover_now()
        return result
    except Exception as e:
        raise ZiggyError(
            code=ErrorCode.HA_UNAVAILABLE,
            log_message=f"health_recover failed: {type(e).__name__}: {e}",
            cause=e,
        )


@router.post("/api/health/acknowledge-offline")
async def health_acknowledge_offline(
    payload: dict | None = Body(default=None),
    _user: dict = Depends(require_role("admin")),
):
    """User-tapped 'It's OK, I know' on the 50–80% devices-offline warning.

    Body: {"offline_ids": ["light.x", "switch.y", ...]}
    If absent, the server uses the current offline primary set as the snapshot.
    The acknowledgement is invalidated automatically when (a) new devices go
    offline beyond this set, or (b) overall offline share crosses 80%.
    """
    payload = payload or {}
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/health/acknowledge-offline",
               user=_user.get("username"), auth_added=True)
    from services import ha_health
    offline_ids = set(payload.get("offline_ids") or [])
    if not offline_ids:
        # Fall back to whatever the current offline set is — single round-trip
        # UX. The FE can pass an explicit list when it wants snapshot-by-id.
        try:
            from services.ha_subscriber import state_cache
            from services.entity_filter import _should_hide as _eh
            offline_ids = {
                eid for eid, e in state_cache.items()
                if not _eh(eid) and (e.get("state") in ("unavailable", "unknown"))
            }
        except Exception:
            pass
    return ha_health.acknowledge_offline(offline_ids)


@router.get("/api/health/debug-coordinator")
async def debug_coordinator(_user: dict = Depends(require_role("admin"))):
    """Return Zigbee coordinator discovery result for diagnostics."""
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="GET /api/health/debug-coordinator",
               user=_user.get("username"), auth_added=True)
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
