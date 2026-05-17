from __future__ import annotations

import asyncio
import ipaddress
import json
import math
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user, require_role
from services.home_automation import get_state
from core.logger_module import log_info, log_error
from core.settings_loader import settings, save_settings

router = APIRouter()

_REGISTRY = Path(__file__).resolve().parents[2] / "user_files" / "persons.json"

# Asymmetric staleness: home state persists 8 h (phone backgrounded ≠ person left),
# not-home state expires in 30 min (they may have returned without opening the app).
_STALE_HOME_HOURS   = 8
_STALE_AWAY_MINUTES = 30


# ── persistence ───────────────────────────────────────────────────────────────

def _ensure_registry() -> None:
    """Create persons.json with an empty list if it doesn't exist."""
    if not _REGISTRY.exists():
        _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        _REGISTRY.write_text("[]", encoding="utf-8")


def _load() -> list[dict]:
    _ensure_registry()
    try:
        return json.loads(_REGISTRY.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(persons: list[dict]) -> None:
    _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY.write_text(json.dumps(persons, indent=2, ensure_ascii=False), encoding="utf-8")


# ── home zone ────────────────────────────────────────────────────────────────

def _home_zone() -> tuple[float, float, float] | None:
    """Return (lat, lon, radius_m) for the home zone.

    Priority:
      1. Ziggy settings (home_zone key) — user configured directly in Ziggy
      2. HA zone.home entity
      3. HA /api/config (lat/lon from HA onboarding, 200 m radius)
      4. None — nothing configured anywhere
    """
    # 1. Ziggy-native home zone (set by the user in Ziggy admin settings)
    hz = settings.get("home_zone", {})
    lat    = hz.get("lat")
    lon    = hz.get("lon")
    radius = hz.get("radius_m", 200)
    if lat is not None and lon is not None:
        return float(lat), float(lon), float(radius)

    # 2. HA zone.home entity
    r = get_state("zone.home")
    if r.get("ok"):
        attrs  = r.get("data", {}).get("attributes", {})
        ha_lat = attrs.get("latitude")
        ha_lon = attrs.get("longitude")
        ha_rad = max(attrs.get("radius", 200), 200)
        if ha_lat is not None and ha_lon is not None:
            return float(ha_lat), float(ha_lon), float(ha_rad)

    # 3. HA core config
    try:
        from services.home_automation import _ha_url, _headers
        import requests as _req
        resp = _req.get(f"{_ha_url()}/api/config", headers=_headers(), timeout=5)
        if resp.ok:
            cfg    = resp.json()
            ha_lat = cfg.get("latitude")
            ha_lon = cfg.get("longitude")
            if ha_lat is not None and ha_lon is not None:
                log_info(f"[Presence] Using HA core config location ({ha_lat}, {ha_lon}) — set your home zone in Ziggy settings to stop this message")
                return float(ha_lat), float(ha_lon), 200.0
    except Exception as exc:
        log_error(f"[Presence] Could not read HA config: {exc}")

    return None


def _extract_client_ip(request: Request) -> str:
    """Real client IP — prefers X-Forwarded-For, then X-Real-IP, then socket peer."""
    xff = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    if xff:
        return xff
    xri = request.headers.get("X-Real-IP", "").strip()
    if xri:
        return xri
    return request.client.host if request.client else ""


def _is_local_ip(ip: str) -> bool:
    """True if ip is RFC-1918 / loopback — phone is on the home LAN."""
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback
    except Exception:
        return False


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres between two lat/lon points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _compute_state(lat: float, lon: float) -> str:
    zone = _home_zone()
    if zone is None:
        return "unknown"
    home_lat, home_lon, radius = zone
    dist = _haversine_m(lat, lon, home_lat, home_lon)
    return "home" if dist <= radius else "not_home"


def _effective_state(person: dict) -> str:
    """Degrade to 'unknown' if the ping is too stale for its state.

    Home state lasts 8 h — the phone being backgrounded overnight shouldn't look
    like the person left. Away state expires in 30 min — they may have come back
    without opening the app.
    """
    last_seen = person.get("last_seen")
    if last_seen is None:
        return "unknown"
    try:
        ts    = datetime.fromisoformat(last_seen)
        age   = datetime.now(timezone.utc) - ts
        state = person.get("state", "unknown")
        if state == "home":
            if age > timedelta(hours=_STALE_HOME_HOURS):
                return "unknown"
        else:
            if age > timedelta(minutes=_STALE_AWAY_MINUTES):
                return "unknown"
    except Exception:
        return "unknown"
    return person.get("state", "unknown")


# ── state-transition event ────────────────────────────────────────────────────

async def _fire_transition(name: str, prev_state: str | None, new_state: str) -> None:
    """Called when a person's effective presence state changes.
    Fires matching person_arrives / person_leaves automations.
    Skips 'unknown' as a destination — unknown is a fallback, not an action trigger.
    """
    log_info(f"[Presence] {name}: {prev_state} → {new_state}")

    # Push notification to all users
    try:
        from services.push_notify import push_notify
        verb = "arrived home" if new_state == "home" else "left home"
        await push_notify(f"{name} {verb}", "", "/", "presence")
    except Exception as exc:
        log_error(f"[Presence] Push notify failed: {exc}")

    trigger_type = "person_arrives" if new_state == "home" else "person_leaves"

    try:
        from core.automation_file import list_automations
        from services.local_automation_actions import execute_ziggy_actions

        for auto in list_automations():
            if not auto.get("enabled", True):
                continue
            t = auto.get("trigger", {})
            if t.get("type") != trigger_type:
                continue
            person_filter = t.get("person", "*")
            if person_filter != "*" and person_filter.lower() != name.lower():
                continue
            log_info(f"[Presence] Firing automation '{auto.get('name', auto['id'])}' for {trigger_type}")
            try:
                await execute_ziggy_actions(auto["id"])
            except Exception as exc:
                log_error(f"[Presence] Automation {auto['id']} failed: {exc}")
    except Exception as exc:
        log_error(f"[Presence] Transition handler error: {exc}")


# ── models ────────────────────────────────────────────────────────────────────

class PersonCreate(BaseModel):
    name: str


class PingBody(BaseModel):
    token: str
    lat: float
    lon: float
    accuracy: Optional[float] = None


def _find_my_person(username: str) -> dict | None:
    """Return the person record linked to this user account.

    Priority:
      1. Explicit linked_user field set on the person record
      2. Person's name appears somewhere in the username/email
         (e.g. "Youval" matches "youvalpolacsek@gmail.com")
    """
    if not username:
        return None
    persons = _load()
    uname_lower = username.lower()
    for p in persons:
        if p.get("linked_user", "").lower() == uname_lower:
            return p
    for p in persons:
        if p["name"].lower() in uname_lower:
            return p
    return None


# ── admin endpoints (require authenticated user) ───────────────────────────────

@router.get("/api/presence/my-person")
async def get_my_person(user=Depends(get_current_user)):
    """Return the presence person linked to the authenticated user."""
    person = _find_my_person(user.get("username", ""))
    if person is None:
        raise HTTPException(status_code=404, detail="No presence person linked to your account.")
    return {"person": person}


@router.get("/api/presence/persons")
async def list_persons(_user=Depends(get_current_user)):
    persons = _load()
    # Attach effective_state to each person for the frontend
    result = []
    for p in persons:
        row = dict(p)
        row["effective_state"] = _effective_state(p)
        # Strip token from list response for non-admin display; admin gets it via create
        result.append(row)
    return {"persons": result}


@router.post("/api/presence/persons")
async def create_person(body: PersonCreate, _=Depends(require_role("admin"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    persons = _load()
    if any(p["name"].lower() == name.lower() for p in persons):
        raise HTTPException(status_code=409, detail="A person with that name already exists.")
    token = secrets.token_urlsafe(24)
    person = {
        "id":        str(uuid.uuid4()),
        "name":      name,
        "token":     token,
        "state":     "unknown",
        "last_seen": None,
        "last_lat":  None,
        "last_lon":  None,
    }
    persons.append(person)
    _save(persons)
    return {"person": person}


@router.delete("/api/presence/persons/{person_id}")
async def delete_person(person_id: str, _=Depends(require_role("admin"))):
    persons = _load()
    updated = [p for p in persons if p["id"] != person_id]
    if len(updated) == len(persons):
        raise HTTPException(status_code=404, detail="Person not found.")
    _save(updated)
    return {"ok": True}


class StateOverride(BaseModel):
    state: str  # "home" | "not_home" | "unknown"


@router.patch("/api/presence/persons/{person_id}/state")
async def override_state(person_id: str, body: StateOverride, _=Depends(require_role("admin"))):
    """Manually force a person's presence state, bypassing GPS."""
    if body.state not in ("home", "not_home", "unknown"):
        raise HTTPException(status_code=400, detail="state must be 'home', 'not_home', or 'unknown'.")
    persons = _load()
    person  = next((p for p in persons if p["id"] == person_id), None)
    if person is None:
        raise HTTPException(status_code=404, detail="Person not found.")

    prev_effective = _effective_state(person)
    person["state"]     = body.state
    person["last_seen"] = datetime.now(timezone.utc).isoformat()
    _save(persons)

    new_effective = body.state
    if prev_effective != new_effective and new_effective != "unknown":
        import asyncio
        asyncio.create_task(_fire_transition(person["name"], prev_effective, new_effective))

    return {"ok": True, "state": body.state}


@router.get("/api/presence/zone")
async def get_zone(_user=Depends(get_current_user)):
    zone = _home_zone()
    configured = settings.get("home_zone", {}).get("lat") is not None
    if zone is None:
        return {"lat": None, "lon": None, "radius": None, "configured": False}
    lat, lon, radius = zone
    return {"lat": lat, "lon": lon, "radius": radius, "configured": configured}


class ZonePatch(BaseModel):
    lat:      float
    lon:      float
    radius_m: Optional[float] = 200.0


@router.patch("/api/presence/zone")
async def save_zone(body: ZonePatch, _=Depends(require_role("admin"))):
    """Save the home zone directly in Ziggy settings."""
    settings["home_zone"] = {
        "lat":      round(body.lat, 6),
        "lon":      round(body.lon, 6),
        "radius_m": max(body.radius_m or 200.0, 50.0),
    }
    save_settings(settings)
    log_info(f"[Presence] Home zone saved: {settings['home_zone']}")
    return {"ok": True, **settings["home_zone"]}


# ── phone ping (no JWT — secured by per-person token) ────────────────────────

@router.post("/api/presence/ping")
async def ping(body: PingBody, request: Request):
    persons = _load()
    person  = next((p for p in persons if p["token"] == body.token), None)
    if person is None:
        raise HTTPException(status_code=401, detail="Invalid token.")

    prev_effective = _effective_state(person)

    # WiFi detection: if the ping arrives from a private LAN IP the phone is on
    # the home network — treat as home regardless of GPS accuracy.
    # (Only works when accessing Ziggy directly on LAN, not through a relay.)
    client_ip = _extract_client_ip(request)
    if _is_local_ip(client_ip):
        new_state = "home"
    else:
        new_state = _compute_state(body.lat, body.lon)

    person["state"]     = new_state
    person["last_seen"] = datetime.now(timezone.utc).isoformat()
    person["last_lat"]  = body.lat
    person["last_lon"]  = body.lon
    _save(persons)

    # Fire transition event if the effective state changed
    if prev_effective != new_state and new_state != "unknown":
        asyncio.create_task(_fire_transition(person["name"], prev_effective, new_state))

    return {"state": person["state"]}


# ── PWA manifest (referenced by <link rel="manifest"> in the join page) ──────

@router.get("/presence/manifest.json")
async def pwa_manifest(token: str = Query(default="")):
    start_url = f"/presence/join/{token}" if token else "/presence/join/"
    return JSONResponse({
        "name": "Ziggy Presence",
        "short_name": "Ziggy",
        "display": "standalone",
        "background_color": "#0f0f0f",
        "theme_color": "#0f0f0f",
        "start_url": start_url,
        "icons": [{
            "src": "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%236366f1'/><text y='.9em' font-size='72' x='14'>Z</text></svg>",
            "sizes": "any",
            "type": "image/svg+xml"
        }]
    })


# ── PWA invite page (no JWT — public, secured by token in URL) ────────────────

@router.get("/presence/join/{token}", response_class=HTMLResponse)
async def pwa_join(token: str):
    persons = _load()
    person  = next((p for p in persons if p["token"] == token), None)
    if person is None:
        return HTMLResponse("<h2>Invalid or expired link.</h2>", status_code=404)

    name = person["name"]
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="mobile-web-app-capable" content="yes">
  <title>Ziggy · {name}</title>
  <link rel="manifest" href="/presence/manifest.json?token={token}">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    :root {{
      --bg: #0f0f0f; --surface: #1a1a1a; --line: #2a2a2a;
      --ink: #f0f0f0; --ink-mute: #888; --ink-faint: #555;
      --ok: #22c55e; --warn: #f59e0b; --err: #ef4444; --accent: #6366f1;
    }}
    html, body {{ height: 100%; background: var(--bg); color: var(--ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }}
    body {{ display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 32px 24px; gap: 24px; min-height: 100dvh; }}
    .card {{ background: var(--surface); border: 0.5px solid var(--line);
      border-radius: 18px; padding: 28px 24px; width: 100%; max-width: 360px;
      display: flex; flex-direction: column; gap: 20px; }}
    .avatar {{ width: 56px; height: 56px; border-radius: 50%; background: var(--accent);
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; font-weight: 700; color: #fff; margin: 0 auto; }}
    h1 {{ font-size: 20px; font-weight: 700; letter-spacing: -0.02em; text-align: center; }}
    .sub {{ font-size: 13px; color: var(--ink-mute); text-align: center; line-height: 1.5; }}
    .btn {{ width: 100%; padding: 13px; border-radius: 12px; border: none;
      font-size: 15px; font-weight: 600; font-family: inherit; cursor: pointer;
      background: var(--accent); color: #fff; transition: opacity .15s; }}
    .btn:disabled {{ opacity: 0.5; cursor: default; }}
    .status {{ display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      border-radius: 10px; font-size: 13px; }}
    .status.ok   {{ background: color-mix(in srgb, var(--ok) 12%, var(--surface));
      color: var(--ok); }}
    .status.warn {{ background: color-mix(in srgb, var(--warn) 12%, var(--surface));
      color: var(--warn); }}
    .status.err  {{ background: color-mix(in srgb, var(--err) 12%, var(--surface));
      color: var(--err); }}
    .dot {{ width: 7px; height: 7px; border-radius: 50%; background: currentColor;
      flex-shrink: 0; animation: pulse 2s infinite; }}
    @keyframes pulse {{ 0%,100%{{opacity:1}} 50%{{opacity:.4}} }}
    .ios-hint {{ font-size: 11px; color: var(--ink-faint); text-align: center;
      line-height: 1.6; padding: 0 4px; display: none; }}
    footer {{ font-size: 11px; color: var(--ink-faint); text-align: center; }}
  </style>
</head>
<body>
  <div class="card">
    <div class="avatar">{name[0].upper()}</div>
    <div>
      <h1>Hi, {name}</h1>
      <p class="sub">Ziggy needs your location to show when you're home.</p>
    </div>
    <div id="status" class="status warn">
      <span class="dot"></span>
      <span id="status-text">Location not yet shared</span>
    </div>
    <button id="btn" class="btn" onclick="startTracking()">Allow Location</button>
    <p class="ios-hint" id="ios-hint">
      On iPhone: keep this page open for live updates, or add it to your Home Screen for easier access.
    </p>
  </div>
  <footer>Ziggy Presence · your location stays on your device</footer>

  <script>
    const TOKEN = "{token}";
    const PING_URL = "/api/presence/ping";
    const STORAGE_KEY = "ziggy_presence_token";

    localStorage.setItem(STORAGE_KEY, TOKEN);

    let _lastPos = null;

    function isIOS() {{
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }}

    function setStatus(type, text) {{
      const el = document.getElementById("status");
      const tx = document.getElementById("status-text");
      el.className = "status " + type;
      tx.textContent = text;
    }}

    async function sendPing(lat, lon, accuracy) {{
      try {{
        const r = await fetch(PING_URL, {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify({{ token: TOKEN, lat, lon, accuracy }})
        }});
        const data = await r.json();
        const state = data.state;
        if (state === "home") {{
          setStatus("ok", "Home ✓");
        }} else if (state === "not_home") {{
          setStatus("warn", "Away");
        }} else {{
          setStatus("warn", "Location received");
        }}
      }} catch(e) {{
        setStatus("err", "Can't reach Ziggy — check Wi-Fi");
      }}
    }}

    function startTracking() {{
      if (!("geolocation" in navigator)) {{
        setStatus("err", "Location not available in this browser");
        return;
      }}
      const btn = document.getElementById("btn");
      btn.disabled = true;
      btn.textContent = "Waiting for permission…";

      navigator.geolocation.watchPosition(
        (pos) => {{
          _lastPos = pos;
          btn.style.display = "none";
          if (isIOS()) document.getElementById("ios-hint").style.display = "block";
          sendPing(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
        }},
        (err) => {{
          btn.disabled = false;
          btn.textContent = "Allow Location";
          if (err.code === 1) {{
            setStatus("err", "Permission denied — enable in browser settings");
          }} else {{
            setStatus("err", "Location error: " + err.message);
          }}
        }},
        {{ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }}
      );
    }}

    // Keep-alive: re-ping every 2 min with last known position.
    // watchPosition only fires when position changes; this prevents the 30-min
    // staleness window from expiring when the phone stays still.
    setInterval(() => {{
      if (_lastPos) sendPing(_lastPos.coords.latitude, _lastPos.coords.longitude, _lastPos.coords.accuracy);
    }}, 2 * 60 * 1000);

    // Re-ping immediately when the PWA comes back to the foreground.
    document.addEventListener("visibilitychange", () => {{
      if (document.visibilityState === "visible" && _lastPos) {{
        sendPing(_lastPos.coords.latitude, _lastPos.coords.longitude, _lastPos.coords.accuracy);
      }}
    }});

    // Auto-start if permission was already granted
    navigator.permissions?.query({{ name: "geolocation" }}).then(p => {{
      if (p.state === "granted") startTracking();
    }});
  </script>
</body>
</html>"""
    return HTMLResponse(html)
