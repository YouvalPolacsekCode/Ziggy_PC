from __future__ import annotations
from core.intent_utils import ok, err
from core.result_utils import L
from services import web_manager


async def handle_recipe_read(params: dict, *, source: str = "unknown") -> dict:
    return web_manager.read_recipe_from_url(
        input_text=params.get("input_text", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_news_brief(params: dict, *, source: str = "unknown") -> dict:
    return web_manager.show_news_brief(
        device_hint=params.get("device_hint"),
        voice=bool(params.get("voice", True)),
    )


async def handle_trip_updates(params: dict, *, source: str = "unknown") -> dict:
    return web_manager.trip_updates(city_or_route=params.get("city_or_route", ""))


async def handle_stocks_update(params: dict, *, source: str = "unknown") -> dict:
    return web_manager.stocks_update(
        tickers=params.get("tickers", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_web_search(params: dict, *, source: str = "unknown") -> dict:
    return web_manager.web_search_and_summary(
        query=params.get("query", ""),
        device_hint=params.get("device_hint"),
    )


async def handle_get_weather(params: dict, *, source: str = "unknown") -> dict:
    city = (params.get("city") or params.get("location") or "").strip()
    if not city:
        return err(L("Please specify a city for the weather.", "אנא ציינו עיר עבור מזג האוויר."))
    wx = web_manager._weather_fetch(city)
    if not wx:
        return err(L(f"Couldn't fetch weather for '{city}'.", f"לא הצלחתי לקבל מזג אוויר עבור '{city}'."))
    current = wx.get("current") or {}
    temp = current.get("temperature")
    wind = current.get("windspeed")
    wcode = current.get("weathercode")
    msg = L(f"Weather in {city}: {temp}°C", f"מזג האוויר ב{city}: {temp}°C")
    if wind is not None:
        msg += L(f", wind {wind} km/h", f", רוח {wind} קמ\"ש")
    return ok(msg, data=wx)


HANDLERS = {
    "web_recipe_read": handle_recipe_read,
    "web_news_brief": handle_news_brief,
    "web_trip_updates": handle_trip_updates,
    "web_stocks_update": handle_stocks_update,
    "web_search_summary": handle_web_search,
    "get_weather": handle_get_weather,
}
