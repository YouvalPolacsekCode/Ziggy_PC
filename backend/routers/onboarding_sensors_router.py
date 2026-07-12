"""Onboarding endpoints — Prompt 7 chunks 2.7 + 3.

All /api/onboarding/* routes the mobile app calls during the kit-out-of-box
flow live here. Routes are grouped by wizard step:

  GET  /api/onboarding/sensors         (Chunk 2.7) — sensor list for the
                                       naming wizard step
  POST /api/onboarding/claim           (Chunk 3.1) — first-boot owner-account
                                       creation + claim-pending device bind
  POST /api/onboarding/sensors/confirm (Chunk 3.2) — TBD
  GET  /api/onboarding/starter-pack    (Chunk 3.3) — TBD
  POST /api/onboarding/complete        (Chunk 3.4) — TBD

Auth posture varies per endpoint and is documented inline. Most use the
device-token Depends(get_current_device) imported from mobile_router so a
single source of truth for mobile-device-token validation stays in place.
"""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.routers.mobile_router import get_current_device, _client_ip, require_lan
from backend.middleware.rate_limit import claim_limiter, peer_key
from core.debug_bus import bus as _dbus, BASIC
from core.logger_module import log_error, log_info
import asyncio

from services import (
    auth_db, first_boot, ha_areas, ha_zigbee, kit_manifest, mobile_app, starter_pack,
    telemetry_client,
)
from services.auth_hashing import hash_password_bcrypt


router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


# ── HA device matching ───────────────────────────────────────────────────────

def _normalize_mac(mac: str) -> str:
    """Lowercase, strip separators. Lets us match `00:15:8D:...` against
    HA's `00158d...` or any other variant the integration emits."""
    if not isinstance(mac, str):
        return ""
    return mac.lower().replace(":", "").replace("-", "").replace(" ", "")


def _ha_device_by_mac(devices: list[dict], mac: str) -> Optional[dict]:
    """Find the HA device whose `connections` includes this MAC (any case,
    any separator). Returns None if not found.

    HA's device registry stores Zigbee IEEE addresses in `connections` as
    pairs like ["zigbee", "00:15:8d:00:01:23:45:67"]. The manifest may
    store the same address with or without separators. We normalise both
    sides before comparing.
    """
    needle = _normalize_mac(mac)
    if not needle:
        return None
    for d in devices:
        for conn in d.get("connections") or []:
            if not isinstance(conn, (list, tuple)) or len(conn) < 2:
                continue
            kind, value = conn[0], conn[1]
            if kind in ("zigbee", "mac") and _normalize_mac(str(value)) == needle:
                return d
    return None


# ── Endpoint ────────────────────────────────────────────────────────────────

@router.get("/sensors")
async def get_onboarding_sensors(device: dict = Depends(get_current_device)) -> dict:
    """Return enriched manifest sensors for the wizard.

    Auth: device-token (any paired mobile device can read its own home's
    sensor list).
    """
    manifest_sensors = kit_manifest.get_sensors()

    ha_devices: list[dict] = []
    area_name_by_id: dict[str, str] = {}
    ha_reachable = False
    try:
        snap = await ha_areas.get_registry_snapshot()
        ha_devices = snap.get("devices") or []
        for a in snap.get("areas") or []:
            if "area_id" in a:
                area_name_by_id[a["area_id"]] = a.get("name", "")
        ha_reachable = True
    except Exception as e:
        # HA unreachable mid-onboarding (cold-start window, HA restarting).
        # Return the manifest sensors with paired=False so the wizard can
        # show "still detecting — retry in a moment" rather than 500ing.
        log_error(f"[onboarding_sensors] HA registry fetch failed: {e}")

    enriched: list[dict] = []
    for s in manifest_sensors:
        mac = s.get("zigbee_mac", "")
        ha = _ha_device_by_mac(ha_devices, mac) if mac else None
        entry = {
            "device_type":            s.get("device_type", ""),
            "vendor_model":           s.get("vendor_model", ""),
            "zigbee_mac":             mac,
            "intended_label_he":      s.get("intended_room_label_he", ""),
            "intended_label_en":      s.get("intended_room_label_en", ""),
            "ha_device_id":           None,
            "current_name":           None,
            "current_area_name":      None,
            "paired":                 False,
        }
        if ha is not None:
            entry["ha_device_id"]      = ha.get("id")
            entry["current_name"]      = ha.get("name_by_user") or ha.get("name") or None
            area_id = ha.get("area_id")
            entry["current_area_name"] = area_name_by_id.get(area_id) if area_id else None
            entry["paired"]            = True
        enriched.append(entry)

    return {
        "sensors":         enriched,
        "manifest_loaded": len(manifest_sensors) > 0,
        "ha_reachable":    ha_reachable,
        # ↑ ha_reachable=True iff the HA WebSocket call succeeded (even
        # with an empty list). The wizard uses it to decide between
        # "no sensors found yet, retry" and "no sensors in this kit by
        # design" / "HA is offline right now, retry in a moment".
    }


