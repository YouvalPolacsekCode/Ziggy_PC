from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()

EVENTS_FILE = Path("user_files/events.jsonl")


@router.get("/api/activity")
async def get_activity(limit: int = 20):
    try:
        if not EVENTS_FILE.exists():
            return {"activity": []}
        lines = EVENTS_FILE.read_text(encoding="utf-8").strip().splitlines()
        entries = []
        for line in reversed(lines[-200:]):
            try:
                entries.append(json.loads(line))
            except Exception:
                pass
            if len(entries) >= limit:
                break
        return {"activity": entries}
    except Exception:
        return {"activity": []}
