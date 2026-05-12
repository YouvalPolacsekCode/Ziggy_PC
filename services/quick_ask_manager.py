"""CRUD operations for Quick Ask shortcuts stored in user_files/quick_asks.json."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

_FILE = Path(__file__).parent.parent / "user_files" / "quick_asks.json"


def load() -> list:
    try:
        return json.loads(_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def save(data: list) -> None:
    _FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def get_all() -> list:
    return load()


def create(label: str, icon: str, intent: str, params: dict) -> dict:
    items = load()
    item = {
        "id": str(uuid.uuid4())[:8],
        "label": label,
        "icon": icon,
        "intent": intent,
        "params": params,
    }
    items.append(item)
    save(items)
    return item


def update(qa_id: str, updates: dict) -> dict | None:
    items = load()
    for item in items:
        if item["id"] == qa_id:
            item.update({k: v for k, v in updates.items() if v is not None})
            save(items)
            return item
    return None


def delete(qa_id: str) -> bool:
    items = load()
    updated = [i for i in items if i["id"] != qa_id]
    if len(updated) == len(items):
        return False
    save(updated)
    return True
