"""Shared household lists (shopping and friends) + a day agenda.

ADDITIVE: new storage, new endpoints. Nothing here reads or writes any
existing Ziggy file, and no existing module imports this one.

Why these live on the hub rather than in the tablet's layout blob: a shopping
list that only one tablet can see is a notepad, not a feature. Hub-owned means
every surface in the home — the wall, both phones, a second tablet — sees the
same list, and it survives a browser cache wipe or a factory-reset tablet.

Storage mirrors the existing dashboard_layouts / ui_prefs pattern: one JSON
file under user_files/, read and written whole. These documents are small
(a family list is tens of items, not thousands) and the write path is a human
tapping a checkbox, so whole-file writes are never hot.

Concurrency: every mutation goes through `_LOCK`, so two phones ticking items
at the same instant cannot lose one another's write. Reads are lock-free.
"""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from core.logger_module import log_error

_FILE = Path(__file__).parent.parent / "user_files" / "wall_lists.json"

# One lock for both documents — they share a file.
_LOCK = asyncio.Lock()

# Bounds. Generous for a household, tight enough that a runaway client or a
# corrupted payload can't grow the file without limit.
_MAX_LISTS = 20
_MAX_ITEMS_PER_LIST = 300
_MAX_EVENTS = 500
_MAX_TEXT = 200

DEFAULT_LIST_ID = "default"


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _empty() -> dict:
    return {"lists": {}, "events": {}}


