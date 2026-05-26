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
        return await _send_apns(token, title=title, body=body, data=data)
    if provider == "fcm":
        return await _send_fcm(token, title=title, body=body, data=data)
    return {"ok": False, "error": f"unknown_provider:{provider}"}


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
        payload = {
            "message": {
                "token": token,
                "notification": {"title": title, "body": body},
                "data": {k: str(v) for k, v in data.items()},
                "android": {"priority": "HIGH"},
            },
        }
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
