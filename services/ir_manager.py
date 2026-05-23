"""
IR device registry and command dispatcher (Hybrid Option C).

HA Broadlink integration owns raw IR code storage and transmission.
Ziggy owns the virtual device registry: name, room, type, assumed state,
command map, and optional command sequences.

Key capabilities:
  - Assumed-state tracking  (power toggle, AC mode/temp memory)
  - AC power-first logic    (send power before temp if AC assumed off)
  - Command sequences       (macros: "open Netflix" = ordered steps with delays)
  - Channel number dispatch ("channel 12" = digit_1 + digit_2 + digit_ok)
  - HA entity state link    (TV state verified via media_player before IR)
  - Live GPT context hint   (injected per-request so GPT knows what exists)
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime
from typing import Optional

from core.logger_module import log_info, log_error
from core.debug_bus import bus as _debug_bus, BASIC, VERBOSE
from services.home_automation import call_service, get_all_states, get_state

IR_DEVICES_FILE = "user_files/ir_devices.json"


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _load() -> list[dict]:
    if not os.path.exists(IR_DEVICES_FILE):
        return []
    try:
        with open(IR_DEVICES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log_error(f"[IR] Failed to load {IR_DEVICES_FILE}: {e}")
        return []


def _save(devices: list[dict]) -> None:
    os.makedirs(os.path.dirname(IR_DEVICES_FILE), exist_ok=True)
    with open(IR_DEVICES_FILE, "w", encoding="utf-8") as f:
        json.dump(devices, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def list_ir_devices(
    room: Optional[str] = None,
    device_type: Optional[str] = None,
    enabled_only: bool = True,
) -> list[dict]:
    devices = _load()
    if room:
        norm = room.lower().replace(" ", "_")
        devices = [d for d in devices if d.get("room") == norm]
    if device_type:
        devices = [d for d in devices if d.get("type") == device_type.lower()]
    if enabled_only:
        devices = [d for d in devices if d.get("enabled", True)]
    return devices


def get_ir_device(device_id: str) -> Optional[dict]:
    for d in _load():
        if d["id"] == device_id:
            return d
    return None


def create_ir_device(
    name: str,
    device_type: str,
    blaster_entity_id: str,
    room: Optional[str] = "",
    *,
    brand: str = "",
    model: str = "",
    aliases: Optional[list[str]] = None,
    commands: Optional[dict[str, str]] = None,
    sequences: Optional[dict[str, list[dict]]] = None,
    ac_config: Optional[dict] = None,
    ha_entity_id: Optional[str] = None,
    blaster_host: Optional[str] = None,
) -> dict:
    room_norm = (room or name).lower().replace(" ", "_")
    ha_device_namespace = f"{room_norm}_{device_type.lower()}"
    device: dict = {
        "id": f"ir_{uuid.uuid4().hex[:10]}",
        "name": name.strip(),
        "type": device_type.lower(),
        "blaster_entity_id": blaster_entity_id,
        "ha_device_namespace": ha_device_namespace,
        "ha_entity_id": ha_entity_id or None,   # optional linked HA entity for real state
        "room": room_norm,
        "brand": brand,
        "model": model,
        "enabled": True,
        "aliases": aliases or [],
        "capabilities": _default_capabilities(device_type),
        "commands": commands if commands is not None else _default_commands(device_type),
        "sequences": sequences if sequences is not None else _default_sequences(device_type),
        "learned_commands": [],
        # Raw IR hex codes per command — populated when a receiver captures them.
        # Used for signal matching (Phase 2: ESPHome IR receiver).
        "ir_codes": {},
        "ac_config": ac_config or (_default_ac_config() if device_type.lower() == "ac" else None),
        # Assumed state — updated optimistically on every command sent
        "assumed_state": "unknown",
        "assumed_state_at": None,
        # Last command Ziggy sent — for diagnostics and UI
        "last_command_sent": None,
        "last_command_sent_at": None,
        # AC memory — last known settings
        "ac_memory": {"mode": None, "temp": None, "fan": None} if device_type.lower() == "ac" else None,
        # Direct IP of the Broadlink device on the local network.
        # When set, Ziggy talks to the blaster via python-broadlink directly
        # instead of routing through HA's remote.* integration. This enables:
        #   - Continuous IR receive (physical remote detection)
        #   - Raw code storage for signal matching
        # Falls back to HA remote.send_command if not set or if ir_codes missing.
        "blaster_host": blaster_host or None,
        # IR capability flags — derived from blaster_host presence.
        # can_receive_ir becomes True once blaster_host is set and listener starts.
        "ir_capabilities": {
            "can_send_ir":       True,
            "can_learn_ir":      True,
            "can_receive_ir":    bool(blaster_host),
            "supports_feedback": bool(blaster_host),
        },
        "created": datetime.now().strftime("%Y-%m-%d %H:%M"),
    }
    devices = _load()
    devices.append(device)
    _save(devices)
    log_info(f"[IR] Created device: {device['name']} ({device['id']})")
    return device


def update_ir_device(device_id: str, updates: dict) -> Optional[dict]:
    devices = _load()
    _allowed = {
        "name", "room", "brand", "model", "type", "enabled", "aliases",
        "commands", "sequences", "ac_config", "learned_commands",
        "assumed_state", "assumed_state_at", "ac_memory", "ha_entity_id",
        "ir_codes", "ir_capabilities", "blaster_host",
        "last_command_sent", "last_command_sent_at",
        # Free-form user-defined buttons (managed via add/remove_custom_command).
        "custom_commands",
    }
    # normalise device_type → type (frontend uses device_type, storage uses type)
    if "device_type" in updates:
        updates["type"] = updates.pop("device_type")
    for i, d in enumerate(devices):
        if d["id"] == device_id:
            for k, v in updates.items():
                if k in _allowed:
                    devices[i][k] = v
            _save(devices)
            return devices[i]
    return None


def delete_ir_device(device_id: str) -> bool:
    devices = _load()
    updated = [d for d in devices if d["id"] != device_id]
    if len(updated) == len(devices):
        return False
    _save(updated)
    log_info(f"[IR] Deleted device: {device_id}")
    return True


# ---------------------------------------------------------------------------
# Command catalog — metadata used by the wizard/edit UI to show which logical
# commands each device type supports. Pulled from the same _default_commands
# table that new devices are seeded from, so the two never drift.
# ---------------------------------------------------------------------------

def _label_for(command_id: str) -> str:
    """Default human label for a command id (snake_case → Title Case)."""
    return command_id.replace("_", " ").strip().title()


# Top-N + everything-else layout. Each device type surfaces at most
# `_CATALOG_TOP_N` commands inline; the rest sit under a single "More"
# expand. Avoid drowning the user in 40+ commands on first setup — most
# remotes only need a handful for daily use, and Unassigned-Signals
# binding handles the rest on demand.
_CATALOG_TOP_N = 4

# Ordered top-N picks per device type. Anything in default_commands NOT
# listed here lands in "More".
#
# AC layout is Israel-first (product launches there): cool-mode-dominant
# usage, heat is rare. power_on + power_off as separate captures matter
# because most Israeli AC remotes (Tadiran/Electra/Tornado) are stateful —
# learning the same physical "on" button at two different AC states gives
# Ziggy reliable on/off state inference without bit-position decoding.
_CATALOG_TOP_COMMANDS: dict[str, list[str]] = {
    "tv":        ["power", "volume_up", "volume_down", "mute"],
    "ac":        ["power_on", "power_off", "mode_cool", "fan_auto"],
    "fan":       ["power", "speed_low", "speed_medium", "speed_high"],
    "soundbar":  ["power", "volume_up", "volume_down", "mute"],
    "projector": ["power", "input_hdmi", "nav_ok", "back"],
    "custom":    ["power"],
}


def _build_catalog_for(device_type: str) -> dict:
    """
    Catalog for one device type in the grouped + core/extras shape the
    wizard renders.

    Layout: ONE "Top" group with up to _CATALOG_TOP_N commands (always
    visible), ONE "More" group with everything else (collapsed behind a
    single expand link). Surfacing more than ~4 commands inline on first
    setup overwhelms; the rest are one click away and physical-remote
    binding can teach new ones on demand.
    """
    dt = device_type.lower()
    cmd_map = _default_commands(dt)
    top_picks = _CATALOG_TOP_COMMANDS.get(dt) or _CATALOG_TOP_COMMANDS["custom"]

    # Top: only ids that actually exist in the default command map for
    # this type — defensive against drift between the two tables.
    top_ids = [cid for cid in top_picks if cid in cmd_map][:_CATALOG_TOP_N]
    top_commands = [
        {"id": cid, "label": _label_for(cid), "core": True}
        for cid in top_ids
    ]
    # More: everything else in the default command map, in declaration order.
    more_ids = [cid for cid in cmd_map.keys() if cid not in top_ids]
    more_commands = [
        {"id": cid, "label": _label_for(cid), "core": False}
        for cid in more_ids
    ]

    groups = []
    if top_commands:
        groups.append({"id": "top", "label": "Top", "commands": top_commands})
    if more_commands:
        groups.append({"id": "more", "label": "More", "commands": more_commands})
    return {
        "type": dt,
        "label": dt.capitalize(),
        "capabilities": _default_capabilities(dt),
        "groups": groups,
    }


def get_command_catalog(device_type: Optional[str] = None) -> dict:
    """
    Catalog of available command ids per device type, with friendly labels
    and a groups+core/extras layout the wizard renders.

    Called by the learn UI to know which buttons to surface for a given
    device. Returns a single catalog entry when device_type is provided,
    or a dict keyed by device type otherwise.
    """
    types = (
        [device_type.lower()] if device_type else
        ["tv", "ac", "fan", "soundbar", "projector", "custom"]
    )
    if device_type:
        return _build_catalog_for(device_type)
    return {dt: _build_catalog_for(dt) for dt in types}


# ---------------------------------------------------------------------------
# Custom commands — user-defined buttons not in the default catalog.
# Stored under d["custom_commands"] as a list of {id, label}; also mirrored
# into d["commands"] so the existing dispatcher can resolve them.
# ---------------------------------------------------------------------------

def _normalize_command_id(command_id: str) -> str:
    """Slug-safe normalization for user-entered command ids."""
    s = (command_id or "").strip().lower()
    out = []
    for ch in s:
        if ch.isalnum():
            out.append(ch)
        elif ch in (" ", "-", "_"):
            out.append("_")
    return "".join(out).strip("_")


def add_custom_command(
    device_id: str,
    command_id: str,
    label: Optional[str] = None,
) -> Optional[dict]:
    """Add a custom command to a device. Returns the updated device or None."""
    norm_id = _normalize_command_id(command_id)
    if not norm_id:
        return None
    devices = _load()
    for d in devices:
        if d["id"] != device_id:
            continue
        custom: list = d.get("custom_commands") or []
        if not any(c.get("id") == norm_id for c in custom):
            custom.append({"id": norm_id, "label": label or _label_for(norm_id)})
            d["custom_commands"] = custom
        # Mirror into the commands map so send_ir_command can resolve it
        cmds = d.get("commands") or {}
        if norm_id not in cmds:
            cmds[norm_id] = norm_id
            d["commands"] = cmds
        _save(devices)
        log_info(f"[IR] Added custom command '{norm_id}' to {d.get('name')}")
        return d
    return None


def remove_custom_command(device_id: str, command_id: str) -> Optional[dict]:
    """
    Remove a custom command and any state it accumulated (learned flag,
    stored ir_codes). Returns the updated device or None.
    """
    devices = _load()
    for d in devices:
        if d["id"] != device_id:
            continue
        d["custom_commands"] = [
            c for c in (d.get("custom_commands") or [])
            if c.get("id") != command_id
        ]
        cmds = d.get("commands") or {}
        cmds.pop(command_id, None)
        d["commands"] = cmds
        d["learned_commands"] = [
            c for c in (d.get("learned_commands") or [])
            if c != command_id
        ]
        ir_codes = d.get("ir_codes") or {}
        ir_codes.pop(command_id, None)
        d["ir_codes"] = ir_codes
        _save(devices)
        log_info(f"[IR] Removed custom command '{command_id}' from {d.get('name')}")
        return d
    return None


# ---------------------------------------------------------------------------
# Sequence (macro) CRUD — execution lives further down in send_sequence().
# ---------------------------------------------------------------------------

def set_sequence(
    device_id: str,
    name: str,
    steps: list[dict],
) -> Optional[dict]:
    """Create or update a sequence (macro) on a device."""
    name = (name or "").strip()
    if not name:
        return None
    devices = _load()
    for d in devices:
        if d["id"] != device_id:
            continue
        seqs = d.get("sequences") or {}
        seqs[name] = list(steps or [])
        d["sequences"] = seqs
        _save(devices)
        log_info(f"[IR] Saved sequence '{name}' ({len(steps or [])} steps) on {d.get('name')}")
        return d
    return None


def delete_sequence(device_id: str, name: str) -> Optional[dict]:
    """Delete a sequence by name. Returns the updated device or None."""
    devices = _load()
    for d in devices:
        if d["id"] != device_id:
            continue
        seqs = d.get("sequences") or {}
        if name in seqs:
            del seqs[name]
            d["sequences"] = seqs
            _save(devices)
            log_info(f"[IR] Deleted sequence '{name}' from {d.get('name')}")
        return d
    return None


def mark_command_learned(device_id: str, command_name: str, raw_code_b64: Optional[str] = None) -> bool:
    """Mark a command as learned. If raw_code_b64 is provided, store it for direct send/matching."""
    devices = _load()
    for d in devices:
        if d["id"] == device_id:
            learned: list = d.get("learned_commands") or []
            if command_name not in learned:
                learned.append(command_name)
                d["learned_commands"] = learned
            if raw_code_b64:
                codes: dict = d.get("ir_codes") or {}
                codes[command_name] = raw_code_b64
                d["ir_codes"] = codes
                # Update capability flags now that we have a raw code
                caps = d.get("ir_capabilities") or {}
                if d.get("blaster_host"):
                    caps["can_receive_ir"] = True
                    caps["supports_feedback"] = True
                d["ir_capabilities"] = caps
            _save(devices)
            return True
    return False


# ---------------------------------------------------------------------------
# Blaster discovery
# ---------------------------------------------------------------------------

def list_ir_blasters() -> list[dict]:
    """Return all remote.* entities from HA — physical Broadlink blasters."""
    try:
        return [
            {
                "entity_id": s["entity_id"],
                "name": s.get("attributes", {}).get("friendly_name", s["entity_id"]),
                "state": s.get("state"),
            }
            for s in get_all_states()
            if s.get("entity_id", "").startswith("remote.")
        ]
    except Exception as e:
        log_error(f"[IR] list_ir_blasters: {e}")
        return []


# ---------------------------------------------------------------------------
# State management
# ---------------------------------------------------------------------------

def get_device_state(device: dict) -> str:
    """
    Return the best-known state for an IR device.
    Priority: HA entity state (if linked) > assumed_state > "unknown".
    """
    state, _ = get_device_state_with_confidence(device)
    return state


def get_device_state_with_confidence(device: dict) -> tuple[str, str]:
    """
    Return (state, confidence) for an IR device.

    confidence values:
      "confirmed"  — live HA entity state
      "estimated"  — Ziggy sent a command and assumed state updated
      "unknown"    — no state information available
    """
    ha_eid = device.get("ha_entity_id")
    if ha_eid:
        result = get_state(ha_eid)
        if result.get("ok"):
            raw = result["data"].get("state", "unknown")
            if raw in ("on", "playing", "idle", "paused"):
                return "on", "confirmed"
            if raw in ("off", "unavailable"):
                return "off", "confirmed"

    assumed = device.get("assumed_state", "unknown")
    if assumed in ("on", "off"):
        return assumed, "estimated"
    return "unknown", "unknown"


def _record_last_command(device_id: str, command: str) -> None:
    devices = _load()
    for d in devices:
        if d["id"] == device_id:
            d["last_command_sent"] = command
            d["last_command_sent_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            break
    _save(devices)


def _set_assumed_state(device_id: str, state: str) -> None:
    devices = _load()
    for d in devices:
        if d["id"] == device_id:
            d["assumed_state"] = state
            d["assumed_state_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            break
    _save(devices)


def _update_ac_memory(device_id: str, **kwargs) -> None:
    """Update AC memory fields (mode, temp, fan) without overwriting others."""
    devices = _load()
    for d in devices:
        if d["id"] == device_id:
            mem = d.get("ac_memory") or {}
            for k, v in kwargs.items():
                if v is not None:
                    mem[k] = v
            d["ac_memory"] = mem
            break
    _save(devices)


def apply_decoded_ac_state(device_id: str, ac_state) -> bool:
    """
    Apply state extracted from a physical-remote AC IR packet to the device.

    Called by ir_listener when an AC protocol packet (Mitsubishi, Daikin,
    Gree/Tadiran, ...) is decoded but no exact code matches. Updates the
    assumed_state, ac_memory, and last-command tracking so Ziggy's
    next-command logic (power-first if off, ac_memory-based mode/temp
    preservation) reflects what the physical remote just did.

    `ac_state` is a services.ir_protocol.AcState dataclass. Accepted as
    plain object here to avoid an import cycle (ir_protocol stays pure).
    """
    devices = _load()
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for d in devices:
        if d["id"] != device_id:
            continue
        if getattr(ac_state, "power", None) in ("on", "off"):
            d["assumed_state"] = ac_state.power
            d["assumed_state_at"] = timestamp
        mem = d.get("ac_memory") or {}
        for field in ("mode", "temp", "fan"):
            val = getattr(ac_state, field, None)
            if val is not None:
                mem[field] = val
        d["ac_memory"] = mem
        brand = getattr(ac_state, "brand", "") or "unknown"
        d["last_command_sent"] = f"physical_remote_{brand}"
        d["last_command_sent_at"] = timestamp
        _save(devices)
        log_info(
            f"[IR] Applied decoded AC state to {d.get('name')}: "
            f"power={getattr(ac_state, 'power', None)} "
            f"mode={getattr(ac_state, 'mode', None)} "
            f"temp={getattr(ac_state, 'temp', None)} "
            f"fan={getattr(ac_state, 'fan', None)} brand={brand}"
        )
        return True
    return False


# ---------------------------------------------------------------------------
# Device resolution
# ---------------------------------------------------------------------------

def resolve_ir_device(
    room: Optional[str],
    device_type: str,
) -> tuple[Optional[dict], str]:
    devices = list_ir_devices(room=room, device_type=device_type)
    if not devices:
        room_str = (room or "").replace("_", " ") or "any room"
        return None, f"No IR {device_type} found in {room_str}. Set one up in the Devices panel."
    if len(devices) == 1:
        return devices[0], ""
    if not room:
        return devices[0], ""
    names = ", ".join(d["name"] for d in devices)
    return None, f"Multiple IR {device_type} devices in {room.replace('_', ' ')}: {names}. Be more specific."


# ---------------------------------------------------------------------------
# Single command dispatch
# ---------------------------------------------------------------------------

def send_ir_command(device_id: str, logical_command: str, repeats: int = 1) -> dict:
    """
    Send one logical command and update assumed state.

    Send path priority:
      1. Direct via python-broadlink (if blaster_host set AND ir_codes has raw code)
      2. HA remote.send_command (existing path, requires command in learned_commands)
    """
    device = get_ir_device(device_id)
    if not device:
        _debug_bus.emit("ir", BASIC, "ir_device_not_found",
                        device_id=device_id, command=logical_command,
                        result="error",
                        suggestion=f"Device '{device_id}' not in IR device list. Check IR Devices settings.")
        return {"ok": False, "message": f"IR device '{device_id}' not found."}

    # Path 1: direct send via python-broadlink (supports continuous receive)
    blaster_host = (device.get("blaster_host") or "").strip()
    ir_codes: dict = device.get("ir_codes") or {}
    raw_code_b64 = ir_codes.get(logical_command)

    _debug_bus.emit("ir", VERBOSE, "ir_command_dispatch",
                    device_id=device_id, device_name=device.get("name"),
                    command=logical_command, repeats=repeats,
                    path="direct" if (blaster_host and raw_code_b64) else "ha")

    if blaster_host and raw_code_b64:
        result = _direct_send(blaster_host, raw_code_b64, repeats)
        if result.get("ok"):
            _after_command(device_id, device, logical_command)
            _debug_bus.emit("ir", BASIC, "ir_command_sent",
                            device_id=device_id, command=logical_command,
                            path="direct", result="ok")
        else:
            _debug_bus.emit("ir", BASIC, "ir_command_failed",
                            device_id=device_id, command=logical_command,
                            path="direct", result="error",
                            message=result.get("message"),
                            suggestion="Check blaster_host connectivity and raw IR code validity.")
        return result

    # Path 2: HA remote.send_command (original flow)
    command_map: dict = device.get("commands") or {}
    learned: list = device.get("learned_commands") or []

    ha_command = command_map.get(logical_command)
    if not ha_command:
        available = ", ".join(learned) if learned else "none yet"
        _debug_bus.emit("ir", BASIC, "ir_command_not_configured",
                        device_id=device_id, command=logical_command,
                        available_commands=learned, result="error",
                        suggestion=f"Learn '{logical_command}' via the IR Wizard first.")
        return {
            "ok": False,
            "message": (
                f"Command '{logical_command}' is not configured for {device['name']}. "
                f"Available learned commands: {available}"
            ),
        }

    if logical_command not in learned:
        _debug_bus.emit("ir", BASIC, "ir_command_not_learned",
                        device_id=device_id, command=logical_command,
                        result="error",
                        suggestion=f"Press Learn in the IR Wizard for '{logical_command}', then point the remote at the blaster.")
        return {
            "ok": False,
            "message": (
                f"Command '{logical_command}' exists but hasn't been learned yet for {device['name']}. "
                f"Use the Devices panel to learn it first."
            ),
        }

    result = _ha_send(
        blaster_entity=device["blaster_entity_id"],
        device_namespace=device["ha_device_namespace"],
        ha_command=ha_command,
        repeats=repeats,
    )

    if result.get("ok"):
        _after_command(device_id, device, logical_command)
        _debug_bus.emit("ir", BASIC, "ir_command_sent",
                        device_id=device_id, command=logical_command,
                        path="ha", result="ok")
    else:
        _debug_bus.emit("ir", BASIC, "ir_command_failed",
                        device_id=device_id, command=logical_command,
                        path="ha", result="error",
                        message=result.get("message"),
                        suggestion="Check HA remote entity and Broadlink blaster connectivity.")

    return result


def _ha_send(blaster_entity: str, device_namespace: str, ha_command: str, repeats: int = 1) -> dict:
    data = {
        "entity_id": blaster_entity,
        "device": device_namespace,
        "command": ha_command,
        "num_repeats": repeats,
        "delay_secs": 0.4,
    }
    result = call_service("remote", "send_command", data)
    if result.get("ok"):
        log_info(f"[IR] Sent {device_namespace}/{ha_command}")
    return result


def _direct_send(host: str, code_b64: str, repeats: int = 1) -> dict:
    """Send raw IR code directly via python-broadlink (synchronous, runs in caller's thread)."""
    import base64
    try:
        import broadlink as _bl
        raw = base64.b64decode(code_b64)
        dev = _bl.hello(host)
        dev.auth()
        for _ in range(max(1, repeats)):
            dev.send_data(raw)
        log_info(f"[IR] Direct send to {host}")
        return {"ok": True}
    except Exception as e:
        log_error(f"[IR] Direct send to {host} failed: {e}")
        return {"ok": False, "message": f"Direct IR send failed: {e}"}


def _after_command(device_id: str, device: dict, logical_command: str) -> None:
    """Update assumed state, AC memory, and last-sent tracking after a successful command."""
    dtype = device.get("type", "")
    current = device.get("assumed_state", "unknown")

    # Always record what was sent and when, regardless of command type
    _record_last_command(device_id, logical_command)

    if logical_command == "power_on":
        # Explicit on — AC remotes send different codes for on vs off
        _set_assumed_state(device_id, "on")

    elif logical_command == "power_off":
        # Explicit off
        _set_assumed_state(device_id, "off")

    elif logical_command == "power":
        # Toggle: on→off, off→on, unknown→on (optimistic)
        new_state = "off" if current == "on" else "on"
        _set_assumed_state(device_id, new_state)

    elif dtype == "ac":
        if logical_command.startswith("mode_"):
            _update_ac_memory(device_id, mode=logical_command.replace("mode_", ""))
            _set_assumed_state(device_id, "on")
        elif logical_command.startswith("temp_"):
            try:
                temp = int(logical_command.split("_")[1])
                _update_ac_memory(device_id, temp=temp)
            except ValueError:
                pass
            _set_assumed_state(device_id, "on")
        elif logical_command.startswith("fan_"):
            _update_ac_memory(device_id, fan=logical_command.replace("fan_", ""))


# ---------------------------------------------------------------------------
# AC temperature (power-first if assumed off)
# ---------------------------------------------------------------------------

async def send_ac_temperature(
    device_id: str,
    temperature: int,
    mode: Optional[str] = None,
) -> dict:
    device = get_ir_device(device_id)
    if not device:
        return {"ok": False, "message": f"IR device '{device_id}' not found."}
    if device.get("type") != "ac":
        return {"ok": False, "message": f"{device['name']} is not an AC device."}

    ac_cfg: dict = device.get("ac_config") or _default_ac_config()
    temp_min, temp_max = ac_cfg.get("temp_range", [16, 30])
    if not (temp_min <= temperature <= temp_max):
        return {"ok": False, "message": f"{temperature}°C is out of range ({temp_min}–{temp_max}°C)."}

    # Power on first if AC assumed off
    state = get_device_state(device)
    if state in ("off", "unknown"):
        power_result = send_ir_command(device_id, "power")
        if not power_result.get("ok"):
            return {"ok": False, "message": f"Couldn't turn on the AC: {power_result.get('message')}"}
        # AC needs a moment to boot before accepting temperature commands
        await asyncio.sleep(1.5)
        # Reload device after state update
        device = get_ir_device(device_id)

    results = []
    if mode:
        results.append(send_ir_command(device_id, f"mode_{mode.lower()}"))
        await asyncio.sleep(0.3)

    temp_mode = ac_cfg.get("temp_mode", "discrete")
    if temp_mode == "discrete":
        results.append(send_ir_command(device_id, f"temp_{temperature}"))
    else:
        return {
            "ok": False,
            "message": "Step-mode AC is not yet supported. Learn discrete temperature commands.",
        }

    if any(r.get("ok") for r in results):
        mode_str = f" in {mode} mode" if mode else ""
        return {"ok": True, "message": f"AC set to {temperature}°C{mode_str}."}
    for r in results:
        if not r.get("ok"):
            return r
    return {"ok": False, "message": "Couldn't send AC temperature command."}


# ---------------------------------------------------------------------------
# Channel number dispatch
# ---------------------------------------------------------------------------

async def send_channel(device_id: str, channel_number: int) -> dict:
    """
    Send a TV channel by number: decompose into individual digits then send ok/enter.
    Requires digit_0..digit_9 and digit_ok commands to be learned.
    """
    device = get_ir_device(device_id)
    if not device:
        return {"ok": False, "message": f"IR device '{device_id}' not found."}

    digits = [f"digit_{d}" for d in str(channel_number)]
    commands = digits + ["digit_ok"]
    command_map: dict = device.get("commands") or {}

    missing = [c for c in commands if c not in command_map]
    if missing:
        return {
            "ok": False,
            "message": (
                f"Channel digits not learned yet: {', '.join(missing)}. "
                "Learn digit_0 through digit_9 and digit_ok in the setup wizard."
            ),
        }

    for cmd in commands:
        result = send_ir_command(device_id, cmd)
        if not result.get("ok"):
            return {"ok": False, "message": f"Failed at digit '{cmd}': {result.get('message')}"}
        await asyncio.sleep(0.35)

    return {"ok": True, "message": f"Changed to channel {channel_number}."}


# ---------------------------------------------------------------------------
# Sequence / macro dispatch
# ---------------------------------------------------------------------------

async def send_sequence(device_id: str, sequence_name: str) -> dict:
    """
    Execute an ordered sequence of commands with per-step delays.
    Sequences live in device.sequences and handle things like "open Netflix".
    """
    device = get_ir_device(device_id)
    if not device:
        return {"ok": False, "message": f"IR device '{device_id}' not found."}

    sequences: dict = device.get("sequences") or {}
    steps: list[dict] = sequences.get(sequence_name) or []
    if not steps:
        available = ", ".join(sequences.keys()) if sequences else "none configured"
        return {
            "ok": False,
            "message": f"Sequence '{sequence_name}' not found. Available: {available}",
        }

    log_info(f"[IR] Running sequence '{sequence_name}' on {device['name']} ({len(steps)} steps)")
    for i, step in enumerate(steps):
        cmd = step.get("command", "")
        delay_ms = int(step.get("delay_after_ms", 400))
        if not cmd:
            continue
        result = send_ir_command(device_id, cmd)
        if not result.get("ok"):
            return {
                "ok": False,
                "message": f"Sequence '{sequence_name}' failed at step {i + 1} ({cmd}): {result.get('message')}",
            }
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000)

    return {"ok": True, "message": f"Sequence '{sequence_name}' completed on {device['name']}."}


