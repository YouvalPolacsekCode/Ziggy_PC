"""Weather facts for automations — "skip the sprinklers if it rains today".

Source: Open-Meteo (free, no key, covers Israel; already used by
services/web_manager for chat weather), for the home's own location (HA
core config — the same coordinates sunrise/sunset use).

Automations get plain yes/no facts, never millimetres to tune:

    rain_yesterday  ≥ 1 mm fell yesterday
    rain_today      ≥ 1 mm today (fallen so far + still expected)
    rain_tomorrow   ≥ 1 mm forecast for tomorrow
    cloudy_today    mean cloud cover ≥ 70 % — a solar water heater won't cope
    max_temp_today  today's high in °C (for "hot day: above X")

1 mm is the cutoff because the model reports a 0.1 mm drizzle as rain, and
under ~1 mm the soil does not get wet.

UNKNOWN IS NOT "NO". When the forecast can't be fetched (or is older than
_STALE_S), every weather condition is NOT met — the same answer HA gives for
the mirrored entity going unavailable (services/weather_mqtt), so the two
evaluators agree. The run log says why ("weather unknown").
"""
from __future__ import annotations

import time
from datetime import date
from typing import Any, Optional

from core.logger_module import log_error, log_info

RAIN_MM = 1.0
CLOUDY_PCT = 70.0
_STALE_S = 6 * 3600

CHECKS = ("rain_yesterday", "rain_today", "rain_tomorrow", "cloudy_today", "hot_today")
BOOL_FACTS = ("rain_yesterday", "rain_today", "rain_tomorrow", "cloudy_today")

_API = "https://api.open-meteo.com/v1/forecast"
_cache: dict[str, Any] = {"at": 0.0, "facts": None, "for_date": None}


def facts_from_open_meteo(payload: dict, today: date) -> Optional[dict]:
    """Pure: Open-Meteo daily payload (past_days=1, forecast_days=2) → facts.

    Rows are matched by date, not position, so a payload that starts a day
    early or late can't silently shift "today" onto "tomorrow".
    """
    daily = (payload or {}).get("daily") or {}
    dates = daily.get("time") or []
    if not dates:
        return None

    def col(name: str, iso: str):
        vals = daily.get(name) or []
        try:
            v = vals[dates.index(iso)]
        except (ValueError, IndexError):
            return None
        return None if v is None else float(v)

    from datetime import timedelta
    d_y, d_t, d_n = (today - timedelta(days=1)).isoformat(), today.isoformat(), (today + timedelta(days=1)).isoformat()
    rain = {k: col("precipitation_sum", d) for k, d in (("y", d_y), ("t", d_t), ("n", d_n))}
    cloud = col("cloud_cover_mean", d_t)
    tmax = col("temperature_2m_max", d_t)
    if rain["t"] is None:
        return None          # no row for today — the payload isn't about today
    return {
        "rain_yesterday": None if rain["y"] is None else rain["y"] >= RAIN_MM,
        "rain_today":     rain["t"] >= RAIN_MM,
        "rain_tomorrow":  None if rain["n"] is None else rain["n"] >= RAIN_MM,
        "cloudy_today":   None if cloud is None else cloud >= CLOUDY_PCT,
        "max_temp_today": tmax,
        "rain_mm":        rain,
        "cloud_pct":      cloud,
    }


def current() -> Optional[dict]:
    """Today's facts, or None when unknown (never fetched, stale, or a new day)."""
    facts = _cache.get("facts")
    if not facts:
        return None
    if time.time() - float(_cache.get("at") or 0) > _STALE_S:
        return None
    if _cache.get("for_date") != date.today().isoformat():
        return None
    return facts


def evaluate(cond: dict, facts: Optional[dict] = None) -> tuple[bool, str]:
    """(passed, reason) for {"type": "weather", "check": ..., "is": bool, "above": °C}."""
    check = str((cond or {}).get("check") or "")
    want = bool((cond or {}).get("is", True))
    if check not in CHECKS:
        return False, f"weather check {check!r} unknown"
    facts = current() if facts is None else facts
    if not facts:
        return False, "weather unknown — forecast unavailable"
    if check == "hot_today":
        tmax = facts.get("max_temp_today")
        try:
            above = float(cond.get("above", 30))
        except (TypeError, ValueError):
            return False, "hot_today needs a number for 'above'"
        if tmax is None:
            return False, "weather unknown — no temperature for today"
        actual = tmax > above
        return actual == want, f"today's high {tmax:.0f}°C {'>' if actual else '≤'} {above:.0f}°C (want {'hot' if want else 'not hot'})"
    actual = facts.get(check)
    if actual is None:
        return False, f"weather unknown — no {check} reading"
    return bool(actual) == want, f"{check}={'yes' if actual else 'no'} (want {'yes' if want else 'no'})"


def invalid_reason(cond: dict) -> Optional[str]:
    check = str((cond or {}).get("check") or "")
    if check not in CHECKS:
        return "Pick what the weather condition should check."
    if check == "hot_today":
        try:
            float(cond.get("above"))
        except (TypeError, ValueError):
            return "Set the temperature for the hot-day condition."
    return None


async def _location() -> tuple[float, float]:
    try:
        from services.ha_config import get_core_location, _is_unset
        loc = await get_core_location()
        if loc and not _is_unset(loc.get("latitude")) and not _is_unset(loc.get("longitude")):
            return float(loc["latitude"]), float(loc["longitude"])
    except Exception as e:
        log_error(f"[Weather] HA location unavailable: {e}")
    from services.ha_config import _default_location
    lat, lon, _ = _default_location()
    return lat, lon


def _fetch(lat: float, lon: float) -> dict:
    import requests
    r = requests.get(_API, timeout=15, params={
        "latitude": lat, "longitude": lon, "timezone": "auto",
        "past_days": 1, "forecast_days": 2,
        "daily": "precipitation_sum,temperature_2m_max,cloud_cover_mean",
    })
    r.raise_for_status()
    return r.json()


async def refresh() -> Optional[dict]:
    """Fetch, cache and mirror today's facts. Never raises."""
    import asyncio
    try:
        lat, lon = await _location()
        payload = await asyncio.to_thread(_fetch, lat, lon)
        today = date.today()
        facts = facts_from_open_meteo(payload, today)
        if not facts:
            raise ValueError("forecast had no row for today")
        _cache.update({"at": time.time(), "facts": facts, "for_date": today.isoformat()})
    except Exception as e:
        log_error(f"[Weather] refresh failed: {e}")
        facts = None
    try:
        from services import weather_mqtt
        weather_mqtt.publish(current())
    except Exception as e:
        log_error(f"[Weather] mirror publish failed: {e}")
    if facts:
        log_info(f"[Weather] rain y/t/n={facts['rain_mm']} cloud={facts['cloud_pct']} max={facts['max_temp_today']}")
    return facts
