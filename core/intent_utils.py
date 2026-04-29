"""Shared helpers for all intent handlers."""
from __future__ import annotations

import re
from core.logger_module import log_error


def ok(message: str, data: dict | None = None) -> dict:
    return {"ok": True, "message": message, "data": data or {}}


def err(message: str, details: str | None = None, data: dict | None = None) -> dict:
    out = {"ok": False, "message": message, "data": data or {}}
    if details:
        out["data"]["details"] = details
    return out


def wrap(res) -> dict:
    if isinstance(res, dict):
        return res
    return ok(str(res))


def normalize_room(params: dict) -> str:
    room = params.get("room") or params.get("area") or params.get("location")
    if not room:
        log_error(f"[Intent Handler] Missing room/location in params: {params}")
        return "unknown"
    return room.replace(" ", "_").lower()


TV_APP_MAP = {
    "netflix": "Netflix", "netfilx": "Netflix",
    "youtube": "YouTube", "yt": "YouTube",
    "prime": "Prime Video", "prime video": "Prime Video",
    "disney": "Disney+", "disney+": "Disney+",
    "apple tv": "Apple TV",
    "hbo": "HBO Max", "max": "Max",
    "hulu": "Hulu",
    "paramount": "Paramount+", "paramount+": "Paramount+",
    "peacock": "Peacock",
    "youtube tv": "YouTube TV",
}


def normalize_tv_source(val: object) -> str:
    s = str(val or "").strip().lower()
    if s in TV_APP_MAP:
        return TV_APP_MAP[s]
    m = re.match(r"^hdmi[\s\-_]*([0-9]+)$", s)
    if m:
        return f"HDMI {int(m.group(1))}"
    if re.match(r"^[0-9]+$", s):
        return f"HDMI {int(s)}"
    return " ".join(part.capitalize() for part in s.split())
