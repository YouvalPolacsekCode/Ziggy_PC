from __future__ import annotations
from core.intent_utils import ok, err, wrap
from core.result_utils import L
from services.event_manager import add_event, list_events, remove_event, days_until_event, next_event


async def handle_add_event(params: dict, *, source: str = "unknown") -> dict:
    name = (params.get("name") or params.get("event") or "").strip()
    date_str = (params.get("date") or params.get("date_str") or "").strip()
    if not name:
        return err(L("Please specify an event name.", "אנא ציינו שם לאירוע."))
    if not date_str:
        return err(L("Please specify a date for the event.", "אנא ציינו תאריך לאירוע."))
    notes = params.get("notes", "")
    repeat = params.get("repeat", "none")
    return wrap(add_event(name, date_str, notes=notes, repeat=repeat))


async def handle_list_events(params: dict, *, source: str = "unknown") -> dict:
    return ok(list_events(limit=int(params.get("limit", 10))))


async def handle_remove_event(params: dict, *, source: str = "unknown") -> dict:
    name = (params.get("name") or params.get("event") or "").strip()
    if not name:
        return err(L("Which event should I remove?", "איזה אירוע להסיר?"))
    return wrap(remove_event(name))


async def handle_days_until_event(params: dict, *, source: str = "unknown") -> dict:
    name = (params.get("name") or params.get("event") or "").strip()
    if not name:
        return err(L("Which event?", "איזה אירוע?"))
    return ok(days_until_event(name))


async def handle_next_event(params: dict, *, source: str = "unknown") -> dict:
    return ok(next_event())


HANDLERS = {
    "add_event": handle_add_event,
    "list_events": handle_list_events,
    "remove_event": handle_remove_event,
    "days_until_event": handle_days_until_event,
    "next_event": handle_next_event,
}
