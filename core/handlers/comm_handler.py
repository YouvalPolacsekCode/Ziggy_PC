from __future__ import annotations
from services import communication_manager


async def handle_read_emails(params: dict, *, source: str = "unknown") -> dict:
    return communication_manager.read_latest_emails(
        limit=int(params.get("limit", 5)),
        sender=params.get("sender"),
        unread_only=bool(params.get("unread_only", True)),
    )


async def handle_send_email(params: dict, *, source: str = "unknown") -> dict:
    return communication_manager.send_email_to_contact(
        name=params.get("name", ""),
        subject=params.get("subject", ""),
        body=params.get("body", ""),
    )


async def handle_quick_message(params: dict, *, source: str = "unknown") -> dict:
    return communication_manager.quick_message(
        contact_name=params.get("contact_name", ""),
        text=params.get("text", ""),
        channel=params.get("channel", "telegram"),
    )


async def handle_broadcast(params: dict, *, source: str = "unknown") -> dict:
    return communication_manager.broadcast_announcement(
        text=params.get("text", ""),
        rooms_or_all=params.get("rooms_or_all", "all"),
    )


async def handle_read_sms(params: dict, *, source: str = "unknown") -> dict:
    return communication_manager.read_latest_sms(limit=int(params.get("limit", 5)))


HANDLERS = {
    "comm_read_emails": handle_read_emails,
    "comm_send_email": handle_send_email,
    "comm_quick_message": handle_quick_message,
    "comm_broadcast_announcement": handle_broadcast,
    "comm_read_sms": handle_read_sms,
}
