from __future__ import annotations

import base64
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.errors import ErrorCode, ZiggyError, ir_blaster_unreachable
from services.ir_manager import (
    list_ir_devices, get_ir_device, create_ir_device,
    update_ir_device, delete_ir_device,
    list_ir_blasters, send_ir_command, start_learning,
    mark_command_learned, send_channel, send_ac_temperature,
    get_device_state_with_confidence,
    get_command_catalog, add_custom_command, remove_custom_command,
    set_sequence, delete_sequence, send_sequence,
)
from core.debug_bus import bus as _bus, BASIC as _BASIC, VERBOSE as _VERBOSE

router = APIRouter()


def _refresh_device_registry() -> None:
    """Re-reconcile the device registry off-thread so the IR change is visible
    on the next API call without blocking the response."""
    try:
        from services.device_registry import refresh as dr_refresh
        import threading
        threading.Thread(target=dr_refresh, daemon=True).start()
    except Exception:
        pass


class IrDeviceCreate(BaseModel):
    name: str
    device_type: str
    blaster_entity_id: str
    room: Optional[str] = ""
    brand: Optional[str] = ""
    model: Optional[str] = ""
    aliases: Optional[list] = None
    commands: Optional[dict] = None
    ac_config: Optional[dict] = None
    blaster_host: Optional[str] = None   # IP for direct python-broadlink access
    # MAC address of the Broadlink, captured at pairing time from
    # `broadlink.discover()`. Optional for backwards compat with the
    # manual-IP entry path (no discovery → no MAC); the listener also
    # lazy-backfills MAC on first successful contact. Stored canonical
    # lowercase-hex, no separators — see _norm_mac.
    blaster_mac: Optional[str] = None


class IrDevicePatch(BaseModel):
    name: Optional[str] = None
    room: Optional[str] = None           # empty string '' = unassign from room
    brand: Optional[str] = None
    model: Optional[str] = None
    enabled: Optional[bool] = None
    aliases: Optional[list] = None
    commands: Optional[dict] = None
    ac_config: Optional[dict] = None
    assumed_state: Optional[str] = None  # 'on' | 'off' | 'unknown'
    ha_entity_id: Optional[str] = None   # link to HA entity for state fallback
    blaster_host: Optional[str] = None   # set/update direct Broadlink IP
    ir_capabilities: Optional[dict] = None


class IrLearnBody(BaseModel):
    device_id: str
    command_name: str


class IrSendBody(BaseModel):
    device_id: str
    command: str
    repeats: int = 1


# ---------------------------------------------------------------------------
# Blaster registry — first-class CRUD on physical IR-blaster hardware
# ---------------------------------------------------------------------------
# Replaces the previous read-only HA-remote-entity list (now at
# /api/ir/ha-remotes for the few flows that still need it). The registry
# is the user-facing source of truth: name, room, status, IR-device count.

class BlasterCreate(BaseModel):
    name: str
    mac: Optional[str] = None             # canonical hex preferred; helper normalizes
    ip: Optional[str] = None
    room: Optional[str] = None
    model: Optional[str] = None
    ha_remote_entity_id: Optional[str] = None


class BlasterPatch(BaseModel):
    name: Optional[str] = None
    room: Optional[str] = None
    model: Optional[str] = None
    ha_remote_entity_id: Optional[str] = None


def _decorate_blaster(b: dict) -> dict:
    """Add derived fields the UI needs but the registry doesn't store:
    status (online/stale/unreachable from last_seen_at) and device_count
    (how many IR devices currently route through this blaster)."""
    from services.ir_blasters import status_for
    try:
        from services.ir_manager import _load as _ir_load
        devices = _ir_load() or []
        count = sum(1 for d in devices if d.get("blaster_id") == b.get("id"))
    except Exception:
        count = 0
    return {**b, "status": status_for(b), "device_count": count}


