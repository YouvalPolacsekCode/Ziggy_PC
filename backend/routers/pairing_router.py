from __future__ import annotations

import asyncio
import threading
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.errors import ErrorCode, ZiggyError, pairing_failed
from services.ha_zigbee import (
    start_permit_join, get_devices as zigbee_get_devices,
    get_device_entities, rename_device as zigbee_rename_device,
)
from services.ha_pairing import (
    start_zwave_inclusion, stop_zwave_inclusion,
    commission_matter, get_pending_config_flows,
    WIFI_INTEGRATIONS,
)
from core.debug_bus import bus as _dbus, BASIC, VERBOSE
from .auth_deps import require_role

router = APIRouter()


# Promoted from user-bearer to admin in PROMPT_SECURITY_HARDENING_V2
# (bucket B — structural/destructive). Per-route emits below tag the calls
# with auth_added=True so the founder can spot any legitimate caller
# broken by the change during the 30-day audit window.


# ---------------------------------------------------------------------------
# Shared helper: refresh device registry + broadcast devices_changed to frontend
# ---------------------------------------------------------------------------

def _schedule_registry_refresh(delay_s: float = 5.0) -> None:
    """Trigger a device-registry refresh after `delay_s` seconds.

    Called after pairing succeeds so newly joined devices appear promptly
    without waiting for the 60-second reconciliation loop.
    """
    async def _run():
        await asyncio.sleep(delay_s)
        try:
            from services.device_registry import refresh
            # refresh() is sync; off-load to threadpool so it doesn't block
            # the running event loop.
            await asyncio.to_thread(refresh)
        except Exception:
            pass
        try:
            from backend.ws_manager import manager
            await manager.broadcast({"type": "devices_changed"})
        except Exception:
            pass

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_run())
    except RuntimeError:
        # Called from a sync context with no running loop (rare; tests).
        threading.Thread(target=lambda: asyncio.run(_run()), daemon=True).start()


# ---------------------------------------------------------------------------
# Zigbee pairing (stack-agnostic: dispatches to ZHA or Z2M via ha_zigbee)
# ---------------------------------------------------------------------------

class ZigbeePermitBody(BaseModel):
    duration: int = 60


class DeviceRename(BaseModel):
    name: str


@router.post("/api/ha/zigbee/permit")
async def zigbee_permit(body: ZigbeePermitBody, _user: dict = Depends(require_role("admin"))):
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/ha/zigbee/permit",
               user=_user.get("username"), auth_added=True)
    _dbus.emit("ha", BASIC, "pairing_permit_join_started",
               duration_s=body.duration,
               message=f"Zigbee permit join opened for {body.duration}s")
    result = await start_permit_join(body.duration)
    if not result.get("ok"):
        _dbus.emit("ha", BASIC, "pairing_permit_join_failed",
                   error=result.get("error"), result="error",
                   stack=result.get("stack"),
                   suggestion="Check the active Zigbee integration in Home Assistant.")
        raise pairing_failed("zigbee", upstream_detail=result.get("error"))
    # Refresh registry shortly after the permit window closes so new devices appear immediately.
    _schedule_registry_refresh(delay_s=body.duration + 5)
    _dbus.emit("ha", BASIC, "pairing_permit_join_ok",
               duration_s=body.duration, result="ok",
               stack=result.get("stack"),
               message=f"Permit join active. Pair your device within {body.duration}s.")
    return result


@router.get("/api/ha/devices")
async def ha_devices():
    devices = await zigbee_get_devices()
    _dbus.emit("ha", VERBOSE, "pairing_devices_listed", count=len(devices))
    return {"devices": devices}


@router.get("/api/ha/devices/{device_id}/entities")
async def ha_device_entities(device_id: str):
    entity_ids = await get_device_entities(device_id)
    return {"entity_ids": entity_ids}


@router.patch("/api/ha/devices/{device_id}/rename")
async def ha_rename_device(device_id: str, body: DeviceRename):
    result = await zigbee_rename_device(device_id, body.name)
    if not result.get("ok"):
        raise ZiggyError(
            code=ErrorCode.HA_SERVICE_FAILED,
            log_message=f"rename_device failed: {result.get('error')}",
            details={"device_id": device_id, "upstream_error": result.get("error")},
        )
    return result


# ---------------------------------------------------------------------------
# Z-Wave pairing
# ---------------------------------------------------------------------------

