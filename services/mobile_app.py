"""
Mobile-app protocol translator.

Bridges between the Ziggy Home mobile app (Capacitor-wrapped) and the existing
Ziggy services. The mobile app POSTs webhook payloads with types like
`update_location`, `update_sensors`, `fire_event`; this module unpacks them and
routes each into the right existing primitive:

  update_location  → services.presence_engine.ingest_external_state(...)
  update_sensors   → in-memory device sensor cache + ws fan-out
  fire_event       → core event bus (deferred to phase 2)

This is intentionally THIN — no decision logic lives here, only translation.
All actual presence math, automation routing, and history persistence happens
in the existing services that have already been battle-tested.

Storage (added by this module, do not edit elsewhere):
  user_files/mobile_devices.json — registered mobile devices
  user_files/mobile_pair_codes.json — short-lived pair codes (5 min TTL)
"""
from __future__ import annotations

import asyncio
import json
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from core.logger_module import log_info, log_error
from services import presence_engine

# ── Storage paths ────────────────────────────────────────────────────────────

_DEVICES_FILE = Path(__file__).resolve().parents[1] / "user_files" / "mobile_devices.json"
_PAIR_FILE    = Path(__file__).resolve().parents[1] / "user_files" / "mobile_pair_codes.json"

_PAIR_TTL_S       = 300       # 5 minutes (user-tier — PWA → phone)
_CLAIM_TTL_S      = 30 * 24 * 60 * 60   # 30 days (first-boot claim, mirrors
                                        # PROMPT_FACTORY_IMAGING §4 step 11)
_DEVICE_TOKEN_LEN = 32       # bytes of entropy in the auth token

