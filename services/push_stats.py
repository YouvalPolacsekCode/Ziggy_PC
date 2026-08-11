"""Did our push notifications actually arrive?

The ops console has always had a row for APNs/FCM delivery, permanently reading
"No data yet — waiting for edge agent v1.5+": the counters were designed in the
dashboard and never built on the hub. So the one question that matters about
push — is it working? — had no answer anywhere, on any home.

It matters more than it sounds. Push is how a hub tells someone their door
opened, their task is due, or their home has a problem. A silently broken
delivery path looks identical to a quiet house.

Design
------
* **Counts, not payloads.** Titles and bodies describe someone's private home;
  none of that leaves the hub. We store a timestamp, the provider, and whether
  it worked.
* **Persisted, not in-memory.** Hubs restart on every update, and an in-memory
  window would read near-zero forever on a healthy fleet — which is exactly the
  "no data" state this replaces.
* **Bounded.** Events older than the window are dropped on write, so the file
  cannot grow without a cleanup job that someone forgets to run.
* **Never raises.** A stats failure must never take down a notification.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

WINDOW_S = 24 * 3600

# Hard ceiling on retained rows. A home spraying notifications should cost a
# bounded amount of disk, not an unbounded one.
MAX_EVENTS = 2000

_lock = threading.Lock()


def _path() -> Path:
    env = os.getenv("ZIGGY_USER_FILES_DIR", "").strip()
    base = Path(env) if env else Path(__file__).resolve().parent.parent / "user_files"
    return base / "push_stats.json"


def _load() -> list[dict]:
    try:
        p = _path()
        if not p.exists():
            return []
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        # A corrupt stats file is not worth failing a notification over, and
        # starting a fresh window is the correct recovery.
        return []


def _save(events: list[dict]) -> None:
    try:
        p = _path()
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(events, separators=(",", ":")), encoding="utf-8")
        tmp.replace(p)
    except Exception:
        pass


def record(provider: str, ok: bool, *, now: float | None = None) -> None:
    """Record one delivery attempt. Best-effort; never raises."""
    try:
        now = time.time() if now is None else now
        provider = (provider or "unknown").strip().lower()
        with _lock:
            events = [e for e in _load() if (now - float(e.get("t", 0))) < WINDOW_S]
            events.append({"t": round(now, 1), "p": provider, "ok": bool(ok)})
            if len(events) > MAX_EVENTS:
                events = events[-MAX_EVENTS:]
            _save(events)
    except Exception:
        pass


def summary(*, now: float | None = None) -> dict[str, Any]:
    """Counts for the last 24 h, in the shape the ops console reads.

    Returns zeros rather than nothing once a hub is capable of reporting: "0
    sent, 0 failed" is a real answer ("nothing needed sending"), and it is
    different from "this hub cannot tell you", which is the absence of the whole
    block.
    """
    now = time.time() if now is None else now
    out = {
        "apns_success_24h": 0, "apns_failure_24h": 0,
        "fcm_success_24h": 0, "fcm_failure_24h": 0,
        "web_success_24h": 0, "web_failure_24h": 0,
    }
    try:
        for e in _load():
            if (now - float(e.get("t", 0))) >= WINDOW_S:
                continue
            provider = e.get("p")
            if provider not in ("apns", "fcm", "web"):
                continue
            key = f"{provider}_{'success' if e.get('ok') else 'failure'}_24h"
            out[key] = out.get(key, 0) + 1
    except Exception:
        pass
    return out
