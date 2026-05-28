"""
Parked v1 — kit ships via mobile-first MobileOnboarding.jsx flow. See docs/ONBOARDING_AUDIT.md §3.2 for context. Revisit for BYO-hardware v1.1+ tier.

First-time onboarding state + HA probe.

Drives the production onboarding wizard at /onboarding/* in the FE:
  - GET  /api/onboarding/state         — current progress (for App.jsx gate + resume).
  - PATCH /api/onboarding/state        — mark a step completed or skipped.
  - POST /api/onboarding/complete      — stamp completion timestamp.
  - POST /api/onboarding/reset         — super_admin only, wipes progress.
  - POST /api/ha/probe                 — verify a candidate HA URL + token (no persistence).
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from services import onboarding_state
from services.ha_runtime import probe_ha
from .auth_deps import get_current_user, require_role

router = APIRouter()


# ---------------------------------------------------------------------------
# Onboarding state
# ---------------------------------------------------------------------------

class StepPatch(BaseModel):
    step_id: str
    skipped: Optional[bool] = False


@router.get("/api/onboarding/state")
async def get_state(_: dict = Depends(get_current_user)):
    s = onboarding_state.load_state()
    return {
        **s,
        "completed":            onboarding_state.is_completed(s),
        "required_remaining":   onboarding_state.required_remaining(s),
        "next_pending":         onboarding_state.next_pending_step(s),
        "step_ids":             list(onboarding_state.STEP_IDS),
    }


@router.patch("/api/onboarding/state")
async def patch_state(body: StepPatch, _: dict = Depends(get_current_user)):
    if not body.step_id:
        raise HTTPException(status_code=400, detail="step_id is required")
    state = onboarding_state.mark_step(body.step_id, skipped=bool(body.skipped))
    return {
        **state,
        "completed":            onboarding_state.is_completed(state),
        "required_remaining":   onboarding_state.required_remaining(state),
        "next_pending":         onboarding_state.next_pending_step(state),
    }


@router.post("/api/onboarding/complete")
async def complete(_: dict = Depends(get_current_user)):
    state = onboarding_state.mark_complete()
    return {**state, "completed": True}


@router.post("/api/onboarding/reset")
async def reset(_: dict = Depends(require_role("super_admin"))):
    state = onboarding_state.reset()
    return state


# ---------------------------------------------------------------------------
# HA probe — used by the "Connect Home Assistant" step BEFORE persisting.
# ---------------------------------------------------------------------------

class HaProbeBody(BaseModel):
    url: str
    token: str


@router.post("/api/ha/probe")
async def ha_probe(body: HaProbeBody, _: dict = Depends(get_current_user)):
    return await probe_ha(body.url, body.token)