# ---------------------------------------------------------------------------
# Learning mode
# ---------------------------------------------------------------------------

def start_learning(blaster_entity: str, device_namespace: str, ha_command: str) -> dict:
    """Put the Broadlink blaster in 20-second learning mode."""
    result = call_service("remote", "learn_command", {
        "entity_id": blaster_entity,
        "device": device_namespace,
        "command": ha_command,
    })
    if result.get("ok"):
        log_info(f"[IR] Learning started: {device_namespace}/{ha_command}")
        return {
            "ok": True,
            "message": (
                f"Learning mode active. Point your remote at the blaster "
                f"and press the '{ha_command}' button. You have 20 seconds."
            ),
        }
    return {
        "ok": False,
        "message": "Couldn't start learning mode. Is the blaster connected in HA?",
        "data": result,
    }


# ---------------------------------------------------------------------------
# Default templates
# ---------------------------------------------------------------------------

def _default_capabilities(device_type: str) -> list[str]:
    return {
        "tv":        ["power", "volume", "mute", "source_select", "navigation", "channels"],
        "ac":        ["power", "temperature", "mode", "fan_speed"],
        "fan":       ["power", "speed"],
        "soundbar":  ["power", "volume", "mute", "input"],
        "projector": ["power", "input", "navigation"],
    }.get(device_type.lower(), ["power"])


