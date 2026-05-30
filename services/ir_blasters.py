"""
IR Blaster registry — first-class storage for physical IR-blaster hardware.

Before this module, "blaster" was an implicit concept that lived only as the
`blaster_host` (IP) and `blaster_mac` fields scattered across every IR-device
record. That was fine for single-blaster homes but offered no surface to:

  - name the blaster ("Living Room Blaster" vs "Bedroom Blaster")
  - track its physical room (independent of its IR devices' rooms)
  - show online / unreachable status
  - rename / delete / move it as a unit
  - know which blaster a re-discovered Broadlink corresponds to when more
    than one is on the LAN

The registry promotes blasters to first-class entities keyed by **MAC**
(stable across DHCP IP changes — the device's actual hardware identity),
while preserving the IP as live runtime state. IR-device records reference
a blaster by `blaster_id`, which is generated from the MAC at registration.

Migration: on first init, existing IR-device records are scanned, devices
are grouped by MAC (falling back to IP when a record predates MAC capture),
one blaster row is generated per group, and the `blaster_id` field is
backfilled into every device. Zero-touch on existing installs.

Storage: `user_files/ir_blasters.json`. Same shape as ir_devices.json
(plain JSON list, in-process lock for atomicity, no external DB).
"""
from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import datetime
from typing import Optional

from core.logger_module import log_info, log_error

