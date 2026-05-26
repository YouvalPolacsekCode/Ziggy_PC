"""Additional named zones for Ziggy presence.

These are zones BEYOND the primary "Home" zone (which still lives in
settings.yaml under `home_zone`). Used for:

  * Head-start automations — "Turn AC on when I'm 5 minutes from home"
    needs a larger "Near Home" zone around the house.
  * Location-categorisation — "I'm at Work", "kids are at School", etc.

Storage: user_files/zones.json. Independent file so settings.yaml's
auto-formatter can't mangle the list.

This module is registry-only — pure CRUD over a JSON file plus a single
`zone_containing(lat, lon, name)` helper. The presence engine consumes the
list when computing per-zone state (Phase 2 — automation triggers).
"""
from __future__ import annotations

import json
import math
import threading
import uuid
from pathlib import Path
from typing import Optional

from core.logger_module import log_info, log_error

_REGISTRY = Path(__file__).resolve().parent.parent / "user_files" / "zones.json"
_lock = threading.RLock()


# ── persistence ───────────────────────────────────────────────────────────────

def _ensure_registry() -> None:
    if not _REGISTRY.exists():
        _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        _REGISTRY.write_text("[]", encoding="utf-8")


def _load() -> list[dict]:
    _ensure_registry()
    try:
        return json.loads(_REGISTRY.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(zones: list[dict]) -> None:
    _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY.write_text(
        json.dumps(zones, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ── public API ────────────────────────────────────────────────────────────────

def list_zones() -> list[dict]:
    """Return every extra zone (home zone lives separately in settings)."""
    return _load()


def get_zone(zone_id: str) -> Optional[dict]:
    return next((z for z in _load() if z.get("id") == zone_id), None)


def create_zone(name: str, lat: float, lon: float, radius_m: float) -> dict:
    """Create a new zone. Raises ValueError on duplicate name (case-insensitive)."""
    name = name.strip()
    if not name:
        raise ValueError("Name is required.")
    with _lock:
        zones = _load()
        if any(z["name"].lower() == name.lower() for z in zones):
            raise ValueError("A zone with that name already exists.")
        zone = {
            "id":       str(uuid.uuid4()),
            "name":     name,
            "lat":      round(float(lat), 6),
            "lon":      round(float(lon), 6),
            "radius_m": max(float(radius_m), 50.0),
        }
        zones.append(zone)
        _save(zones)
        log_info(f"[Zones] Created '{name}' ({zone['lat']}, {zone['lon']}) r={zone['radius_m']}m")
        return zone


def update_zone(zone_id: str, *, name: Optional[str] = None,
                lat: Optional[float] = None, lon: Optional[float] = None,
                radius_m: Optional[float] = None) -> Optional[dict]:
    """Partial update of a zone. Returns the new record or None if not found."""
    with _lock:
        zones = _load()
        z = next((x for x in zones if x.get("id") == zone_id), None)
        if z is None:
            return None
        if name is not None:
            new_name = name.strip()
            if not new_name:
                raise ValueError("Name cannot be empty.")
            if any(o["name"].lower() == new_name.lower() and o["id"] != zone_id for o in zones):
                raise ValueError("Another zone already has that name.")
            z["name"] = new_name
        if lat is not None:
            z["lat"] = round(float(lat), 6)
        if lon is not None:
            z["lon"] = round(float(lon), 6)
        if radius_m is not None:
            z["radius_m"] = max(float(radius_m), 50.0)
        _save(zones)
        log_info(f"[Zones] Updated '{z['name']}' → ({z['lat']}, {z['lon']}) r={z['radius_m']}m")
        return z


def delete_zone(zone_id: str) -> bool:
    with _lock:
        zones = _load()
        new_zones = [z for z in zones if z.get("id") != zone_id]
        if len(new_zones) == len(zones):
            return False
        _save(new_zones)
        log_info(f"[Zones] Deleted zone {zone_id}")
        return True


# ── geometry helper (also used by the presence engine in Phase 2) ────────────

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def zones_containing(lat: float, lon: float) -> list[dict]:
    """Return the subset of zones whose circle contains (lat, lon)."""
    out = []
    for z in _load():
        if "lat" not in z or "lon" not in z:
            continue
        if _haversine_m(lat, lon, z["lat"], z["lon"]) <= float(z.get("radius_m", 100)):
            out.append(z)
    return out