def _load() -> dict:
    if not _FILE.exists():
        return _empty()
    try:
        data = json.loads(_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return _empty()
        data.setdefault("lists", {})
        data.setdefault("events", {})
        return data
    except Exception as e:
        # A corrupt file must not take the wall down — start clean and log.
        log_error(f"[wall_lists] Read failed, starting empty: {e}")
        return _empty()


def _save(data: dict) -> None:
    try:
        _FILE.parent.mkdir(parents=True, exist_ok=True)
        # Write-then-rename so a crash mid-write can't leave a half file that
        # would read as corrupt on the next boot.
        tmp = _FILE.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(_FILE)
    except Exception as e:
        log_error(f"[wall_lists] Write failed: {e}")


def _now() -> float:
    return time.time()


def _clean_text(s: Optional[str]) -> str:
    return (s or "").strip()[:_MAX_TEXT]


# ---------------------------------------------------------------------------
# Lists
# ---------------------------------------------------------------------------

def _ensure_default(data: dict) -> None:
    """A home always has one list, so the wall is never blank-with-no-affordance."""
    if DEFAULT_LIST_ID not in data["lists"]:
        data["lists"][DEFAULT_LIST_ID] = {
            "id": DEFAULT_LIST_ID,
            "name": "Shopping",
            "items": [],
            "created_at": _now(),
        }


async def get_lists() -> list[dict]:
    data = await asyncio.to_thread(_load)
    _ensure_default(data)
    return list(data["lists"].values())


async def get_list(list_id: str) -> Optional[dict]:
    data = await asyncio.to_thread(_load)
    _ensure_default(data)
    return data["lists"].get(list_id)


async def create_list(name: str) -> dict:
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        _ensure_default(data)
        if len(data["lists"]) >= _MAX_LISTS:
            raise ValueError("Too many lists.")
        lid = "lst_" + uuid.uuid4().hex[:10]
        rec = {"id": lid, "name": _clean_text(name) or "List", "items": [], "created_at": _now()}
        data["lists"][lid] = rec
        await asyncio.to_thread(_save, data)
        return rec


async def delete_list(list_id: str) -> bool:
    if list_id == DEFAULT_LIST_ID:
        # The default list is furniture — emptying it is fine, deleting it
        # would leave a shopping module pointing at nothing.
        raise ValueError("The default list cannot be deleted.")
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        if list_id not in data["lists"]:
            return False
        del data["lists"][list_id]
        await asyncio.to_thread(_save, data)
        return True


async def add_item(list_id: str, text: str, added_by: str = "") -> Optional[dict]:
    text = _clean_text(text)
    if not text:
        raise ValueError("Item text is required.")
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        _ensure_default(data)
        lst = data["lists"].get(list_id)
        if not lst:
            return None
        if len(lst["items"]) >= _MAX_ITEMS_PER_LIST:
            raise ValueError("This list is full.")
        item = {
            "id": "itm_" + uuid.uuid4().hex[:10],
            "text": text,
            "done": False,
            "added_by": _clean_text(added_by),
            "created_at": _now(),
        }
        lst["items"].append(item)
        await asyncio.to_thread(_save, data)
        return item


async def update_item(list_id: str, item_id: str, patch: dict) -> Optional[dict]:
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        lst = data["lists"].get(list_id)
        if not lst:
            return None
        for item in lst["items"]:
            if item["id"] == item_id:
                if "text" in patch and patch["text"] is not None:
                    cleaned = _clean_text(patch["text"])
                    if cleaned:
                        item["text"] = cleaned
                if "done" in patch and patch["done"] is not None:
                    item["done"] = bool(patch["done"])
                await asyncio.to_thread(_save, data)
                return item
        return None


async def delete_item(list_id: str, item_id: str) -> bool:
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        lst = data["lists"].get(list_id)
        if not lst:
            return False
        before = len(lst["items"])
        lst["items"] = [i for i in lst["items"] if i["id"] != item_id]
        if len(lst["items"]) == before:
            return False
        await asyncio.to_thread(_save, data)
        return True


async def clear_done(list_id: str) -> int:
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        lst = data["lists"].get(list_id)
        if not lst:
            return 0
        before = len(lst["items"])
        lst["items"] = [i for i in lst["items"] if not i.get("done")]
        removed = before - len(lst["items"])
        if removed:
            await asyncio.to_thread(_save, data)
        return removed


# ---------------------------------------------------------------------------
# Agenda
# ---------------------------------------------------------------------------
# Events are keyed by ISO day so "today at home" is a single dict lookup and
# old days can be pruned without walking every record.

def _day_key(when: Optional[str]) -> str:
    """ISO date for an event. Accepts a full ISO timestamp or a bare date."""
    if not when:
        return date.today().isoformat()
    try:
        return datetime.fromisoformat(when.replace("Z", "+00:00")).date().isoformat()
    except Exception:
        try:
            return date.fromisoformat(when[:10]).isoformat()
        except Exception:
            return date.today().isoformat()


def _prune_old(data: dict) -> None:
    """Drop days older than a week. A wall agenda is a today-and-tomorrow
    surface; keeping months of history would grow the file for no benefit."""
    cutoff = (date.today() - timedelta(days=7)).isoformat()
    stale = [k for k in data["events"] if k < cutoff]
    for k in stale:
        del data["events"][k]


async def get_agenda(days: int = 1) -> list[dict]:
    """Events for today through today+days-1, sorted by time."""
    days = max(1, min(14, int(days or 1)))
    data = await asyncio.to_thread(_load)
    out: list[dict] = []
    today = date.today()
    for offset in range(days):
        key = (today + timedelta(days=offset)).isoformat()
        for ev in data["events"].get(key, []):
            out.append({**ev, "day": key, "day_offset": offset})
    out.sort(key=lambda e: (e.get("day", ""), e.get("time") or "99:99"))
    return out


async def create_event(title: str, when: Optional[str] = None, time_str: Optional[str] = None,
                       note: str = "", people: Optional[list] = None,
                       added_by: str = "") -> Optional[dict]:
    title = _clean_text(title)
    if not title:
        raise ValueError("Event title is required.")
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        _prune_old(data)
        key = _day_key(when)
        bucket = data["events"].setdefault(key, [])
        total = sum(len(v) for v in data["events"].values())
        if total >= _MAX_EVENTS:
            raise ValueError("Too many events.")
        ev = {
            "id": "evt_" + uuid.uuid4().hex[:10],
            "title": title,
            "time": _clean_text(time_str) or None,
            "note": _clean_text(note),
            "people": [_clean_text(p) for p in (people or [])][:8],
            "done": False,
            "added_by": _clean_text(added_by),
            "created_at": _now(),
        }
        bucket.append(ev)
        await asyncio.to_thread(_save, data)
        return {**ev, "day": key}


async def update_event(event_id: str, patch: dict) -> Optional[dict]:
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        for key, bucket in data["events"].items():
            for ev in bucket:
                if ev["id"] == event_id:
                    if patch.get("title"):
                        ev["title"] = _clean_text(patch["title"])
                    if "done" in patch and patch["done"] is not None:
                        ev["done"] = bool(patch["done"])
                    if "note" in patch and patch["note"] is not None:
                        ev["note"] = _clean_text(patch["note"])
                    if "time" in patch:
                        ev["time"] = _clean_text(patch.get("time")) or None
                    await asyncio.to_thread(_save, data)
                    return {**ev, "day": key}
        return None


async def delete_event(event_id: str) -> bool:
    async with _LOCK:
        data = await asyncio.to_thread(_load)
        for key, bucket in list(data["events"].items()):
            before = len(bucket)
            data["events"][key] = [e for e in bucket if e["id"] != event_id]
            if len(data["events"][key]) != before:
                await asyncio.to_thread(_save, data)
                return True
        return False
