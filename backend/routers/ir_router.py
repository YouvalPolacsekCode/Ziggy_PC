from __future__ import annotations

import base64
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.ir_manager import (
    list_ir_devices, get_ir_device, create_ir_device,
    update_ir_device, delete_ir_device,
    list_ir_blasters, send_ir_command, start_learning,
    mark_command_learned, send_channel,
    get_device_state_with_confidence,
)

router = APIRouter()


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
# Blasters — HA entities + network discovery
# ---------------------------------------------------------------------------

@router.get("/api/ir/blasters")
async def ir_blasters():
    """Return Broadlink remote.* entities from HA (for legacy HA-path setup)."""
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
        raise HTTPException(status_code=502, detail=f"Discovery failed: {e}")


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
        )
        # If blaster_host provided, start listener for this host
        if body.blaster_host:
            try:
                from services.ir_listener import restart_listener_for_host
                restart_listener_for_host(body.blaster_host)
            except Exception:
                pass
        return {"ok": True, "device": device}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


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

    # Refresh device registry so room changes are reflected immediately
    try:
        from services.device_registry import refresh as dr_refresh
        import threading
        threading.Thread(target=dr_refresh, daemon=True).start()
    except Exception:
        pass
    return device


@router.delete("/api/ir/devices/{device_id}")
async def remove_ir_device(device_id: str):
    if not delete_ir_device(device_id):
        raise HTTPException(status_code=404, detail="IR device not found")
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

    if blaster_host:
        # Direct path: python-broadlink captures raw code
        try:
            from services.ir_listener import learn_command_direct
        except ImportError:
            raise HTTPException(status_code=503, detail="broadlink package not installed. Run: pip install broadlink")

        raw_bytes = await learn_command_direct(blaster_host, timeout=20)
        if raw_bytes is None:
            raise HTTPException(status_code=504, detail="No IR signal received within 20 seconds.")

        raw_b64 = base64.b64encode(raw_bytes).decode()
        mark_command_learned(body.device_id, body.command_name, raw_code_b64=raw_b64)
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
    return result


# ---------------------------------------------------------------------------
# Send
# ---------------------------------------------------------------------------

@router.post("/api/ir/send")
async def ir_send(body: IrSendBody):
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
        return {"listeners": [], "error": str(e)}


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
