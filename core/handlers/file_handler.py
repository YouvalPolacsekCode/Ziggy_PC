from __future__ import annotations
import dateparser
from datetime import datetime as dt
from core.intent_utils import ok, err
from services.file_manager import (
    save_file, read_file, delete_file, list_files,
    create_note, read_notes, search_notes,
    append_to_note, delete_note,
    save_json, read_json, save_yaml_file, save_csv,
)


async def handle_save_note(params: dict, *, source: str = "unknown") -> dict:
    content = (params.get("content") or params.get("text") or "").strip()
    if not content:
        return ok("What should I save in the note?")
    title = params.get("title")
    result = create_note(content, title=title)
    return ok(f"Note saved. ({result})")


async def handle_read_notes(params: dict, *, source: str = "unknown") -> dict:
    limit = int(params.get("limit", 3))
    return ok(read_notes(limit))


async def handle_search_notes(params: dict, *, source: str = "unknown") -> dict:
    query = (params.get("query") or params.get("keyword") or "").strip()
    if not query:
        return ok("What should I search for in your notes?")
    matches = search_notes(query)
    if not matches:
        return ok(f"No notes found matching '{query}'.")
    titles = [n.get("title", n.get("filename", "")) for n in matches]
    return ok(f"Found {len(matches)} note(s): " + ", ".join(titles), data={"matches": matches})


async def handle_append_to_note(params: dict, *, source: str = "unknown") -> dict:
    filename = (params.get("filename") or params.get("title") or "").strip()
    content = (params.get("content") or params.get("text") or "").strip()
    if not filename:
        return ok("Which note should I append to?")
    if not content:
        return ok("What should I append?")
    return ok(append_to_note(filename, content))


async def handle_delete_note(params: dict, *, source: str = "unknown") -> dict:
    query = (params.get("filename") or params.get("title") or params.get("query") or "").strip()
    if not query:
        return ok("Which note should I delete?")
    return ok(delete_note(query))


async def handle_save_file(params: dict, *, source: str = "unknown") -> dict:
    filename = (params.get("filename") or "").strip()
    content = (params.get("content") or "").strip()
    if not filename:
        return ok("What filename should I use?")
    if not content:
        return ok("What should I put in the file?")
    # Route to structured format handlers based on extension
    if filename.endswith(".json"):
        try:
            import json
            return ok(save_json(filename, json.loads(content)))
        except Exception:
            pass
    return ok(save_file(filename, content))


async def handle_read_file(params: dict, *, source: str = "unknown") -> dict:
    filename = (params.get("filename") or "").strip()
    if not filename:
        return ok("Which file should I read?")
    return ok(read_file(filename))


async def handle_delete_file(params: dict, *, source: str = "unknown") -> dict:
    filename = (params.get("filename") or "").strip()
    if not filename:
        return ok("Which file should I delete?")
    return ok(delete_file(filename))


async def handle_list_files(params: dict, *, source: str = "unknown") -> dict:
    files = list_files()
    if not files:
        return ok("No files saved yet.")
    return ok("Saved files: " + ", ".join(sorted(files)))


async def handle_countdown(params: dict, *, source: str = "unknown") -> dict:
    target = (params.get("date") or params.get("event") or "").strip()
    if not target:
        return ok("What date or event should I count down to?")
    parsed = dateparser.parse(target, settings={"PREFER_DATES_FROM": "future"})
    if not parsed:
        return err(f"I couldn't understand the date: '{target}'.")
    today = dt.now().date()
    delta = (parsed.date() - today).days
    if delta < 0:
        return ok(f"That was {abs(delta)} day(s) ago ({parsed.strftime('%B %d, %Y')}).")
    elif delta == 0:
        return ok(f"That's today! ({parsed.strftime('%B %d, %Y')})")
    elif delta == 1:
        return ok(f"Tomorrow! ({parsed.strftime('%B %d, %Y')})")
    return ok(f"{delta} days until {parsed.strftime('%B %d, %Y')}.")


HANDLERS = {
    "save_note": handle_save_note,
    "read_notes": handle_read_notes,
    "search_notes": handle_search_notes,
    "append_to_note": handle_append_to_note,
    "delete_note": handle_delete_note,
    "save_file": handle_save_file,
    "read_file": handle_read_file,
    "delete_file": handle_delete_file,
    "list_files": handle_list_files,
    "countdown": handle_countdown,
}
