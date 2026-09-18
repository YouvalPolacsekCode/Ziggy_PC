"""Legacy single-value house mode — now a facade over services.modes.

The original v1 stored one of home/away/night/vacation in user_files/home_mode.json
and, by its own docstring, had "no side effects": nothing read it. The fixed
home modes (services/modes.py) replaced it; this module keeps the old
/api/mode contract alive for any client still on it:

    night    ⇄ modes.sleep on
    vacation ⇄ modes.vacation on
    home     ⇄ both off
    away     — accepted, treated as home (away is a presence FACT, not a mode)

Nothing new should import this. Use services.modes.
"""
from __future__ import annotations

import time
from typing import Optional

from services import modes as _modes

MODES = ("home", "away", "night", "vacation")
DEFAULT_MODE = "home"


def _load() -> dict:
    """Legacy shape, derived. Kept because core/agent/context.py and a few
    callers still read it for the HOUSE line."""
    mode = _modes.legacy_mode()
    rec = _modes.get("vacation") if mode == "vacation" else (_modes.get("sleep") if mode == "night" else None)
    return {
        "mode": mode,
        "changed_at": (rec or {}).get("since") or time.time(),
        "changed_by": (rec or {}).get("by"),
    }


async def get_mode() -> dict:
    return _load()


async def set_mode(new_mode: str, changed_by: Optional[str] = None) -> dict:
    if new_mode not in MODES:
        raise ValueError(f"Unknown mode '{new_mode}'. Allowed: {MODES}")
    by = changed_by or "?"
    if new_mode == "night":
        await _modes.set_mode("sleep", True, by=by)
        if _modes.is_on("vacation"):
            await _modes.set_mode("vacation", False, by=by)
    elif new_mode == "vacation":
        await _modes.set_mode("vacation", True, by=by)
        if _modes.is_on("sleep"):
            await _modes.set_mode("sleep", False, by=by)
    else:  # home / away → neither
        for m in ("sleep", "vacation"):
            if _modes.is_on(m):
                await _modes.set_mode(m, False, by=by)
    return _load()
