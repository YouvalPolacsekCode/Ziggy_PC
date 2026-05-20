"""Web push notification service.

Manages VAPID keys and browser push subscriptions. Sends encrypted push
messages to subscriptions that pass per-user preference + quiet-hour checks.

Subscriptions are stored in user_files/push_subscriptions.json.
VAPID keys are generated once and persisted to user_files/vapid_keys.json.
"""
from __future__ import annotations

import json
import threading
from pathlib import Path

from core.logger_module import log_info, log_error

_SUBS_FILE  = Path("user_files/push_subscriptions.json")
_VAPID_FILE = Path("user_files/vapid_keys.json")
_VAPID_CONTACT = "mailto:silentyouval@gmail.com"

_lock = threading.Lock()


# ── VAPID key management ──────────────────────────────────────────────────────

def _generate_vapid_keys() -> dict:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    import base64

    private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())

    # pywebpush expects the private key as a base64url-encoded raw 32-byte D value.
    d_bytes = private_key.private_numbers().private_value.to_bytes(32, "big")
    private_b64url = base64.urlsafe_b64encode(d_bytes).rstrip(b"=").decode()

    public_raw = private_key.public_key().public_bytes(
        Encoding.X962, PublicFormat.UncompressedPoint
    )
    public_b64url = base64.urlsafe_b64encode(public_raw).rstrip(b"=").decode()
    return {"private_b64url": private_b64url, "public_b64url": public_b64url}


def get_vapid_keys() -> dict:
    """Return VAPID keys, generating and persisting them on first call.
    Regenerates if the file uses the old PEM format (private_pem key).
    """
    _VAPID_FILE.parent.mkdir(parents=True, exist_ok=True)
    if _VAPID_FILE.exists():
        try:
            keys = json.loads(_VAPID_FILE.read_text(encoding="utf-8"))
            # Only accept the new b64url format — discard old PEM-format files
            if keys.get("private_b64url") and keys.get("public_b64url"):
                return keys
        except Exception:
            pass
    keys = _generate_vapid_keys()
    _VAPID_FILE.write_text(json.dumps(keys, indent=2), encoding="utf-8")
    log_info("[Push] Generated new VAPID keys")
    return keys


def get_vapid_public_key() -> str:
    return get_vapid_keys()["public_b64url"]


# ── Subscription store ────────────────────────────────────────────────────────

def load_subs() -> list[dict]:
    try:
        return json.loads(_SUBS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_subs(subs: list[dict]) -> None:
    _SUBS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SUBS_FILE.write_text(json.dumps(subs, indent=2, ensure_ascii=False), encoding="utf-8")


def add_subscription(sub: dict) -> None:
    """Store a push subscription, deduplicating by endpoint."""
    with _lock:
        subs = load_subs()
        subs = [s for s in subs if s.get("endpoint") != sub.get("endpoint")]
        subs.append(sub)
        _save_subs(subs)


def remove_subscription(endpoint: str) -> None:
    with _lock:
        subs = [s for s in load_subs() if s.get("endpoint") != endpoint]
        _save_subs(subs)


# ── Sending ───────────────────────────────────────────────────────────────────

def _send_one(sub: dict, data: str, private_pem: str) -> bool:
    """Send push to a single subscription. Returns False if the sub is gone (410/404)."""
    try:
        from pywebpush import webpush
        from urllib.parse import urlparse
        endpoint = sub["endpoint"]
        parsed   = urlparse(endpoint)
        aud      = f"{parsed.scheme}://{parsed.netloc}"
        webpush(
            subscription_info={"endpoint": endpoint, "keys": sub["keys"]},
            data=data,
            vapid_private_key=private_pem,
            vapid_claims={"sub": _VAPID_CONTACT, "aud": aud},
        )
        return True
    except Exception as exc:
        msg = str(exc)
        if "410" in msg or "404" in msg or "Gone" in msg:
            return False
        log_error(f"[Push] Send failed for {sub.get('endpoint', '?')[:60]}: {exc}")
        return True  # transient error — keep subscription


def push_notify_sync(
    title: str,
    body: str,
    url: str = "/",
    category: str = "general",
    exclude_user_id: str | None = None,
) -> None:
    """Send a web push to all subscriptions that pass per-user preference checks.

    `exclude_user_id`: if set, subscriptions whose `user_id` matches (case-
    insensitive) are skipped — used for self-notification suppression so a
    user doesn't get pushed about their own presence transitions.

    Safe to call from any thread.
    category must match a key in push_preferences.CATEGORIES, or "general" to skip filtering.
    """
    try:
        keys        = get_vapid_keys()
        private_pem = keys["private_b64url"]
        data        = json.dumps({"title": title, "body": body, "url": url})

        with _lock:
            subs = load_subs()

        if not subs:
            return

        still_valid: list[dict] = []
        sent = 0
        excl_lower = (exclude_user_id or "").lower() if exclude_user_id else ""

        for sub in subs:
            user_id = sub.get("user_id")

            # Self-suppression — keep the subscription, just skip sending.
            if excl_lower and user_id and user_id.lower() == excl_lower:
                still_valid.append(sub)
                continue

            # Per-user preference gate
            if user_id and category != "general":
                try:
                    from services.push_preferences import is_allowed
                    if not is_allowed(user_id, category):
                        still_valid.append(sub)
                        continue
                except Exception:
                    pass  # preference check failure → send anyway

            ok = _send_one(sub, data, private_pem)
            if ok:
                still_valid.append(sub)
                sent += 1

        if len(still_valid) != len(subs):
            with _lock:
                _save_subs(still_valid)

        if sent:
            log_info(f"[Push] Sent '{title}' ({category}) to {sent} subscription(s)")
    except Exception as exc:
        log_error(f"[Push] push_notify_sync failed: {exc}")


async def push_notify(
    title: str,
    body: str,
    url: str = "/",
    category: str = "general",
    exclude_user_id: str | None = None,
) -> None:
    """Async wrapper — offloads to thread pool to avoid blocking the event loop."""
    import asyncio
    await asyncio.get_event_loop().run_in_executor(
        None, push_notify_sync, title, body, url, category, exclude_user_id
    )


def push_notify_fire_and_forget(
    title: str,
    body: str,
    url: str = "/",
    category: str = "general",
    exclude_user_id: str | None = None,
) -> None:
    """Schedule a push without waiting for HTTP delivery.

    Safe from any context: if an asyncio loop is running we hand the work
    to its default executor; otherwise we spawn a one-shot daemon thread.
    Use this on hot paths (HA event handler, presence engine, scheduler
    tick) where a slow web-push subscription must not stall the caller —
    a single dead endpoint can otherwise block the event loop 10–30 s.
    """
    import asyncio, threading
    try:
        loop = asyncio.get_running_loop()
        loop.run_in_executor(
            None, push_notify_sync, title, body, url, category, exclude_user_id
        )
        return
    except RuntimeError:
        pass
    threading.Thread(
        target=push_notify_sync,
        args=(title, body, url, category, exclude_user_id),
        daemon=True,
        name="PushNotify",
    ).start()
