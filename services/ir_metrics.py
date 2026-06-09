"""
RX reliability instrumentation for IR blasters.

Without metrics, the user has no way to tell whether their Broadlink is
actually catching physical-remote presses — silence could mean "no one
pressed anything" or "the blaster is across the room and missing every
press." This module exposes per-blaster counters and a snapshot endpoint
that surface what's happening.

What's tracked per blaster_host:

  captures_total        — every capture, matched or not
  matched_exact         — Pass 1 hit (byte-identical to learned code)
  matched_fingerprint   — Pass 2 hit (jitter-tolerant)
  matched_protocol      — Pass 3 hit (decoded payload equivalence)
  matched_fuzzy         — Pass 4 hit (per-pulse tolerance)
  matched_ac_state      — Pass 5 hit (stateful AC decode)
  matched_ac_command    — Pass 5.5 hit (AC short-command)
  unmatched             — went to unassigned queue
  last_capture_at       — float epoch of most recent capture
  last_match_at         — float epoch of most recent successful match
  listener_started_at   — when the loop began (for derived "uptime")

Plus a rolling 60-minute counter for "captures in the last hour" — the
single number that tells you if RX is working right now.

Storage: in-memory, with a lightweight JSONL append at coarse granularity
so we survive restarts without expensive writes. Reset endpoint clears
counters for testing and placement-tuning sessions.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

from core.logger_module import log_info, log_error


METRICS_FILE = "user_files/ir_metrics.json"


# Match-method buckets — keep in sync with ir_listener's match labels.
MATCH_BUCKETS = (
    "matched_exact",
    "matched_fingerprint",
    "matched_protocol",
    "matched_fuzzy",
    "matched_ac_state",
    "matched_ac_command",
    "unmatched",
)


# Rolling window for "captures in last hour" — bounded so old data ages out
# without growing the working set unboundedly.
_ROLLING_WINDOW_S = 3600


@dataclass
class HostStats:
    """Per-blaster_host capture counters."""
    captures_total: int = 0
    matched_exact: int = 0
    matched_fingerprint: int = 0
    matched_protocol: int = 0
    matched_fuzzy: int = 0
    matched_ac_state: int = 0
    matched_ac_command: int = 0
    unmatched: int = 0
    last_capture_at: Optional[float] = None
    last_match_at: Optional[float] = None
    listener_started_at: Optional[float] = None
    # Rolling timestamps for the 60-minute "captures in last hour" view.
    # Bounded deque keeps memory cheap even on busy installs.
    recent_captures: deque = field(default_factory=lambda: deque(maxlen=2000))

    def to_dict(self) -> dict:
        return {
            "captures_total":      self.captures_total,
            "matched_exact":       self.matched_exact,
            "matched_fingerprint": self.matched_fingerprint,
            "matched_protocol":    self.matched_protocol,
            "matched_fuzzy":       self.matched_fuzzy,
            "matched_ac_state":    self.matched_ac_state,
            "matched_ac_command":  self.matched_ac_command,
            "unmatched":           self.unmatched,
            "last_capture_at":     self.last_capture_at,
            "last_match_at":       self.last_match_at,
            "listener_started_at": self.listener_started_at,
        }

    @property
    def matched_total(self) -> int:
        return (
            self.matched_exact + self.matched_fingerprint + self.matched_protocol
            + self.matched_fuzzy + self.matched_ac_state + self.matched_ac_command
        )

    def match_rate(self) -> Optional[float]:
        """Fraction of captures that produced a match. None if no captures."""
        if self.captures_total == 0:
            return None
        return self.matched_total / self.captures_total

    def captures_in_last_hour(self, *, now: Optional[float] = None) -> int:
        t = now if now is not None else time.time()
        cutoff = t - _ROLLING_WINDOW_S
        # Lazy purge so we don't carry stale entries forever
        while self.recent_captures and self.recent_captures[0] < cutoff:
            self.recent_captures.popleft()
        return len(self.recent_captures)

    def idle_seconds(self, *, now: Optional[float] = None) -> Optional[float]:
        """Seconds since last capture. None if listener never captured."""
        if self.last_capture_at is None:
            return None
        t = now if now is not None else time.time()
        return max(0.0, t - self.last_capture_at)


# In-memory store keyed by blaster_host. Mutex-protected so listener
# loop + endpoint reads don't race.
_lock = threading.Lock()
_stats: dict[str, HostStats] = {}

# Persistence is best-effort; throttled so we don't write on every capture.
_last_persist_at: float = 0.0
_PERSIST_INTERVAL_S = 30.0


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _persist_locked() -> None:
    """Write a snapshot to disk. Caller must hold _lock."""
    try:
        os.makedirs(os.path.dirname(METRICS_FILE), exist_ok=True)
        snapshot = {host: s.to_dict() for host, s in _stats.items()}
        with open(METRICS_FILE, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, indent=2)
    except Exception as e:
        log_error(f"[IRMetrics] Failed to persist: {e}")


def _maybe_persist_locked() -> None:
    """Persist if enough time has elapsed since the last write."""
    global _last_persist_at
    now = time.time()
    if now - _last_persist_at >= _PERSIST_INTERVAL_S:
        _persist_locked()
        _last_persist_at = now


def load_persisted() -> None:
    """Restore counters from disk on startup. Best-effort.

    Rolling-window data isn't persisted — it's a session-local rolling
    timer. Long-term counters survive restarts.
    """
    if not os.path.exists(METRICS_FILE):
        return
    try:
        with open(METRICS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        with _lock:
            for host, body in data.items():
                s = HostStats()
                for k, v in body.items():
                    if hasattr(s, k):
                        setattr(s, k, v)
                _stats[host] = s
        log_info(f"[IRMetrics] Restored counters for {len(data)} blaster(s)")
    except Exception as e:
        log_error(f"[IRMetrics] Failed to load persisted metrics: {e}")


# ---------------------------------------------------------------------------
# Recording API — called from ir_listener
# ---------------------------------------------------------------------------

def _get(host: str) -> HostStats:
    """Get-or-create the HostStats for a blaster. Caller holds _lock."""
    s = _stats.get(host)
    if s is None:
        s = HostStats()
        _stats[host] = s
    return s


def record_listener_started(host: str) -> None:
    """Called when a listener loop boots."""
    with _lock:
        s = _get(host)
        s.listener_started_at = time.time()
        _maybe_persist_locked()


def record_capture(host: str) -> None:
    """Every received signal increments captures_total (matched or not)."""
    now = time.time()
    with _lock:
        s = _get(host)
        s.captures_total += 1
        s.last_capture_at = now
        s.recent_captures.append(now)
        _maybe_persist_locked()


def record_match(host: str, method: str) -> None:
    """Bump the matched_* bucket and the last_match timestamp.

    `method`: one of MATCH_BUCKETS. Unknown values are silently ignored to
    keep the listener call site forgiving.
    """
    now = time.time()
    bucket = method if method.startswith("matched_") else f"matched_{method}"
    if bucket not in MATCH_BUCKETS:
        return
    with _lock:
        s = _get(host)
        cur = getattr(s, bucket, 0)
        setattr(s, bucket, cur + 1)
        s.last_match_at = now
        _maybe_persist_locked()


def record_unmatched(host: str) -> None:
    """No pass produced a match — counter for placement diagnostics."""
    with _lock:
        s = _get(host)
        s.unmatched += 1
        _maybe_persist_locked()


# ---------------------------------------------------------------------------
# Read API — called from the diagnostics endpoint
# ---------------------------------------------------------------------------

def snapshot(host: Optional[str] = None) -> dict:
    """Return a JSON-friendly snapshot for one host or all hosts.

    For each host returns counters + derived fields:
      - match_rate          : matched_total / captures_total
      - captures_in_hour    : rolling 60-minute capture count
      - idle_seconds        : seconds since last capture (None if never)
      - listener_uptime_s   : seconds since listener_started_at (None if never)
      - placement_hint      : "good" | "marginal" | "poor" | "unknown" — a
                              one-word verdict derived from match_rate and
                              activity volume

    Placement hint thresholds (tunable):
      good     : match_rate >= 0.7 AND captures_in_hour >= 1
                 (most captures are recognized; activity exists)
      marginal : 0.4 <= match_rate < 0.7 OR captures_in_hour == 0 AND uptime>1h
      poor     : match_rate < 0.4 (lots of garbled or unknown signals)
      unknown  : no captures yet
    """
    now = time.time()
    with _lock:
        if host is not None:
            s = _stats.get(host)
            if s is None:
                return {"host": host, "snapshot": _empty_snapshot(host, now)}
            return {"host": host, "snapshot": _build_snapshot(host, s, now)}
        return {
            "hosts": {h: _build_snapshot(h, s, now) for h, s in _stats.items()}
        }


def _empty_snapshot(host: str, now: float) -> dict:
    return {
        "host": host,
        "captures_total": 0,
        "matched_total": 0,
        "match_rate": None,
        "captures_in_hour": 0,
        "idle_seconds": None,
        "listener_uptime_s": None,
        "last_capture_at": None,
        "last_match_at": None,
        "placement_hint": "unknown",
        "breakdown": {b: 0 for b in MATCH_BUCKETS},
    }


def _build_snapshot(host: str, s: HostStats, now: float) -> dict:
    rate = s.match_rate()
    hour = s.captures_in_last_hour(now=now)
    idle = s.idle_seconds(now=now)
    uptime = None
    if s.listener_started_at is not None:
        uptime = max(0.0, now - s.listener_started_at)

    # Placement verdict
    if s.captures_total == 0:
        if uptime is not None and uptime > 3600:
            hint = "marginal"   # listener up >1h with no captures = likely misaimed
        else:
            hint = "unknown"
    elif rate is not None and rate >= 0.7:
        hint = "good"
    elif rate is not None and rate >= 0.4:
        hint = "marginal"
    else:
        hint = "poor"

    return {
        "host":                host,
        "captures_total":      s.captures_total,
        "matched_total":       s.matched_total,
        "match_rate":          rate,
        "captures_in_hour":    hour,
        "idle_seconds":        idle,
        "listener_uptime_s":   uptime,
        "last_capture_at":     s.last_capture_at,
        "last_match_at":       s.last_match_at,
        "placement_hint":      hint,
        "breakdown": {
            b: getattr(s, b) for b in MATCH_BUCKETS
        },
    }


# ---------------------------------------------------------------------------
# Reset — for placement-tuning sessions or after RX-side changes
# ---------------------------------------------------------------------------

def reset(host: Optional[str] = None) -> int:
    """Zero counters. Returns number of hosts reset."""
    with _lock:
        if host is not None:
            if host in _stats:
                _stats[host] = HostStats(listener_started_at=time.time())
                _persist_locked()
                return 1
            return 0
        n = len(_stats)
        for h in list(_stats.keys()):
            _stats[h] = HostStats(listener_started_at=time.time())
        _persist_locked()
        return n
