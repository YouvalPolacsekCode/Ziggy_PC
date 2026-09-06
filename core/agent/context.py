"""What the agent knows about the home this turn, beyond the device directory.

Every section is best-effort and capped: a missing service yields an empty
string, never an exception, and a power-user home cannot blow the prompt.
Nothing here is user-facing; ids appear only because the model needs them for
tool calls, and the output contract + sanitizer keep them out of replies.
"""
from __future__ import annotations

import datetime as _dt
from typing import Any

from core.logger_module import log_error
from core.agent import directory as _dir

_MAX_AUTOMATIONS = 25
_MAX_RECENT = 15
_MAX_MEMORY_CHARS = 600
_MAX_ROOMS = 30


def _persons_and_mode() -> tuple[str, str]:
    people = "unknown"
    mode = "home"
    try:
        from services.presence_engine import list_persons
        names = []
        for p in list_persons():
            names.append(f"{p.get('name') or p.get('username') or p.get('id')}="
                         f"{p.get('effective_state') or 'unknown'}")
        if names:
            people = ", ".join(names)
    except Exception:
        pass
    try:
        from services.mode_service import _load as _mode_load, DEFAULT_MODE
        mode = str((_mode_load() or {}).get("mode") or DEFAULT_MODE)
    except Exception:
        pass
    return people, mode


def _now_text() -> str:
    try:
        from core.settings_loader import settings
        tz = ((settings.get("system") or {}).get("timezone")) or None
    except Exception:
        tz = None
    try:
        from zoneinfo import ZoneInfo
        now = _dt.datetime.now(ZoneInfo(tz)) if tz else _dt.datetime.now().astimezone()
    except Exception:
        now = _dt.datetime.now().astimezone()
    return now.strftime("%A %d/%m %H:%M")


def occupancy_text(directory: dict) -> str:
    """One line per room: state + reason. Engine first, sensors as fallback."""
    lines: list[str] = []
    rooms_seen: set[str] = set()
    try:
        from services.occupancy import engine as occ_engine  # optional subsystem
        for snap in occ_engine.get_all():
            if snap.inference_mode == "none":
                continue
            rooms_seen.add(snap.room_id)
            lines.append(f"  {snap.room_id} / {_dir.room_he(snap.room_id) or snap.room_id}: "
                         f"{snap.state} — {snap.reason.description}")
    except Exception:
        pass
    # Fallback / complement: raw presence sensors per room.
    by_room: dict[str, list] = {}
    for p in directory.get("presence") or []:
        by_room.setdefault(p.get("room") or "unknown", []).append(p)
    for room, sensors in sorted(by_room.items()):
        if room in rooms_seen or room == "unknown":
            continue
        occupied = any(s.get("on") for s in sensors)
        lines.append(f"  {room} / {_dir.room_he(room) or room}: "
                     f"{'occupied' if occupied else 'clear'} — from {len(sensors)} sensor(s)")
    return "\n".join(lines[:_MAX_ROOMS])


def _age(iso: str | None) -> str:
    if not iso:
        return "never"
    try:
        t = _dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        delta = _dt.datetime.now(_dt.timezone.utc) - t.astimezone(_dt.timezone.utc)
        s = int(delta.total_seconds())
        if s < 90:
            return "just now"
        if s < 3600:
            return f"{s // 60} min ago"
        if s < 86400:
            return f"{s // 3600} h ago"
        return f"{s // 86400} d ago"
    except Exception:
        return "unknown"


def automations_text() -> str:
    lines: list[str] = []
    try:
        from services.ha_automations import list_automations
        autos = list_automations()
    except Exception as e:
        log_error(f"[agent.context] automations: {e}")
        autos = []
    for a in autos[:_MAX_AUTOMATIONS]:
        name = a.get("name") or a.get("id")
        lines.append(f"  {name} | {'on' if a.get('enabled', True) else 'off'} | "
                     f"{_age(a.get('last_triggered'))}")
    try:
        from services.ha_scripts import list_scripts
        scripts = list_scripts() or []
        for s in scripts[:_MAX_AUTOMATIONS]:
            lines.append(f"  {s.get('name') or s.get('id')} | routine (on-demand) | "
                         f"{_age(s.get('last_triggered'))}")
    except Exception:
        pass
    return "\n".join(lines)


def recent_text(directory: dict, minutes: int = 60) -> str:
    """Controllable devices whose state changed within the window, newest first."""
    try:
        from services.ha_subscriber import state_cache
        cache = dict(state_cache) if state_cache else {}
    except Exception:
        cache = {}
    if not cache:
        return ""
    names = {d["entity_id"]: d for d in (directory.get("devices") or [])}
    cutoff = _dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(minutes=minutes)
    rows: list[tuple[_dt.datetime, str]] = []
    for eid, entry in cache.items():
        d = names.get(eid)
        if not d:
            continue
        lc = (entry or {}).get("last_changed")
        if not lc:
            continue
        try:
            t = _dt.datetime.fromisoformat(str(lc).replace("Z", "+00:00")).astimezone(_dt.timezone.utc)
        except Exception:
            continue
        if t < cutoff:
            continue
        rows.append((t, f"  {t.astimezone().strftime('%H:%M')} {d['name']} ({d.get('room') or 'no room'}) → "
                        f"{(entry or {}).get('state')}"))
    rows.sort(key=lambda r: r[0], reverse=True)
    return "\n".join(r[1] for r in rows[:_MAX_RECENT])


def memory_text() -> str:
    try:
        from core.memory import list_memory
        mem = list_memory() or {}
    except Exception:
        return ""
    if not isinstance(mem, dict) or not mem:
        return ""
    parts = []
    for k, v in mem.items():
        if v in (None, "", [], {}):
            continue
        parts.append(f"  {k}: {v}")
    out = "\n".join(parts)
    return out[:_MAX_MEMORY_CHARS]


def entitlements_map() -> dict[str, bool]:
    try:
        from services import entitlements
        return {f: entitlements.has(f) for f in entitlements.ALL_FEATURES}
    except Exception:
        return {}


def rehearsal_active() -> bool:
    try:
        from services import rehearsal
        return bool(rehearsal.active())
    except Exception:
        return False


def build_context(directory: dict, *, lang: str, channel: str,
                  mode: str | None = None) -> dict[str, Any]:
    people, house_mode = _persons_and_mode()
    ctx: dict[str, Any] = {
        "lang": lang,
        "channel": channel,
        "mode": mode,
        "house_mode": house_mode,
        "people_text": people,
        "now_text": _now_text(),
        "directory_text": _dir.format_directory_for_prompt(directory),
        "entitlements": entitlements_map(),
        "rehearsal": rehearsal_active(),
    }
    for key, fn in (("occupancy_text", lambda: occupancy_text(directory)),
                    ("automations_text", automations_text),
                    ("recent_text", lambda: recent_text(directory)),
                    ("memory_text", memory_text)):
        try:
            ctx[key] = fn()
        except Exception as e:
            log_error(f"[agent.context] {key} failed: {e}")
            ctx[key] = ""
    return ctx