@router.post("/api/ha/zwave/include")
async def zwave_include(_user: dict = Depends(require_role("admin"))):
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/ha/zwave/include",
               user=_user.get("username"), auth_added=True)
    result = await start_zwave_inclusion()
    if not result.get("ok"):
        raise pairing_failed("zwave", upstream_detail=result.get("error"))
    _schedule_registry_refresh(delay_s=30)
    return result


@router.post("/api/ha/zwave/stop")
async def zwave_stop(_user: dict = Depends(require_role("admin"))):
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/ha/zwave/stop",
               user=_user.get("username"), auth_added=True)
    await stop_zwave_inclusion()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Matter commissioning — async fire-and-poll.
#
# Commissioning takes 30-120s (BLE handshake + attestation + Thread join). A
# SYNCHRONOUS request holds the HTTP connection well past the app's fetch/proxy
# timeout — the user sees "request timed out", taps pair again, and each retry
# ABORTS the in-flight BLE connection (le-connection-abort-by-local) so nothing
# ever completes and the BLE adapter degrades. Instead: start commissioning in a
# background task, return immediately, and let the client poll
# GET /api/ha/matter/status. A single-flight guard rejects a second start while
# one is running, so an impatient double-tap can't create the storm.
# ---------------------------------------------------------------------------

class MatterCommissionBody(BaseModel):
    code: str


# Terminal + in-flight state for the (single) active Matter commission. Guarded
# by a lock because the background task and the HTTP handlers touch it from
# different threads/tasks. status ∈ idle|running|success|failed.
_matter_lock = threading.Lock()
_matter_state: dict = {"status": "idle", "message": "", "ok": None, "ts": 0.0}
_matter_task: Optional["asyncio.Task"] = None
# A commission can't outlive commission_matter's own 150s WS timeout by much;
# treat a "running" older than this as stale so a wedged attempt can't lock the
# user out of ever pairing again.
_MATTER_STALE_S = 200.0


async def _run_matter_commission(code: str) -> None:
    """Background worker: run the (slow) commission, record the outcome, notify."""
    ok = False
    message = "Pairing failed."
    try:
        result = await commission_matter(code)
        ok = bool(result.get("ok"))
        message = "Device paired." if ok else (result.get("error") or "Pairing failed.")
    except Exception as e:  # defensive — never leave state stuck on "running"
        message = str(e)
    with _matter_lock:
        _matter_state.update(status="success" if ok else "failed",
                             ok=ok, message=message, ts=time.time())
        state = dict(_matter_state)
    try:
        from backend.ws_manager import manager
        await manager.broadcast({"type": "matter_commission", **state})
    except Exception:
        pass
    if ok:
        _schedule_registry_refresh(delay_s=8)


@router.post("/api/ha/matter/commission")
async def matter_commission(body: MatterCommissionBody,
                            _user: dict = Depends(require_role("admin"))):
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/ha/matter/commission",
               user=_user.get("username"), auth_added=True)
    code = body.code.strip()
    if not code:
        raise ZiggyError(
            code=ErrorCode.VALIDATION_ERROR,
            message="Please enter the Matter setup code.",
            log_message="matter_commission: empty setup code",
        )
    global _matter_task
    with _matter_lock:
        running = (_matter_state["status"] == "running"
                   and (time.time() - _matter_state["ts"]) < _MATTER_STALE_S)
        if running:
            # Already pairing — do NOT start a second overlapping commission.
            return {"status": "running", "message": _matter_state.get("message", "")}
        _matter_state.update(
            status="running", ok=None,
            message="Pairing… keep the device next to the hub (up to 2 minutes).",
            ts=time.time())
    _matter_task = asyncio.create_task(_run_matter_commission(code))
    return {"status": "started"}


@router.get("/api/ha/matter/status")
async def matter_status(_user: dict = Depends(require_role("admin"))):
    """Poll target for the async Matter pairing flow. Returns the current
    {status, message, ok, ts} of the single active/last commission."""
    with _matter_lock:
        return dict(_matter_state)


# ---------------------------------------------------------------------------
# Config flows (Wi-Fi / Broadlink discovery)
# ---------------------------------------------------------------------------

@router.get("/api/ha/config_flows")
async def ha_config_flows(protocol: Optional[str] = None):
    if protocol == "broadlink":
        return await get_pending_config_flows(["broadlink"])
    # "wifi" (or unspecified): show EVERY network device HA discovered (smart TV,
    # Chromecast, WiFi plug, …) minus infra handlers — not a hardcoded allowlist
    # that silently dropped TVs/casts.
    return await get_pending_config_flows()


