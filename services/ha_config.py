"""Home Assistant core-config (home location) management.

HA's sun / sunrise-sunset / weather all depend on core-config latitude &
longitude. A freshly-imaged hub onboards HA WITHOUT a location, so it sits at
0,0 (the Gulf of Guinea) and every sun-based automation misfires — schedules
run at the wrong time, "at sunset" never lines up with reality. Ziggy owns this:

  * on startup, `ensure_home_location()` sets a sensible default if HA has no
    real location yet (covers imaging automatically, since the Ziggy container
    starts after ha-seed onboards HA — and self-heals existing hubs on restart);
  * the onboarding location step pushes the user's ACTUAL home coordinates in
    via `set_core_location()`, refining the default.

It never overrides a location that's already set — the default is only a floor.
"""
from __future__ import annotations

import asyncio

from core.logger_module import log_info, log_error
from core.settings_loader import settings

# Israel-first default (Tel Aviv). Vastly better than 0,0 until onboarding sets
# the user's real coordinates. Override via settings `home.location`.
_DEFAULT_LAT = 32.0853
_DEFAULT_LON = 34.7818
_DEFAULT_ELEV = 10
_DEFAULT_TZ = "Asia/Jerusalem"


async def get_core_location() -> dict | None:
    """Read HA's current core-config location, or None if HA is unreachable."""
    try:
        from services.home_automation import _ha_url, _headers
        import requests
        resp = requests.get(f"{_ha_url()}/api/config", headers=_headers(), timeout=5)
        if resp.ok:
            c = resp.json()
            return {
                "latitude":  c.get("latitude"),
                "longitude": c.get("longitude"),
                "elevation": c.get("elevation"),
                "time_zone": c.get("time_zone"),
            }
    except Exception as e:
        log_error(f"[HAConfig] get_core_location: {e}")
    return None


async def set_core_location(lat: float, lon: float,
                            elevation: int | None = None,
                            time_zone: str | None = None) -> dict:
    """Set HA's core-config location via the WS config/core/update command."""
    from services.ha_areas import _ws
    cmd: dict = {"type": "config/core/update", "latitude": float(lat), "longitude": float(lon)}
    if elevation is not None:
        cmd["elevation"] = int(elevation)
    if time_zone:
        cmd["time_zone"] = time_zone
    try:
        res, = await _ws(cmd)
        if res.get("success"):
            log_info(f"[HAConfig] HA location set -> {lat},{lon}")
            return {"ok": True}
        return {"ok": False, "error": (res.get("error") or {}).get("message", "unknown")}
    except Exception as e:
        log_error(f"[HAConfig] set_core_location: {e}")
        return {"ok": False, "error": str(e)}


def _default_location() -> tuple[float, float, int]:
    loc = (settings.get("home") or {}).get("location") or {}
    return (
        float(loc.get("latitude", _DEFAULT_LAT)),
        float(loc.get("longitude", _DEFAULT_LON)),
        int(loc.get("elevation", _DEFAULT_ELEV)),
    )


def _is_unset(v) -> bool:
    return v is None or (isinstance(v, (int, float)) and abs(v) < 1e-6)


async def ensure_home_location(retries: int = 6, delay: float = 5.0) -> None:
    """If HA has no real location (0,0 / unset), set the configured default.

    Idempotent — never touches a location that's already real (so a hub the user
    has located, or onboarding has set, is left alone). Retries a few times so a
    just-imaged / just-booted HA that isn't ready yet still gets located.
    """
    cur = None
    for _ in range(max(1, retries)):
        cur = await get_core_location()
        if cur is not None:
            break
        await asyncio.sleep(delay)
    if cur is None:
        log_info("[HAConfig] HA unreachable during location check; will retry on next start")
        return
    if not (_is_unset(cur.get("latitude")) and _is_unset(cur.get("longitude"))):
        return  # already located — leave it
    lat, lon, elev = _default_location()
    tz = cur.get("time_zone") or _DEFAULT_TZ
    res = await set_core_location(lat, lon, elev, tz)
    if res.get("ok"):
        log_info(f"[HAConfig] HA location was unset (0,0) — applied default {lat},{lon}")
    else:
        log_error(f"[HAConfig] failed to set default location: {res.get('error')}")
