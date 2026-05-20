"""Presence HTTP surface — thin wrapper over services.presence_engine.

The router owns:
  * FastAPI routes (/api/presence/* and the PWA join page)
  * Auth / role checks
  * Concurrency-safe registry mutations that are NOT presence decisions
    (creating, deleting, linking persons; saving the home zone)
  * Asyncio-fanning of side effects (push notifications + automation triggers)
    when the engine returns `fired_transition=True`.

All decision logic (hysteresis, dwell, cooldown, accuracy gating, stale-ping
rejection) lives in services.presence_engine.
"""
from __future__ import annotations

import asyncio
import ipaddress
import json
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user, require_role
from core.logger_module import log_info, log_error
from core.settings_loader import settings, save_settings
from services import presence_engine
from services.presence_engine import Decision

router = APIRouter()

_REGISTRY = Path(__file__).resolve().parents[2] / "user_files" / "persons.json"


# ── registry CRUD (HTTP-only — not part of the state machine) ────────────────

def _load() -> list[dict]:
    if not _REGISTRY.exists():
        _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        _REGISTRY.write_text("[]", encoding="utf-8")
    try:
        return json.loads(_REGISTRY.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(persons: list[dict]) -> None:
    _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY.write_text(
        json.dumps(persons, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# Async wrappers — endpoints must not block the event loop on disk I/O when
# persons.json is being read or rewritten under concurrent ping load.
async def _load_async() -> list[dict]:
    import asyncio
    return await asyncio.to_thread(_load)


async def _save_async(persons: list[dict]) -> None:
    import asyncio
    await asyncio.to_thread(_save, persons)


# ── WiFi-LAN hint (additive evidence, never overrides cooldown) ──────────────

def _extract_client_ip(request: Request) -> str:
    xff = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    if xff:
        return xff
    xri = request.headers.get("X-Real-IP", "").strip()
    if xri:
        return xri
    return request.client.host if request.client else ""


def _is_local_ip(ip: str) -> bool:
    """True if `ip` is RFC-1918 / loopback. Only meaningful for direct-LAN access;
    when the request comes through the relay this returns False."""
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback
    except Exception:
        return False


# Side-effect fanout (push + automation) is shared with the HA bridge — see
# services/presence_side_effects.py. Both ingestion paths go through that
# module so behaviour is identical regardless of signal source.
from services.presence_side_effects import schedule_side_effects


def _handle_decision(decision: Decision) -> None:
    """Log every decision; schedule side effects only when the engine fires."""
    presence_engine.log_decision(decision)
    schedule_side_effects(decision)


# ── models ────────────────────────────────────────────────────────────────────

class PersonCreate(BaseModel):
    name: str


class PingBody(BaseModel):
    token: str
    lat: float
    lon: float
    accuracy: Optional[float] = None
    ts: Optional[float]       = None   # client-side ms since epoch (optional)


class MePingBody(BaseModel):
    lat: float
    lon: float
    accuracy: Optional[float] = None
    ts: Optional[float]       = None


class StateOverride(BaseModel):
    state: str  # "home" | "not_home" | "unknown"


class LanHostPatch(BaseModel):
    lan_host: Optional[str] = None  # "youval-iphone.local" or "192.168.1.42"


class ZonePatch(BaseModel):
    lat:      float
    lon:      float
    radius_m: Optional[float] = 100.0


# ── admin endpoints ───────────────────────────────────────────────────────────

@router.get("/api/presence/my-person")
async def get_my_person(user=Depends(get_current_user)):
    person = presence_engine.find_person_by_username(user.get("username", ""))
    if person is None:
        raise HTTPException(status_code=404, detail="No presence person linked to your account.")
    return {"person": person}


@router.get("/api/presence/persons")
async def list_persons(_user=Depends(get_current_user)):
    return {"persons": presence_engine.list_persons()}


@router.get("/api/presence/debug")
async def debug_state(_=Depends(require_role("admin"))):
    """Full debug snapshot — current persons, recent decisions, tunables."""
    zone = presence_engine.get_home_zone()
    return {
        "zone": (
            {"lat": zone[0], "lon": zone[1], "radius_m": zone[2]}
            if zone else None
        ),
        "tunables": {
            k: presence_engine._cfg(k)
            for k in (
                "home_radius_m", "away_radius_m", "max_accuracy_m",
                "dwell_seconds", "cooldown_seconds", "stale_ping_seconds",
                "stale_home_hours", "stale_away_minutes", "history_size",
            )
        },
        "persons": presence_engine.list_persons(),
    }


@router.post("/api/presence/persons")
async def create_person(body: PersonCreate, _=Depends(require_role("admin"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    persons = await _load_async()
    if any(p["name"].lower() == name.lower() for p in persons):
        raise HTTPException(status_code=409, detail="A person with that name already exists.")
    token = secrets.token_urlsafe(24)
    person = {
        "id":              str(uuid.uuid4()),
        "name":            name,
        "token":           token,
        "lan_host":        None,
        "lan_last_probe":  None,
        "lan_last_seen":   None,
        "state":           "unknown",
        "last_seen":       None,
        "last_lat":        None,
        "last_lon":        None,
        "last_accuracy":   None,
        "last_distance_m": None,
        "candidate_state": None,
        "candidate_since": None,
        "last_transition_at": None,
        "last_transition_to": None,
        "last_decision":   None,
        "history":         [],
    }
    persons.append(person)
    await _save_async(persons)
    return {"person": person}


@router.delete("/api/presence/persons/{person_id}")
async def delete_person(person_id: str, _=Depends(require_role("admin"))):
    persons = await _load_async()
    updated = [p for p in persons if p["id"] != person_id]
    if len(updated) == len(persons):
        raise HTTPException(status_code=404, detail="Person not found.")
    await _save_async(updated)
    return {"ok": True}


@router.patch("/api/presence/persons/{person_id}/lan-host")
async def set_lan_host(person_id: str, body: LanHostPatch, _=Depends(require_role("admin"))):
    """Set this person's LAN address for reachability-based presence.

    Accepted: a hostname (e.g. `youval-iphone.local`), an IPv4 address, or
    empty/null to disable LAN probing. The probe runs on Ziggy's host every
    minute via the scheduler; reachability is a strong "home" signal that
    works even when the phone has the PWA closed.
    """
    persons = await _load_async()
    person = next((p for p in persons if p["id"] == person_id), None)
    if person is None:
        raise HTTPException(status_code=404, detail="Person not found.")

    host = (body.lan_host or "").strip() or None
    if host is not None and (" " in host or len(host) > 253):
        raise HTTPException(status_code=400, detail="lan_host must be a hostname or IP without spaces.")

    person["lan_host"] = host
    await _save_async(persons)
    log_info(f"[Presence] {person['name']}: lan_host = {host}")
    return {"ok": True, "lan_host": host}


@router.patch("/api/presence/persons/{person_id}/state")
async def override_state(person_id: str, body: StateOverride, _=Depends(require_role("admin"))):
    decision = presence_engine.manual_override(person_id, body.state)
    if decision.result.startswith("rejected_unknown"):
        raise HTTPException(status_code=404, detail="Person not found.")
    if decision.result.startswith("rejected_invalid"):
        raise HTTPException(status_code=400, detail=decision.reason)
    _handle_decision(decision)
    return {
        "ok": True,
        "state": decision.new_confirmed,
        "result": decision.result,
        "reason": decision.reason,
    }


@router.get("/api/presence/zone")
async def get_zone(_user=Depends(get_current_user)):
    zone = presence_engine.get_home_zone()
    configured = settings.get("home_zone", {}).get("lat") is not None
    if zone is None:
        return {"lat": None, "lon": None, "radius": None, "configured": False}
    lat, lon, radius = zone
    return {"lat": lat, "lon": lon, "radius": radius, "configured": configured}


@router.patch("/api/presence/zone")
async def save_zone(body: ZonePatch, _=Depends(require_role("admin"))):
    settings["home_zone"] = {
        "lat":      round(body.lat, 6),
        "lon":      round(body.lon, 6),
        # Lower bound 50 m is a safety floor — the engine's hysteresis (away_radius_m
        # in settings.presence) provides additional buffer regardless of this number.
        "radius_m": max(body.radius_m or 100.0, 50.0),
    }
    save_settings(settings)
    log_info(f"[Presence] Home zone saved: {settings['home_zone']}")
    return {"ok": True, **settings["home_zone"]}


# ── authenticated self-tracking (logged-in Ziggy user, no invite needed) ────

def _resolve_or_create_my_person(user: dict) -> dict:
    """Return the person record for the authenticated user, creating one on
    first use so the in-app "Track me" flow has zero setup.

    Match priority:
      1. linked_user exact match (case-insensitive)
      2. name appears in the username (e.g. person "Youval" matches user
         "youvalpolacsek@gmail.com") — and we PERSIST linked_user on first
         match so the person can't later be "stolen" by another user whose
         name happens to be a substring of theirs.
      3. otherwise create a new person whose name is the username's local
         part (capitalised), with linked_user set to the username.
    """
    username = user.get("username", "") or ""
    person = presence_engine.find_person_by_username(username)
    if person is not None:
        # Lock the association so the next user with a similar name doesn't
        # match the same person.
        if not (person.get("linked_user") or "").strip():
            persons = _load()
            for p in persons:
                if p["id"] == person["id"]:
                    p["linked_user"] = username
                    break
            _save(persons)
            log_info(f"[Presence] Linked person '{person['name']}' to user {username}")
            person["linked_user"] = username
        return person

    # Auto-create.
    persons = _load()
    local = username.split("@", 1)[0] if "@" in username else username
    name  = local[:1].upper() + local[1:] if local else "Me"
    # Avoid name collisions.
    base, i = name, 1
    while any(p["name"].lower() == name.lower() for p in persons):
        i += 1
        name = f"{base} {i}"
    new_person = {
        "id":              str(uuid.uuid4()),
        "name":            name,
        "token":           secrets.token_urlsafe(24),
        "linked_user":     username,
        "lan_host":        None,
        "lan_last_probe":  None,
        "lan_last_seen":   None,
        "state":           "unknown",
        "last_seen":       None,
        "last_lat":        None,
        "last_lon":        None,
        "last_accuracy":   None,
        "last_distance_m": None,
        "candidate_state": None,
        "candidate_since": None,
        "last_transition_at": None,
        "last_transition_to": None,
        "last_decision":   None,
        "history":         [],
    }
    persons.append(new_person)
    _save(persons)
    log_info(f"[Presence] Auto-created person for {username}: {name}")
    return new_person


def _client_ts_from_body(ts_val: Optional[float]) -> Optional[datetime]:
    """Accept ms-since-epoch or seconds-since-epoch (distinguished by magnitude)."""
    if ts_val is None:
        return None
    try:
        v = float(ts_val)
        if v > 1e12:
            v /= 1000.0
        return datetime.fromtimestamp(v, tz=timezone.utc)
    except Exception:
        return None


@router.post("/api/presence/me/ping")
async def ping_me(body: MePingBody, request: Request, user=Depends(get_current_user)):
    """Logged-in user pings their own location. No invite link, no token.

    Auto-creates a person record for the user on first call so there's zero
    setup — just grant location once in the PWA.
    """
    import asyncio
    # `_resolve_or_create_my_person` does sync file I/O (load/save persons.json
    # and may write linked_user). Off-load to the threadpool so a hot ping path
    # doesn't stall the event loop for other handlers.
    person    = await asyncio.to_thread(_resolve_or_create_my_person, user)
    client_ts = _client_ts_from_body(body.ts)
    wifi_hint = _is_local_ip(_extract_client_ip(request))

    decision = presence_engine.ingest_ping_for_person_id(
        person_id     = person["id"],
        lat           = body.lat,
        lon           = body.lon,
        accuracy      = body.accuracy,
        client_ts     = client_ts,
        wifi_home_hint = wifi_hint,
    )
    _handle_decision(decision)

    refreshed = presence_engine.find_person_by_id(person["id"]) or {}
    return {
        "state":   presence_engine.effective_state(refreshed) if refreshed else "unknown",
        "person":  {"id": person["id"], "name": person["name"]},
        "result":  decision.result,
        "reason":  decision.reason,
    }


# ── phone ping (no JWT — secured by per-person token) ────────────────────────

@router.post("/api/presence/ping")
async def ping(body: PingBody, request: Request):
    client_ts = _client_ts_from_body(body.ts)
    wifi_hint = _is_local_ip(_extract_client_ip(request))

    decision = presence_engine.ingest_ping(
        token         = body.token,
        lat           = body.lat,
        lon           = body.lon,
        accuracy      = body.accuracy,
        client_ts     = client_ts,
        wifi_home_hint = wifi_hint,
    )

    if decision.result == "rejected_unknown_token":
        raise HTTPException(status_code=401, detail="Invalid token.")

    _handle_decision(decision)

    # Frontend wants the effective state for status display, not raw.
    person = presence_engine.find_person_by_token(body.token) or {}
    return {
        "state":  presence_engine.effective_state(person) if person else "unknown",
        "result": decision.result,
        "reason": decision.reason,
    }


# ── PWA manifest ──────────────────────────────────────────────────────────────

@router.get("/presence/manifest.json")
async def pwa_manifest(token: str = Query(default="")):
    start_url = f"/presence/join/{token}" if token else "/presence/join/"
    return JSONResponse({
        "name":             "Ziggy Presence",
        "short_name":       "Ziggy",
        "display":          "standalone",
        "background_color": "#0f0f0f",
        "theme_color":      "#0f0f0f",
        "start_url":        start_url,
        "icons": [{
            "src":   "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='%236366f1'/><text y='.9em' font-size='72' x='14'>Z</text></svg>",
            "sizes": "any",
            "type":  "image/svg+xml",
        }],
    })


# ── PWA invite page ───────────────────────────────────────────────────────────

@router.get("/presence/join/{token}", response_class=HTMLResponse)
async def pwa_join(token: str):
    person = presence_engine.find_person_by_token(token)
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
    // Minimum gap between two outgoing pings, regardless of how often
    // watchPosition fires. Keeps the server from being hammered on devices
    // that emit a callback every second or two.
    const MIN_PING_INTERVAL_MS = 20 * 1000;
    // Re-ping cadence when the position itself hasn't changed; defeats the
    // server's stale-ping decay without firing every 30 s.
    const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;

    localStorage.setItem(STORAGE_KEY, TOKEN);

    let _lastPos = null;
    let _lastPingAt = 0;

    function isIOS() {{
      return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }}

    function setStatus(type, text) {{
      const el = document.getElementById("status");
      const tx = document.getElementById("status-text");
      el.className = "status " + type;
      tx.textContent = text;
    }}

    async function sendPing(pos, opts) {{
      opts = opts || {{}};
      const now = Date.now();
      if (!opts.force && now - _lastPingAt < MIN_PING_INTERVAL_MS) return;
      _lastPingAt = now;
      try {{
        const r = await fetch(PING_URL, {{
          method: "POST",
          headers: {{ "Content-Type": "application/json" }},
          body: JSON.stringify({{
            token:    TOKEN,
            lat:      pos.coords.latitude,
            lon:      pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            // Browser-reported GPS timestamp; falls back to Date.now() so the
            // server can reject queued/replayed pings either way.
            ts:       pos.timestamp || now,
          }}),
        }});
        const data = await r.json();
        if (data.state === "home") {{
          setStatus("ok", "Home ✓");
        }} else if (data.state === "not_home") {{
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
          sendPing(pos);
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

    // Keep-alive: re-ping with last known position. Defeats server-side
    // staleness decay; the server's per-person dwell/cooldown logic prevents
    // these benign keep-alives from causing notifications.
    setInterval(() => {{
      if (_lastPos) sendPing(_lastPos);
    }}, KEEPALIVE_INTERVAL_MS);

    // When the PWA comes back to foreground, ask the browser for a *fresh*
    // position rather than replaying a stale cached one. The cached position
    // could be hours old after backgrounding and would cause a false flip.
    document.addEventListener("visibilitychange", () => {{
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(
        (pos) => {{ _lastPos = pos; sendPing(pos, {{ force: true }}); }},
        () => {{ /* ignore — watchPosition will resume on its own */ }},
        {{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }},
      );
    }});

    // Auto-start if permission was already granted.
    navigator.permissions?.query({{ name: "geolocation" }}).then(p => {{
      if (p.state === "granted") startTracking();
    }});
  </script>
</body>
</html>"""
    return HTMLResponse(html)
