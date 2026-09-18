"""Nightly relay DB backup, scheduled inside the relay's own lifespan.

`relay/app/db_backup.py` has done the whole job (snapshot → AES-GCM →
Backblaze B2 → weekly promotion) since it was written, behind a
`python -m relay.app.db_backup --once` CLI that nothing ever called. A backup
that exists only as documentation is not a backup. This module calls the same
public function, `run_relay_db_backup`, once a night at 03:00 Asia/Jerusalem
(the fleet is quietest then, and the hour is the one Youval reads in logs).

Configuration is the backup module's: RELAY_BACKUP_KEY plus RELAY_B2_KEY_ID /
RELAY_B2_APP_KEY. When any of them is unset the loop logs one line and exits
— a dev relay or a fresh Fly app must not spend its nights failing loudly.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import os
from typing import Callable, Mapping, Optional
from zoneinfo import ZoneInfo

from .db_backup import run_relay_db_backup

log = logging.getLogger("relay.backup_schedule")

BACKUP_HOUR = 3
BACKUP_MINUTE = 0
BACKUP_TZ = "Asia/Jerusalem"

REQUIRED_ENV = ("RELAY_BACKUP_KEY", "RELAY_B2_KEY_ID", "RELAY_B2_APP_KEY")


def backup_configured(env: Optional[Mapping[str, str]] = None) -> bool:
    """True when every secret the backup needs is present and non-blank."""
    env = os.environ if env is None else env
    return all((env.get(k) or "").strip() for k in REQUIRED_ENV)


def missing_env(env: Optional[Mapping[str, str]] = None) -> list[str]:
    env = os.environ if env is None else env
    return [k for k in REQUIRED_ENV if not (env.get(k) or "").strip()]


def _tz() -> dt.tzinfo:
    try:
        return ZoneInfo(BACKUP_TZ)
    except Exception:
        # No tzdata on this host: fall back to Israel Standard Time. Off by an
        # hour half the year, which for a nightly backup is not a problem.
        return dt.timezone(dt.timedelta(hours=2), name="IST")


def seconds_until_next_run(now: Optional[dt.datetime] = None, *,
                           hour: int = BACKUP_HOUR, minute: int = BACKUP_MINUTE,
                           tz: Optional[dt.tzinfo] = None) -> float:
    """Pure: seconds from `now` (aware) until the next hour:minute in `tz`."""
    tz = tz or _tz()
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=dt.timezone.utc)
    local = now.astimezone(tz)
    target = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= local:
        target = target + dt.timedelta(days=1)
    return max(0.0, (target - local).total_seconds())


async def run_backup_once(*, runner: Callable[..., dict] = run_relay_db_backup) -> dict:
    """One backup on a worker thread (snapshot + upload are blocking I/O)."""
    try:
        result = await asyncio.to_thread(runner)
    except Exception as e:   # runner is documented not to raise; belt and braces
        result = {"ok": False, "stage": "crashed", "error": f"{type(e).__name__}: {e}"}
    if result.get("ok"):
        log.info("nightly relay DB backup ok: %s (%s bytes)",
                 result.get("daily_key"), result.get("encrypted_bytes"))
    else:
        log.error("nightly relay DB backup FAILED at stage=%s: %s",
                  result.get("stage"), result.get("error"))
    try:
        from .audit import log_event
        await log_event("relay_db_backup", ok=bool(result.get("ok")),
                        detail=(result.get("daily_key") if result.get("ok")
                                else f"stage={result.get('stage')} {result.get('error')}"))
    except Exception:
        pass
    return result


async def run_nightly_backup_loop(*, env: Optional[Mapping[str, str]] = None,
                                  runner: Callable[..., dict] = run_relay_db_backup,
                                  sleep=asyncio.sleep,
                                  max_runs: Optional[int] = None) -> int:
    """Sleep until 03:00 Asia/Jerusalem, back up, repeat. Returns runs done.

    Skips (returns 0) with one log line when the backup secrets are unset.
    `sleep` and `max_runs` are test seams.
    """
    if not backup_configured(env):
        log.info("nightly relay DB backup not scheduled — unset: %s",
                 ", ".join(missing_env(env)))
        return 0
    runs = 0
    while max_runs is None or runs < max_runs:
        delay = seconds_until_next_run()
        log.info("next relay DB backup in %.0f s", delay)
        await sleep(delay)
        await run_backup_once(runner=runner)
        runs += 1
        # Guard against a clock that makes "next run" land in the same
        # minute (DST edge, coarse sleep) and would otherwise run twice.
        await sleep(61)
    return runs