def _default_commands(device_type: str) -> dict[str, str]:
    base: dict[str, dict[str, str]] = {
        "tv": {
            "power":        "power",
            "volume_up":    "vol_up",
            "volume_down":  "vol_down",
            "mute":         "mute",
            "hdmi_1":       "hdmi_1",
            "hdmi_2":       "hdmi_2",
            "hdmi_3":       "hdmi_3",
            "nav_up":       "up",
            "nav_down":     "down",
            "nav_left":     "left",
            "nav_right":    "right",
            "nav_ok":       "ok",
            "back":         "back",
            "menu":         "menu",
            "home":         "home",
            "channel_up":   "ch_up",
            "channel_down": "ch_down",
            # Digit buttons for channel number entry
            **{f"digit_{i}": f"digit_{i}" for i in range(10)},
            "digit_ok":     "digit_ok",
        },
        "ac": {
            # Two on/off variants — same physical button, captured at two AC
            # states (AC currently off → captures power_on; AC currently on →
            # captures power_off). Lets Ziggy infer on/off reliably for
            # stateful Israeli AC remotes (Tadiran/Electra/Tornado) without
            # protocol-level bit-position decoding.
            "power_on":    "power_on",
            "power_off":   "power_off",
            "power":       "power",
            "mode_cool":   "mode_cool",
            "mode_heat":   "mode_heat",
            "mode_fan":    "mode_fan",
            "mode_auto":   "mode_auto",
            "mode_dry":    "mode_dry",
            "fan_low":     "fan_low",
            "fan_medium":  "fan_med",
            "fan_high":    "fan_high",
            "fan_auto":    "fan_auto",
            "swing_on":    "swing_on",
            "swing_off":   "swing_off",
            **{f"temp_{t}": f"temp_{t}" for t in range(16, 31)},
        },
        "fan": {
            "power":        "power",
            "speed_low":    "speed_1",
            "speed_medium": "speed_2",
            "speed_high":   "speed_3",
            "oscillate":    "oscillate",
        },
        "soundbar": {
            "power":           "power",
            "volume_up":       "vol_up",
            "volume_down":     "vol_down",
            "mute":            "mute",
            "input_hdmi":      "input_hdmi",
            "input_optical":   "input_optical",
            "input_bluetooth": "input_bt",
        },
        "projector": {
            "power":      "power",
            "input_hdmi": "input_hdmi",
            "nav_up":     "up",
            "nav_down":   "down",
            "nav_ok":     "ok",
            "back":       "back",
        },
    }
    return base.get(device_type.lower(), {"power": "power"})


