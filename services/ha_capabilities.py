"""
HA capability mirror.

Pulls the full Home Assistant service catalog and exposes — per device — the
list of commands HA can deliver, in a Ziggy-shaped form. The user never sees
HA service names; the frontend renders Ziggy controls from this metadata.

Cache strategy:
  - Lazy first fetch (on first call to commands_for_entity / get_catalog).
  - TTL refresh (default 5 min) on next call after expiry.
  - Manual `invalidate()` lets pairing flows force a re-pull when a new
    integration just came online.

Why TTL rather than HA event subscription: subscribe_events for
service_registered/service_removed would be cleaner, but HA's service
registry is small and rarely changes — a periodic pull keeps this module
free of long-lived WS state and avoids contending with ha_subscriber.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from core.logger_module import log_info, log_error

_CATALOG_TTL_S = 300  # 5 minutes — service registry is near-static

# Cached HA service catalog. Shape mirrors HA's `get_services` result:
# { domain: { service_name: { name, description, fields, target } } }
_catalog: dict[str, dict] = {}
_catalog_fetched_at: float = 0.0
# When HA WS times out, skip refresh attempts for this many seconds so each
# device-page load doesn't pay another 5s timeout while HA is unreachable.
_HA_DOWN_COOLDOWN_S = 30.0
_last_ha_failure_at: float = 0.0


def invalidate() -> None:
    """Drop the cache so the next read re-pulls from HA. Call this after a
    config-flow completes so new services appear immediately."""
    global _catalog, _catalog_fetched_at
    _catalog = {}
    _catalog_fetched_at = 0.0


async def _fetch_services_ws() -> dict[str, dict]:
    """Fetch HA's full service registry via WebSocket."""
    from services.ha_areas import _ws
    res, = await _ws({"type": "get_services"})
    if not res.get("success"):
        raise RuntimeError(f"get_services failed: {res.get('error')}")
    return res.get("result") or {}


def _catalog_fresh() -> bool:
    return _catalog and (time.time() - _catalog_fetched_at) < _CATALOG_TTL_S


def _ensure_catalog(force: bool = False) -> None:
    """Refresh the service catalog if missing or stale.

    Safe to call from sync code: opens a private event loop if needed so
    callers don't have to await."""
    global _catalog, _catalog_fetched_at
    if not force and _catalog_fresh():
        return
    try:
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # We're inside an async context — caller should have awaited
                # _fetch_services_ws() directly; we can't run another loop here.
                # Fall through and return stale cache.
                return
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        new_loop = asyncio.new_event_loop()
        try:
            services = new_loop.run_until_complete(_fetch_services_ws())
        finally:
            new_loop.close()
        _catalog = services
        _catalog_fetched_at = time.time()
        log_info(f"[HACapabilities] Loaded {sum(len(v) for v in services.values())} services across {len(services)} domains")
    except Exception as e:
        log_error(f"[HACapabilities] catalog refresh failed: {e}")


async def ensure_catalog_async(force: bool = False) -> None:
    """Async version for callers already inside an event loop.

    Hard timeout + circuit breaker: if HA's WS is unresponsive, we'd otherwise
    block every /api/devices/X/commands request for 5s. After one failure, we
    skip new attempts for _HA_DOWN_COOLDOWN_S so device pages render
    immediately (with empty More Commands). When HA recovers, the next call
    after the cooldown re-tries and re-populates.
    """
    global _catalog, _catalog_fetched_at, _last_ha_failure_at
    if not force and _catalog_fresh():
        return
    # Circuit-break: if a recent attempt failed, don't pile on more 5s waits.
    if (time.time() - _last_ha_failure_at) < _HA_DOWN_COOLDOWN_S:
        return
    try:
        services = await asyncio.wait_for(_fetch_services_ws(), timeout=5.0)
        _catalog = services
        _catalog_fetched_at = time.time()
        _last_ha_failure_at = 0.0
        log_info(f"[HACapabilities] Loaded {sum(len(v) for v in services.values())} services across {len(services)} domains")
    except asyncio.TimeoutError:
        _last_ha_failure_at = time.time()
        log_error("[HACapabilities] catalog refresh timed out (HA WS unresponsive) — circuit-breaking for 30s")
    except Exception as e:
        _last_ha_failure_at = time.time()
        log_error(f"[HACapabilities] catalog refresh failed: {e}")


