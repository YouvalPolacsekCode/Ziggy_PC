"""
Ziggy logging + debug-bus front door.

The log file (logs/ziggy.log) and the in-memory debug bus run off the same
level, sourced from settings.yaml › debug.level (off | basic | verbose | trace).
Changing the level at runtime through /api/debug/config also re-tunes the file
handler, so a session at "trace" actually writes trace-level lines to disk —
not just to the live console.

Mapping
  off      → logging WARNING  (file stays quiet; only warn/error land)
  basic    → logging INFO     (default operational signal)
  verbose  → logging DEBUG    (params, payloads, timing)
  trace    → logging DEBUG    (same handler level; bus carries the extra detail)
"""
from __future__ import annotations

import atexit
import logging
import os
import queue
import re
import threading
import time
from collections import deque
from logging.handlers import QueueHandler, QueueListener, TimedRotatingFileHandler

LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)


# ─── File handler — rotates daily, keeps 7 days ──────────────────────────────

_file_handler = TimedRotatingFileHandler(
    filename=os.path.join(LOG_DIR, "ziggy.log"),
    when="midnight",
    interval=1,
    backupCount=7,
    encoding="utf-8",
)
_file_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
)

# Async logging: the file write happens on a background thread, so callers
# only pay the cost of a queue.put_nowait (a few microseconds) instead of
# blocking on disk fsync. A busy request emits ~20 log lines — that used to
# add ~20 ms of synchronous file I/O to every request.
_log_queue: "queue.Queue[logging.LogRecord]" = queue.Queue(-1)
_queue_handler = QueueHandler(_log_queue)
_queue_listener = QueueListener(_log_queue, _file_handler, respect_handler_level=True)
_queue_listener.start()
atexit.register(_queue_listener.stop)

_root = logging.getLogger()
_root.addHandler(_queue_handler)


# ─── Error ring — what the hub tells the fleet about its own errors ──────────
#
# services/usage_counters.py reads this every 5 minutes and ships ONLY a count
# and the top exception class names inside the telemetry post. Nothing else is
# retained here: no message text, no request bodies, no paths — an exception's
# class name is the whole record. That is deliberate; the ring exists so the
# relay can notice an error burst, not so anyone can read a customer's logs.

_ERROR_RING_MAXLEN = 512
_UNHANDLED_RE = re.compile(r"^\[Unhandled\] ([A-Za-z_][A-Za-z0-9_.]*):")


class ErrorRingHandler(logging.Handler):
    """Keeps (monotonic_ts, exception_class_name | None) for ERROR+ records."""

    def __init__(self, maxlen: int = _ERROR_RING_MAXLEN) -> None:
        super().__init__(level=logging.ERROR)
        self._ring: "deque[tuple[float, str | None]]" = deque(maxlen=maxlen)
        self._lock = threading.Lock()

    @staticmethod
    def _exc_type(record: logging.LogRecord) -> str | None:
        exc_info = getattr(record, "exc_info", None)
        if exc_info and exc_info[0] is not None:
            return getattr(exc_info[0], "__name__", None)
        try:
            m = _UNHANDLED_RE.match(record.getMessage())
        except Exception:
            return None
        return m.group(1) if m else None

    def emit(self, record: logging.LogRecord) -> None:
        try:
            entry = (time.monotonic(), self._exc_type(record))
            with self._lock:
                self._ring.append(entry)
        except Exception:
            # A logging handler must never take the process down.
            pass

    def since(self, t0: float) -> list[str | None]:
        """Exception class names (or None) of every record at/after monotonic t0."""
        with self._lock:
            return [name for ts, name in self._ring if ts >= t0]

    def clear(self) -> None:
        with self._lock:
            self._ring.clear()


error_ring = ErrorRingHandler()
_root.addHandler(error_ring)


# ─── Bus ↔ stdlib logging bridge ─────────────────────────────────────────────

_BUS_TO_PY = {
    "off":     logging.WARNING,
    "basic":   logging.INFO,
    "verbose": logging.DEBUG,
    "trace":   logging.DEBUG,
}


def apply_log_level(bus_level: str) -> None:
    """Re-tune the file handler and root logger to a bus level name.

    Called once at startup from settings.yaml, and again whenever the user
    changes the level via /api/debug/config. Without this the log file would
    only ever reflect whatever level we hard-coded at import time, which
    silently divorced what the user picked in the Debug page from what
    actually landed on disk.
    """
    py_level = _BUS_TO_PY.get((bus_level or "off").lower(), logging.WARNING)
    _root.setLevel(py_level)
    _file_handler.setLevel(py_level)


# Boot at WARNING so we don't write any startup chatter before settings load.
# server.py calls apply_log_level() during the startup hook once settings.yaml
# is parsed. Tests import this module without a server hook — they keep the
# quiet default, which keeps test output clean.
apply_log_level("off")


# ─── Public helpers ──────────────────────────────────────────────────────────

def log_info(message: str) -> None:
    print(message)
    logging.info(message)


def log_warn(message: str) -> None:
    print(f"WARN: {message}")
    logging.warning(message)


def log_error(message: str) -> None:
    print(f"ERROR: {message}")
    logging.error(message)


def log_debug(
    message: str,
    *,
    scope: str = "",
    request_id: str | None = None,
    level: int | None = None,
    **extra,
) -> None:
    """
    Emit a structured debug event to the debug bus and write to the log file.

    Args:
        message:    Human-readable description.
        scope:      Feature scope (intent, ha, ir, automation, sensor, presence,
                    ws, voice, scheduler, api, device, frontend, general).
        request_id: Correlation ID for this request chain.
        level:      Override the bus level (BASIC/VERBOSE/TRACE). Defaults to VERBOSE.
        **extra:    Additional structured fields included in the debug event data.
    """
    from core.debug_bus import bus, VERBOSE

    emit_level = level if level is not None else VERBOSE
    logging.debug(f"[{scope}] {message}" if scope else message)

    bus.emit(
        scope or "general",
        emit_level,
        message,
        request_id=request_id,
        **extra,
    )
