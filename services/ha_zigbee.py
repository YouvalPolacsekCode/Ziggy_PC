"""
Zigbee helpers — stack-agnostic interface over ZHA or Zigbee2MQTT.

Replaces the older ha_zha module. `start_permit_join` dispatches to the
active Zigbee stack on this HA instance; everything else (device
registry list, rename, entity lookup) goes through HA's device registry
which is the same regardless of which stack populated it.

Stack selection precedence (`detect_stack`):
  1. ZIGGY_ZIGBEE_STACK env var ('zha' | 'z2m' | 'zigbee2mqtt'), if set
  2. Auto-detect from HA's config_entries (prefers z2m when ZHA absent)
  3. Fallback 'zha' — matches historical behavior on hubs that haven't
     yet switched

Why permit-join needs stack dispatch but the registry calls don't:
ZHA's permit is an HA service call (`zha.permit`). Z2M's permit is an
MQTT publish to `zigbee2mqtt/bridge/request/permit_join`. HA never
exposes a Z2M permit service of its own.
"""
from __future__ import annotations

import os
from typing import Literal, Optional

from services.ha_areas import _ws
from services.mqtt_client import publish as mqtt_publish
from core.logger_module import log_error


Stack = Literal["zha", "z2m"]

_FORCED_RAW = os.environ.get("ZIGGY_ZIGBEE_STACK", "").strip().lower()
_DETECTED: Optional[Stack] = None


def _forced_stack() -> Optional[Stack]:
    if _FORCED_RAW in ("zha",):
        return "zha"
    if _FORCED_RAW in ("z2m", "zigbee2mqtt"):
        return "z2m"
    return None


async def detect_stack(force_refresh: bool = False) -> Stack:
    """Return the active Zigbee stack on this HA instance. Cached per process.

    Override with env var ZIGGY_ZIGBEE_STACK if a user wants to force the
    selection (e.g. transient cut-over states where both ZHA and Z2M are
    installed and we want to be explicit).
    """
    global _DETECTED
    forced = _forced_stack()
    if forced is not None:
        return forced
    if _DETECTED is not None and not force_refresh:
        return _DETECTED
    try:
        res, = await _ws({"type": "config_entries/get"})
        domains = {(c or {}).get("domain") for c in (res.get("result") or [])}
        if "zha" in domains:
            _DETECTED = "zha"
        elif "zigbee2mqtt" in domains:
            _DETECTED = "z2m"
        elif "mqtt" in domains:
            # MQTT alone (with no zigbee2mqtt entry) means HA has the
            # broker integration but Z2M isn't surfaced via a config flow.
            # That's the Z2M-as-discovery-only mode — still Z2M.
            _DETECTED = "z2m"
        else:
            _DETECTED = "zha"
        return _DETECTED
    except Exception as e:
        log_error(f"[zigbee] detect_stack failed, defaulting to zha: {e}")
        return "zha"


# ---------------------------------------------------------------------------
# Permit-join — stack-dispatched
# ---------------------------------------------------------------------------

async def start_permit_join(duration: int = 60) -> dict:
    """Open the Zigbee network for `duration` seconds. Dispatches by stack."""
    stack = await detect_stack()
    if stack == "z2m":
        return await _z2m_permit(duration)
    return await _zha_permit(duration)


async def _zha_permit(duration: int) -> dict:
    try:
        res, = await _ws({
            "type": "call_service",
            "domain": "zha",
            "service": "permit",
            "service_data": {"duration": duration},
        })
        if res.get("success"):
            return {"ok": True, "stack": "zha"}
        err = (res.get("error") or {}).get("message", "ZHA not available or not configured")
        return {"ok": False, "error": err, "stack": "zha"}
    except Exception as e:
        log_error(f"[zigbee] zha permit: {e}")
        return {"ok": False, "error": str(e), "stack": "zha"}


async def _z2m_permit(duration: int) -> dict:
    """Open Z2M permit-join via MQTT bridge request.

    Z2M subscribes to `zigbee2mqtt/bridge/request/permit_join` with
    payload {"value": true, "time": <seconds>}. The bridge auto-closes
    after `time` seconds — no follow-up publish needed.
    """
    try:
        await mqtt_publish(
            "zigbee2mqtt/bridge/request/permit_join",
            {"value": True, "time": duration},
        )
        return {"ok": True, "stack": "z2m"}
    except Exception as e:
        log_error(f"[zigbee] z2m permit: {e}")
        return {"ok": False, "error": str(e), "stack": "z2m"}


# ---------------------------------------------------------------------------
# Device registry — stack-agnostic (HA wraps both stacks behind one registry)
# ---------------------------------------------------------------------------

async def get_devices() -> list:
    """Return all devices from HA device registry."""
    try:
        res, = await _ws({"type": "config/device_registry/list"})
        devices = res.get("result") or []
        return [
            {
                "id": d["id"],
                "name": d.get("name_by_user") or d.get("name") or d["id"],
                "manufacturer": d.get("manufacturer"),
                "model": d.get("model"),
                "area_id": d.get("area_id"),
            }
            for d in devices
        ]
    except Exception as e:
        log_error(f"[zigbee] get_devices: {e}")
        return []


async def get_device_entities(device_id: str) -> list[str]:
    """Return entity_ids belonging to a specific device."""
    try:
        res, = await _ws({"type": "config/entity_registry/list"})
        entities = res.get("result") or []
        return [e["entity_id"] for e in entities if e.get("device_id") == device_id]
    except Exception as e:
        log_error(f"[zigbee] get_device_entities: {e}")
        return []


async def rename_device(device_id: str, name: str) -> dict:
    """Set a user-friendly name on an HA device."""
    try:
        res, = await _ws({
            "type": "config/device_registry/update",
            "device_id": device_id,
            "name_by_user": name,
        })
        if res.get("success"):
            return {"ok": True}
        err = (res.get("error") or {}).get("message", "Unknown error")
        return {"ok": False, "error": err}
    except Exception as e:
        log_error(f"[zigbee] rename_device: {e}")
        return {"ok": False, "error": str(e)}
