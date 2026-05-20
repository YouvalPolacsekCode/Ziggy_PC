from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()

EVENTS_FILE = Path("user_files/events.jsonl")


def _read_recent_events(limit: int) -> list[dict]:
    if not EVENTS_FILE.exists():
        return []
    lines = EVENTS_FILE.read_text(encoding="utf-8").strip().splitlines()
    entries: list[dict] = []
    for line in reversed(lines[-200:]):
        try:
            entries.append(json.loads(line))
        except Exception:
            pass
        if len(entries) >= limit:
            break
    return entries


@router.get("/api/activity")
async def get_activity(limit: int = 20):
    """Last `limit` activity events. File I/O runs in a thread so a slow
    disk read doesn't stall the event loop for every other request."""
    try:
        entries = await asyncio.to_thread(_read_recent_events, limit)
        return {"activity": entries}
    except Exception:
        return {"activity": []}
