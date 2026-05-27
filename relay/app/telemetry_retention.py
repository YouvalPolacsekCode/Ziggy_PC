"""Telemetry retention + aggregation (Prompt 2 §C).

Two-tier retention:

    telemetry_raw    kept 30 days
    telemetry_daily  kept 365 days, one row per (home_id, day)

One pass = one call to run_retention_pass(). It:

  1. Computes the day-of-cutoff (now - 30 days, UTC).
  2. For every distinct (home_id, day) older than today's UTC date,
     aggregates any telemetry_raw rows in that window into a single
     telemetry_daily row (upsert).
  3. Deletes telemetry_raw rows older than the 30-day cutoff.
  4. Deletes telemetry_daily rows older than 365 days.

The relay background loop (started in lifespan) runs run_retention_loop()
which sleeps 24 hours between passes. Tests call run_retention_pass()
directly with a frozen `now` and an arbitrary db connection.

Aggregations:

  ha_version       most recent value in the window (LAST function via
                   max(ts) join)
  ziggy_version    same shape
  uptime_avg_s     average of payload.uptime_s where present
  sensor_count_avg average length of payload.sensors when present
  disk_pct_avg     average of payload.disk_pct (or computed used/total)
  cpu_pct_avg      average of payload.cpu_pct
  mem_pct_avg      average of payload.mem_pct
  sample_count     count of raw rows in the window
  last_seen_ts     max(ts) in the window — non-NULL only when sample_count > 0

Missing fields in a payload are treated as None (skipped from the
average). A row with no relevant fields still bumps sample_count.
"""

from __future__ import annotations

import asyncio
import json as _json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from .database import get_db

log = logging.getLogger(__name__)

RAW_RETENTION_DAYS = 30
DAILY_RETENTION_DAYS = 365
RETENTION_INTERVAL_S = 24 * 60 * 60  # one pass per day


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _day_of(ts_iso: str) -> Optional[str]:
    """Extract YYYY-MM-DD UTC from an ISO timestamp. None if unparseable."""
    try:
        # fromisoformat handles offset suffixes in 3.11+; strip Z for older.
        s = ts_iso.replace("Z", "+00:00") if ts_iso.endswith("Z") else ts_iso
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).date().isoformat()
    except (ValueError, TypeError):
        return None


def _float_or_none(value) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def _coerce_disk_pct(disk_field) -> Optional[float]:
    """Accept either {used_gb, total_gb} or a flat float percentage."""
    if isinstance(disk_field, dict):
        used = _float_or_none(disk_field.get("used_gb"))
        total = _float_or_none(disk_field.get("total_gb"))
        if used is not None and total and total > 0:
            return 100.0 * (used / total)
        return _float_or_none(disk_field.get("used_pct"))
    return _float_or_none(disk_field)