@router.get("/api/ir/blasters")
async def ir_blasters():
    """Return every registered blaster with derived status + device_count.

    This is the authoritative blaster list used by the Blasters admin UI
    and the IR Wizard's "pick blaster" picker. Backed by ir_blasters.json
    (in user_files/) — built from existing ir_devices.json on first boot
    after upgrade, then maintained explicitly via this API.
    """
    from services.ir_blasters import list_blasters
    return {"blasters": [_decorate_blaster(b) for b in list_blasters()]}


@router.get("/api/ir/blasters/{blaster_id}")
async def get_blaster(blaster_id: str):
    from services.ir_blasters import get_blaster as _get
    row = _get(blaster_id)
    if not row:
        raise HTTPException(status_code=404, detail="Blaster not found")
    return _decorate_blaster(row)


@router.post("/api/ir/blasters")
async def create_blaster_endpoint(body: BlasterCreate):
    """Register a new blaster. Idempotent on MAC: re-creating with the same
    MAC returns the existing row instead of duplicating. Used by the IR
    Wizard's name-this-blaster step right after the user picks a discovered
    Broadlink (and again on every re-pair of the same hardware)."""
    if not (body.mac or body.ip):
        raise HTTPException(status_code=422, detail="Either mac or ip must be provided")
    from services.ir_blasters import create_blaster
    blaster = create_blaster(
        name=body.name,
        mac=body.mac or "",
        ip=body.ip or "",
        model=body.model,
        room=body.room,
        ha_remote_entity_id=body.ha_remote_entity_id,
    )
    return _decorate_blaster(blaster)


@router.patch("/api/ir/blasters/{blaster_id}")
async def patch_blaster(blaster_id: str, body: BlasterPatch):
    """Rename / move / re-link a blaster. id, mac, ip, last_seen are
    immutable from this endpoint — mac is the stable identity; ip is
    runtime state owned by the rediscovery flow."""
    from services.ir_blasters import update_blaster
    updates = body.model_dump(exclude_none=True)
    row = update_blaster(blaster_id, updates)
    if not row:
        raise HTTPException(status_code=404, detail="Blaster not found")
    return _decorate_blaster(row)


@router.delete("/api/ir/blasters/{blaster_id}")
async def delete_blaster_endpoint(blaster_id: str, cascade: bool = False):
    """Remove a blaster. By default, attached IR devices are ORPHANED (kept
    in ir_devices.json but with no working route — they'll error on send
    until the user re-pairs them). Pass `?cascade=true` to also delete
    every IR device hosted on this blaster.

    The UI shows the orphan count and asks for confirmation before either
    path — this endpoint just executes whichever was picked.
    """
    from services.ir_blasters import delete_blaster, get_blaster as _get
    target = _get(blaster_id)
    if not target:
        raise HTTPException(status_code=404, detail="Blaster not found")

    orphan_count = 0
    if cascade:
        # Cascade-delete attached IR devices first.
        try:
            from services.ir_manager import _load as _ir_load, _save as _ir_save
            devices = _ir_load() or []
            before = len(devices)
            kept = [d for d in devices if d.get("blaster_id") != blaster_id]
            orphan_count = before - len(kept)
            if orphan_count:
                _ir_save(kept)
        except Exception as e:
            _bus.emit("api", _BASIC, "blaster_cascade_failed", blaster_id=blaster_id, error=str(e))
            raise HTTPException(status_code=500, detail=f"Cascade delete failed: {e}")

    delete_blaster(blaster_id)
    _refresh_device_registry()
    return {"ok": True, "deleted": True, "cascaded_devices": orphan_count}


@router.get("/api/ir/ha-remotes")
async def ha_remote_entities():
    """Return HA `remote.*` entities. Used only by flows that need to wire
    Ziggy's blaster registry to an existing HA Broadlink integration entity
    (so HA-routed send fallback works). Most surfaces should use
    /api/ir/blasters instead."""
    return {"blasters": list_ir_blasters()}


