"""
Persistent queue of unmatched IR signals — the "self-teaching" half of Phase 1.

When the listener captures a code that doesn't match any stored ir_codes entry,
the raw capture is appended here. The Devices UI lists these and lets the user
bind each one to (device, command) with a single click — which then writes the
code into ir_devices.json so the next press matches and triggers state updates.

File-based JSONL queue, capped at MAX_QUEUE_SIZE, deduplicating consecutive
identical signals (so holding down a button doesn't flood the queue).
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Optional

from core.logger_module import log_error

UNASSIGNED_FILE = "user_files/ir_unknown_signals.jsonl"
MAX_QUEUE_SIZE = 100
# Recent same-fingerprint signals collapse into one entry with a bumped count.
DEDUP_WINDOW_SECONDS = 60


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _now_epoch() -> float:
    return datetime.now().timestamp()


def _load_all() -> list[dict]:
    if not os.path.exists(UNASSIGNED_FILE):
        return []
    rows: list[dict] = []
    try:
        with open(UNASSIGNED_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError as e:
        log_error(f"[IRUnassigned] read failed: {e}")
        return []
    return rows


def _save_all(rows: list[dict]) -> None:
    os.makedirs(os.path.dirname(UNASSIGNED_FILE), exist_ok=True)
    tmp = UNASSIGNED_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(tmp, UNASSIGNED_FILE)


def record_signal(
    code_b64: str,
    *,
    blaster_host: str = "",
    fingerprint: Optional[str] = None,
    pulse_count: int = 0,
) -> dict:
    """
    Append a new unknown signal. If the most recent entry has the same
    fingerprint (or same raw code) and was seen recently, bump its count
    and update last_seen_at instead of creating a duplicate.
    """
    rows = _load_all()
    now_iso = _now_iso()
    now_epoch = _now_epoch()

    if rows:
        last = rows[-1]
        last_epoch = 0.0
        try:
            last_epoch = datetime.fromisoformat(last.get("last_seen_at", "")).timestamp()
        except (TypeError, ValueError):
            last_epoch = 0.0

        if now_epoch - last_epoch <= DEDUP_WINDOW_SECONDS:
            same = (
                (fingerprint and last.get("fingerprint") == fingerprint)
                or last.get("code_b64") == code_b64
            )
            if same:
                last["count"] = int(last.get("count", 1)) + 1
                last["last_seen_at"] = now_iso
                if len(rows) > MAX_QUEUE_SIZE:
                    rows = rows[-MAX_QUEUE_SIZE:]
                _save_all(rows)
                return last

    entry: dict = {
        "id": uuid.uuid4().hex[:10],
        "received_at": now_iso,
        "last_seen_at": now_iso,
        "code_b64": code_b64,
        "fingerprint": fingerprint,
        "pulse_count": pulse_count,
        "blaster_host": blaster_host,
        "count": 1,
    }
    rows.append(entry)
    if len(rows) > MAX_QUEUE_SIZE:
        rows = rows[-MAX_QUEUE_SIZE:]
    _save_all(rows)
    return entry


def list_signals() -> list[dict]:
    """Return signals newest-first."""
    return list(reversed(_load_all()))


def get_signal(signal_id: str) -> Optional[dict]:
    for r in _load_all():
        if r.get("id") == signal_id:
            return r
    return None


def take_signal(signal_id: str) -> Optional[dict]:
    """Pop a signal by id. Returns the row, or None if not found."""
    rows = _load_all()
    kept: list[dict] = []
    found: Optional[dict] = None
    for r in rows:
        if r.get("id") == signal_id and found is None:
            found = r
        else:
            kept.append(r)
    if found is not None:
        _save_all(kept)
    return found


def remove_signal(signal_id: str) -> bool:
    return take_signal(signal_id) is not None


def clear_signals() -> int:
    """Remove all queued unknown signals. Returns the number removed."""
    rows = _load_all()
    count = len(rows)
    _save_all([])
    return count