# ---------------------------------------------------------------------------
# Native config-flow driver — configure a discovered device (TV, Chromecast,
# WiFi plug) WITHOUT ever showing HA's UI. Each HA flow step is reshaped into
# Ziggy's native envelope and driven via the WS config-flow API. Simple devices
# auto-confirm on the first (empty) submit; ones needing input (a PIN, a
# confirm-on-the-TV prompt) surface a native form/progress screen.
# ---------------------------------------------------------------------------

def _present_config_step(step: dict) -> dict:
    """Reshape an HA flow step into Ziggy's UI envelope (mirrors switcher)."""
    from services.ha_flow_driver import step_kind, translate_schema
    kind = step_kind(step)
    flow_id = step.get("flow_id")
    if kind == "create_entry":
        _schedule_registry_refresh(delay_s=2)
        return {"ok": True, "status": "done", "flow_id": flow_id,
                "title": step.get("title") or "Device added"}
    if kind == "abort":
        return {"ok": False, "status": "aborted", "flow_id": flow_id,
                "reason": step.get("reason") or "unknown"}
    if kind == "progress":
        return {"ok": True, "status": "progress", "flow_id": flow_id,
                "progress_action": step.get("progress_action"),
                "description_placeholders": step.get("description_placeholders") or {}}
    if kind == "menu":
        return {"ok": True, "status": "menu", "flow_id": flow_id,
                "options": step.get("menu_options") or [],
                "description_placeholders": step.get("description_placeholders") or {}}
    return {"ok": True, "status": "form", "flow_id": flow_id, "step_id": step.get("step_id"),
            "fields": translate_schema(step), "errors": step.get("errors") or {},
            "description_placeholders": step.get("description_placeholders") or {}}


def _present_config_error(res: dict) -> dict:
    """Reshape a failed flow-step submission into an actionable envelope.

    Returned with HTTP 200 (like the switcher flow, and unlike the old bare 502)
    so the UI renders the guidance instead of a generic "temporarily unavailable".
    The frontend keys off `status`; `detail` is the localized fallback text.
    """
    if res.get("kind") == "timeout":
        # HA is still finishing the pairing handshake (or briefly unreachable).
        # Recoverable — the user can retry once the device settles.
        return {"ok": False, "status": "timeout",
                "detail": ("This device is taking longer than usual to respond. "
                           "Make sure it's powered on and on the same Wi-Fi, then try again.")}
    if res.get("status_code") == 404:
        # HA dropped the discovery flow (already consumed, or the device went
        # offline). It only reappears when the device re-announces itself, so
        # the right recovery is a fresh scan, not retrying this dead flow id.
        return {"ok": False, "status": "gone",
                "detail": ("This device is no longer available to set up. Turn it on, "
                           "make sure it's on your Wi-Fi, then rescan to find it again.")}
    # Genuine upstream error — surface HA's real reason rather than flattening it.
    return {"ok": False, "status": "error",
            "detail": res.get("error") or "Setup couldn't continue. Please try again."}


@router.post("/api/pairing/config-flow/{flow_id}/step")
async def config_flow_step(flow_id: str, body: FlowStepBody,
                           _user: dict = Depends(require_role("admin"))):
    """Advance a discovered HA config flow one step, natively. Submit empty
    user_input to confirm/auto-configure; a form's fields come back for anything
    that needs input. Never redirects to HA."""
    from services.ha_flow_driver import submit_step
    # 55s (< the frontend's 60s request cap): a device-pairing step such as an
    # Android TV showing its PIN blocks well past the old 20s default. Failing
    # inside that window is what produced the "upstream issues" dead-end and the
    # vanishing device. See tests/test_config_flow_pairing.py.
    res = await submit_step(flow_id, body.user_input or {}, timeout=55)
    if not res.get("ok"):
        return _present_config_error(res)
    return _present_config_step(res["step"])


@router.post("/api/pairing/config-flow/{flow_id}/cancel")
async def config_flow_cancel(flow_id: str,
                             _user: dict = Depends(require_role("admin"))):
    from services.ha_flow_driver import abort_flow
    try:
        await abort_flow(flow_id)
    except Exception:
        pass
    return {"ok": True}


# ---------------------------------------------------------------------------
# Switcher pairing — native Ziggy UI driving HA's switcher_kis config flow.
# HA does protocol work invisibly; user sees only Ziggy screens.
# ---------------------------------------------------------------------------

class FlowStepBody(BaseModel):
    user_input: Optional[dict] = None


