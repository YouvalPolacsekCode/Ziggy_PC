from __future__ import annotations

import base64
import os
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from core.logger_module import log_info, log_error
from core.settings_loader import settings

try:
    from interfaces.telegram_interface import send_direct_message as _tg_send
except Exception:
    _tg_send = None

CONTACTS: Dict[str, Any] = settings.get("contacts", {})


# ---------------------------------------------------------------------------
# Gmail helpers
# ---------------------------------------------------------------------------

_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]


def _get_gmail_service():
    """Load or refresh Gmail credentials. Returns (service, error_message)."""
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError:
        return None, "google-api-python-client not installed. Run: pip install google-api-python-client google-auth-oauthlib"

    token_path = os.getenv("GMAIL_TOKEN_PATH", "config/gmail_token.json")
    creds_path = os.getenv("GMAIL_CREDENTIALS_PATH", "config/gmail_credentials.json")

    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, _SCOPES)

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(token_path, "w") as f:
                f.write(creds.to_json())
        except Exception as e:
            return None, f"Failed to refresh Gmail token: {e}. Run scripts/setup_gmail.py again."

    if not creds or not creds.valid:
        if not os.path.exists(creds_path):
            return None, (
                "Gmail not configured. Follow these steps:\n"
                "1. Go to Google Cloud Console > APIs > Gmail API > Enable\n"
                "2. Create OAuth2 credentials (Desktop app)\n"
                "3. Download credentials.json to config/gmail_credentials.json\n"
                "4. Run: python scripts/setup_gmail.py"
            )
        return None, (
            "Gmail token missing. Run: python scripts/setup_gmail.py\n"
            f"(credentials found at {creds_path})"
        )

    try:
        service = build("gmail", "v1", credentials=creds)
        return service, None
    except Exception as e:
        return None, f"Failed to build Gmail service: {e}"


def _decode_body(payload: dict) -> str:
    """Extract plain-text body from a Gmail message payload."""
    if payload.get("mimeType") == "text/plain":
        data = payload.get("body", {}).get("data", "")
        return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="replace") if data else ""
    for part in payload.get("parts", []):
        result = _decode_body(part)
        if result:
            return result
    return ""


# ---------------------------------------------------------------------------
# Public Scenarios
# ---------------------------------------------------------------------------

def read_latest_emails(limit: int = 5, sender: Optional[str] = None, unread_only: bool = True) -> Dict[str, Any]:
    service, err = _get_gmail_service()
    if err:
        return {"ok": False, "message": err, "data": {}}
    try:
        # Build Gmail search query
        q_parts: List[str] = []
        if unread_only:
            q_parts.append("is:unread")
        if sender:
            contact = _contact_resolve(sender)
            email_addr = contact.get("email") or sender
            q_parts.append(f"from:{email_addr}")

        query = " ".join(q_parts) or None
        list_kwargs: Dict[str, Any] = {"userId": "me", "maxResults": limit}
        if query:
            list_kwargs["q"] = query
        else:
            list_kwargs["labelIds"] = ["INBOX", "UNREAD"]

        result = service.users().messages().list(**list_kwargs).execute()
        messages = result.get("messages", [])
        if not messages:
            from_label = f" from {sender}" if sender else ""
            return {"ok": True, "message": f"No {'unread ' if unread_only else ''}emails{from_label}.", "data": {"threads": []}}

        threads = []
        for msg in messages:
            detail = service.users().messages().get(userId="me", id=msg["id"], format="full").execute()
            headers = {h["name"]: h["value"] for h in detail.get("payload", {}).get("headers", [])}
            snippet = detail.get("snippet", "")
            body = _decode_body(detail.get("payload", {}))
            threads.append({
                "id": msg["id"],
                "from": headers.get("From", ""),
                "subject": headers.get("Subject", "(no subject)"),
                "date": headers.get("Date", ""),
                "snippet": snippet,
                "body": body[:500],
            })

        summary_parts = [f"From {t['from']}: {t['subject']} — {t['snippet'][:80]}" for t in threads]
        summary = "\n".join(summary_parts)
        log_info(f"[Gmail] Read {len(threads)} emails (sender={sender!r})")
        return {"ok": True, "message": summary, "data": {"threads": threads}}
    except Exception as e:
        log_error(f"[Gmail] read_latest_emails: {e}")
        return {"ok": False, "message": f"Gmail error: {e}", "data": {}}


