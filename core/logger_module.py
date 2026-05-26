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
