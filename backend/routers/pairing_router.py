from __future__ import annotations

import asyncio
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.errors import ErrorCode, ZiggyError, pairing_failed
from services.ha_zha import (
    start_permit_join, get_devices as zha_get_devices,
    get_device_entities, rename_device as zha_rename_device,
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
# ZHA pairing
# ---------------------------------------------------------------------------

class ZhaPermitBody(BaseModel):
    duration: int = 60


class DeviceRename(BaseModel):
    name: str


@router.post("/api/ha/zha/permit")
async def zha_permit(body: ZhaPermitBody, _user: dict = Depends(require_role("admin"))):
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/ha/zha/permit",
               user=_user.get("username"), auth_added=True)
    _dbus.emit("ha", BASIC, "pairing_permit_join_started",
               duration_s=body.duration,
               message=f"Zigbee permit join opened for {body.duration}s")
    result = await start_permit_join(body.duration)
    if not result.get("ok"):
        _dbus.emit("ha", BASIC, "pairing_permit_join_failed",
                   error=result.get("error"), result="error",
                   suggestion="Check ZHA integration is enabled in Home Assistant.")
        raise pairing_failed("zigbee", upstream_detail=result.get("error"))
    # Refresh registry shortly after the permit window closes so new devices appear immediately.
    _schedule_registry_refresh(delay_s=body.duration + 5)
    _dbus.emit("ha", BASIC, "pairing_permit_join_ok",
               duration_s=body.duration, result="ok",
               message=f"Permit join active. Pair your device within {body.duration}s.")
    return result


@router.get("/api/ha/devices")
async def ha_devices():
    devices = await zha_get_devices()
    _dbus.emit("ha", VERBOSE, "pairing_devices_listed", count=len(devices))
    return {"devices": devices}


@router.get("/api/ha/devices/{device_id}/entities")
async def ha_device_entities(device_id: str):
    entity_ids = await get_device_entities(device_id)
    return {"entity_ids": entity_ids}


@router.patch("/api/ha/devices/{device_id}/rename")
async def ha_rename_device(device_id: str, body: DeviceRename):
    result = await zha_rename_device(device_id, body.name)
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
# Matter commissioning
# ---------------------------------------------------------------------------

class MatterCommissionBody(BaseModel):
    code: str


@router.post("/api/ha/matter/commission")
async def matter_commission(body: MatterCommissionBody,
                            _user: dict = Depends(require_role("admin"))):
    _dbus.emit("auth", BASIC, "auth_promoted_route_called",
               route="POST /api/ha/matter/commission",
               user=_user.get("username"), auth_added=True)
    if not body.code.strip():
        raise ZiggyError(
            code=ErrorCode.VALIDATION_ERROR,
            message="Please enter the Matter setup code.",
            log_message="matter_commission: empty setup code",
        )
    result = await commission_matter(body.code.strip())
    if not result.get("ok"):
        raise pairing_failed("matter", upstream_detail=result.get("error"))
    _schedule_registry_refresh(delay_s=10)
    return result


# ---------------------------------------------------------------------------
# Config flows (Wi-Fi / Broadlink discovery)
# ---------------------------------------------------------------------------

@router.get("/api/ha/config_flows")
async def ha_config_flows(protocol: Optional[str] = None):
    integrations = None
    if protocol == "wifi":
        integrations = list(WIFI_INTEGRATIONS)
    elif protocol == "broadlink":
        integrations = ["broadlink"]
    return get_pending_config_flows(integrations)


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
