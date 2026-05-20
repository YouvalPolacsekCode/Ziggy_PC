"""Thin read-only helpers for the Ziggy-native presence registry.

The canonical read/write logic lives in services.presence_engine.
This module exposes read-only helpers so non-HTTP code (anomaly engine,
voice handler, sensor alerts) can query presence without importing FastAPI.

A ping older than the asymmetric stale window degrades the displayed state to
'unknown' so a phone that stops reporting is never permanently locked as home.
"""
from __future__ import annotations

from services.presence_engine import (
    _DEFAULTS,
    _cfg,
    effective_state,
    list_persons as _engine_list_persons,
)
from services.presence_engine import _load as _engine_load


# Backwards-compatible constants — preserved for callers that imported them
# directly. Values come from the engine config so changes apply uniformly.
STALE_HOME_HOURS   = _DEFAULTS["stale_home_hours"]
STALE_AWAY_MINUTES = _DEFAULTS["stale_away_minutes"]
STALE_AFTER_MINUTES = STALE_AWAY_MINUTES  # kept for any external callers


def load_persons() -> list[dict]:
    return _engine_load()


def home_person_names() -> list[str]:
    return [p["name"] for p in load_persons() if effective_state(p) == "home"]


def all_away() -> bool:
    persons = load_persons()
    return bool(persons) and all(effective_state(p) != "home" for p in persons)


def any_home() -> bool:
    return any(effective_state(p) == "home" for p in load_persons())