def send_email_to_contact(name: str, subject: str, body: str) -> Dict[str, Any]:
    c = _contact_resolve(name)
    email_addr = c.get("email")
    if not email_addr:
        return {"ok": False, "message": f"No email address for contact '{name}'.", "data": {}}

    service, err = _get_gmail_service()
    if err:
        return {"ok": False, "message": err, "data": {}}

    sender = os.getenv("GMAIL_SENDER", "me")
    msg = MIMEMultipart()
    msg["From"] = sender
    msg["To"] = email_addr
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain"))

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
    try:
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
        log_info(f"[Gmail] Sent email to {email_addr}")
        return {"ok": True, "message": f"Email sent to {name} ({email_addr}).", "data": {}}
    except Exception as e:
        log_error(f"[Gmail] send_email_to_contact: {e}")
        return {"ok": False, "message": f"Failed to send email: {e}", "data": {}}


def quick_message(contact_name: str, text: str, channel: str = "telegram") -> Dict[str, Any]:
    c = _contact_resolve(contact_name)
    if channel == "telegram":
        if not _tg_send:
            return {"ok": False, "message": "Telegram interface not loaded.", "data": {}}
        handle = c.get("telegram")
        if not handle:
            return {"ok": False, "message": f"Contact '{contact_name}' has no Telegram handle.", "data": {}}
        try:
            _tg_send(handle, text)
            return {"ok": True, "message": f"Sent Telegram to {handle}.", "data": {}}
        except Exception as e:
            log_error(f"[comm.quick_message] {e}")
            return {"ok": False, "message": f"Telegram send failed: {e}", "data": {}}
    elif channel == "whatsapp":
        return _msg_send_whatsapp(c, text)
    return {"ok": False, "message": f"Unsupported channel '{channel}'.", "data": {}}


def broadcast_announcement(text: str, rooms_or_all: str | List[str] = "all") -> Dict[str, Any]:
    """Send TTS announcement via HA media_player targets from settings.tts."""
    tts_cfg = settings.get("tts", {})
    tts_service = tts_cfg.get("service", "tts.google_translate_say")
    media_players = tts_cfg.get("media_players", [])
    if not media_players:
        return {
            "ok": False,
            "message": "No TTS targets configured. Add 'tts.media_players' to settings.yaml with a list of media_player entity_ids.",
            "data": {},
        }
    # Parse "domain.service_name" from settings
    svc_parts = tts_service.rsplit(".", 1)
    tts_domain = svc_parts[0] if len(svc_parts) == 2 else "tts"
    tts_svc_name = svc_parts[1] if len(svc_parts) == 2 else tts_service
    from services.home_automation import call_service
    sent = 0
    for entity_id in media_players:
        r = call_service(tts_domain, tts_svc_name, {"entity_id": entity_id, "message": text, "cache": False})
        if r.get("ok"):
            sent += 1
    return {"ok": sent > 0, "message": f"Announcement sent to {sent} device(s).", "data": {}}


def read_latest_sms(limit: int = 5) -> Dict[str, Any]:
    return {
        "ok": False,
        "message": "SMS integration not configured. Requires Twilio or Android Companion App add-on.",
        "data": {},
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _contact_resolve(name: str) -> Dict[str, Any]:
    key = (name or "").strip().lower()
    return settings.get("contacts", {}).get(key, {})


def _msg_send_whatsapp(contact: Dict[str, Any], text: str) -> Dict[str, Any]:
    # WhatsApp Cloud API requires a verified Meta Business Account with approved
    # message templates for initiating conversations. Without one, free-form messages
    # to most contacts will be rejected by the API (error 131030 / 131026).
    # Recommend Telegram as the default quick-message channel instead.
    phone = contact.get("whatsapp")
    if not phone:
        return {
            "ok": False,
            "message": "Contact has no WhatsApp number. Use Telegram instead (say: 'send [name] a Telegram message').",
            "data": {},
        }
    phone_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
    token = os.getenv("WHATSAPP_ACCESS_TOKEN")
    if not (phone_id and token):
        return {
            "ok": False,
            "message": (
                "WhatsApp requires a Meta Business Account — not configured. "
                "Use Telegram instead (say: 'send [name] a Telegram message')."
            ),
            "data": {},
        }
    import requests as req
    try:
        resp = req.post(
            f"https://graph.facebook.com/v18.0/{phone_id}/messages",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"messaging_product": "whatsapp", "to": phone, "type": "text", "text": {"body": text}},
            timeout=10,
        )
        if resp.ok:
            return {"ok": True, "message": f"WhatsApp sent to {phone}.", "data": {}}
        err_data = resp.json() if resp.content else {}
        err_msg = err_data.get("error", {}).get("message", f"HTTP {resp.status_code}")
        return {"ok": False, "message": f"WhatsApp API error: {err_msg}", "data": {}}
    except Exception as e:
        log_error(f"[comm._msg_send_whatsapp] {e}")
        return {"ok": False, "message": f"WhatsApp error: {e}", "data": {}}