@router.get("/api/ir/discover")
async def ir_discover():
    """
    Scan the local network for Broadlink devices.
    Returns list of {host, mac, type, name} — usable as blaster_host values.
    Takes up to 6 seconds.
    """
    try:
        from services.ir_listener import discover_broadlink_devices
        devices = await discover_broadlink_devices(timeout=5)
        return {"devices": devices}
    except Exception as e:
        raise ir_blaster_unreachable(cause=e)


# ---------------------------------------------------------------------------
# IR device CRUD
# ---------------------------------------------------------------------------

@router.get("/api/ir/devices")
async def get_ir_devices(room: Optional[str] = None, device_type: Optional[str] = None):
    return {"devices": list_ir_devices(room=room, device_type=device_type, enabled_only=False)}


@router.get("/api/ir/devices/{device_id}")
async def get_single_ir_device(device_id: str):
    device = get_ir_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    return device


@router.get("/api/ir/devices/{device_id}/state")
async def get_ir_device_state(device_id: str):
    """Return current state + confidence + diagnostics for a single IR device."""
    device = get_ir_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    state, confidence = get_device_state_with_confidence(device)
    ir_caps = device.get("ir_capabilities") or {}
    return {
        "device_id": device_id,
        "name": device.get("name"),
        "state": state,
        "state_confidence": confidence,
        "assumed_state": device.get("assumed_state", "unknown"),
        "assumed_state_at": device.get("assumed_state_at"),
        "last_command_sent": device.get("last_command_sent"),
        "last_command_sent_at": device.get("last_command_sent_at"),
        "ha_entity_id": device.get("ha_entity_id"),
        "blaster_host": device.get("blaster_host"),
        "can_receive_ir": ir_caps.get("can_receive_ir", False),
        "supports_feedback": ir_caps.get("supports_feedback", False),
    }


@router.post("/api/ir/devices")
async def create_ir_device_endpoint(body: IrDeviceCreate):
    try:
        device = create_ir_device(
            name=body.name,
            device_type=body.device_type,
            blaster_entity_id=body.blaster_entity_id,
            room=body.room,
            brand=body.brand or "",
            model=body.model or "",
            aliases=body.aliases,
            commands=body.commands,
            ac_config=body.ac_config,
            blaster_host=body.blaster_host,
            blaster_mac=body.blaster_mac,
        )
        # If blaster_host provided, start listener for this host
        if body.blaster_host:
            try:
                from services.ir_listener import restart_listener_for_host
                restart_listener_for_host(body.blaster_host)
            except Exception:
                pass
        # Merge the new IR device into the device registry so it appears in
        # /api/devices and /api/rooms/devices without waiting for restart.
        _refresh_device_registry()
        return {"ok": True, "device": device}
    except Exception as e:
        # create_ir_device raises ValueError with user-readable validation
        # text (e.g. "blaster_host is required"). VALIDATION_ERROR is the
        # right code so the FE can surface it inline on the form. The full
        # exception lands in details for the admin debug channel.
        raise ZiggyError(
            code=ErrorCode.VALIDATION_ERROR,
            message=str(e) if str(e) and not isinstance(e, KeyError) else None,
            log_message=f"create_ir_device failed: {type(e).__name__}: {e}",
            details={"cause": repr(e)},
            cause=e,
        )


@router.patch("/api/ir/devices/{device_id}")
async def patch_ir_device(device_id: str, body: IrDevicePatch):
    data = body.model_dump()
    updates = {}
    for k, v in data.items():
        if v is not None:
            updates[k] = v
        elif k == "room":
            updates["room"] = ""
    device = update_ir_device(device_id, updates)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")

    # If blaster_host was added/changed, restart listener for that host
    if "blaster_host" in updates and updates["blaster_host"]:
        try:
            from services.ir_listener import restart_listener_for_host
            restart_listener_for_host(updates["blaster_host"])
        except Exception:
            pass

    # Refresh device registry so room/type/link changes are reflected immediately
    _refresh_device_registry()
    return device


@router.delete("/api/ir/devices/{device_id}")
async def remove_ir_device(device_id: str):
    if not delete_ir_device(device_id):
        raise HTTPException(status_code=404, detail="IR device not found")
    # Drop the stale row from the device registry without waiting for restart.
    _refresh_device_registry()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Channel
