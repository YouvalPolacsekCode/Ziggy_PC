"""
Compatibility shim between the universal device-state engine and the legacy
device-record shape.

The legacy record had:
  - device["assumed_state"]        : "on" | "off" | "unknown"
  - device["assumed_state_at"]     : "%Y-%m-%d %H:%M:%S" ISO-ish
  - device["ac_memory"]            : {"mode": ..., "temp": ..., "fan": ...}

The new record adds:
  - device["state"]                : {"template": "ac" | "tv" | ...,
                                       "values": {...},
                                       "live_at": float | None,
                                       "estimated_at": float | None}

This shim:
  1. Maps legacy device_type → template id (with sensible fallback to "custom").
  2. Builds an initial device["state"] from legacy fields when migrating.
  3. Keeps legacy fields mirrored to the new state so consumers that still
     read assumed_state / ac_memory keep working until the deprecation lands.

The shim is intentionally read-only on the legacy side once a state record
exists — the new engine is the source of truth.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Optional

from services.device_state import (
    DeviceTemplate,
    apply_button_press,
    apply_decoded_full_state,
    get_template,
    make_state_record,
    state_with_confidence,
)


# device_type values used historically in ir_devices.json. Any not listed
# falls back to "custom" — gives every device a state, but with minimal schema.
_TYPE_TO_TEMPLATE = {
    "ac":        "ac",
    "tv":        "tv",
    "streamer":  "streamer",
    "soundbar":  "soundbar",
    "stb":       "stb",
    "settopbox": "stb",
    "fan":       "fan",
    "heater":    "fan",
}


def template_for_device_type(device_type: Optional[str]) -> DeviceTemplate:
    """Pick a template for a legacy device_type. Falls back to 'custom'."""
    norm = (device_type or "").strip().lower()
    tid = _TYPE_TO_TEMPLATE.get(norm, "custom")
    tpl = get_template(tid)
    if tpl is None:
        return get_template("custom")  # type: ignore[return-value]
    return tpl


# ---------------------------------------------------------------------------
# Legacy → new migration
# ---------------------------------------------------------------------------

def _parse_legacy_timestamp(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(s, fmt).timestamp()
        except (ValueError, TypeError):
            continue
    return None


def initial_state_from_legacy(device: dict) -> dict:
    """Build a state record from legacy fields.

    Used when `_load()` sees a device that doesn't have `state` yet (existing
    install pre-abstraction). Preserves any history encoded in the legacy
    fields rather than wiping state to defaults.
    """
    tpl = template_for_device_type(device.get("type"))
    rec = make_state_record(tpl)

    # Power: legacy assumed_state -> values.power
    assumed = (device.get("assumed_state") or "").lower()
    if assumed == "on":
        rec["values"]["power"] = True
    elif assumed == "off":
        rec["values"]["power"] = False

    # AC memory fields -> values
    ac_mem = device.get("ac_memory") or {}
    for legacy_field in ("mode", "temp", "fan", "swing"):
        if legacy_field in tpl.schema and ac_mem.get(legacy_field) is not None:
            field = tpl.schema[legacy_field]
            rec["values"][legacy_field] = field.clamp(ac_mem[legacy_field])

    # Timestamp: legacy field is human-readable; promote to estimated_at
    # (not live_at — we can't tell from history whether the past observation
    # was RX-confirmed or Ziggy-initiated).
    ts = _parse_legacy_timestamp(device.get("assumed_state_at"))
    if ts is not None:
        rec["estimated_at"] = ts

    return rec


def ensure_state(device: dict) -> dict:
    """Return device with `state` populated. In-place safe; returns the same dict.

    Idempotent — leaves existing `state` untouched. Use at every read path
    in ir_manager so progressive migration doesn't require a one-shot
    upgrade script.
    """
    if not isinstance(device.get("state"), dict):
        device["state"] = initial_state_from_legacy(device)
    elif not device["state"].get("template"):
        # Repair: state dict missing template id (corrupted record)
        device["state"]["template"] = template_for_device_type(device.get("type")).id
    return device


# ---------------------------------------------------------------------------
# Legacy mirror — keep assumed_state / ac_memory in sync with values
# ---------------------------------------------------------------------------

def mirror_state_to_legacy(device: dict) -> None:
    """Copy the new state values back into legacy fields. In-place.

    Until consumers migrate to reading device["state"]["values"], this keeps
    existing code paths (intent handlers, UI, debug logs) reading consistent
    state regardless of which surface mutated it.
    """
    state = device.get("state") or {}
    values = state.get("values") or {}
    if not values:
        return

    # Power
    if "power" in values:
        device["assumed_state"] = "on" if values["power"] else "off"
        # Choose the most recent timestamp from either band
        ts = state.get("live_at") or state.get("estimated_at")
        if ts:
            device["assumed_state_at"] = datetime.fromtimestamp(
                float(ts)
            ).strftime("%Y-%m-%d %H:%M:%S")

    # AC memory mirror — only for templates that have these fields
    ac_fields = {"mode", "temp", "fan", "swing"}
    overlap = ac_fields & set(values.keys())
    if overlap:
        mem = device.get("ac_memory") or {}
        for k in overlap:
            mem[k] = values[k]
        device["ac_memory"] = mem


# ---------------------------------------------------------------------------
# Mutation entry points — the manager calls these instead of touching state directly
# ---------------------------------------------------------------------------

def apply_button(device: dict, command: str, *, source: str = "estimated") -> dict:
    """Apply a button press to device state. Mirrors legacy fields. In-place.

    `source`:
      "live"      — RX-confirmed (physical-remote press matched a learned code)
      "estimated" — Ziggy-initiated (we sent the command ourselves)

    Returns the same device dict.
    """
    ensure_state(device)
    tpl = get_template(device["state"]["template"])
    if tpl is None:
        return device
    new_values = apply_button_press(device["state"]["values"], tpl, command)
    device["state"]["values"] = new_values
    now = time.time()
    if source == "live":
        device["state"]["live_at"] = now
    else:
        device["state"]["estimated_at"] = now
    mirror_state_to_legacy(device)
    return device


def apply_decoded_state(device: dict, decoded: dict) -> dict:
    """Apply a fully-decoded stateful payload (e.g. AC). Always live.

    `decoded` is a plain dict of field-value pairs. Unknown fields are
    silently dropped by the engine. Mirrors legacy fields. In-place.
    """
    ensure_state(device)
    tpl = get_template(device["state"]["template"])
    if tpl is None:
        return device
    new_values = apply_decoded_full_state(device["state"]["values"], tpl, decoded)
    device["state"]["values"] = new_values
    device["state"]["live_at"] = time.time()
    mirror_state_to_legacy(device)
    return device


def ac_state_to_dict(ac_state) -> dict:
    """Coerce an ir_protocol.AcState dataclass to a plain dict for the engine.

    Accepts `None`s, "on"/"off" strings for power, and snake-case field names.
    Drops fields the engine doesn't recognize.
    """
    if ac_state is None:
        return {}
    out: dict[str, Any] = {}
    power = getattr(ac_state, "power", None)
    if isinstance(power, str):
        if power.lower() == "on":
            out["power"] = True
        elif power.lower() == "off":
            out["power"] = False
    elif isinstance(power, bool):
        out["power"] = power
    for f in ("mode", "temp", "fan", "swing"):
        v = getattr(ac_state, f, None)
        if v is not None:
            out[f] = v
    return out


# ---------------------------------------------------------------------------
# Read-side helpers
# ---------------------------------------------------------------------------

def state_snapshot(device: dict) -> dict:
    """UI-shape snapshot for a device record. Adds confidence + age.

    Use this anywhere the UI or an intent handler needs to read state. It
    auto-migrates on read so callers don't need to know about legacy.
    """
    ensure_state(device)
    snap = state_with_confidence(device["state"])
    snap["device_id"] = device.get("id")
    return snap
