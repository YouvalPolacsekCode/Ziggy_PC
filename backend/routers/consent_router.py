"""Consent surfaces — read + record + gate.

Runtime endpoints for the consent flows designed in
docs/IN_APP_LEGAL_SURFACES.md §4 (voice transcript), §5 (support tunnel),
and §6 (mobile background location). Persistence + enforcement live in
services/consent.py; this router is the HTTP surface.

Endpoints
  GET  /api/consent                     all consent records (authenticated)
  GET  /api/consent/{feature}           one record
  GET  /api/consent/{feature}/check     {allowed: bool} — non-raising gate probe
  POST /api/consent/{feature}           record a decision {granted: bool, ...}
                                        (owner-gated: consent is home-level in v1)

Design notes:
- **Default-deny.** Absent state reads as not granted.
- **Owner-gated writes.** v1 is single-account-per-home
  (IN_APP_LEGAL_SURFACES.md §8), so recording a consent decision requires an
  admin+ role. Reads are available to any authenticated user.
- **Audit.** Every write emits a `consent_changed` debug-bus event carrying
  the shape from §7 (event, value, previous_value, source, actor, ts). The
  authoritative record is the persisted store; the relay audit-log POST is
  layered by the relay when it proxies the request.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.routers.auth_deps import get_current_user, require_role
from core.debug_bus import bus as _bus, BASIC as _BASIC
from services import consent

router = APIRouter()


def _actor(user: dict) -> str:
    return (user.get("email") or user.get("username") or "unknown").lower()


def _feature_or_404(feature: str) -> str:
    try:
        return consent._normalize(feature)
    except consent.UnknownFeature:
        raise HTTPException(status_code=404, detail=f"unknown consent feature: {feature}")


class ConsentDecision(BaseModel):
    granted: bool
    # app | web | email | system — provenance of the decision (design §7).
    source: str = "app"
    note: Optional[str] = None


@router.get("/api/consent")
async def list_consent(user: dict = Depends(get_current_user)):
    """All consent records for this home. Default-deny for anything unset."""
    return {"features": consent.get_all(), "known": list(consent.FEATURES)}


@router.get("/api/consent/{feature}")
async def get_consent(feature: str, user: dict = Depends(get_current_user)):
    f = _feature_or_404(feature)
    return consent.get_record(f)


@router.get("/api/consent/{feature}/check")
async def check_consent(feature: str, user: dict = Depends(get_current_user)):
    """Non-raising gate probe. The support-tunnel enable path and any other
    consumer can hit this before starting a consent-gated action."""
    f = _feature_or_404(feature)
    return {"feature": f, "allowed": consent.is_allowed(f)}


@router.post("/api/consent/{feature}")
async def record_consent(
    feature: str,
    body: ConsentDecision,
    request: Request,
    user: dict = Depends(require_role("admin")),
):
    """Record a consent decision. Owner-gated (home-level consent in v1)."""
    f = _feature_or_404(feature)
    source = (body.source or "app").strip().lower()
    if source not in ("app", "web", "email", "system"):
        raise HTTPException(status_code=422, detail="source must be app|web|email|system")

    prev = consent.get(f)
    rec = consent.set(
        f,
        body.granted,
        source=source,
        actor=_actor(user),
        note=body.note,
    )
    # Audit event mirrors IN_APP_LEGAL_SURFACES.md §7. The relay attaches
    # account_id/home_id when it proxies; on a standalone hub this is the
    # local audit trail.
    _bus.emit(
        "consent",
        _BASIC,
        "consent_changed",
        event=f"{f}_consent_changed",
        value="on" if body.granted else "off",
        previous_value="on" if prev else "off",
        source=source,
        actor=_actor(user),
        ts=rec.get("updated_at"),
    )
    return rec