# ---------------------------------------------------------------------------

class IrChannelBody(BaseModel):
    channel: int


@router.post("/api/ir/devices/{device_id}/channel")
async def ir_channel(device_id: str, body: IrChannelBody):
    if not (0 <= body.channel <= 9999):
        raise HTTPException(status_code=400, detail="Channel out of range (0–9999)")
    device = get_ir_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    result = await send_channel(device_id, body.channel)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Channel send failed"))
    return result


# ---------------------------------------------------------------------------
# Command catalog — read-only metadata used by the learn UI to know which
# commands each device type can have (grouped + labeled).
# ---------------------------------------------------------------------------

@router.get("/api/ir/catalog")
async def ir_catalog(device_type: Optional[str] = None):
    return {"catalog": get_command_catalog(device_type)}


# ---------------------------------------------------------------------------
# Custom commands — user-defined buttons not in the catalog (e.g. "scene_movie")
# ---------------------------------------------------------------------------

class IrCustomCommandBody(BaseModel):
    id: str
    label: Optional[str] = None


@router.post("/api/ir/devices/{device_id}/custom-command")
async def ir_add_custom_command(device_id: str, body: IrCustomCommandBody):
    device = add_custom_command(device_id, body.id, body.label)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found or invalid command id")
    return {"ok": True, "device": device}


