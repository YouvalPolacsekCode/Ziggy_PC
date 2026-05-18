import logging
import os
from logging.handlers import TimedRotatingFileHandler

LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)

# Rotate daily, keep 7 days of log files
_file_handler = TimedRotatingFileHandler(
    filename=os.path.join(LOG_DIR, "ziggy.log"),
    when="midnight",
    interval=1,
    backupCount=7,
    encoding="utf-8",
)
_file_handler.setLevel(logging.DEBUG)
_file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))

_root = logging.getLogger()
_root.setLevel(logging.DEBUG)
_root.addHandler(_file_handler)


def log_info(message: str) -> None:
    print(message)
    logging.info(message)


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
        scope:      Feature scope (intent, ha, ir, automation, sensor, presence, ws, voice, scheduler).
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
