"""Durable presence journal — the record that survives a container rebuild.

Why this exists: on 2026-08-14 a presence incident took hours to diagnose and
produced four wrong conclusions, because there was almost nothing to read.

  * `persons.json` keeps a rolling **20** history rows per person, and the
    once-a-minute LAN probe writes a row every time — so the window is ~20
    minutes and every real transition is evicted long before anyone looks.
  * `/app/logs/ziggy.log` lives INSIDE the container. Only `config/` and
    `user_files/` are bind-mounted, so a rebuild (an OTA deploy) destroys it.
  * `docker logs` is batch-flushed, so its timestamps are the flush time, not
    the event time — they are actively misleading for ordering.

So: an append-only JSONL under `user_files/`, which is bind-mounted, gitignored
and survives deploys. One line per event that MATTERS — transitions, holds,
probe requests, probe outcomes — never the per-minute "nothing changed" rows
that flooded the rolling history in the first place.

Read it with:
    docker exec ziggy-ziggy-1 python -m services.presence_journal --tail 50
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from core.logger_module import log_error

_PATH = Path(__file__).resolve().parent.parent / "user_files" / "presence_events.jsonl"
_lock = threading.Lock()

# Trim when the file exceeds MAX, keeping the newest KEEP. Sized so a busy home
# retains roughly a fortnight of real events — long enough that "it worked fine
# last week, something changed" is an answerable question rather than a guess.
_MAX_LINES = 20_000
_KEEP_LINES = 15_000


def record(kind: str, **fields: Any) -> None:
    """Append one event. Never raises — journalling must not break presence."""
    try:
        row = {"ts": datetime.now(timezone.utc).isoformat(), "kind": kind}
        for k, v in fields.items():
            if v is not None:
                row[k] = v
        line = json.dumps(row, ensure_ascii=False, default=str)
        with _lock:
            _PATH.parent.mkdir(parents=True, exist_ok=True)
            with _PATH.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
            _maybe_trim()
    except Exception as exc:                      # pragma: no cover - defensive
        try:
            log_error(f"[PresenceJournal] write failed: {exc}")
        except Exception:
            pass


def _maybe_trim() -> None:
    """Keep the newest _KEEP_LINES once the file passes _MAX_LINES.

    Cheap check: only counts lines when the file is big enough to plausibly
    need it, so the common path is a bare stat().
    """
    try:
        if not _PATH.exists() or _PATH.stat().st_size < 2_000_000:
            return
        lines = _PATH.read_text(encoding="utf-8").splitlines()
        if len(lines) <= _MAX_LINES:
            return
        tmp = _PATH.with_suffix(".jsonl.tmp")
        tmp.write_text("\n".join(lines[-_KEEP_LINES:]) + "\n", encoding="utf-8")
        os.replace(tmp, _PATH)
    except Exception:                             # pragma: no cover - defensive
        pass


def read(limit: int = 100, kind: Optional[str] = None) -> list[dict]:
    """Newest-last list of journal rows, optionally filtered by kind."""
    try:
        if not _PATH.exists():
            return []
        rows = []
        for line in _PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except Exception:
                continue
            if kind and row.get("kind") != kind:
                continue
            rows.append(row)
        return rows[-limit:]
    except Exception:
        return []


def path() -> Path:
    return _PATH


if __name__ == "__main__":                        # pragma: no cover - operator tool
    import argparse

    ap = argparse.ArgumentParser(description="Read Ziggy's durable presence journal")
    ap.add_argument("--tail", type=int, default=50)
    ap.add_argument("--kind", default=None)
    args = ap.parse_args()
    for r in read(limit=args.tail, kind=args.kind):
        ts = str(r.pop("ts", ""))[:19]
        kind = r.pop("kind", "")
        print(f"{ts}  {kind:<22} " + "  ".join(f"{k}={v}" for k, v in r.items()))