# ── /api/onboarding/claim (Chunk 3.1) ───────────────────────────────────────

class ClaimBody(BaseModel):
    """Owner-account credentials submitted from the mobile CLAIM_OWNER step."""
    username: str
    password: str


@router.post("/claim")
async def claim_owner(
    body: ClaimBody,
    request: Request,
    device: dict = Depends(get_current_device),
) -> dict:
    """First-boot owner-account creation + claim-pending device bind.

    Flow on the wire:
      1. Mobile app scanned the LAN /pair QR (claim-tier code).
      2. POST /api/mobile/pair created a device record with claim_pending=True
         and returned an auth_token + is_first_pair=True (Chunk 2.5).
      3. Mobile app collected username + password from the customer.
      4. POST /api/onboarding/claim (this endpoint) with the device token in
         Authorization. We create the super_admin owner account, bind the
         freshly-paired mobile device to it, and return a user session token
         the customer's PWA can pick up later for browser auto-login.

    Concurrency notes:
      - Only the FIRST caller succeeds. Ownership is minted via
        auth_db.create_first_owner(), a single BEGIN IMMEDIATE transaction
        that inserts the super_admin row ONLY if the users table is empty.
        Two concurrent /claim calls with different usernames can therefore
        never both win — the loser's insert affects zero rows and we return
        a tidy 409. (The earlier has_any_user() pre-check is a fast path /
        nicer audit reason, NOT the correctness guarantee.)
      - A claim-pending device whose token can't bind (race with revoke or
        bind-already-happened) yields device_bound=False without rolling
        back the user creation — the customer's account exists, the
        device is just orphaned and can be revoked from Settings later.

    Audit:
      Emits `onboarding.claim_succeeded` and `onboarding.claim_rejected`
      (with a specific reason) so the founder's debug feed shows whether
      a freshly-imaged box made it through claim cleanly.
    """
    # C2: ownership grant — LAN only, never through the tunnel/relay.
    require_lan(request)
    # H2: throttle per direct peer IP so the ownership endpoint can't be
    # hammered even from the LAN.
    claim_limiter.check(peer_key(request, "claim"))

    src_ip = _client_ip(request)

    # 1. The auth dep already returned a valid device record. Now verify
    #    it's actually waiting to be claimed.
    if not device.get("claim_pending"):
        _dbus.emit("onboarding", BASIC, "claim_rejected",
                   reason="device_not_claim_pending",
                   device_id=device.get("device_id"),
                   source_ip=src_ip)
        raise HTTPException(status_code=409, detail="This device is already claimed.")

    # 2. Fast-path refusal + clear audit reason when an owner already exists.
    #    This is NOT the concurrency guard — that lives in create_first_owner
    #    (step 4). It short-circuits the common already-owned case cheaply.
    if auth_db.has_any_user():
        _dbus.emit("onboarding", BASIC, "claim_rejected",
                   reason="owner_already_exists",
                   device_id=device.get("device_id"),
                   source_ip=src_ip)
        raise HTTPException(status_code=409, detail="An owner account already exists.")

    # 3. Lightweight validation — mirrors /api/auth/setup so two routes that
    #    create owner accounts apply the same minimum requirements.
    username = (body.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username required.")
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    # 4. Atomically create the FIRST owner. create_first_owner returns None if
    #    another concurrent claim already won the super_admin slot — treat that
    #    as 409. Mirrors /api/auth/setup primitives (bcrypt hash, empty salt,
    #    hash_algo=bcrypt, super_admin role) so the row matches every login path.
    user_session_token = secrets.token_hex(32)
    user_row_id = auth_db.create_first_owner(
        username=username,
        password_hash=hash_password_bcrypt(body.password),
        salt="",
        role="super_admin",
        hash_algo="bcrypt",
    )
    if user_row_id is None:
        _dbus.emit("onboarding", BASIC, "claim_rejected",
                   reason="owner_race_lost",
                   device_id=device.get("device_id"),
                   source_ip=src_ip)
        raise HTTPException(status_code=409, detail="An owner account already exists.")
    auth_db.add_session(user_row_id, user_session_token)

    # 5. Bind the device. mobile_app stores user_id as the username string
    #    (convention shared with /api/mobile/pair-code's mint path).
    device_bound = mobile_app.bind_claim_pending_device(
        device["device_id"],
        user_id=username,
    )
    if not device_bound:
        # Created the user but the device record could not be bound — the
        # customer's account exists and they can still use the PWA, but the
        # mobile device is orphaned. Surface this loudly via the audit bus
        # so the founder spots the inconsistency in /api/debug/events.
        log_error(
            f"[onboarding] claim: created user '{username}' but failed to bind "
            f"claim-pending device {device['device_id']} — device record may "
            f"have been concurrently mutated."
        )

    log_info(f"[onboarding] claim succeeded — user={username} device={device['device_id']}")
    _dbus.emit("onboarding", BASIC, "claim_succeeded",
               device_id=device.get("device_id"),
               user_id=username,
               device_bound=device_bound,
               source_ip=src_ip)

    return {
        "ok":            True,
        "user_token":    user_session_token,
        "role":          "super_admin",
        "username":      username,
        "device_bound":  device_bound,
    }


# ── /api/onboarding/sensors/confirm (Chunk 3.2) ─────────────────────────────

class SensorConfirmEntry(BaseModel):
    """One sensor's user-confirmed name + room from the wizard."""
    ha_device_id: str
    name: Optional[str] = None
    room_name: Optional[str] = None


class SensorConfirmBody(BaseModel):
    sensors: list[SensorConfirmEntry]


@router.post("/sensors/confirm")
async def confirm_sensors(
    body: SensorConfirmBody,
    device: dict = Depends(get_current_device),
) -> dict:
    """Persist user-confirmed sensor names + room assignments to HA.

    Idempotent — applying the same payload twice is a no-op.

    For each entry:
      1. If `name` is provided, rename the HA device via ha_zigbee.rename_device
         (single source of truth; covers all entities under the device).
      2. If `room_name` is provided, find a matching HA area by name
         (case-insensitive). Create it if missing, then assign the device
         to it via ha_areas.assign_device_to_area.

    Failures are per-entry — a rename error doesn't abort the rest. The
    response reports `confirmed` (per-entry success count) and `failed`
    (list of {ha_device_id, error}) so the wizard can surface partial
    progress and let the user retry the failed ones.

    Returns 503 only if the initial registry-snapshot fetch fails — that
    indicates HA is unreachable, which would make every entry fail
    anyway.
    """
    # Defense-in-depth (PROMPT_SECURITY_HARDENING_V2): device token is valid
    # (get_current_device handled that) but additionally require that the
    # device is bound to a user — i.e. has been through /api/onboarding/claim.
    # A claim-pending device that somehow held a token without binding (race
    # with bind_claim_pending_device, future refactor that splits the two
    # state mutations) shouldn't be allowed to write HA structure under
    # nobody's name. The upstream invariant is set by claim_owner; this
    # is the safety net.
    if not device.get("user_id"):
        raise HTTPException(status_code=409, detail="Device not claimed.")

    if not body.sensors:
        return {"ok": True, "confirmed": 0, "failed": []}

    try:
        snap = await ha_areas.get_registry_snapshot(force=True)
    except Exception as e:
        log_error(f"[onboarding] sensors/confirm: HA registry fetch failed: {e}")
        raise HTTPException(status_code=503, detail="Home Assistant unreachable.")

    # Build name → area_id index, case-insensitive. We re-use this across
    # all entries in the batch and update it when we create new areas, so
    # two entries naming the same new room create only one area.
    area_by_name: dict[str, str] = {}
    for a in snap.get("areas") or []:
        name = (a.get("name") or "").strip()
        if name:
            area_by_name[name.lower()] = a["area_id"]

    confirmed = 0
    failed: list[dict] = []

    for s in body.sensors:
        ha_id = (s.ha_device_id or "").strip()
        if not ha_id:
            failed.append({"ha_device_id": "", "error": "missing ha_device_id"})
            continue

        # 1. Rename the HA device, if a name was given.
        new_name = (s.name or "").strip()
        if new_name:
            res = await ha_zigbee.rename_device(ha_id, new_name)
            if not res.get("ok"):
                failed.append({
                    "ha_device_id": ha_id,
                    "error": f"rename: {res.get('error', 'failed')}",
                })
                # Skip area assignment on rename failure — likely the
                # device_id is wrong and assign would just fail too.
                continue

        # 2. Assign to area, creating the area if it doesn't exist yet.
        room = (s.room_name or "").strip()
        if room:
            area_id = area_by_name.get(room.lower())
            if not area_id:
                create_res = await ha_areas.create_area(room)
                if not create_res.get("ok"):
                    failed.append({
                        "ha_device_id": ha_id,
                        "error": f"create_area: {create_res.get('error', 'failed')}",
                    })
                    continue
                area_id = (create_res.get("area") or {}).get("area_id")
                if area_id:
                    area_by_name[room.lower()] = area_id
            if area_id:
                assign_res = await ha_areas.assign_device_to_area(ha_id, area_id)
                if not assign_res.get("ok"):
                    failed.append({
                        "ha_device_id": ha_id,
                        "error": f"assign_area: {assign_res.get('error', 'failed')}",
                    })
                    continue

        confirmed += 1

    log_info(
        f"[onboarding] sensors/confirm: {confirmed} ok, {len(failed)} failed "
        f"(device={device.get('device_id')})"
    )
    _dbus.emit("onboarding", BASIC, "sensors_confirmed",
               device_id=device.get("device_id"),
               confirmed=confirmed,
               failed=len(failed))

    return {
        "ok":        len(failed) == 0,
        "confirmed": confirmed,
        "failed":    failed,
    }


# ── /api/onboarding/starter-pack (Chunk 3.3) ────────────────────────────────

@router.get("/starter-pack")
async def get_starter_pack(device: dict = Depends(get_current_device)) -> dict:
    """Return starter automations whose slots can be filled against this kit.

    For each starter in services/starter_automations/v1.yaml, look at the
    kit manifest's sensors[] (device_types we know we shipped) and the
    HA device + entity registries (what's actually paired right now);
    return only the starters whose every slot resolves to a real HA
    entity_id. The returned ha_payload already has its {{slot}}
    placeholders substituted, so the mobile app POSTs it straight to
    /api/automations.

    Returned shape:
      {
        "starters": [
          { id, label_en, label_he, description_en, description_he, ha_payload }
        ],
        "ha_reachable": bool
      }
    """
    manifest_sensors = kit_manifest.get_sensors()

    ha_devices: list[dict]  = []
    ha_entities: list[dict] = []
    ha_reachable = False
    try:
        snap = await ha_areas.get_registry_snapshot()
        ha_devices  = snap.get("devices")  or []
        ha_entities = snap.get("entities") or []
        ha_reachable = True
    except Exception as e:
        log_error(f"[onboarding] starter-pack: HA registry fetch failed: {e}")

    starters = starter_pack.list_available(
        manifest_sensors=manifest_sensors,
        ha_devices=ha_devices,
        ha_entities=ha_entities,
    )
    return {"starters": starters, "ha_reachable": ha_reachable}


# ── /api/onboarding/complete (Chunk 3.4) ────────────────────────────────────

class CompleteBody(BaseModel):
    """End-of-wizard summary the mobile app sends after the last step."""
    time_elapsed_seconds:        int = 0
    sensors_confirmed_count:     int = 0
    automations_accepted_count:  int = 0
    errors:                      list[str] = []


@router.post("/complete")
async def complete_onboarding(
    body: CompleteBody,
    device: dict = Depends(get_current_device),
) -> dict:
    """Finalise the wizard: stamp first_boot.completed_at and fire a one-shot
    telemetry post with the summary.

    Idempotent in practice:
      - first_boot.mark_onboarding_complete() is itself idempotent (the
        timestamp doesn't move on subsequent calls).
      - The telemetry post is fire-and-forget per-call. Repeated calls
        emit repeated events; the relay stores them all and the founder
        sees the most recent one. Mobile app code is the de-facto guard
        against double-firing — it only calls this once at the end of
        the wizard.

    Returns:
      ok               — always True; the telemetry post is best-effort.
      first_boot_done  — True after this call (idempotent).
      telemetry_posted — True if the relay accepted; False on any failure
                         (missing config, network error, non-2xx). Mobile
                         app uses this only for diagnostic display.
      telemetry_reason — short string explaining the False case.
    """
    # 1. Mark first-boot complete so the LAN /pair page stops showing the QR.
    state = first_boot.mark_onboarding_complete()

    # 2. Build the extras dict per the §1.7 spec from docs/ONBOARDING_AUDIT.md.
    extras = {
        "event":                      "onboarding_complete",
        "time_elapsed_seconds":       int(body.time_elapsed_seconds),
        "sensors_confirmed_count":    int(body.sensors_confirmed_count),
        "automations_accepted_count": int(body.automations_accepted_count),
        "errors":                     list(body.errors or []),
        "device_id":                  state.get("device_id"),
    }

    # 3. Fire the one-shot telemetry post. telemetry_client.post_once is
    #    sync (requests-based) — run it off the event loop so we don't
    #    block other concurrent requests if the relay is slow. Failures
    #    don't bubble — completion stands regardless of relay reachability.
    try:
        result = await asyncio.to_thread(telemetry_client.post_once, extra=extras)
        telemetry_posted = bool(result.get("ok"))
        telemetry_reason = str(result.get("reason") or "")
    except Exception as e:
        log_error(f"[onboarding] complete: telemetry post crashed: {e}")
        telemetry_posted = False
        telemetry_reason = "exception"

    _dbus.emit("onboarding", BASIC, "onboarding_complete",
               device_id=device.get("device_id"),
               time_elapsed_seconds=extras["time_elapsed_seconds"],
               sensors_confirmed_count=extras["sensors_confirmed_count"],
               automations_accepted_count=extras["automations_accepted_count"],
               telemetry_posted=telemetry_posted)
    log_info(
        f"[onboarding] complete — elapsed={extras['time_elapsed_seconds']}s "
        f"sensors={extras['sensors_confirmed_count']} "
        f"automations={extras['automations_accepted_count']} "
        f"telemetry_posted={telemetry_posted}"
    )

    return {
        "ok":               True,
        "first_boot_done":  True,
        "telemetry_posted": telemetry_posted,
        "telemetry_reason": telemetry_reason,
    }
