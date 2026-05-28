"""Onboarding sensor list — Prompt 7 chunk 2.7.

GET /api/onboarding/sensors
    Device-auth (mobile-paired phone). Returns the list the sensor-naming
    wizard step (Chunk 3.2) renders: each pre-paired sensor from the kit
    manifest, joined with HA's device registry so the mobile app shows the
    current name + area alongside the factory-set Hebrew + English intended
    labels.

Why join here and not in the app
--------------------------------
The kit manifest lives on the edge (factory writes /etc/ziggy/kit_manifest.yaml).
The HA registry lives in the local HA instance. The mobile app has no
direct access to either. This endpoint is the only spot in the system
where both are visible — keeping the join here means the app stays
ignorant of HA-specific concepts (device_id, area_id, connections).

Sensors present in the manifest but not yet in HA come back with
paired=False so the wizard can flag a missing sensor (factory imaging
incomplete, sensor battery dead in transit, mesh re-pair needed). Sensors
present in HA but absent from the manifest are NOT returned — the manifest
is the source of truth for "what the kit shipped with."
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends

from backend.routers.mobile_router import get_current_device
from core.logger_module import log_error
from services import ha_areas, kit_manifest


router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


# ── HA device matching ───────────────────────────────────────────────────────

def _normalize_mac(mac: str) -> str:
    """Lowercase, strip separators. Lets us match `00:15:8D:...` against
    HA's `00158d...` or any other variant the integration emits."""
    if not isinstance(mac, str):
        return ""
    return mac.lower().replace(":", "").replace("-", "").replace(" ", "")


def _ha_device_by_mac(devices: list[dict], mac: str) -> Optional[dict]:
    """Find the HA device whose `connections` includes this MAC (any case,
    any separator). Returns None if not found.

    HA's device registry stores Zigbee IEEE addresses in `connections` as
    pairs like ["zigbee", "00:15:8d:00:01:23:45:67"]. The manifest may
    store the same address with or without separators. We normalise both
    sides before comparing.
    """
    needle = _normalize_mac(mac)
    if not needle:
        return None
    for d in devices:
        for conn in d.get("connections") or []:
            if not isinstance(conn, (list, tuple)) or len(conn) < 2:
                continue
            kind, value = conn[0], conn[1]
            if kind in ("zigbee", "mac") and _normalize_mac(str(value)) == needle:
                return d
    return None


# ── Endpoint ────────────────────────────────────────────────────────────────

@router.get("/sensors")
async def get_onboarding_sensors(device: dict = Depends(get_current_device)) -> dict:
    """Return enriched manifest sensors for the wizard.

    Auth: device-token (any paired mobile device can read its own home's
    sensor list).
    """
    manifest_sensors = kit_manifest.get_sensors()

    ha_devices: list[dict] = []
    area_name_by_id: dict[str, str] = {}
    ha_reachable = False
    try:
        snap = await ha_areas.get_registry_snapshot()
        ha_devices = snap.get("devices") or []
        for a in snap.get("areas") or []:
            if "area_id" in a:
                area_name_by_id[a["area_id"]] = a.get("name", "")
        ha_reachable = True
    except Exception as e:
        # HA unreachable mid-onboarding (cold-start window, HA restarting).
        # Return the manifest sensors with paired=False so the wizard can
        # show "still detecting — retry in a moment" rather than 500ing.
        log_error(f"[onboarding_sensors] HA registry fetch failed: {e}")

    enriched: list[dict] = []
    for s in manifest_sensors:
        mac = s.get("zigbee_mac", "")
        ha = _ha_device_by_mac(ha_devices, mac) if mac else None
        entry = {
            "device_type":            s.get("device_type", ""),
            "vendor_model":           s.get("vendor_model", ""),
            "zigbee_mac":             mac,
            "intended_label_he":      s.get("intended_room_label_he", ""),
            "intended_label_en":      s.get("intended_room_label_en", ""),
            "ha_device_id":           None,
            "current_name":           None,
            "current_area_name":      None,
            "paired":                 False,
        }
        if ha is not None:
            entry["ha_device_id"]      = ha.get("id")
            entry["current_name"]      = ha.get("name_by_user") or ha.get("name") or None
            area_id = ha.get("area_id")
            entry["current_area_name"] = area_name_by_id.get(area_id) if area_id else None
            entry["paired"]            = True
        enriched.append(entry)

    return {
        "sensors":         enriched,
        "manifest_loaded": len(manifest_sensors) > 0,
        "ha_reachable":    ha_reachable,
        # ↑ ha_reachable=True iff the HA WebSocket call succeeded (even
        # with an empty list). The wizard uses it to decide between
        # "no sensors found yet, retry" and "no sensors in this kit by
        # design" / "HA is offline right now, retry in a moment".
    }
