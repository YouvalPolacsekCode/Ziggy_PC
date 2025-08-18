# services/communication_manager.py
from __future__ import annotations

import os
from typing import Optional, Dict, Any, List

from core.logger_module import log_info, log_error
from core.settings_loader import settings

# Optional integrations
# Telegram: reuse interfaces/telegram_interface.py if present
try:
    from interfaces.telegram_interface import send_direct_message as _tg_send
except Exception:
    _tg_send = None

CONTACTS = settings.get("contacts", {})  # also mirrored from config/contacts.yaml if your loader merges it


# ---------- Public Scenarios ----------

def read_latest_emails(limit: int = 5) -> Dict[str, Any]:
    """
    Read/summarize latest unread emails.

    TODO:
      - Configure Gmail or MS Graph OAuth and token path per .env and perform initial authorization flow.

    Args:
        limit: Max threads/messages.

    Returns:
        Standard result dict.
    """
    chk = _mail_auth_check()
    if not chk["ok"]:
        return chk
    threads = _mail_fetch_unread(limit)
    summary = _mail_summarize_threads(threads)
    return {"ok": True, "message": f"{len(threads)} threads.", "data": {"threads": threads, "summary": summary}}


def send_email_to_contact(name: str, subject: str, body: str) -> Dict[str, Any]:
    """
    Compose and send an email via configured provider.

    Args:
        name: Contact key in contacts.yaml.
        subject: Subject line.
        body: Message body.

    Returns:
        Standard result dict.
    """
    c = _contact_resolve(name)
    if not c.get("email"):
        return {"ok": False, "message": f"No email for contact '{name}'.", "data": {}}
    msg = _mail_compose(c["email"], subject, body)
    res = _mail_send(msg)
    return res


def quick_message(contact_name: str, text: str, channel: str = "telegram") -> Dict[str, Any]:
    """
    Send a quick IM via Telegram/WhatsApp.

    Args:
        contact_name: Contact name key.
        text: Message content.
        channel: 'telegram' or 'whatsapp'.

    Returns:
        Standard result dict.
    """
    c = _contact_resolve(contact_name)
    if channel == "telegram":
        if not _tg_send:
            return _todo("Telegram interface not wired. Implement interfaces/telegram_interface.send_direct_message")
        handle = c.get("telegram")
        if not handle:
            return {"ok": False, "message": f"Contact '{contact_name}' missing telegram handle.", "data": {}}
        try:
            _tg_send(handle, text)
            return {"ok": True, "message": f"Sent Telegram to {handle}.", "data": {}}
        except Exception as e:
            log_error(f"[comm.quick_message] {e}")
            return {"ok": False, "message": f"Telegram send failed: {e}", "data": {}}
    elif channel == "whatsapp":
        return _msg_send_whatsapp(c, text)
    else:
        return {"ok": False, "message": f"Unsupported channel '{channel}'.", "data": {}}


def broadcast_announcement(text: str, rooms_or_all: str | List[str] = "all") -> Dict[str, Any]:
    """
    Broadcast a short announcement via TTS to all or selected rooms.

    TODO:
      - Configure HA TTS and a notify/tts service (e.g., tts.google_translate_say) and media targets.

    Args:
        text: Announcement.
        rooms_or_all: "all" or list of room keys.

    Returns:
        Standard result dict.
    """
    res = _tts_broadcast(text, rooms_or_all)
    if not res["ok"]:
        return res
    ok = _confirm_broadcast()
    return {"ok": ok, "message": "Announcement sent." if ok else "Announcement may have failed.", "data": {}}


def read_latest_sms(limit: int = 5) -> Dict[str, Any]:
    """
    Read/summarize latest SMS messages.

    TODO:
      - Wire Twilio or Android Companion App integration.

    Args:
        limit: Max messages.

    Returns:
        Standard result dict.
    """
    msgs = _sms_fetch_unread(limit)
    if not isinstance(msgs, list):
        return msgs
    summary = _sms_summarize(msgs)
    return {"ok": True, "message": f"{len(msgs)} messages.", "data": {"messages": msgs, "summary": summary}}

# ---------- Atomic ----------

def _mail_auth_check() -> Dict[str, Any]:
    # TODO steps:
    # 1) Fill GMAIL_* or MS_* values in .env
    # 2) Run a one-time local OAuth flow to create token file (paths in .env: GMAIL_TOKEN_PATH/MS_TOKEN_PATH)
    # 3) Implement provider-specific code below.
    return _todo("Email provider OAuth not configured. Fill .env and implement Gmail/MS Graph code.")


def _mail_fetch_unread(limit: int) -> List[Dict[str, Any]]:
    return []  # TODO: Fetch unread threads via Gmail API or MS Graph


def _mail_summarize_threads(threads: List[Dict[str, Any]]) -> str:
    if not threads:
        return "No unread emails."
    return f"Unread: {len(threads)} threads."


def _mail_compose(to: str, subject: str, body: str) -> Dict[str, Any]:
    return {"to": to, "subject": subject, "body": body}


def _mail_send(message: Dict[str, Any]) -> Dict[str, Any]:
    # TODO: Use Gmail API send or MS Graph send-mail
    return _todo("Email send not implemented. Use Gmail API or MS Graph send-mail endpoints.")


def _contact_resolve(name: str) -> Dict[str, Any]:
    key = (name or "").strip().lower()
    return settings.get("contacts", {}).get(key, {})


def _msg_send_telegram(contact: Dict[str, Any], text: str) -> Dict[str, Any]:
    if not _tg_send:
        return _todo("Telegram interface not available.")
    try:
        _tg_send(contact["telegram"], text)
        return {"ok": True, "message": "Telegram sent.", "data": {}}
    except Exception as e:
        log_error(f"[comm._msg_send_telegram] {e}")
        return {"ok": False, "message": f"Telegram error: {e}", "data": {}}


def _msg_send_whatsapp(contact: Dict[str, Any], text: str) -> Dict[str, Any]:
    # TODO steps:
    # 1) Add WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in .env
    # 2) Call Facebook Graph API /messages with template or text
    return _todo("WhatsApp Cloud API not configured.")


def _sms_fetch_unread(limit: int) -> List[Dict[str, Any]] | Dict[str, Any]:
    # TODO steps:
    # 1) Twilio creds in .env OR Android Companion App add-on and REST endpoint
    return _todo("SMS integration not configured.")


def _sms_summarize(messages: List[Dict[str, Any]]) -> str:
    return "No SMS messages." if not messages else f"{len(messages)} messages."


def _tts_broadcast(text: str, target: str | List[str]) -> Dict[str, Any]:
    # TODO: Implement via HA tts service + media_player targets
    return _todo("TTS broadcast not set. Configure HA TTS and targets in settings.yaml.")


def _confirm_broadcast() -> bool:
    return True  # Best-effort; can poll HA media state if desired.


def _todo(msg: str) -> Dict[str, Any]:
    return {"ok": False, "message": f"TODO: {msg}", "data": {}}
