"""Thin read-only helpers for the Ziggy-native presence registry.

The canonical read/write logic lives in backend/routers/presence_router.py.
This module exposes read-only helpers so non-HTTP code (anomaly engine,
voice handler) can query presence without importing from the router layer.
"""
from __future__ import annotations

import json
from pathlib import Path

_REGISTRY = Path(__file__).resolve().parent.parent / "user_files" / "persons.json"


def load_persons() -> list[dict]:
    try:
        return json.loads(_REGISTRY.read_text(encoding="utf-8"))
    except Exception:
        return []


def home_person_names() -> list[str]:
    """Return display names of persons whose state is 'home'."""
    return [p["name"] for p in load_persons() if p.get("state") == "home"]


def all_away() -> bool:
    """True only if the registry is non-empty and every person is not home."""
    persons = load_persons()
    return bool(persons) and all(p.get("state") != "home" for p in persons)


def any_home() -> bool:
    return any(p.get("state") == "home" for p in load_persons())