@router.delete("/api/ir/devices/{device_id}/custom-command/{command_id}")
async def ir_remove_custom_command(device_id: str, command_id: str):
    device = remove_custom_command(device_id, command_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    return {"ok": True, "device": device}


# ---------------------------------------------------------------------------
# Sequences (macros) — ordered command lists with per-step delays
# ---------------------------------------------------------------------------

class IrSequenceStep(BaseModel):
    command: str
    delay_after_ms: int = 400


class IrSequenceBody(BaseModel):
    name: str
    steps: list[IrSequenceStep]


@router.post("/api/ir/devices/{device_id}/sequences")
async def ir_save_sequence(device_id: str, body: IrSequenceBody):
    device = set_sequence(device_id, body.name, [s.model_dump() for s in body.steps])
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found or invalid sequence name")
    return {"ok": True, "device": device}


@router.delete("/api/ir/devices/{device_id}/sequences/{name}")
async def ir_delete_sequence(device_id: str, name: str):
    device = delete_sequence(device_id, name)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    return {"ok": True, "device": device}


@router.post("/api/ir/devices/{device_id}/sequences/{name}/run")
async def ir_run_sequence(device_id: str, name: str):
    result = await send_sequence(device_id, name)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Sequence failed"))
    return result


# ---------------------------------------------------------------------------
# AC temperature — auto-selects discrete vs step based on learned commands
# ---------------------------------------------------------------------------

class IrAcTempBody(BaseModel):
    temperature: int
    mode: Optional[str] = None


@router.post("/api/ir/devices/{device_id}/ac/temperature")
async def ir_ac_temperature(device_id: str, body: IrAcTempBody):
    device = get_ir_device(device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")
    result = await send_ac_temperature(device_id, body.temperature, body.mode)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Temperature send failed"))
    return result


# ---------------------------------------------------------------------------
# Learn — prefers direct python-broadlink path when blaster_host set
# ---------------------------------------------------------------------------

@router.post("/api/ir/learn")
async def ir_learn(body: IrLearnBody):
    """
    Put the blaster in learning mode and capture an IR code.

    If blaster_host is configured on the device, uses python-broadlink directly:
      - Captures the raw IR code bytes
      - Stores them in ir_codes (enables direct send + physical remote matching)
      - No 20-second HA timeout — waits up to 20 seconds for the button press

    Otherwise falls back to HA's remote.learn_command (existing behaviour).
    """
    device = get_ir_device(body.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")

    blaster_host = (device.get("blaster_host") or "").strip()
    _bus.emit("ir", _BASIC, "ir_learn_started",
              device_id=body.device_id, command=body.command_name,
              via="direct" if blaster_host else "ha",
              blaster_host=blaster_host or None)

    if blaster_host:
        # Direct path: python-broadlink captures raw code
        try:
            from services.ir_listener import learn_command_direct
        except ImportError:
            _bus.emit("ir", _BASIC, "ir_learn_unavailable",
                      device_id=body.device_id, command=body.command_name,
                      result="error", error="broadlink package missing")
            raise HTTPException(status_code=503, detail="broadlink package not installed. Run: pip install broadlink")

        raw_bytes = await learn_command_direct(blaster_host, timeout=20)
        if raw_bytes is None:
            _bus.emit("ir", _BASIC, "ir_learn_timeout",
                      device_id=body.device_id, command=body.command_name,
                      result="timeout",
                      suggestion="Aim the remote at the blaster and press the button within 20s.")
            raise HTTPException(status_code=504, detail="No IR signal received within 20 seconds.")

        raw_b64 = base64.b64encode(raw_bytes).decode()
        mark_command_learned(body.device_id, body.command_name, raw_code_b64=raw_b64)
        _bus.emit("ir", _BASIC, "ir_learn_captured",
                  device_id=body.device_id, command=body.command_name,
                  via="direct", code_bytes=len(raw_bytes), result="ok")
        return {
            "ok": True,
            "message": (
                f"Learned '{body.command_name}'. "
                "Physical remote detection is now active for this button."
            ),
            "raw_code_b64": raw_b64,
        }

    # Legacy path: HA remote.learn_command
    # HA's service call returns immediately (fire-and-forget) — the blaster then
    # listens for 20 seconds in the background. We hold the HTTP response open
    # for 20 seconds so the frontend countdown actually runs and the user has
    # time to press the remote before the request completes.
    command_map: dict = device.get("commands") or {}
    ha_command = command_map.get(body.command_name, body.command_name)

    result = start_learning(
        blaster_entity=device["blaster_entity_id"],
        device_namespace=device["ha_device_namespace"],
        ha_command=ha_command,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Learning mode failed"))

    import asyncio
    await asyncio.sleep(20)   # hold open so frontend countdown runs

    mark_command_learned(body.device_id, body.command_name)
    _bus.emit("ir", _BASIC, "ir_learn_captured",
              device_id=body.device_id, command=body.command_name,
              via="ha", result="ok")
    return result


# ---------------------------------------------------------------------------
# Send
# ---------------------------------------------------------------------------

@router.post("/api/ir/send")
async def ir_send(body: IrSendBody):
    # The IR send path itself emits scope=ir VERBOSE events from ir_manager;
    # here we mark the API-side entry so it shows up in the request timeline
    # for the click that triggered it (test-button on the IR wizard, etc).
    _bus.emit("ir", _VERBOSE, "ir_send_api",
              device_id=body.device_id, command=body.command, repeats=body.repeats)
    result = send_ir_command(body.device_id, body.command, repeats=body.repeats)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail=result.get("message", "Send failed"))
    return result


# ---------------------------------------------------------------------------
# Listener status
# ---------------------------------------------------------------------------

@router.get("/api/ir/listener/status")
async def ir_listener_status():
    """Return which blaster hosts have an active receive listener."""
    try:
        from services.ir_listener import _tasks, _pause_events
        hosts = []
        for host, task in _tasks.items():
            paused = _pause_events.get(host, None)
            hosts.append({
                "host": host,
                "running": not task.done(),
                "paused": bool(paused and paused.is_set()),
            })
        return {"listeners": hosts}
    except Exception as e:
        # Surface as a proper error rather than a "looks fine but secretly
        # failed" empty list — the admin status page treats an empty list as
        # "no listeners configured" which masked real outages.
        raise ZiggyError(
            code=ErrorCode.INTERNAL_ERROR,
            log_message=f"ir listener status failed: {type(e).__name__}: {e}",
            details={"cause": repr(e)},
            cause=e,
        )


# ---------------------------------------------------------------------------
# Unassigned signals — captured IR codes that didn't match any device.
# The UI lists these and lets the user bind each to (device, command).
# ---------------------------------------------------------------------------

class IrAssignSignalBody(BaseModel):
    device_id: str
    command_name: str


@router.get("/api/ir/unassigned-signals")
async def ir_list_unassigned_signals():
    """Return all captured IR signals that didn't match any device, newest-first."""
    from services.ir_unassigned import list_signals
    return {"signals": list_signals()}


@router.get("/api/ir/unassigned-signals/{signal_id}/analyze")
async def ir_analyze_unassigned_signal(signal_id: str):
    """
    Deep-inspection of a captured IR signal: parsed pulses, leader timing
    + magnitude class, protocol-decoder attempt, fingerprint. Use this to
    identify which protocol family an unknown remote is using.
    """
    from services.ir_unassigned import get_signal
    from services.ir_protocol import (
        parse_broadlink_raw, decode_protocol_bytes, _magnitude_class,
    )
    sig = get_signal(signal_id)
    if not sig:
        raise HTTPException(status_code=404, detail="Signal not found")
    try:
        raw = base64.b64decode(sig.get("code_b64") or "")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 payload")
    pulses = parse_broadlink_raw(raw)
    leader_us = pulses[:2] if len(pulses) >= 2 else []
    leader_class = "".join(_magnitude_class(p) for p in leader_us)
    decode = decode_protocol_bytes(raw)
    decoded_dict = None
    if decode:
        decoded_dict = {
            "family": decode.family,
            "payload_hex": decode.payload_hex,
            "payload_bits": decode.payload_bits,
            "ac_state": (
                {
                    "power": decode.ac_state.power,
                    "mode":  decode.ac_state.mode,
                    "temp":  decode.ac_state.temp,
                    "fan":   decode.ac_state.fan,
                    "brand": decode.ac_state.brand,
                }
                if decode.ac_state else None
            ),
        }
    return {
        "signal_id": signal_id,
        "fingerprint": sig.get("fingerprint"),
        "blaster_host": sig.get("blaster_host"),
        "count": sig.get("count"),
        "received_at": sig.get("received_at"),
        "last_seen_at": sig.get("last_seen_at"),
        "pulse_count": len(pulses),
        "leader_us": leader_us,
        "leader_class": leader_class,
        "early_pulses_us": pulses[:30],
        "all_pulses_us": pulses,
        "protocol_decoded": decoded_dict,
    }


@router.post("/api/ir/unassigned-signals/{signal_id}/assign")
async def ir_assign_unassigned_signal(signal_id: str, body: IrAssignSignalBody):
    """
    Bind a captured signal to (device, command). Writes the raw code into
    ir_devices.json under ir_codes, then removes the signal from the queue.
    """
    from services.ir_unassigned import take_signal
    device = get_ir_device(body.device_id)
    if not device:
        raise HTTPException(status_code=404, detail="IR device not found")

    signal = take_signal(signal_id)
    if not signal:
        raise HTTPException(status_code=404, detail="Signal not found")

    code_b64 = signal.get("code_b64")
    if not code_b64:
        raise HTTPException(status_code=400, detail="Signal has no code payload")

    mark_command_learned(body.device_id, body.command_name, raw_code_b64=code_b64)
    return {
        "ok": True,
        "message": (
            f"Bound signal to {device['name']} → {body.command_name}. "
            "Future presses of this button will update state automatically."
        ),
    }


@router.delete("/api/ir/unassigned-signals/{signal_id}")
async def ir_remove_unassigned_signal(signal_id: str):
    """Dismiss a captured signal without assigning it."""
    from services.ir_unassigned import remove_signal
    if not remove_signal(signal_id):
        raise HTTPException(status_code=404, detail="Signal not found")
    return {"ok": True}


@router.delete("/api/ir/unassigned-signals")
async def ir_clear_unassigned_signals():
    """Clear all queued unassigned signals."""
    from services.ir_unassigned import clear_signals
    removed = clear_signals()
    return {"ok": True, "removed": removed}
