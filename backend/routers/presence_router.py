from __future__ import annotations

import json
import math
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from backend.routers.auth_deps import require_role
from services.home_automation import get_state

router = APIRouter()

_REGISTRY = Path(__file__).resolve().parents[2] / "user_files" / "persons.json"


# ── persistence ───────────────────────────────────────────────────────────────

def _load() -> list[dict]:
    try:
        return json.loads(_REGISTRY.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except Exception:
        return []


def _save(persons: list[dict]) -> None:
    _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY.write_text(json.dumps(persons, indent=2, ensure_ascii=False), encoding="utf-8")


# ── home zone (reads from HA zone.home) ───────────────────────────────────────

def _home_zone() -> tuple[float, float, float] | None:
    """Return (lat, lon, radius_m) from HA zone.home, or None if unavailable."""
    r = get_state("zone.home")
    if not r.get("ok"):
        return None
    attrs = r.get("data", {}).get("attributes", {})
    lat    = attrs.get("latitude")
    lon    = attrs.get("longitude")
    radius = attrs.get("radius", 100)
    if lat is None or lon is None:
        return None
    return float(lat), float(lon), float(radius)


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


# ── models ────────────────────────────────────────────────────────────────────

class PersonCreate(BaseModel):
    name: str


class PingBody(BaseModel):
    token: str
    lat: float
    lon: float
    accuracy: Optional[float] = None


# ── admin endpoints ───────────────────────────────────────────────────────────

@router.get("/api/presence/persons")
async def list_persons():
    return {"persons": _load()}


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


@router.get("/api/presence/zone")
async def get_zone():
    zone = _home_zone()
    if zone is None:
        raise HTTPException(status_code=503, detail="Home zone unavailable — check HA zone.home.")
    lat, lon, radius = zone
    return {"lat": lat, "lon": lon, "radius": radius}


# ── phone ping (no auth — secured by per-person token) ───────────────────────

@router.post("/api/presence/ping")
async def ping(body: PingBody):
    persons = _load()
    person  = next((p for p in persons if p["token"] == body.token), None)
    if person is None:
        raise HTTPException(status_code=401, detail="Invalid token.")
    person["state"]     = _compute_state(body.lat, body.lon)
    person["last_seen"] = datetime.now(timezone.utc).isoformat()
    person["last_lat"]  = body.lat
    person["last_lon"]  = body.lon
    _save(persons)
    return {"state": person["state"]}


# ── PWA manifest (referenced by <link rel="manifest"> in the join page) ──────

@router.get("/presence/manifest.json")
async def pwa_manifest(token: str = Query(default="")):
    # start_url includes the token so "Add to Home Screen" reopens the right person's page
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


# ── PWA invite page (no auth — public, secured by token in URL) ───────────────

@router.get("/presence/join/{token}", response_class=HTMLResponse)
async def pwa_join(token: str):
    persons = _load()
    person  = next((p for p in persons if p["token"] == token), None)
    if person is None:
        return HTMLResponse("<h2>Invalid or expired link.</h2>", status_code=404)

    name = person["name"]
    # Inline the token so the JS doesn't need a second round-trip
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

    // Persist so "Add to Home Screen" → start_url still works even if manifest
    // start_url token ever changes. On bare /presence/join/ visits, redirect to
    // the stored token URL if we have one.
    localStorage.setItem(STORAGE_KEY, TOKEN);

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
        setStatus("err", "Can’t reach Ziggy — check Wi-Fi");
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
        {{ enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }}
      );
    }}

    // Auto-start if permission was already granted
    navigator.permissions?.query({{ name: "geolocation" }}).then(p => {{
      if (p.state === "granted") startTracking();
    }});
  </script>
</body>
</html>"""
    return HTMLResponse(html)
