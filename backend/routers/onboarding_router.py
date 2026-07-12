"""Onboarding state + preferences router.

Restores the onboarding *ledger* surface that was parked/deleted with the v1
self-install web wizard (see docs/ONBOARDING_AUDIT.md §3.2 breadcrumb) and adds
the language/timezone persistence the kit-out-of-box flow needs.

Routes (all under /api/onboarding — disjoint from the sensor/claim/starter/
complete routes owned by backend/routers/onboarding_sensors_router.py):

  GET  /api/onboarding/state   (no auth)   Read-only onboarding ledger +
                                           first-boot lifecycle summary. Safe
                                           to expose pre-account so the FE can
                                           decide whether to show the wizard.
  POST /api/onboarding/prefs   (guarded)   Persist the language + timezone the
                                           user picked. Allowed while the
                                           first-boot window is open (no owner
                                           yet, language step runs before the
                                           account exists) OR to any paired
                                           mobile device (post-claim override).

`prefs` writes the authoritative override into user_files/onboarding.json via
services.onboarding_state.set_prefs, then best-effort mirrors it into
config/settings.yaml (system.language / system.timezone) so time-based
automations + the UI honour the override. A settings-write failure never loses
the captured preference (the ledger already holds it) and never fails the
request.

This file does NOT edit any existing router. The only change in
backend/server.py is one additive `app.include_router(onboarding_router)` line.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from backend.routers.mobile_router import is_lan_request
from core.logger_module import log_error, log_info
from services import first_boot, mobile_app, onboarding_state


router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


# ── GET /state ───────────────────────────────────────────────────────────────

# PUBLIC ENDPOINT — read-only onboarding ledger. No secrets: step ids +
# language/timezone override + first-boot lifecycle booleans. The FE needs it
# before an owner account exists to decide whether to route into the wizard.
@router.get("/state")
async def get_state(request: Request) -> dict:
    """Return the onboarding ledger merged with the first-boot lifecycle."""
    state = onboarding_state.load_state()
    # L1: the `first_boot` flag reveals whether this hub is unclaimed — useful
    # recon for an attacker sweeping the relay for fresh boxes. Only expose the
    # real value to LAN callers (the onboarding phone). Remote callers see
    # False, which is also the steady-state value once a hub is owned.
    first_boot_flag = first_boot.is_first_boot() if is_lan_request(request) else False
    return {
        "steps_completed": state.get("steps_completed") or [],
        "skipped":         state.get("skipped") or [],
        "last_step":       state.get("last_step"),
        "completed":       onboarding_state.is_completed(state),
        "completed_at":    state.get("completed_at"),
        "next_pending":    onboarding_state.next_pending_step(state),
        "required_remaining": onboarding_state.required_remaining(state),
        "language":        state.get("language"),
        "timezone":        state.get("timezone"),
        # First-boot lifecycle — lets the FE know whether the no-auth claim
        # window is still open (fresh box) or an owner already exists. LAN-only
        # (see above) to avoid leaking unclaimed-hub status to remote callers.
        "first_boot":      first_boot_flag,
    }


# ── POST /prefs ──────────────────────────────────────────────────────────────

class PrefsBody(BaseModel):
    language: Optional[str] = None
    timezone: Optional[str] = None


def _prefs_allowed(request: Request) -> bool:
    """Allow when the caller is a paired mobile device OR the box is still in
    its first-boot window (pre-owner language step). Refuse otherwise so a
    fully-onboarded hub doesn't accept anonymous settings writes."""
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if token and mobile_app.find_device_by_token(token):
        return True
    return first_boot.is_first_boot()


def _mirror_to_settings(language: Optional[str], timezone: Optional[str]) -> bool:
    """Best-effort write of language/timezone into config settings (system.*).

    Returns True if the settings file was updated, False on any failure. Never
    raises — the onboarding ledger is the source of truth for the override.
    """
    if language is None and timezone is None:
        return False
    try:
        from core.settings_loader import load_settings, save_settings
        data = load_settings() or {}
        system = data.get("system")
        if not isinstance(system, dict):
            system = {}
            data["system"] = system
        if language:
            system["language"] = str(language).strip()
        if timezone:
            system["timezone"] = str(timezone).strip()
        save_settings(data)
        return True
    except Exception as e:
        log_error(f"[onboarding] failed to mirror prefs into settings: {e}")
        return False


@router.post("/prefs")
async def set_prefs(body: PrefsBody, request: Request) -> dict:
    """Persist the onboarding language + timezone override."""
    if not _prefs_allowed(request):
        raise HTTPException(status_code=403, detail="Onboarding preferences are locked.")

    if not (body.language or body.timezone):
        raise HTTPException(status_code=400, detail="Provide language and/or timezone.")

    state = onboarding_state.set_prefs(language=body.language, timezone=body.timezone)
    settings_updated = _mirror_to_settings(body.language, body.timezone)
    log_info(
        f"[onboarding] prefs set language={state.get('language')} "
        f"timezone={state.get('timezone')} settings_updated={settings_updated}"
    )
    return {
        "ok":               True,
        "language":         state.get("language"),
        "timezone":         state.get("timezone"),
        "settings_updated": settings_updated,
    }
