"""
Mobile push delivery — scaffolding for APNs (iOS) and FCM (Android).

Phase 1 status: STUBS. Real delivery code lights up in Phase 4 once the user
has:
  - Enrolled in the Apple Developer Program and generated an APNs .p8 key
  - Created a Firebase project and downloaded a service-account JSON for FCM

This module deliberately does NOT import aioapns or any FCM SDK at import time
— so the backend continues to start cleanly even before credentials exist.
Imports happen lazily inside the send_* functions, with a clear error if creds
are missing.

Configuration (read from settings.yaml or env, in order of precedence):
  mobile_push:
    apns:
      key_id:    "..."          # 10-char Apple Key ID
      team_id:   "..."          # 10-char Apple Team ID
      key_path:  "secrets/AuthKey_XXXXXX.p8"
      topic:     "app.ziggy.mobile"     # iOS bundle id
      production: true
    fcm:
      service_account_path: "secrets/firebase-service-account.json"
      project_id: "ziggy-home"
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Optional

from core.logger_module import log_info, log_error
from core.settings_loader import settings
from services import mobile_app


def _cfg() -> dict:
    return settings.get("mobile_push", {}) or {}


def _apns_cfg() -> Optional[dict]:
    cfg = _cfg().get("apns")
    if not cfg or not all(cfg.get(k) for k in ("key_id", "team_id", "key_path", "topic")):
        return None
    return cfg


def _fcm_cfg() -> Optional[dict]:
    cfg = _cfg().get("fcm")
    if not cfg or not cfg.get("service_account_path"):
        return None
    return cfg


# ── Public API ───────────────────────────────────────────────────────────────

async def send_to_device(device_id: str, *, title: str, body: str,
                          data: Optional[dict] = None) -> dict:
    """Deliver a push to a single registered mobile device. Returns a small
    result dict the caller can log. Best-effort — failure is logged, never
    raised, because push delivery should never break callers.
    """
    devices = [d for d in _all_devices() if d.get("device_id") == device_id]
    if not devices:
        return {"ok": False, "error": "device_not_found"}
    return await _send(devices[0], title=title, body=body, data=data or {})


async def send_to_user(user_id: str, *, title: str, body: str,
                        data: Optional[dict] = None) -> list[dict]:
    """Fan-out to every mobile device registered to a user. One push per
    device. Returns a list of per-device results.
    """
    targets = [d for d in _all_devices() if d.get("user_id") == user_id]
    if not targets:
        return [{"ok": False, "error": "no_devices_for_user", "user_id": user_id}]
    return await asyncio.gather(*[
        _send(d, title=title, body=body, data=data or {}) for d in targets
    ])


async def send_to_all(*, title: str, body: str,
                      data: Optional[dict] = None) -> list[dict]:
    """Fan a push out to EVERY registered mobile device that has a token +
    provider. Used by the shared web-push path so automation/presence/anomaly
    notifications reach native phones too, not just browsers. Best-effort and
    a fast no-op when no device has a token yet (e.g. before FCM is set up).
    """
    targets = [d for d in _all_devices()
               if d.get("push_token") and d.get("push_provider")]
    if not targets:
        return []
    return await asyncio.gather(*[
        _send(d, title=title, body=body, data=data or {}) for d in targets
    ])


# ── Kill-proof location probes ───────────────────────────────────────────────
# While a person is AWAY, the hub interrogates their phone with a data-only
# high-priority FCM message every `probe_interval_s`. High-priority data
# messages cold-start the app process even when the OS killed it (the same
# mechanism WhatsApp calls ride on); the app's native ZiggyMessagingService
# answers with a location fix + re-arms its geofences — no JS involved. When
# the last known position is within `boost_km` of home, the probe also carries
# boost=1, switching the phone to a continuous foreground location stream
# ("courier mode") for the final approach so Pre-cool gets a precise crossing.

_PROBE_INTERVAL_S = 300          # plain probe cadence while away
_PROBE_BOOST_INTERVAL_S = 120    # faster cadence once within boost range
_PROBE_BOOST_KM = 8.0
_last_probe_at: dict[str, float] = {}   # device_id → monotonic seconds


async def send_location_probe(device: dict, *, boost: bool = False) -> dict:
    """One data-only FCM probe to one device. No notification payload — the
    user sees nothing; the phone just wakes and reports."""
    token = device.get("push_token")
    if device.get("push_provider") != "fcm" or not token:
        return {"ok": False, "error": "no_fcm_token"}
    data = {"type": "ziggy_loc_probe"}
    if boost:
        data["boost"] = "1"
    return await _send_fcm(token, title=None, body=None, data=data)


async def probe_devices() -> None:
    """Scheduler hook (runs each minute): wake phones and ask where they are.

    Probed cases, in priority order:

      1. **Departure probe pending** — the presence engine is about to call a
         departure and wants the phone asked FIRST. Sent immediately, bypassing
         the rate limit: the engine is holding a deadline open for this answer.
      2. **Away** — approach detection for Pre-cool. Boosted cadence inside
         `_PROBE_BOOST_KM` of home.
      3. **Home but unconfirmed** — LAN has gone quiet and there's no fresh fix,
         so "home" is an assumption, not an observation. This case used to be
         skipped entirely (`state == "home"` → `continue`), which is precisely
         when presence most needs to ask: a phone dozing at home and a phone
         that left produce identical silence.

    Silent no-op with no tokens / no FCM creds.
    """
    import time as _time
    try:
        from services import presence_engine, zones_registry
    except Exception:
        return
    devices = [d for d in _all_devices()
               if d.get("push_provider") == "fcm" and d.get("push_token") and d.get("person_id")]
    if not devices:
        return
    persons = {p.get("id"): p for p in presence_engine.list_persons()}
    home = None
    try:
        home = presence_engine.get_home_zone()   # (lat, lon, radius) or None
    except Exception:
        pass
    now = _time.monotonic()
    for d in devices:
        person = persons.get(d.get("person_id"))
        if not person:
            continue

        pending = bool(person.get("departure_probe_pending"))
        at_home = person.get("state") == "home"

        if not pending and at_home and not _home_needs_confirming(person, presence_engine):
            continue  # LAN or a fresh fix already says home — nothing to ask

        # Near home (by last known fix) → boost cadence + courier-mode stream.
        boost = False
        try:
            lat, lon = person.get("last_lat"), person.get("last_lon")
            if home and lat is not None and lon is not None:
                dist_m = zones_registry._haversine_m(float(lat), float(lon), home[0], home[1])
                boost = dist_m <= _PROBE_BOOST_KM * 1000
        except Exception:
            pass

        if not pending:
            interval = _PROBE_BOOST_INTERVAL_S if boost else _PROBE_INTERVAL_S
            if now - _last_probe_at.get(d["device_id"], 0.0) < interval:
                continue
        _last_probe_at[d["device_id"]] = now
        try:
            res = await send_location_probe(d, boost=boost)
            log_info(f"[mobile_push] loc probe → {d['device_id']} boost={boost} "
                     f"pending_departure={pending} ok={res.get('ok')}")
            try:
                from services import presence_journal
                presence_journal.record(
                    "probe_sent", person=person.get("name"), device=d["device_id"],
                    reason=("departure" if pending else ("away" if not at_home else "confirm_home")),
                    boost=boost, ok=bool(res.get("ok")), error=res.get("error"),
                )
            except Exception:
                pass
            if pending:
                # One request, one send. The engine's deadline governs from here;
                # re-sending every minute would spam the phone and, worse, keep
                # resetting nothing — the deadline is anchored to the request.
                person["departure_probe_pending"] = False
                try:
                    presence_engine.persist_person(person)
                except Exception:
                    pass
        except Exception as e:
            log_error(f"[mobile_push] loc probe failed for {d.get('device_id')}: {e}")


def _home_needs_confirming(person: dict, presence_engine) -> bool:
    """True when "home" rests on assumption rather than a live signal.

    Home is observed when the LAN probe is currently answering, or a GPS fix is
    fresh. Otherwise it is inertia from the last thing we saw, and inertia is
    what let a departure go unnoticed for hours.
    """
    try:
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        lan_seen = presence_engine._parse_iso(person.get("lan_last_seen"))
        if lan_seen is not None:
            fresh_s = int(presence_engine._cfg("lan_fresh_seconds"))
            if (now - lan_seen) < timedelta(seconds=fresh_s):
                return False
        if presence_engine.gps_recent_home(
                person, float(presence_engine._cfg("gps_fresh_minutes")), now=now):
            return False
        return True
    except Exception:
        return False


# Back-compat alias — the scheduler and older call sites used this name.
probe_away_devices = probe_devices


# ── Internals ────────────────────────────────────────────────────────────────

def _all_devices() -> list[dict]:
    # mobile_app stores devices in user_files/mobile_devices.json
    path = Path(__file__).resolve().parents[1] / "user_files" / "mobile_devices.json"
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []


async def _send(device: dict, *, title: str, body: str, data: dict) -> dict:
    provider = device.get("push_provider")
    token = device.get("push_token")
    if not provider or not token:
        return {"ok": False, "error": "no_push_token", "device_id": device.get("device_id")}

    if provider == "apns":
        result = await _send_apns(token, title=title, body=body, data=data)
    elif provider == "fcm":
        result = await _send_fcm(token, title=title, body=body, data=data)
    else:
        return {"ok": False, "error": f"unknown_provider:{provider}"}

    # Single chokepoint for every native push, so delivery can finally be
    # answered in the fleet view. Counts only — no titles, no bodies, no tokens.
    try:
        from services.push_stats import record as _record_push
        _record_push(provider, bool(result.get("ok")))
    except Exception:
        pass

    return result


async def _send_apns(token: str, *, title: str, body: str, data: dict) -> dict:
    cfg = _apns_cfg()
    if not cfg:
        log_info("[mobile_push] APNs not configured — skipping iOS push")
        return {"ok": False, "error": "apns_not_configured"}

    # Lazy import so missing aioapns doesn't break import-time
    try:
        from aioapns import APNs, NotificationRequest, PushType  # type: ignore
    except ImportError:
        log_error("[mobile_push] aioapns not installed. pip install aioapns")
        return {"ok": False, "error": "aioapns_not_installed"}

    try:
        apns = APNs(
            key=cfg["key_path"],
            key_id=cfg["key_id"],
            team_id=cfg["team_id"],
            topic=cfg["topic"],
            use_sandbox=not cfg.get("production", True),
        )
        request = NotificationRequest(
            device_token=token,
            message={
                "aps": {"alert": {"title": title, "body": body}, "sound": "default"},
                **data,
            },
            push_type=PushType.ALERT,
        )
        result = await apns.send_notification(request)
        return {"ok": result.is_successful, "status": result.status,
                "description": getattr(result, "description", None)}
    except Exception as e:
        log_error(f"[mobile_push] APNs send failed: {e}")
        return {"ok": False, "error": str(e)}


async def _send_fcm(token: str, *, title: str, body: str, data: dict) -> dict:
    cfg = _fcm_cfg()
    if not cfg:
        log_info("[mobile_push] FCM not configured — skipping Android push")
        return {"ok": False, "error": "fcm_not_configured"}

    try:
        import httpx  # type: ignore
        from google.oauth2 import service_account   # type: ignore
        from google.auth.transport.requests import Request as GoogleRequest  # type: ignore
    except ImportError:
        log_error("[mobile_push] FCM deps missing. pip install httpx google-auth")
        return {"ok": False, "error": "fcm_deps_missing"}

    try:
        credentials = service_account.Credentials.from_service_account_file(
            cfg["service_account_path"],
            scopes=["https://www.googleapis.com/auth/firebase.messaging"],
        )
        credentials.refresh(GoogleRequest())
        project_id = cfg.get("project_id") or credentials.project_id

        url = f"https://fcm.googleapis.com/v1/projects/{project_id}/messages:send"
        message = {
            "token": token,
            "data": {k: str(v) for k, v in data.items()},
            "android": {"priority": "HIGH"},
        }
        # title=None → DATA-ONLY message: no notification payload, nothing shown
        # to the user. High-priority data messages cold-start the app's native
        # FCM service even when the OS killed the app — the kill-proof wake
        # vector the location probes ride on.
        if title is not None:
            message["notification"] = {"title": title, "body": body}
        payload = {"message": message}
        headers = {
            "Authorization": f"Bearer {credentials.token}",
            "Content-Type": "application/json; UTF-8",
        }
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, headers=headers, json=payload)
        ok = 200 <= r.status_code < 300
        return {"ok": ok, "status": r.status_code, "body": r.text[:300]}
    except Exception as e:
        log_error(f"[mobile_push] FCM send failed: {e}")
        return {"ok": False, "error": str(e)}
