"""
Runtime registry of active Ziggy browser display clients.

When a Ziggy frontend tab connects via WebSocket it sends:
  {"type": "display_hello", "name": "office monitor", "room": "office", "aliases": ["my monitor"]}

That registration is stored here. target_resolver queries this registry to route
display_push commands to the correct browser tab.

Entries are pruned after STALE_SECONDS with no heartbeat (default 5 min).
"""
from __future__ import annotations

import time
from typing import Dict, Optional

STALE_SECONDS = 300

_displays: Dict[str, dict] = {}  # ws_id → display record


class DisplayRegistry:
    def register(self, ws_id: str, name: str, room: str = "", aliases: list | None = None) -> None:
        _displays[ws_id] = {
            "ws_id": ws_id,
            "name": name,
            "room": room.strip().lower(),
            "aliases": [a.strip().lower() for a in (aliases or [])],
            "last_seen": time.monotonic(),
        }

    def unregister(self, ws_id: str) -> None:
        _displays.pop(ws_id, None)

    def heartbeat(self, ws_id: str) -> None:
        if ws_id in _displays:
            _displays[ws_id]["last_seen"] = time.monotonic()

    def resolve(self, hint: str) -> Optional[dict]:
        self._prune()
        h = hint.strip().lower()
        for d in _displays.values():
            if h == d["name"].lower() or h in d["aliases"]:
                return d
        return None

    def list_active(self) -> list[dict]:
        self._prune()
        return list(_displays.values())

    def _prune(self) -> None:
        now = time.monotonic()
        stale = [k for k, v in _displays.items() if now - v["last_seen"] > STALE_SECONDS]
        for k in stale:
            del _displays[k]


registry = DisplayRegistry()