BLASTERS_FILE = "user_files/ir_blasters.json"
_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _load() -> list[dict]:
    if not os.path.exists(BLASTERS_FILE):
        return []
    try:
        with open(BLASTERS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception as e:
        log_error(f"[Blasters] Failed to load {BLASTERS_FILE}: {e}")
        return []


def _save(blasters: list[dict]) -> None:
    os.makedirs(os.path.dirname(BLASTERS_FILE), exist_ok=True)
    with open(BLASTERS_FILE, "w", encoding="utf-8") as f:
        json.dump(blasters, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm_mac(mac: str | bytes | None) -> str:
    """Canonical lowercase-hex MAC, no separators. Mirrors ir_listener._norm_mac
    so registry comparisons and rediscovery comparisons agree."""
    if not mac:
        return ""
    if isinstance(mac, (bytes, bytearray)):
        return mac.hex().lower()
    return str(mac).replace(":", "").replace("-", "").replace(" ", "").lower()


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _new_blaster_id() -> str:
    # `blaster_xxxxxxxx` — short stable id, references stable across renames.
    # Generated once at registration; if the user deletes + re-adds the same
    # physical hardware they get a fresh id (intentional: registry rows are
    # configuration, not hardware twins).
    return f"blaster_{uuid.uuid4().hex[:8]}"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def list_blasters() -> list[dict]:
    """Return all registered blasters. Caller-facing read API."""
    with _lock:
        return [dict(b) for b in _load()]


def get_blaster(blaster_id: str) -> Optional[dict]:
    if not blaster_id:
        return None
    with _lock:
        for b in _load():
            if b.get("id") == blaster_id:
                return dict(b)
    return None


def get_by_mac(mac: str | bytes) -> Optional[dict]:
    """Lookup by MAC. Used by rediscovery to map a found device back to its
    registry row even after an IP change."""
    target = _norm_mac(mac)
    if not target:
        return None
    with _lock:
        for b in _load():
            if _norm_mac(b.get("mac")) == target:
                return dict(b)
    return None


def get_by_host(host: str) -> Optional[dict]:
    """Lookup by current IP. Used as a fallback for legacy records that
    never captured a MAC."""
    if not host:
        return None
    with _lock:
        for b in _load():
            if (b.get("ip") or "").strip() == host:
                return dict(b)
    return None


def create_blaster(
    *,
    name: str,
    mac: str | bytes,
    ip: str,
    model: Optional[str] = None,
    room: Optional[str] = None,
    ha_remote_entity_id: Optional[str] = None,
) -> dict:
    """Register a new blaster. If a row with the same MAC already exists,
    return that row instead of creating a duplicate — idempotent for the
    common "re-pair the same hardware" flow."""
    mac_norm = _norm_mac(mac)
    existing = get_by_mac(mac_norm) if mac_norm else None
    if existing:
        return existing
    blaster = {
        "id":                   _new_blaster_id(),
        "name":                 (name or "").strip() or "IR Blaster",
        "room":                 (room or "").strip().lower().replace(" ", "_") or None,
        "mac":                  mac_norm or None,
        "ip":                   (ip or "").strip() or None,
        "model":                model or None,
        "ha_remote_entity_id":  ha_remote_entity_id or None,
        "last_seen_at":         _now_iso(),
        "last_seen_ip":         (ip or "").strip() or None,
        "created_at":           _now_iso(),
    }
    with _lock:
        blasters = _load()
        blasters.append(blaster)
        _save(blasters)
    log_info(f"[Blasters] Created {blaster['id']} name={blaster['name']!r} ip={blaster['ip']}")
    return blaster


def update_blaster(blaster_id: str, updates: dict) -> Optional[dict]:
    """Patch named fields. Returns the updated row or None if not found.

    Whitelist of patchable fields enforces no accidental writes to id /
    mac / created_at (immutable) or runtime state (auto-updated below)."""
    _ALLOWED = {"name", "room", "model", "ha_remote_entity_id"}
    with _lock:
        blasters = _load()
        for i, b in enumerate(blasters):
            if b.get("id") != blaster_id:
                continue
            for k, v in (updates or {}).items():
                if k not in _ALLOWED:
                    continue
                if k == "name":
                    b["name"] = (v or "").strip() or b["name"]
                elif k == "room":
                    b["room"] = (v or "").strip().lower().replace(" ", "_") or None
                else:
                    b[k] = v
            blasters[i] = b
            _save(blasters)
            log_info(f"[Blasters] Updated {blaster_id}: {sorted(updates.keys())}")
            return dict(b)
    return None


def delete_blaster(blaster_id: str) -> bool:
    """Remove a blaster row. Returns True if removed.

    Does NOT cascade-delete IR devices attached to this blaster — caller
    decides the policy (usually: orphan them, surface a warning in the UI).
    """
    with _lock:
        blasters = _load()
        before = len(blasters)
        blasters[:] = [b for b in blasters if b.get("id") != blaster_id]
        if len(blasters) == before:
            return False
        _save(blasters)
    log_info(f"[Blasters] Deleted {blaster_id}")
    return True


# ---------------------------------------------------------------------------
# Runtime-state updates (called by ir_listener on every successful contact)
# ---------------------------------------------------------------------------

def mark_seen(blaster_id: str, ip: str) -> None:
    """Record that we just successfully talked to this blaster. Updates
    last_seen_at + tracks the current IP (which auto-rediscovery may have
    just changed). Fire-and-forget — failure here doesn't break the send."""
    if not blaster_id:
        return
    with _lock:
        blasters = _load()
        changed = False
        for b in blasters:
            if b.get("id") != blaster_id:
                continue
            now = _now_iso()
            new_ip = (ip or "").strip()
            if b.get("last_seen_at") != now:
                b["last_seen_at"] = now
                changed = True
            if new_ip and b.get("last_seen_ip") != new_ip:
                b["last_seen_ip"] = new_ip
                changed = True
            if new_ip and b.get("ip") != new_ip:
                b["ip"] = new_ip
                changed = True
            break
        if changed:
            _save(blasters)


def update_ip(blaster_id: str, new_ip: str) -> None:
    """Persist a new IP after auto-rediscovery. Same as the ip-only path of
    mark_seen, kept as a named function for clarity at the call site."""
    if not blaster_id or not new_ip:
        return
    with _lock:
        blasters = _load()
        for b in blasters:
            if b.get("id") == blaster_id and b.get("ip") != new_ip:
                b["ip"] = new_ip.strip()
                b["last_seen_at"] = _now_iso()
                b["last_seen_ip"] = new_ip.strip()
                _save(blasters)
                log_info(f"[Blasters] {blaster_id}: ip → {new_ip}")
                return


# ---------------------------------------------------------------------------
# Migration — bootstrap registry from existing ir_devices.json on first boot
# ---------------------------------------------------------------------------

def migrate_from_ir_devices() -> int:
    """Build the registry from existing IR-device records on first init.

    Groups records by (mac, ip) — MAC wins when present, IP-only fallback
    for legacy records that predate MAC capture. Generates one blaster row
    per group and back-fills `blaster_id` into each ir_devices.json entry.

    Idempotent: no-op when the registry already has rows. Returns the number
    of blaster rows created (0 on no-op or empty fresh install).
    """
    existing = _load()
    if existing:
        return 0

    try:
        from services.ir_manager import _load as _ir_load, _save as _ir_save
        ir_devices = _ir_load()
    except Exception as e:
        log_error(f"[Blasters] migrate: failed to load ir_devices: {e}")
        return 0

    if not ir_devices:
        return 0

    # Cluster IR devices by (mac or ip) — MAC is stable, IP is the legacy
    # fallback for records that predate the MAC-capture work.
    clusters: dict[str, list[dict]] = {}
    for d in ir_devices:
        host = (d.get("blaster_host") or "").strip()
        mac = _norm_mac(d.get("blaster_mac"))
        if not host and not mac:
            continue
        key = f"mac:{mac}" if mac else f"ip:{host}"
        clusters.setdefault(key, []).append(d)

    if not clusters:
        return 0

    created = 0
    with _lock:
        registry = _load()  # re-read inside lock (might have been seeded racily)
        if registry:
            return 0
        for key, devs in clusters.items():
            # Use the first device's blaster info to seed the registry row.
            first = devs[0]
            mac = _norm_mac(first.get("blaster_mac"))
            ip = (first.get("blaster_host") or "").strip()
            # Best-effort name + room: borrow from the first device with one.
            seed_room = next((d.get("room") for d in devs if d.get("room")), None)
            name = (
                f"Blaster in {seed_room.replace('_',' ').title()}"
                if seed_room else f"IR Blaster ({ip or 'unknown'})"
            )
            blaster = {
                "id":                   _new_blaster_id(),
                "name":                 name,
                "room":                 seed_room or None,
                "mac":                  mac or None,
                "ip":                   ip or None,
                "model":                None,
                "ha_remote_entity_id":  None,
                "last_seen_at":         _now_iso(),
                "last_seen_ip":         ip or None,
                "created_at":           _now_iso(),
            }
            registry.append(blaster)
            created += 1
            # Back-fill blaster_id into every device in this cluster.
            for d in devs:
                d["blaster_id"] = blaster["id"]
        _save(registry)

    # Persist the back-filled ir_devices.json.
    try:
        _ir_save(ir_devices)
    except Exception as e:
        log_error(f"[Blasters] migrate: failed to save back-filled ir_devices: {e}")

    log_info(f"[Blasters] Migration: created {created} blaster row(s) from existing IR devices")
    return created


def ensure_initialized() -> None:
    """Idempotent boot hook — runs migration on cold start, no-op otherwise.

    Called from ziggy_main during startup. Safe to call multiple times.
    """
    try:
        migrate_from_ir_devices()
    except Exception as e:
        log_error(f"[Blasters] ensure_initialized failed: {e}")


# ---------------------------------------------------------------------------
# Status — derived field, not stored
# ---------------------------------------------------------------------------

def status_for(blaster: dict, *, online_window_s: int = 60, stale_window_s: int = 300) -> str:
    """Derive a UI status string from `last_seen_at`. Three buckets:

      online       — last_seen_at within `online_window_s` (default 60s)
      stale        — within `stale_window_s` (default 5 min) but not online
      unreachable  — older than stale_window_s, OR last_seen_at missing

    Pure function, safe to call from any context.
    """
    ts = blaster.get("last_seen_at")
    if not ts:
        return "unreachable"
    try:
        seen = datetime.fromisoformat(ts)
    except Exception:
        return "unreachable"
    age = (datetime.now() - seen).total_seconds()
    if age < 0:
        return "online"   # clock skew, treat as online
    if age <= online_window_s:
        return "online"
    if age <= stale_window_s:
        return "stale"
    return "unreachable"