# ───────────────────────── selector translation ─────────────────────────

# Map HA selector types to Ziggy's UI atom kinds. The frontend dynamic-command
# renderer reads `kind` and picks the matching component.
_SELECTOR_TO_KIND = {
    "number":   "number",
    "select":   "select",
    "boolean":  "boolean",
    "time":     "time",
    "datetime": "datetime",
    "duration": "duration",
    "text":     "text",
    "entity":   "entity",
    "area":     "area",
    "color_rgb": "color",
    "color_temp": "color_temp",
    "object":   "json",
    # Fallthrough: anything we don't recognize is rendered as freeform text/JSON
}


def _translate_field(field_name: str, field_def: dict) -> dict | None:
    """Convert one HA service field schema into a Ziggy form-field descriptor.

    Returns None for fields we deliberately hide (e.g. entity_id when it's
    bound by the device context).
    """
    if field_name == "entity_id":
        return None

    selector = (field_def.get("selector") or {})
    if not selector:
        # Best-effort fallback when HA doesn't declare a selector
        kind = "text"
        meta: dict[str, Any] = {}
    else:
        sel_key = next(iter(selector.keys()), "text")
        kind = _SELECTOR_TO_KIND.get(sel_key, "text")
        meta = selector.get(sel_key) or {}

    return {
        "name": field_name,
        "kind": kind,
        "label": (field_def.get("name") or field_name).replace("_", " ").title(),
        "description": field_def.get("description") or "",
        "required": bool(field_def.get("required")),
        "default": field_def.get("default"),
        "min": meta.get("min"),
        "max": meta.get("max"),
        "step": meta.get("step"),
        "unit": meta.get("unit_of_measurement"),
        "options": meta.get("options"),
        "mode": meta.get("mode"),  # 'slider' vs 'box' for numbers
    }


# ───────────────────────── per-device command list ─────────────────────────

def _supported_features(entity_id: str) -> int:
    """Read the HA `supported_features` attribute from the live state cache."""
    try:
        from services.ha_subscriber import state_cache
        return int((state_cache.get(entity_id) or {}).get("attributes", {}).get("supported_features") or 0)
    except Exception:
        return 0


def _entity_attrs(entity_id: str) -> dict:
    try:
        from services.ha_subscriber import state_cache
        return (state_cache.get(entity_id) or {}).get("attributes") or {}
    except Exception:
        return {}


# Domain-specific extras. Each entry can add bound vendor services that
# don't live under the entity's own domain. HA's Switcher integration
# registers its services under `switcher_kis`, not `switcher` — the
# integration domain, not the manufacturer name.
# Extend this map when adding more vendors (shelly, esphome, …).
_DOMAIN_EXTRA_SERVICE_DOMAINS = {
    "water_heater": ["switcher_kis"],
    "switch":       ["switcher_kis"],
    "cover":        ["switcher_kis"],
    "climate":      ["switcher_kis"],
}


# Vendor-domain entity-id prefixes. Used to filter cross-domain services so a
# generic switch (TP-Link, Shelly, etc.) doesn't see Switcher-only services
# in its "More Commands" panel. HA's service target metadata includes the
# `integration` restriction but we don't have entity-registry source data
# readily available; the entity_id prefix is a robust proxy in practice.
_VENDOR_PREFIXES = {
    "switcher_kis": ("switch.switcher_", "sensor.switcher_", "cover.switcher_", "climate.switcher_", "light.switcher_"),
}


def _candidate_domains(entity_id: str) -> list[str]:
    """Which HA service domains may apply to this entity."""
    if not entity_id or "." not in entity_id:
        return []
    primary = entity_id.split(".", 1)[0]
    extras = _DOMAIN_EXTRA_SERVICE_DOMAINS.get(primary, [])
    # homeassistant.* is universal (turn_on/turn_off/toggle/reload)
    return [primary, "homeassistant"] + extras


