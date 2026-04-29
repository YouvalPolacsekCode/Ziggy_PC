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
        "ac_config": ac_config or (_default_ac_config() if device_type.lower() == "ac" else None),
        # Assumed state — updated optimistically on every command sent
        "assumed_state": "unknown",
        "assumed_state_at": None,
        # AC memory — last known settings
        "ac_memory": {"mode": None, "temp": None, "fan": None} if device_type.lower() == "ac" else None,
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


def mark_command_learned(device_id: str, command_name: str) -> bool:
    devices = _load()
    for d in devices:
        if d["id"] == device_id:
            learned: list = d.get("learned_commands") or []
            if command_name not in learned:
                learned.append(command_name)
                d["learned_commands"] = learned
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
    ha_eid = device.get("ha_entity_id")
    if ha_eid:
        result = get_state(ha_eid)
        if result.get("ok"):
            raw = result["data"].get("state", "unknown")
            if raw in ("on", "playing", "idle", "paused"):
                return "on"
            if raw in ("off", "unavailable"):
                return "off"
    return device.get("assumed_state", "unknown")


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
    """Send one logical command via HA remote.send_command and update assumed state."""
    device = get_ir_device(device_id)
    if not device:
        return {"ok": False, "message": f"IR device '{device_id}' not found."}

    command_map: dict = device.get("commands") or {}
    learned: list = device.get("learned_commands") or []

    ha_command = command_map.get(logical_command)
    if not ha_command:
        available = ", ".join(learned) if learned else "none yet"
        return {
            "ok": False,
            "message": (
                f"Command '{logical_command}' is not configured for {device['name']}. "
                f"Available learned commands: {available}"
            ),
        }

    if logical_command not in learned:
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


def _after_command(device_id: str, device: dict, logical_command: str) -> None:
    """Update assumed state and AC memory after a successful command."""
    dtype = device.get("type", "")
    current = device.get("assumed_state", "unknown")

    if logical_command == "power":
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
