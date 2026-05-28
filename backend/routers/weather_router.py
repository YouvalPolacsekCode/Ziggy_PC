"""Weather endpoint — thin wrapper around _weather_fetch in web_manager.

Exposed for the Hub's weather widget. The intent system (`get_weather`) keeps
working as-is; this is a direct REST shortcut so the widget can fetch without
going through intent parsing.

Default city pulled from settings (preserves Israel-first default of "Tel Aviv").
Falls back to the home location when configured.

Cached in-memory for 10 minutes per (city) — Open-Meteo is free but rate-limited,
and a wall tablet refreshing every minute would still get warm cache 90% of the
time.
"""
from __future__ import annotations

import asyncio
import time
from typing import Optional

from fastapi import APIRouter

from core.settings_loader import settings

router = APIRouter()

_CACHE_TTL_S = 10 * 60
_cache: dict[str, tuple[float, dict]] = {}


def _default_city() -> str:
    return (
        settings.get("weather", {}).get("default_city")
        or settings.get("location", {}).get("city")
        or "Tel Aviv"
    )


@router.get("/api/weather")
async def get_weather(city: Optional[str] = None):
    target = (city or _default_city()).strip()
    if not target:
        return {"city": None, "current": None}

    now = time.time()
    hit = _cache.get(target.lower())
    if hit and now - hit[0] < _CACHE_TTL_S:
        return {"cached": True, **hit[1]}

    from services.web_manager import _weather_fetch
    result = await asyncio.to_thread(_weather_fetch, target)
    # _weather_fetch returns {} on geocoding or network failures — passthrough so
    # the frontend can show a clean empty state instead of an error toast.
    out = {"city": target, "current": (result or {}).get("current"), "cached": False}
    _cache[target.lower()] = (now, {"city": target, "current": out["current"]})
    return out