# Service-level feature-bit gates. Each entry: (domain, service) → bit on
# HA's supported_features that must be set for the service to be applicable.
# Sparse — only filled where omitting it would surface non-functional buttons.
# Maps to HA's documented feature bitmasks at https://developers.home-assistant.io.
_FEATURE_BIT_GATES = {
    ("climate", "set_temperature"):       1,    # SUPPORT_TARGET_TEMPERATURE
    ("climate", "set_humidity"):          8,    # SUPPORT_TARGET_HUMIDITY
    ("climate", "set_fan_mode"):          8 if False else 8,  # placeholder
    ("media_player", "volume_set"):       4,    # VOLUME_SET
    ("media_player", "media_next_track"): 32,
    ("media_player", "media_previous_track"): 16,
    ("media_player", "select_source"):    2048,
    ("cover", "set_cover_position"):      4,
    ("light", "turn_on"):                 0,    # always available
}


def _is_supported(domain: str, service: str, entity_id: str) -> bool:
    """Cheap pre-filter: drop services that obviously don't apply to the entity.

    Two filters apply:
      1. HA `supported_features` bitmask (when documented for this service).
      2. Vendor entity-id prefix (only Switcher entities see switcher_kis.*).
    """
    # Vendor restriction — switcher_kis services only apply to switcher entities
    prefixes = _VENDOR_PREFIXES.get(domain)
    if prefixes is not None:
        if not any(entity_id.startswith(p) for p in prefixes):
            return False

    bit = _FEATURE_BIT_GATES.get((domain, service))
    if bit is None or bit == 0:
        return True
    return bool(_supported_features(entity_id) & bit)


def commands_for_entity(entity_id: str) -> list[dict]:
    """Return the Ziggy-shaped command list for an HA entity.

    Each command:
      {
        "id": "<domain>.<service>",     # stable across calls; passed back when executing
        "domain": "<domain>",
        "service": "<service>",
        "label": "<human-readable verb>",
        "description": "<service description>",
        "fields": [ <field descriptor>, ... ],   # ordered, omit entity_id
        "target_domain": "<primary entity domain>",
      }

    Cached service catalog is fetched lazily if missing or stale.
    """
    if not entity_id or "." not in entity_id:
        return []
    _ensure_catalog()
    if not _catalog:
        return []

    primary_domain = entity_id.split(".", 1)[0]
    result: list[dict] = []
    seen: set[str] = set()

    for domain in _candidate_domains(entity_id):
        services = _catalog.get(domain) or {}
        for service, defn in services.items():
            cmd_id = f"{domain}.{service}"
            if cmd_id in seen:
                continue
            seen.add(cmd_id)
            if not _is_supported(domain, service, entity_id):
                continue

            # Build field list, drop entity_id (bound by device context)
            fields_def = defn.get("fields") or {}
            fields: list[dict] = []
            for fname, fdef in fields_def.items():
                translated = _translate_field(fname, fdef)
                if translated:
                    fields.append(translated)

            label = (defn.get("name") or service).strip() or service.replace("_", " ").title()
            result.append({
                "id": cmd_id,
                "domain": domain,
                "service": service,
                "label": label,
                "description": (defn.get("description") or "").strip(),
                "fields": fields,
                "target_domain": primary_domain,
            })

    # Sort: same-domain first, then helpful verbs (turn_on, turn_off) up top.
    _PRIORITY = {"turn_on": 0, "turn_off": 1, "toggle": 2}

    def _sort_key(c: dict):
        same = 0 if c["domain"] == primary_domain else 1
        prio = _PRIORITY.get(c["service"], 99)
        return (same, prio, c["service"])

    result.sort(key=_sort_key)
    return result


def get_catalog() -> dict[str, dict]:
    """Return the raw cached HA service catalog (refresh if stale)."""
    _ensure_catalog()
    return dict(_catalog)
