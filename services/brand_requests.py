"""What customers asked for and we don't support yet.

The Wi-Fi brand catalogue is curated, so it is permanently incomplete — 266
device integrations exist that Ziggy cannot pair, and only a few dozen are
worth listing. This file is the other half of that bargain: when someone's
device isn't there, they say so, and we find out which brand to add next from
a real home rather than from a guess.

Deliberately tiny: an append-only ring buffer on disk. No schema, no
migration, nothing that can fail a pairing flow if it breaks.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone

STORE_FILE = "user_files/brand_requests.json"
MAX_ENTRIES = 200

_lock = threading.Lock()


def record(text: str, category: str | None = None) -> None:
    """Append one request. Never raises — a failure here must not break
    pairing, which is the flow the customer is actually in."""
    try:
        with _lock:
            items = _load()
            items.append({
                "text": text,
                "category": category,
                "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            })
            del items[:-MAX_ENTRIES]
            os.makedirs(os.path.dirname(STORE_FILE), exist_ok=True)
            tmp = STORE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(items, f, ensure_ascii=False, indent=2)
            os.replace(tmp, STORE_FILE)
    except Exception:
        pass


def listed() -> list[dict]:
    with _lock:
        return _load()


def _load() -> list[dict]:
    try:
        with open(STORE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []
