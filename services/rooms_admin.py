"""Blank a home's rooms — delete all HA areas + clear device-registry room
assignments, so a hub opens as a clean slate.

Two callers share this one implementation:
  1. The in-app "reset home" action (POST /api/rooms/reset, super_admin).
  2. The factory ship gate (scripts/factory/kit-ready-check.sh) runs it as
     `python -m services.rooms_admin` inside the ziggy container, so a handed-
     over box never carries leftover rooms from setup/testing. It runs pre-owner
     (no auth) — it talks to HA with the container's HA_URL/HA_TOKEN and edits
     the local device_registry.json.

Rooms are HA areas; the customer builds their own during/after onboarding. This
does NOT delete devices — only their room placement.
"""
from __future__ import annotations

import asyncio

from services import ha_areas, device_registry
from core.logger_module import log_error, log_info


async def reset_all_rooms() -> dict:
    """Delete every HA area and clear every device's room assignment.

    Returns {areas_deleted, areas_failed, devices_cleared, areas_total}.
    Best-effort: a per-area delete failure is reported, not raised.
    """
    area_res = await ha_areas.delete_all_areas()
    devices_cleared = device_registry.clear_all_room_assignments()
    result = {
        "areas_deleted":   area_res.get("deleted", 0),
        "areas_total":     area_res.get("total", 0),
        "areas_failed":    area_res.get("failed", []),
        "devices_cleared": devices_cleared,
    }
    log_info(
        f"[rooms_admin] reset_all_rooms: deleted {result['areas_deleted']}/"
        f"{result['areas_total']} HA areas, cleared {devices_cleared} device "
        f"room assignment(s)"
    )
    return result


def _main() -> int:
    """CLI entrypoint for the factory ship gate. Exit 0 only if the home is
    verifiably blank afterwards (zero areas remain), else 1 so the gate fails."""
    try:
        device_registry.init()
    except Exception as e:
        log_error(f"[rooms_admin] registry init failed (continuing): {e}")
    res = asyncio.run(reset_all_rooms())
    remaining = res["areas_total"] - res["areas_deleted"]
    print(
        f"rooms reset: areas_deleted={res['areas_deleted']}/{res['areas_total']} "
        f"devices_cleared={res['devices_cleared']} "
        f"areas_failed={len(res['areas_failed'])}"
    )
    if remaining > 0 or res["areas_failed"]:
        print(f"ERROR: {remaining} area(s) still present after reset — home NOT blank")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
