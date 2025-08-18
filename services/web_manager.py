# services/web_manager.py
from __future__ import annotations

import os
import re
from typing import Optional, Dict, Any, List
import requests
import feedparser
import yfinance as yf
import trafilatura

from core.logger_module import log_info, log_error
from core.settings_loader import settings
import os
import requests
from core.logger_module import log_info, log_error

def _serpapi_key() -> str | None:
    # prefer .env, allow settings.yaml too if you added it
    from core.settings_loader import settings
    return os.getenv("SERPAPI_API_KEY") or settings.get("serpapi", {}).get("api_key")

# ---------- Public Scenarios ----------

def read_recipe_from_url(input_text: str, device_hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch a recipe from a URL (or find a URL in free text), parse it, and summarize for voice.

    Args:
        input_text: Text possibly containing a URL.
        device_hint: Optional cast/display target.

    Returns:
        Standard result dict.
    """
    url = _extract_url(input_text)
    if not url:
        return {"ok": False, "message": "No URL found in input.", "data": {}}
    html = _fetch_webpage(url)
    if not html:
        return {"ok": False, "message": "Failed to fetch page.", "data": {"url": url}}
    recipe = _recipe_parse(html)
    if not recipe.get("ok"):
        return recipe
    voice = _summarize_recipe_for_voice(recipe["data"])
    _optional_cast_text_or_view(device_hint, voice)
    return {"ok": True, "message": "Recipe ready.", "data": {"url": url, "voice": voice, "recipe": recipe["data"]}}


def show_news_brief(device_hint: Optional[str] = None, voice: bool = True) -> Dict[str, Any]:
    """
    Aggregate RSS and present a short brief.

    Args:
        device_hint: Optional display/speaker target.
        voice: If True, format for TTS.

    Returns:
        Standard result dict.
    """
    feeds = settings.get("news", {}).get("rss_sources", [])
    items = _news_fetch_feeds(feeds)
    brief = _news_summarize(items)
    _optional_cast_text_or_view(device_hint, brief)
    return {"ok": True, "message": "News brief ready.", "data": {"items": items, "summary": brief, "voice": voice}}


def trip_updates(city_or_route: str) -> Dict[str, Any]:
    """
    Provide quick travel/weather context for a city or route.

    TODO:
      - Integrate route or flight APIs (GraphHopper, FlightAware) if needed.

    Args:
        city_or_route: City (e.g., 'Tel Aviv') or 'A -> B'.

    Returns:
        Standard result dict.
    """
    if "->" in city_or_route or "-" in city_or_route:
        # Basic stub for route
        return _todo("Route updates need a travel API (e.g., GraphHopper). Configure key in .env and implement.")
    wx = _weather_fetch(city_or_route)
    return {"ok": bool(wx), "message": "Trip update." if wx else "Weather not available.", "data": {"weather": wx}}


def stocks_update(tickers: str | List[str], device_hint: Optional[str] = None) -> Dict[str, Any]:
    """
    Fetch and summarize stock quotes.

    Args:
        tickers: CSV string or list of symbols.
        device_hint: Optional display target.

    Returns:
        Standard result dict.
    """
    syms = [s.strip().upper() for s in (tickers.split(",") if isinstance(tickers, str) else tickers) if s.strip()]
    if not syms:
        return {"ok": False, "message": "No tickers provided.", "data": {}}
    quotes = _stocks_fetch_quotes(syms)
    summary = _stocks_format_summary(quotes)
    _optional_cast_text_or_view(device_hint, summary)
    return {"ok": True, "message": "Stocks summary ready.", "data": {"quotes": quotes, "summary": summary}}


def web_search_and_summary(query: str, device_hint: str | None = None) -> dict:
    """
    Web search + concise summary using SerpAPI.
    Returns the answer text in `message`.
    """
    q = (query or "").strip()
    if not q:
        return {"ok": False, "message": "Missing search query.", "data": {}}

    api_key = _serpapi_key()
    if not api_key:
        # TODO: put SERPAPI_API_KEY in .env or settings.serpapi.api_key
        return {"ok": False, "message": "Web search is not configured (missing SERPAPI_API_KEY).", "data": {}}

    try:
        params = {
            "engine": "google",
            "q": q,
            "api_key": api_key,
            "num": "10",
            "hl": "en",
            "safe": "active",
        }
        r = requests.get("https://serpapi.com/search.json", params=params, timeout=12)
        if r.status_code != 200:
            log_error(f"[web] SerpAPI error {r.status_code}: {r.text}")
            return {"ok": False, "message": "Search failed.", "data": {"status": r.status_code}}

        js = r.json()
        data_payload = {"serpapi_search_metadata": js.get("search_metadata", {})}

        # 1) Direct answers: answer_box
        abox = js.get("answer_box") or {}
        if abox:
            # prefer 'answer' > 'snippet' > 'title'
            answer = abox.get("answer") or abox.get("snippet") or abox.get("title")
            if answer:
                msg = answer.strip()
                log_info(f"[web] answer_box → {msg}")
                return {"ok": True, "message": msg, "data": data_payload}

        # 2) Knowledge graph (entities like people/offices)
        kg = js.get("knowledge_graph") or {}
        if kg:
            # name/title summary; include subtitle if present (e.g., occupation/role)
            name = kg.get("title") or kg.get("header")
            subtitle = kg.get("type") or kg.get("description")
            if name:
                msg = name if not subtitle else f"{name} — {subtitle}"
                log_info(f"[web] knowledge_graph → {msg}")
                data_payload["knowledge_graph"] = kg
                return {"ok": True, "message": msg, "data": data_payload}

        # 3) People also ask
        paa = js.get("related_questions") or js.get("people_also_ask") or []
        for qitem in paa:
            ans = qitem.get("snippet") or qitem.get("answer")
            if ans:
                msg = ans.strip()
                log_info("[web] people_also_ask → used snippet")
                data_payload["paa_used"] = True
                return {"ok": True, "message": msg, "data": data_payload}

        # 4) Organic results → stitch a short one-liner
        org = js.get("organic_results") or []
        if org:
            # take top 2-3 snippets/titles
            parts = []
            for item in org[:3]:
                piece = item.get("snippet") or item.get("title")
                if piece:
                    parts.append(piece.strip())
            if parts:
                msg = parts[0]
                # If first piece is too generic, append second for context
                if len(msg) < 40 and len(parts) > 1:
                    msg = f"{msg} — {parts[1]}"
                log_info("[web] organic_results → stitched")
                data_payload["used_organic"] = True
                return {"ok": True, "message": msg, "data": data_payload}

        # No useful fields found
        return {"ok": False, "message": "No results found.", "data": data_payload}

    except Exception as e:
        log_error(f"[web] Exception in web_search_and_summary: {e}")
        return {"ok": False, "message": "Search error.", "data": {"details": str(e)}}

# ---------- Atomic ----------

def _extract_url(text: str) -> Optional[str]:
    m = re.search(r"(https?://\S+)", text or "")
    return m.group(1) if m else None


def _fetch_webpage(url: str) -> Optional[str]:
    try:
        r = requests.get(url, timeout=12)
        if not r.ok:
            log_error(f"[web._fetch_webpage] {r.status_code} {url}")
            return None
        return r.text
    except Exception as e:
        log_error(f"[web._fetch_webpage] {e}")
        return None


def _recipe_parse(html: str) -> Dict[str, Any]:
    try:
        # Prefer recipe-scrapers when possible; fallback to trafilatura + heuristics
        try:
            from recipe_scrapers import scrap_html
            sc = scrap_html(html)
            data = {
                "title": sc.title(),
                "ingredients": sc.ingredients(),
                "instructions": sc.instructions_list() or [sc.instructions()],
                "yields": sc.yields(),
                "time": {"total": sc.total_time(), "prep": sc.prep_time(), "cook": sc.cook_time()},
            }
            return {"ok": True, "message": "Parsed via recipe-scrapers.", "data": data}
        except Exception:
            text = trafilatura.extract(html) or ""
            if not text:
                return {"ok": False, "message": "Could not parse recipe.", "data": {}}
            # Minimal heuristic fallback
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            ingredients = [l for l in lines if re.search(r"^\d|cup|tbsp|teaspoon|גרם|כוס", l, re.I)]
            instructions = [l for l in lines if l.endswith(".") and len(l.split()) > 4]
            return {"ok": True, "message": "Heuristic parse.", "data": {
                "title": lines[0] if lines else "Recipe",
                "ingredients": ingredients[:30],
                "instructions": instructions[:20] or lines[:15],
                "yields": None,
                "time": {}
            }}
    except Exception as e:
        log_error(f"[web._recipe_parse] {e}")
        return {"ok": False, "message": f"Parse error: {e}", "data": {}}


def _summarize_recipe_for_voice(recipe: Dict[str, Any]) -> str:
    title = recipe.get("title") or "Recipe"
    ings = recipe.get("ingredients") or []
    steps = recipe.get("instructions") or []
    # If you have integrations/openai_wrapper.py you can improve summary; keep local for now
    head = f"{title}. Ingredients: " + ", ".join(ings[:10])
    tail = " Steps: " + " ".join([f"Step {i+1}: {s}" for i, s in enumerate(steps[:6])])
    return head + "." + tail


def _news_fetch_feeds(sources: List[str] | None) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for src in sources or []:
        try:
            f = feedparser.parse(src)
            for e in f.entries[:6]:
                items.append({"title": e.get("title"), "link": e.get("link"), "summary": e.get("summary", "")})
        except Exception as e:
            log_error(f"[web._news_fetch_feeds] {src}: {e}")
    return items


def _news_summarize(items: List[Dict[str, Any]]) -> str:
    if not items:
        return "No news items."
    tops = "; ".join([i["title"] for i in items[:5] if i.get("title")])
    return f"Top headlines: {tops}."


def _web_search(query: str) -> List[Dict[str, Any]]:
    key = os.getenv("SERPAPI_API_KEY", "")
    if not key:
        # Barebones fallback: attempt simple GET to DuckDuckGo HTML (very limited)
        return [{"title": query, "url": f"https://duckduckgo.com/?q={requests.utils.quote(query)}", "snippet": ""}]
    try:
        r = requests.get("https://serpapi.com/search.json", params={"engine": "google", "q": query, "api_key": key}, timeout=12)
        j = r.json()
        results = []
        for itm in (j.get("organic_results") or [])[:8]:
            results.append({"title": itm.get("title"), "url": itm.get("link"), "snippet": itm.get("snippet", "")})
        return results
    except Exception as e:
        log_error(f"[web._web_search] {e}")
        return []


def _web_fetch_top_n(results: List[Dict[str, Any]], n: int = 3) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for r in results[:n]:
        url = r.get("url")
        html = _fetch_webpage(url) if url else None
        text = trafilatura.extract(html) if html else ""
        out.append({"title": r.get("title"), "url": url, "snippet": r.get("snippet", ""), "text": text})
    return out


def _summarize_pages(pages: List[Dict[str, Any]]) -> str:
    if not pages:
        return "No results."
    bullets = []
    for p in pages:
        txt = (p.get("text") or "")[:500].replace("\n", " ")
        bullets.append(f"- {p.get('title')}: {txt[:250]}...")
    return "Search summary:\n" + "\n".join(bullets)


def _weather_fetch(city: str) -> Dict[str, Any]:
    # Simple Open-Meteo (no key)
    try:
        geo = requests.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": city, "count": 1}, timeout=10)
        g = geo.json()
        if not g.get("results"):
            return {}
        lat = g["results"][0]["latitude"]
        lon = g["results"][0]["longitude"]
        wx = requests.get("https://api.open-meteo.com/v1/forecast", params={"latitude": lat, "longitude": lon, "current_weather": True}, timeout=10).json()
        return {"city": city, "coords": (lat, lon), "current": wx.get("current_weather")}
    except Exception as e:
        log_error(f"[web._weather_fetch] {e}")
        return {}


def _stocks_fetch_quotes(tickers: List[str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for t in tickers:
        try:
            info = yf.Ticker(t).fast_info
            out[t] = {"last": float(info.get("last_price") or 0), "currency": info.get("currency"), "exchange": info.get("exchange")}
        except Exception as e:
            log_error(f"[web._stocks_fetch_quotes] {t}: {e}")
            out[t] = {"error": str(e)}
    return out


def _stocks_format_summary(quotes: Dict[str, Any]) -> str:
    parts = []
    for t, q in quotes.items():
        if "error" in q:
            parts.append(f"{t}: error")
        else:
            parts.append(f"{t} {q['last']} {q.get('currency') or ''}".strip())
    return " | ".join(parts)


def _optional_cast_text_or_view(device_hint: Optional[str], text_or_url: str) -> Dict[str, Any]:
    # TODO: Optionally implement casting via services.visual_manager.cast_image_slideshow or dashboard view
    return {"ok": True, "message": "Not cast.", "data": {}}


def _todo(msg: str) -> Dict[str, Any]:
    return {"ok": False, "message": f"TODO: {msg}", "data": {}}