@router.post("/api/pairing/switcher/start")
async def switcher_pairing_start(_user: dict = Depends(require_role("admin"))):
    """Start (or resume) a Switcher pairing flow. Returns the first step.

    Returns 200 with the full envelope even on expected errors (port-in-use,
    no devices found) so the FE can read the `recovery` hint and offer
    targeted recovery actions. Only true infrastructure failures should
    raise HTTPException.
    """
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/pairing/switcher/start",
               user=_user.get("username"), auth_added=True)
    from services.switcher_pairing import start_or_resume
    _dbus.emit("ha", BASIC, "switcher_pairing_started",
               message="Switcher pairing started — driving HA switcher_kis flow.")
    res = await start_or_resume()
    return res


@router.post("/api/pairing/switcher/{flow_id}/step")
async def switcher_pairing_step(flow_id: str, body: FlowStepBody,
                                _user: dict = Depends(require_role("admin"))):
    """Submit user answers for the current step; return the next step."""
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/pairing/switcher/{flow_id}/step",
               user=_user.get("username"), auth_added=True)
    from services.switcher_pairing import submit
    res = await submit(flow_id, body.user_input)
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail=res.get("error", "Step submission failed"))
    if res.get("status") == "done":
        _schedule_registry_refresh(delay_s=2)
        _dbus.emit("ha", BASIC, "switcher_pairing_complete",
                   flow_id=flow_id, title=res.get("title"),
                   message="Switcher device added.")
    return res


@router.post("/api/pairing/switcher/{flow_id}/cancel")
async def switcher_pairing_cancel(flow_id: str,
                                  _user: dict = Depends(require_role("admin"))):
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/pairing/switcher/{flow_id}/cancel",
               user=_user.get("username"), auth_added=True)
    from services.switcher_pairing import cancel
    res = await cancel(flow_id)
    return res


@router.get("/api/pairing/switcher/diagnose")
async def switcher_pairing_diagnose():
    """Diagnose which Switcher UDP discovery ports are blocked.

    Tries to bind each from Ziggy's process and reports the result. Used by
    the FE to tell the user concretely which port is held and offer shell
    commands to identify the holding process.
    """
    from services.switcher_pairing import diagnose_ports
    return diagnose_ports()


@router.post("/api/pairing/switcher/recover")
async def switcher_pairing_recover(_user: dict = Depends(require_role("admin"))):
    """Heavy-handed recovery: restart HA, wait for it, retry pairing.

    Triggered by the FE only after we've shown the user that HA's switcher
    discovery port is leaked. Hides the underlying HA restart entirely.
    """
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/pairing/switcher/recover",
               user=_user.get("username"), auth_added=True)
    from services.switcher_pairing import restart_ha_and_retry
    _dbus.emit("ha", BASIC, "switcher_pairing_recover_started",
               message="Restarting HA to free Switcher discovery port.")
    res = await restart_ha_and_retry()
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail=res.get("error", "Recovery failed"))
    return res


# ── Switcher account credentials (one-time setup, reused across pairings) ──

class SwitcherAccountBody(BaseModel):
    email: str
    token: str


@router.get("/api/pairing/switcher/account")
async def switcher_account_status():
    """Report whether Switcher account credentials are connected.

    Returns email when connected so the FE can show "Connected as X" / a
    Disconnect button. Token is never returned to the client.
    """
    from services.switcher_account import get_credentials
    creds = get_credentials()
    return {
        "connected": creds is not None,
        "email": (creds or {}).get("email"),
    }


@router.post("/api/pairing/switcher/account")
async def switcher_account_connect(body: SwitcherAccountBody,
                                   _user: dict = Depends(require_role("admin"))):
    """Validate and save Switcher account credentials.

    Calls Switcher's ValidateToken endpoint via aioswitcher. On success,
    persists the credentials so they auto-inject into every future pairing.
    """
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/pairing/switcher/account",
               user=_user.get("username"), auth_added=True)
    from services.switcher_account import validate_and_save
    res = await validate_and_save(body.email, body.token)
    if not res.get("ok"):
        raise HTTPException(status_code=502, detail=res.get("error", "Could not reach Switcher to verify."))
    if not res.get("valid"):
        raise HTTPException(status_code=401, detail="Switcher rejected those credentials.")
    return {"ok": True, "connected": True, "email": body.email}


@router.delete("/api/pairing/switcher/account")
async def switcher_account_disconnect(_user: dict = Depends(require_role("admin"))):
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="DELETE /api/pairing/switcher/account",
               user=_user.get("username"), auth_added=True)
    from services.switcher_account import clear_credentials
    removed = clear_credentials()
    return {"ok": True, "had_credentials": removed}
