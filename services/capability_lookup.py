"""Ziggy's self-knowledge: search the generated capability catalog.

docs/capability-catalog.json (built by scripts/catalog/) is the curated,
plain-language record of what Ziggy can do, in which layer, and whether it is
actually live. The agent consults it through the `what_can_ziggy_do` tool so
"can you…", "what can you do", "do you support…" are answered from the
record, not from the model's imagination.

Search is deliberately dumb and deterministic: word overlap over name, pitch,
what_it_does and known_gaps, with a small Hebrew→English hint table so a
Hebrew question still lands on the English catalog. No model call.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

# docs/ is NOT copied into the hub image (.dockerignore), so the shipped copy
# lives under services/data/. The docs copy is the generator's output and the
# one humans read; scripts/catalog keeps both in step (see tests).
_SHIPPED_PATH = Path(__file__).resolve().parent / "data" / "capability-catalog.json"
_CATALOG_PATH = Path(__file__).resolve().parent.parent / "docs" / "capability-catalog.json"

# Statuses that mean "this works in a customer home today".
LIVE_STATUSES = frozenset({"live-prod"})
# Hebrew stems → English catalog words. Small on purpose; the model already
# translates the user's intent, this only rescues bare nouns.
_HE_HINTS = {
    "אור": "light", "תאורה": "light", "מנורה": "lamp light", "מזגן": "ac climate",
    "מיזוג": "ac climate", "טלוויזיה": "tv", "תריס": "cover blind shutter",
    "דוד": "boiler water heater", "מצלמה": "camera", "מצלמות": "camera",
    "נוכחות": "presence occupancy", "חיישן": "sensor", "אוטומציה": "automation",
    "שגרה": "routine", "תזכורת": "reminder task", "משימה": "task",
    "קול": "voice", "דיבור": "voice speak", "לילה": "night", "בוקר": "morning",
    "חדר": "room", "בית": "home", "מזג": "weather", "חדשות": "news",
    "שער": "gate", "דלת": "door lock", "מנעול": "lock", "אינפרא": "ir remote",
    "שלט": "remote ir", "תיקון": "repair fix", "בעיה": "problem broken",
}
_WORD = re.compile(r"[a-z0-9]+|[א-ת]+")


@lru_cache(maxsize=1)
def _load() -> list[dict]:
    data = None
    for p in (_SHIPPED_PATH, _CATALOG_PATH):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            break
        except Exception:
            continue
    if data is None:
        return []
    caps = data.get("capabilities") if isinstance(data, dict) else data
    return [c for c in (caps or []) if isinstance(c, dict)]


def _tokens(text: str) -> set[str]:
    out: set[str] = set()
    for w in _WORD.findall((text or "").lower()):
        if w in _HE_HINTS:
            out.update(_HE_HINTS[w].split())
        elif len(w) > 2:
            out.add(w)
    return out


def search(query: str, limit: int = 5, *, live_only: bool = False) -> list[dict]:
    """Rank capabilities by word overlap with `query`. Returns slim records."""
    q = _tokens(query)
    if not q:
        return []
    scored: list[tuple[float, dict]] = []
    for c in _load():
        if live_only and c.get("status") not in LIVE_STATUSES:
            continue
        name_t = _tokens(c.get("name", ""))
        body_t = _tokens(" ".join([c.get("pitch", ""), c.get("what_it_does", ""),
                                   " ".join(c.get("known_gaps") or [])]))
        score = 3.0 * len(q & name_t) + 1.0 * len(q & body_t)
        if score <= 0:
            continue
        if c.get("status") in LIVE_STATUSES:
            score += 0.5
        scored.append((score, c))
    scored.sort(key=lambda s: (-s[0], s[1].get("name", "")))
    return [_slim(c) for _, c in scored[:limit]]


# Catalog `surfaces` are source files. The ones that are app screens map to
# routes, so a capability tile can open the place where the feature lives.
# First match in a capability's surface list wins; order = specificity.
_SURFACE_ROUTES: tuple[tuple[str, str], ...] = (
    ("pages/DeviceDetail.jsx", "/devices"), ("pages/Devices.jsx", "/devices"),
    ("PairingWizard", "/devices"), ("ConfigFlowRunner", "/devices"),
    ("pages/RoomDetail", "/rooms"), ("pages/RoomsList", "/rooms"), ("pages/Rooms", "/rooms"),
    ("components/rooms/", "/rooms"),
    ("pages/Actions.jsx", "/actions"), ("components/automations/", "/actions"),
    ("pages/Routines", "/routines"), ("pages/Cameras", "/cameras"),
    ("pages/Anomalies", "/alerts"), ("pages/Suggestions", "/suggestions"),
    ("pages/Tasks", "/tasks"), ("pages/AIChat", "/chat"), ("components/chat/", "/chat"),
    ("pages/MediaSettings", "/settings/media"), ("pages/People", "/settings/people"),
    ("pages/WallTablets", "/settings/tablets"), ("wall/", "/settings/tablets"),
    ("pages/Settings.jsx", "/settings"), ("pages/AdminSettings", "/settings"),
    ("pages/Dashboard", "/"),
)


def path_for(c: dict) -> Optional[str]:
    """The app route where this capability lives, if any of its surfaces is a screen."""
    surfaces = [str(s) for s in (c.get("surfaces") or [])]
    for needle, route in _SURFACE_ROUTES:
        if any(needle in s for s in surfaces):
            return route
    return None


def _slim(c: dict) -> dict:
    return {
        "id": c.get("id"),
        "name": c.get("name"),
        "pitch": c.get("pitch"),
        "what_it_does": (c.get("what_it_does") or "")[:600],
        "status": c.get("status"),
        "live": c.get("status") in LIVE_STATUSES,
        "layer": c.get("layer"),
        "known_gaps": (c.get("known_gaps") or [])[:3],
        "path": path_for(c),
    }


def overview(limit: int = 12) -> list[dict]:
    """A short list of live, user-facing capabilities for 'what can you do'."""
    live = [c for c in _load() if c.get("status") in LIVE_STATUSES
            and c.get("audience", "user-facing") == "user-facing"]
    return [_slim(c) for c in live[:limit]]