def _default_sequences(device_type: str) -> dict[str, list[dict]]:
    """
    Pre-built command sequences (macros) for common actions.
    Users can customize these via the wizard or API.
    Delays are in milliseconds.
    """
    if device_type.lower() == "tv":
        return {
            "netflix": [
                {"command": "power",   "delay_after_ms": 3000},
                {"command": "home",    "delay_after_ms": 1500},
                # User must customize navigation to Netflix per their TV model
            ],
            "sleep_mode": [
                {"command": "menu",    "delay_after_ms": 800},
                # Placeholder — user customizes for their TV menu
            ],
        }
    return {}


def _default_ac_config() -> dict:
    return {
        "temp_range": [16, 30],
        "temp_mode":  "discrete",
        "modes":      ["cool", "heat", "fan", "auto", "dry"],
        "fan_speeds": ["low", "medium", "high", "auto"],
    }


# ---------------------------------------------------------------------------
# GPT context hint
# ---------------------------------------------------------------------------

def build_ir_context_hint() -> str:
    """
    Short description of all configured IR devices, injected into the GPT system prompt
    on every request so the model knows which devices exist and which intents to pick.
    """
    devices = [d for d in _load() if d.get("enabled", True)]
    if not devices:
        return ""

    lines = ["IR-blaster controlled devices (use ir_send_command / ir_set_ac_temperature for these):"]
    for d in devices:
        room = (d.get("room") or "").replace("_", " ")
        name = d.get("name", "")
        dtype = d.get("type", "")
        aliases = d.get("aliases") or []
        alias_str = f" (also: {', '.join(aliases)})" if aliases else ""

        cmds = list((d.get("commands") or {}).keys())
        seqs = list((d.get("sequences") or {}).keys())

        if dtype == "ac":
            temp_cmds = [c for c in cmds if c.startswith("temp_")]
            other_cmds = [c for c in cmds if not c.startswith("temp_") and not c.startswith("digit_")]
            temps = sorted(int(c.split("_")[1]) for c in temp_cmds) if temp_cmds else []
            summary = other_cmds + ([f"temp_{temps[0]}..temp_{temps[-1]}"] if temps else [])
        else:
            summary = [c for c in cmds if not c.startswith("digit_")][:12]

        seq_str = f" | sequences: {', '.join(seqs)}" if seqs else ""
        lines.append(f"  - {name}{alias_str} [{dtype}] in {room}: {', '.join(summary)}{seq_str}")

    return "\n".join(lines)