async def _aggregate_day(db, home_id: str, day: str) -> None:
    """Compute and upsert one (home_id, day) row from raw rows that fall in it.

    Day boundary: ts where date-of-ts equals `day` (UTC). Pulled by string
    prefix match — telemetry_raw.ts is the raw ISO string the edge sent, so
    matching its first 10 chars to the day works because we always store
    UTC ISO from the edge poster.
    """
    rows = await db.execute_fetchall(
        "SELECT ts, payload FROM telemetry_raw "
        "WHERE home_id=? AND substr(ts,1,10)=? ORDER BY ts ASC",
        (home_id, day),
    )
    if not rows:
        return

    ha_version: Optional[str] = None
    ziggy_version: Optional[str] = None
    uptime_sum: float = 0.0
    uptime_n: int = 0
    sensor_count_sum: int = 0
    sensor_count_n: int = 0
    disk_sum: float = 0.0
    disk_n: int = 0
    cpu_sum: float = 0.0
    cpu_n: int = 0
    mem_sum: float = 0.0
    mem_n: int = 0
    last_seen_ts: Optional[str] = None

    for r in rows:
        try:
            payload = _json.loads(r["payload"]) if r["payload"] else {}
            if not isinstance(payload, dict):
                payload = {}
        except _json.JSONDecodeError:
            payload = {}
        last_seen_ts = r["ts"]  # rows are ASC, so this ends up at the latest

        # Versions: take the latest non-empty value seen.
        if isinstance(payload.get("ha_version"), str) and payload["ha_version"]:
            ha_version = payload["ha_version"]
        if isinstance(payload.get("ziggy_version"), str) and payload["ziggy_version"]:
            ziggy_version = payload["ziggy_version"]

        u = _float_or_none(payload.get("uptime_s"))
        if u is not None:
            uptime_sum += u
            uptime_n += 1

        sensors = payload.get("sensors")
        if isinstance(sensors, list):
            sensor_count_sum += len(sensors)
            sensor_count_n += 1

        d = _coerce_disk_pct(payload.get("disk"))
        if d is not None:
            disk_sum += d
            disk_n += 1

        c = _float_or_none(payload.get("cpu_pct"))
        if c is not None:
            cpu_sum += c
            cpu_n += 1

        m = _float_or_none(payload.get("mem_pct"))
        if m is not None:
            mem_sum += m
            mem_n += 1

    def _avg(s: float, n: int) -> Optional[float]:
        return (s / n) if n else None

    uptime_avg = int(uptime_sum / uptime_n) if uptime_n else None
    sensor_count_avg = int(round(sensor_count_sum / sensor_count_n)) if sensor_count_n else None
    disk_avg = _avg(disk_sum, disk_n)
    cpu_avg  = _avg(cpu_sum, cpu_n)
    mem_avg  = _avg(mem_sum, mem_n)

    await db.execute(
        """INSERT OR REPLACE INTO telemetry_daily
           (home_id, day, ha_version, ziggy_version, uptime_avg_s,
            sensor_count_avg, disk_pct_avg, cpu_pct_avg, mem_pct_avg,
            sample_count, last_seen_ts)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
        (home_id, day, ha_version, ziggy_version, uptime_avg,
         sensor_count_avg, disk_avg, cpu_avg, mem_avg,
         len(rows), last_seen_ts),
    )


async def run_retention_pass(*, now: Optional[datetime] = None) -> dict:
    """Execute one aggregation + pruning cycle. Returns a small result dict."""
    if now is None:
        now = _utc_now()
    today_iso = now.astimezone(timezone.utc).date().isoformat()
    raw_cutoff_iso = (now - timedelta(days=RAW_RETENTION_DAYS)).isoformat()
    daily_cutoff = (now - timedelta(days=DAILY_RETENTION_DAYS)).date().isoformat()

    aggregated_days = 0
    deleted_raw = 0
    deleted_daily = 0

    async with get_db() as db:
        # Aggregate every (home_id, day) seen in raw that's strictly older than today.
        # Today's data is left raw so partial-day aggregates aren't published.
        pairs = await db.execute_fetchall(
            "SELECT DISTINCT home_id, substr(ts,1,10) AS day FROM telemetry_raw "
            "WHERE substr(ts,1,10) < ?",
            (today_iso,),
        )
        for row in pairs:
            await _aggregate_day(db, row["home_id"], row["day"])
            aggregated_days += 1

        # Prune raw older than cutoff. Two separate executes so cursor.rowcount
        # is meaningful per delete.
        cur = await db.execute(
            "DELETE FROM telemetry_raw WHERE ts < ?", (raw_cutoff_iso,)
        )
        deleted_raw = cur.rowcount or 0

        cur = await db.execute(
            "DELETE FROM telemetry_daily WHERE day < ?", (daily_cutoff,)
        )
        deleted_daily = cur.rowcount or 0

        await db.commit()

    log.info("telemetry retention pass: aggregated=%d days, pruned raw=%d daily=%d",
             aggregated_days, deleted_raw, deleted_daily)
    return {
        "aggregated_days": aggregated_days,
        "deleted_raw":     deleted_raw,
        "deleted_daily":   deleted_daily,
        "ran_at":          now.isoformat(),
    }


async def run_retention_loop() -> None:
    """Background task started by relay's lifespan. Sleeps a day between passes.

    On the first tick after process start we run immediately so a relay
    restart doesn't delay retention by a full day.
    """
    while True:
        try:
            await run_retention_pass()
        except Exception as e:
            log.error("telemetry retention pass failed: %s", e, exc_info=True)
        await asyncio.sleep(RETENTION_INTERVAL_S)