_lock = threading.Lock()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _load(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        log_error(f"[mobile_app] failed to read {path}: {e}")
        return default


def _save(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def _new_token() -> str:
    # Prefix lets us identify mobile tokens at a glance in logs.
    return "zgy_mb_" + secrets.token_urlsafe(_DEVICE_TOKEN_LEN)


def _new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


# ── Pair codes ───────────────────────────────────────────────────────────────

def _mint_code_string() -> str:
    return "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))


def create_pair_code(user_id: str) -> dict:
    """Mint a short-lived (5 min) USER-tier pair code. The PWA owner shows the
    code (or its QR) to their phone; phone POSTs to /mobile/pair to redeem.

    Use this when an owner account already exists. For the kit-out-of-box
    first-boot flow where no owner is yet defined, see create_claim_code.
    """
    code = _mint_code_string()
    expires_at = _now() + timedelta(seconds=_PAIR_TTL_S)
    with _lock:
        codes = _load(_PAIR_FILE, [])
        codes = [c for c in codes if datetime.fromisoformat(c["expires_at"]) > _now()]
        codes.append({
            "code":       code,
            "kind":       "user",          # explicit so consume can route
            "user_id":    user_id,
            "created_at": _now().isoformat(),
            "expires_at": expires_at.isoformat(),
        })
        _save(_PAIR_FILE, codes)
    return {"code": code, "expires_at": expires_at.isoformat(), "ttl_seconds": _PAIR_TTL_S}


def create_claim_code(device_id: str, *, ttl_seconds: int = _CLAIM_TTL_S) -> dict:
    """Mint a long-lived (default 30 days) CLAIM-tier pair code bound to a
    device_id rather than a user_id.

    Used on a freshly-imaged box where the customer hasn't created an owner
    account yet. The mobile app redeems via /api/mobile/pair; the resulting
    device record stays in a `claim_pending` state until /api/onboarding/claim
    (Chunk 3) creates the owner and binds it.

    Idempotent within a single device's lifetime: if a non-expired claim
    code already exists for this device_id, return it instead of minting a
    second one. Stops first-boot.py from minting fresh codes on every
    process restart.
    """
    if not device_id or not device_id.strip():
        raise ValueError("device_id is required to mint a claim code")
    device_id = device_id.strip()
    with _lock:
        codes = _load(_PAIR_FILE, [])
        codes = [c for c in codes if datetime.fromisoformat(c["expires_at"]) > _now()]
        # Idempotency: reuse an existing non-expired claim code for the same
        # device. Lets the LAN /pair page re-render the same QR even after
        # an edge restart, so a sticker printed at imaging time stays valid.
        for c in codes:
            if c.get("kind") == "claim" and c.get("device_id") == device_id:
                _save(_PAIR_FILE, codes)  # drop expired neighbours
                return {
                    "code":        c["code"],
                    "device_id":   device_id,
                    "expires_at":  c["expires_at"],
                    "ttl_seconds": int(
                        (datetime.fromisoformat(c["expires_at"]) - _now()).total_seconds()
                    ),
                    "kind":        "claim",
                    "reused":      True,
                }
        code = _mint_code_string()
        expires_at = _now() + timedelta(seconds=ttl_seconds)
        codes.append({
            "code":       code,
            "kind":       "claim",
            "device_id":  device_id,
            "created_at": _now().isoformat(),
            "expires_at": expires_at.isoformat(),
        })
        _save(_PAIR_FILE, codes)
    log_info(f"[mobile_app] minted claim code for device {device_id} (ttl_s={ttl_seconds})")
    return {
        "code":        code,
        "device_id":   device_id,
        "expires_at":  expires_at.isoformat(),
        "ttl_seconds": ttl_seconds,
        "kind":        "claim",
        "reused":      False,
    }


def consume_pair_code(code: str) -> Optional[dict]:
    """Return the pair record if `code` is valid, removing it atomically.
    Returns None if expired or unknown.

    The returned dict always carries a `kind` field — "user" or "claim".
    Older codes minted before the kind field existed are treated as "user"
    (forward-compatible default).

    Callers should branch on kind:
      kind=="user"   → match["user_id"] identifies the owner
      kind=="claim"  → match["device_id"] identifies the box; owner is created
                       later via /api/onboarding/claim (Chunk 3)
    """
    with _lock:
        codes = _load(_PAIR_FILE, [])
        match = None
        remaining = []
        for c in codes:
            if c["code"] == code and datetime.fromisoformat(c["expires_at"]) > _now():
                match = c
            elif datetime.fromisoformat(c["expires_at"]) > _now():
                remaining.append(c)
        _save(_PAIR_FILE, remaining)
    if match is None:
        return None
    # Forward-compat: older records without kind are user-tier.
    match.setdefault("kind", "user")
    return match


# ── Devices ──────────────────────────────────────────────────────────────────

def register_device(
    user_id: Optional[str],
    device_info: dict,
    *,
    claim_pending: bool = False,
    claim_device_id: Optional[str] = None,
) -> dict:
    """Create a new mobile-device record and return it with its auth token.

    Two modes:
      Normal (claim_pending=False):
        user_id is required. Behaviour is unchanged from the pre-Prompt-7
        flow — the device is immediately bound to its owner.

      Claim-pending (claim_pending=True):
        user_id may be None. The record is created with `claim_pending=True`
        and `claim_device_id=<edge device_id>`, indicating the mobile app
        successfully redeemed a first-boot claim code but the owner account
        has not been created yet. /api/onboarding/claim (Chunk 3) will bind
        a real user_id via bind_claim_pending_device().
    """
    if not claim_pending and not user_id:
        raise ValueError("user_id is required unless claim_pending=True")

    device_id = _new_id("dev")
    webhook_id = _new_id("wh")
    token = _new_token()

    record = {
        "device_id":       device_id,
        "webhook_id":      webhook_id,
        "user_id":         user_id,
        "person_id":       None,
        "auth_token":      token,
        "push_token":      None,
        "push_provider":   None,
        "platform":        device_info.get("platform"),
        "model":           device_info.get("model"),
        "os_version":      device_info.get("os_version"),
        "app_version":     device_info.get("app_version"),
        "claim_pending":   claim_pending,
        "claim_device_id": claim_device_id,
        "created_at":      _now().isoformat(),
        "last_seen":       _now().isoformat(),
    }
    with _lock:
        devices = _load(_DEVICES_FILE, [])
        devices.append(record)
        _save(_DEVICES_FILE, devices)
    if claim_pending:
        log_info(
            f"[mobile_app] registered claim-pending device {device_id} "
            f"({record['platform']} {record['model']}) for box {claim_device_id}"
        )
    else:
        log_info(
            f"[mobile_app] registered device {device_id} "
            f"({record['platform']} {record['model']}) for user {user_id}"
        )
    return record


def bind_claim_pending_device(device_id: str, user_id: str) -> bool:
    """Bind a claim-pending mobile-device record to a freshly-created owner.

    Called from /api/onboarding/claim (Chunk 3) after the owner account has
    been minted. Idempotent: a non-claim-pending or unknown record returns
    False so the caller can decide whether to 404 or 409.
    """
    if not user_id:
        raise ValueError("user_id is required to bind a claim-pending device")
    with _lock:
        devices = _load(_DEVICES_FILE, [])
        for d in devices:
            if d.get("device_id") != device_id:
                continue
            if not d.get("claim_pending"):
                return False
            d["user_id"]       = user_id
            d["claim_pending"] = False
            d["last_seen"]     = _now().isoformat()
            _save(_DEVICES_FILE, devices)
            log_info(f"[mobile_app] bound claim-pending device {device_id} → user {user_id}")
            return True
    return False


def find_device_by_token(token: str) -> Optional[dict]:
    if not token:
        return None
    with _lock:
        for d in _load(_DEVICES_FILE, []):
            if d.get("auth_token") == token:
                return d
    return None


def find_device_by_webhook_id(webhook_id: str) -> Optional[dict]:
    with _lock:
        for d in _load(_DEVICES_FILE, []):
            if d.get("webhook_id") == webhook_id:
                return d
    return None


def update_device(device_id: str, fields: dict) -> None:
    """Patch a device record. Used by /mobile/register to set push token,
    permissions, person binding, etc."""
    with _lock:
        devices = _load(_DEVICES_FILE, [])
        for d in devices:
            if d.get("device_id") == device_id:
                d.update(fields)
                d["last_seen"] = _now().isoformat()
                _save(_DEVICES_FILE, devices)
                return


def list_devices_for_user(user_id: str) -> list[dict]:
    """Return public-safe device records for a user (no auth_token)."""
    with _lock:
        devices = _load(_DEVICES_FILE, [])
    return [_redact(d) for d in devices if d.get("user_id") == user_id]


def list_all_devices() -> list[dict]:
    """All devices, redacted. Used by push fan-out."""
    with _lock:
        devices = _load(_DEVICES_FILE, [])
    return [_redact(d) for d in devices]


def delete_device(device_id: str, *, user_id: Optional[str] = None) -> bool:
    """Remove a device record. If user_id is given, the device must belong to
    that user — defends against a leaked token deleting someone else's record.
    Returns True if deleted.
    """
    with _lock:
        devices = _load(_DEVICES_FILE, [])
        kept = []
        deleted = False
        for d in devices:
            if d.get("device_id") == device_id:
                if user_id is not None and d.get("user_id") != user_id:
                    kept.append(d)
                    continue
                deleted = True
                continue
            kept.append(d)
        if deleted:
            _save(_DEVICES_FILE, kept)
    if deleted:
        log_info(f"[mobile_app] deleted device {device_id}")
    return deleted


def _redact(d: dict) -> dict:
    """Strip secrets from a device record before returning to the PWA."""
    return {k: v for k, v in d.items() if k not in ("auth_token",)}


# ── Webhook payload routers ──────────────────────────────────────────────────

def handle_webhook(device: dict, payload: dict) -> dict:
    """Dispatch a single webhook payload from the mobile app.
    Returns a small response dict the app can use for confirmation.
    """
    ptype = payload.get("type")
    data = payload.get("data") or {}

    if ptype == "update_location":
        return _handle_location(device, data)
    if ptype == "update_sensors":
        return _handle_sensors(device, data)
    if ptype == "fire_event":
        # Phase 2: hook into core.debug_bus / automation engine.
        log_info(f"[mobile_app] fire_event from {device['device_id']}: {data.get('event')}")
        return {"ok": True, "queued": True}

    return {"ok": False, "error": f"unknown_type:{ptype}"}


def _handle_location(device: dict, data: dict) -> dict:
    """Translate a location webhook into presence_engine state.

    Signal classes after Phase 3 (ziggy-presence native plugin):

      source='geofence' + transition='enter'|'exit', zone_id supplied:
        * zone_id='home' → presence_engine.ingest_external_state
            (home|not_home). Primary native presence path.
        * zone_id='home_near' → outer-ring approach signal. No presence
            transition (that fires when home itself enters), but on enter
            we push "Approaching home" so head-start automations can use the
            window before arrival. Suppressed via cooldown so multiple drive-
            bys don't spam.
        * zone_id matching an entry in zones_registry → broadcast a
            zone_state WS event and fire zone_entered / zone_left automations
            via presence_side_effects. No effect on home/not_home.
        * unknown zone_id → log + ignore.

      source='significant_change' | 'gps' | 'fused' (raw position):
        If lat/lon present, runs through presence_engine.ingest_ping_for_person_id
        so the engine's hysteresis + accuracy gating apply. Acts as a safety
        net when geofences silently fail (Android OEM anti-kill, OS bugs).

      source='activity':
        Stores {activity, confidence, ts} on the device record under
        `last_activity`. The native plugin already applies its own driving-
        deferral on enters; backend fusion uses this as ambient evidence
        (TODO 1c-10 LAN corroboration reads it).

    Devices without a person_id binding are recorded (last_seen bumped) but
    NOT forwarded to presence — there's no person to attribute the state to.
    The PWA picker in MobileOnboarding handles binding.
    """
    update_device(device["device_id"], {})  # bump last_seen
    person_id = device.get("person_id")
    source = data.get("source", "gps")

    # Activity hints: persist on the device record. No presence side effect.
    if source == "activity":
        activity   = data.get("activity")
        confidence = data.get("confidence")
        ts         = data.get("ts")
        if not activity:
            return {"ok": False, "error": "activity field required"}
        update_device(device["device_id"], {
            "last_activity": {"activity": activity, "confidence": confidence, "ts": ts},
        })
        return {"ok": True, "recorded": True, "activity": activity, "confidence": confidence}

    if not person_id:
        return {"ok": True, "ignored": "no_person_bound"}

    # Geofence transition — primary presence-update path.
    if source == "geofence":
        return _handle_geofence_event(device, person_id, data)

    # Raw GPS / SLC / fused background updates — feed the engine when we have a
    # real position fix, so the engine's hysteresis + cooldown act as a safety
    # net for missed geofence events.
    lat = data.get("lat")
    lon = data.get("lon")
    if lat is not None and lon is not None:
        try:
            accuracy = data.get("accuracy_m")
            decision = presence_engine.ingest_ping_for_person_id(
                person_id = person_id,
                lat       = float(lat),
                lon       = float(lon),
                accuracy  = float(accuracy) if accuracy is not None else None,
            )
            # Side effects (push + automation + WS) are owned by the ingest
            # path's caller — here that's us. Schedule them so a missed
            # geofence still drives the same fanout as an explicit transition.
            from services.presence_side_effects import schedule_side_effects
            try:
                schedule_side_effects(decision)
            except Exception:
                pass
            return {
                "ok": True,
                "ingested": True,
                "result": decision.result,
                "new_state": decision.new_confirmed,
            }
        except Exception as e:
            log_error(f"[mobile_app] gps ingest failed for {device['device_id']}: {e}")
            return {"ok": False, "error": str(e)}

    log_info(
        f"[mobile_app] location from {device['device_id']} person={person_id} "
        f"src={source} lat={lat} lon={lon} acc={data.get('accuracy_m')}m"
    )
    return {"ok": True, "recorded": True}


def _handle_geofence_event(device: dict, person_id: str, data: dict) -> dict:
    """Geofence enter/exit fanout.

    Splits on zone_id:
      home      → ingest_external_state into presence_engine (the engine then
                  drives the push + automation fanout via presence_side_effects).
      home_near → "Approaching home" push on enter; no presence-state change.
      <other>   → if registered in zones_registry, broadcast zone_state and
                  fire zone_entered / zone_left automations.
    """
    transition = data.get("transition")
    zone_id    = data.get("zone_id") or "home"
    if transition not in ("enter", "exit"):
        return {"ok": True, "recorded": True, "ignored": f"unknown_transition_{transition}"}

    if zone_id == "home":
        new_state = "home" if transition == "enter" else "not_home"
        # Multi-signal fusion: log the LAN + last-activity evidence on the
        # engine's decision reason so debug history shows what corroborated
        # (or disagreed with) the geofence. If both LAN and activity actively
        # contradict a "home enter" (LAN-unreachable AND activity=driving in
        # a fresh window) we suppress the enter entirely — that combination is
        # the high-confidence "drove past home" false positive the native side's
        # 3-min drive-hold tries to catch first, but defends against OEMs where
        # the plugin's hold doesn't fire.
        evidence = _corroboration_evidence(device, person_id)
        suffix = f"zone_{zone_id}_{transition}"
        if evidence["summary"]:
            suffix = f"{suffix} [{evidence['summary']}]"

        if (
            transition == "enter"
            and evidence["lan_unreachable_recent"]
            and evidence["activity_driving_recent"]
        ):
            log_info(
                f"[mobile_app] suppressing geofence enter for person={person_id} "
                f"device={device['device_id']} — drive-past pattern "
                f"(lan=unreachable activity=driving)"
            )
            return {
                "ok": True,
                "suppressed": "drive_past_pattern",
                "evidence": evidence["summary"],
            }

        try:
            decision = presence_engine.ingest_external_state(
                person_id     = person_id,
                new_state     = new_state,
                source        = "ziggy_mobile_geofence",
                reason_suffix = suffix,
            )
            from services.presence_side_effects import schedule_side_effects
            try:
                schedule_side_effects(decision)
            except Exception:
                pass
            log_info(
                f"[mobile_app] geofence {transition} zone=home → {new_state} "
                f"for person={person_id} device={device['device_id']} "
                f"result={decision.result}"
            )
            return {"ok": True, "ingested": True, "result": decision.result,
                    "new_state": new_state}
        except Exception as e:
            log_error(f"[mobile_app] presence ingest failed for {device['device_id']}: {e}")
            return {"ok": False, "error": str(e)}

    if zone_id == "home_near":
        if transition == "enter":
            _fire_approaching_home_push(person_id)
        log_info(
            f"[mobile_app] geofence {transition} zone=home_near "
            f"person={person_id} device={device['device_id']}"
        )
        return {"ok": True, "near_home": transition}

    # Extra registered zone — fire the zones_registry fanout via the same path
    # presence_engine uses for its in-engine zone state machine. We build a
    # minimal ZoneTransition synthetic so presence_side_effects' zone fanout
    # treats this exactly like a geo-derived zone crossing.
    try:
        from services import zones_registry
        zone = zones_registry.get_zone(zone_id)
    except Exception:
        zone = None
    if zone is None:
        log_info(
            f"[mobile_app] geofence {transition} unknown zone={zone_id} "
            f"person={person_id} device={device['device_id']} (no-op)"
        )
        return {"ok": True, "recorded": True, "ignored": "unknown_zone"}

    person = presence_engine.find_person_by_id(person_id) or {"id": person_id, "name": ""}
    try:
        from services.presence_engine import ZoneTransition
        from services.presence_side_effects import schedule_zone_side_effects
        from datetime import datetime, timezone
        zt = ZoneTransition(
            zone_id     = zone_id,
            zone_name   = zone.get("name", zone_id),
            direction   = "entered" if transition == "enter" else "left",
            ts          = datetime.now(timezone.utc),
            person_id   = person_id,
            person_name = person.get("name", ""),
            reason      = f"ziggy_mobile_geofence_{transition}",
        )

        class _Stub:
            fired_transition = False
            new_confirmed = "unknown"
        stub = _Stub()
        stub.zone_transitions = [zt]
        try:
            schedule_zone_side_effects(stub)
        except Exception:
            pass
    except Exception as e:
        log_error(f"[mobile_app] zone fanout failed for {zone_id}: {e}")
    log_info(
        f"[mobile_app] geofence {transition} zone={zone_id} "
        f"person={person_id} device={device['device_id']}"
    )
    return {"ok": True, "zone_event": transition, "zone_id": zone_id}


# Track the last "approaching home" push per person to avoid spamming when a
# user does multiple drive-by enters in a short window. In-memory only;
# resetting on process restart is harmless (a single missed dedupe at most).
_LAST_APPROACH_PUSH: dict[str, datetime] = {}
_APPROACH_PUSH_COOLDOWN_S = 600  # 10 min — matches the engine's presence cooldown


def _corroboration_evidence(device: dict, person_id: str) -> dict:
    """Gather LAN + last-activity evidence for a geofence event.

    Returns a dict with:
      lan_reachable_recent      bool  — LAN probe succeeded within `lan_fresh_seconds`
      lan_unreachable_recent    bool  — LAN probe attempted recently AND failed
      activity_driving_recent   bool  — last activity sample said "driving" within 90 s
      summary                   str   — short tag for log lines / decision reasons
    """
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)

    # LAN evidence — sourced from the person record, written by lan_presence's
    # record_lan_probe(). lan_fresh_seconds is the same window the engine uses
    # to decide whether to trust a "home" state for the long staleness window.
    lan_recent = False
    lan_unreach = False
    try:
        person = presence_engine.find_person_by_id(person_id) or {}
        lan_fresh_s = int(presence_engine._cfg("lan_fresh_seconds"))
        lan_seen_iso = person.get("lan_last_seen")
        lan_probe_iso = person.get("lan_last_probe")
        if lan_seen_iso:
            try:
                lan_seen = datetime.fromisoformat(lan_seen_iso)
                if lan_seen.tzinfo is None:
                    lan_seen = lan_seen.replace(tzinfo=timezone.utc)
                if (now - lan_seen) < timedelta(seconds=lan_fresh_s):
                    lan_recent = True
            except Exception:
                pass
        # "Unreachable recent" means: we DID probe in the last `lan_fresh_s`,
        # but `lan_last_seen` is stale or absent — i.e. the most recent probe
        # failed.
        if not lan_recent and lan_probe_iso:
            try:
                lan_probe = datetime.fromisoformat(lan_probe_iso)
                if lan_probe.tzinfo is None:
                    lan_probe = lan_probe.replace(tzinfo=timezone.utc)
                if (now - lan_probe) < timedelta(seconds=lan_fresh_s):
                    lan_unreach = True
            except Exception:
                pass
    except Exception:
        pass

    # Activity evidence — last_activity is persisted on the device record by
    # the source='activity' branch of _handle_location.
    driving_recent = False
    try:
        last_act = device.get("last_activity") or {}
        if (last_act.get("activity") == "driving"
                and (last_act.get("confidence") in ("medium", "high"))):
            ts_iso = last_act.get("ts")
            if ts_iso:
                try:
                    ts = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    if (now - ts) < timedelta(seconds=90):
                        driving_recent = True
                except Exception:
                    pass
    except Exception:
        pass

    parts: list[str] = []
    if lan_recent:   parts.append("lan=reachable")
    elif lan_unreach: parts.append("lan=unreachable")
    if driving_recent: parts.append("activity=driving")
    summary = " ".join(parts)
    return {
        "lan_reachable_recent":     lan_recent,
        "lan_unreachable_recent":   lan_unreach,
        "activity_driving_recent":  driving_recent,
        "summary":                  summary,
    }


def _fire_approaching_home_push(person_id: str) -> None:
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    last = _LAST_APPROACH_PUSH.get(person_id)
    if last is not None and (now - last).total_seconds() < _APPROACH_PUSH_COOLDOWN_S:
        return
    _LAST_APPROACH_PUSH[person_id] = now

    person = presence_engine.find_person_by_id(person_id) or {}
    name = person.get("name") or "Someone"
    # Self-suppression mirrors the home-arrival push: the person whose phone
    # fired the event already knows they're heading home; their household
    # members are who we want to notify.
    exclude = person.get("linked_user") or None
    try:
        from services.push_notify import push_notify_fire_and_forget
        push_notify_fire_and_forget(
            f"{name} is approaching home",
            "Ziggy will start prep automations.",
            "/",
            "presence_approach",
            exclude_user_id=exclude,
        )
    except Exception as exc:
        log_error(f"[mobile_app] approach push failed: {exc}")


def _handle_sensors(device: dict, data: Any) -> dict:
    """Phase 1 stub: write per-device sensor values into the device record.
    Full ingestion into the presence/anomaly engines lands in Phase 3.
    """
    if not isinstance(data, list):
        return {"ok": False, "error": "data_must_be_list"}
    sensors = {s["key"]: {"value": s.get("value"), "ts": s.get("ts")} for s in data if "key" in s}
    if not sensors:
        return {"ok": False, "error": "no_sensors"}
    update_device(device["device_id"], {"last_sensors": sensors})
    log_info(f"[mobile_app] {len(sensors)} sensors from {device['device_id']}")
    return {"ok": True, "ingested": len(sensors)}
