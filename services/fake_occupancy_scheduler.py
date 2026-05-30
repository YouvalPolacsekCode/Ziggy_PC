"""
Fake-occupancy scheduler — Ziggy-side multi-day "Away — Simulate Presence" runner.

Drives the manual-only Fake Occupancy automation. A single activation persists
across restarts and ticks once per minute from `ziggy_scheduler.py`. Each day
during the active window the scheduler generates a randomized plan (2–3 rooms,
45–90 min light-on periods, 20–40 min gaps, ±15 min start-time jitter, optional
TV blast for 60–120 min) and executes lights via `home_automation.call_service`
and TV via `ir_manager.send_ir_command`. After `duration_days` days the
activation auto-removes itself.

State file:
    user_files/fake_occupancy_activations.json
Schema:
    {
      "activations": {
        "<automation_id>": {
          "automation_id": str,
          "label": str,
          "started_at": ISO-8601,
          "window_start": "HH:MM",
          "window_end":   "HH:MM",
          "duration_days": int,
          "days_completed": int,
          "last_window_end_date": "YYYY-MM-DD" | null,
          "room_pool": [{"id": str, "entity_id": str}],   # dimmable lights, one per included room
          "tv_ir_device_id": str | null,
          "brightness_pct": int,
          "daily_plan": {
            "date": "YYYY-MM-DD",
            "jobs": [{"at_ts": float, "kind": "light_on"|"light_off"|"tv_on"|"tv_off",
                      "entity_id": str | null, "ir_device_id": str | null, "room_id": str | null,
                      "brightness_pct": int | null}],
            "executed": [int]    # indices into jobs that already ran
          } | null
        }
      }
    }

There is no general-purpose multi-day task scheduler in Ziggy yet, so this
service is intentionally narrow: it only handles Fake Occupancy. If a second
multi-day feature shows up, generalize then — not before.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import random
import time
from datetime import datetime
from typing import Optional

from core.logger_module import log_error, log_info
from core.debug_bus import bus as _bus, BASIC, VERBOSE

STATE_FILE = "user_files/fake_occupancy_activations.json"

_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _load() -> dict:
    if not os.path.exists(STATE_FILE):
        return {"activations": {}}
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
        if "activations" not in data or not isinstance(data["activations"], dict):
            data["activations"] = {}
        return data
    except Exception as e:
        log_error(f"[FakeOccupancy] Failed to load state: {e}")
        return {"activations": {}}


def _save(data: dict) -> None:
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_active() -> list[dict]:
    """Return all currently registered activations (frontend / debug)."""
    return list(_load()["activations"].values())


def get_activation(automation_id: str) -> Optional[dict]:
    return _load()["activations"].get(automation_id)


def start(
    automation_id: str,
    label: str,
    window_start: str,
    window_end: str,
    duration_days: int,
    room_pool: list[dict],
    tv_ir_device_id: Optional[str] = None,
    brightness_pct: int = 70,
) -> dict:
    """Register (or refresh) a Fake Occupancy activation.

    Calling start again for the same automation_id resets days_completed and
    discards any unfinished daily plan — re-running from the app means "start
    over for N more days," which matches user expectation.
    """
    if not room_pool:
        return {"ok": False, "message": "Fake Occupancy needs at least one room with a dimmable light."}
    if duration_days < 1:
        return {"ok": False, "message": "Duration must be at least 1 day."}

    data = _load()
    data["activations"][automation_id] = {
        "automation_id": automation_id,
        "label": label or automation_id,
        "started_at": datetime.now().isoformat(timespec="seconds"),
        "window_start": _norm_hm(window_start, "19:00"),
        "window_end":   _norm_hm(window_end,   "23:00"),
        "duration_days": int(duration_days),
        "days_completed": 0,
        "last_window_end_date": None,
        "room_pool": [
            {"id": r.get("id") or r.get("room") or "", "entity_id": r.get("entity_id") or ""}
            for r in room_pool if r.get("entity_id")
        ],
        "tv_ir_device_id": tv_ir_device_id or None,
        "brightness_pct": int(max(10, min(100, brightness_pct))),
        "daily_plan": None,
    }
    _save(data)
    _bus.emit("automation", BASIC, "fake_occupancy_started",
              automation_id=automation_id, label=label,
              window_start=window_start, window_end=window_end,
              duration_days=duration_days,
              room_count=len(data["activations"][automation_id]["room_pool"]),
              tv_blast=bool(tv_ir_device_id))
    log_info(
        f"[FakeOccupancy] started '{label}' for {duration_days} day(s), "
        f"window {window_start}–{window_end}, rooms={len(room_pool)}, "
        f"tv={'yes' if tv_ir_device_id else 'no'}"
    )
    return {"ok": True, "message": f"Simulating presence for {duration_days} day(s)."}


def stop(automation_id: str) -> bool:
    """Remove an activation. Called when the user toggles the automation off
    or deletes it. Safe no-op if the automation_id wasn't running."""
    data = _load()
    if automation_id in data["activations"]:
        data["activations"].pop(automation_id, None)
        _save(data)
        _bus.emit("automation", BASIC, "fake_occupancy_stopped",
                  automation_id=automation_id)
        log_info(f"[FakeOccupancy] stopped {automation_id}")
        return True
    return False


# ---------------------------------------------------------------------------
# Tick — called once per minute by ziggy_scheduler.run_scheduler()
# ---------------------------------------------------------------------------

async def tick(now: datetime) -> None:
    """Process all active activations: generate today's plan if needed,
    execute any jobs whose at_ts <= now, and advance day counter at window end.

    Safe to call when no activations exist (early return). Errors per-activation
    are logged but never raised — the parent scheduler must keep ticking.
    """
    async with _lock:
        data = _load()
        if not data["activations"]:
            return

        changed = False
        for auto_id, act in list(data["activations"].items()):
            try:
                changed |= await _process_activation(act, now)
            except Exception as exc:
                log_error(f"[FakeOccupancy] activation {auto_id} tick error: {exc}")

        # Drop activations that exhausted their day count.
        for auto_id in list(data["activations"].keys()):
            act = data["activations"][auto_id]
            if act.get("days_completed", 0) >= act.get("duration_days", 0):
                log_info(f"[FakeOccupancy] activation {auto_id} completed — removing")
                _bus.emit("automation", BASIC, "fake_occupancy_completed",
                          automation_id=auto_id, label=act.get("label"))
                data["activations"].pop(auto_id, None)
                changed = True

        if changed:
            _save(data)


async def _process_activation(act: dict, now: datetime) -> bool:
    """Returns True if the activation dict was mutated (caller must save)."""
    changed = False
    today_str = now.date().isoformat()
    now_hm = f"{now.hour:02d}:{now.minute:02d}"
    win_start = act["window_start"]
    win_end   = act["window_end"]

    # ── 1. Generate today's plan if we don't have one yet for today ──────────
    plan = act.get("daily_plan")
    if (plan is None or plan.get("date") != today_str) and _within_window(now_hm, win_start, win_end):
        act["daily_plan"] = _build_daily_plan(act, now)
        plan = act["daily_plan"]
        changed = True
        _bus.emit("automation", VERBOSE, "fake_occupancy_plan_built",
                  automation_id=act["automation_id"],
                  date=today_str, job_count=len(plan["jobs"]))

    # ── 2. Execute any jobs that are due ────────────────────────────────────
    if plan and plan.get("date") == today_str:
        now_ts = now.timestamp()
        executed = set(plan.get("executed", []))
        for i, job in enumerate(plan["jobs"]):
            if i in executed:
                continue
            if job["at_ts"] > now_ts:
                continue
            await _execute_job(act, job)
            executed.add(i)
            changed = True
        plan["executed"] = sorted(executed)

    # ── 3. End-of-window: bump day counter exactly once per day ─────────────
    if now_hm >= win_end and act.get("last_window_end_date") != today_str:
        act["last_window_end_date"] = today_str
        act["days_completed"] = int(act.get("days_completed", 0)) + 1
        changed = True
        log_info(
            f"[FakeOccupancy] {act['automation_id']} day "
            f"{act['days_completed']}/{act['duration_days']} done"
        )

    return changed


# ---------------------------------------------------------------------------
# Daily plan generation
# ---------------------------------------------------------------------------

def _build_daily_plan(act: dict, now: datetime) -> dict:
    """Build the day's randomized schedule.

    Seeded by (automation_id, date) so a restart mid-day reproduces the same
    plan — keeps the scheduler idempotent across restarts.
    """
    seed_src = f"{act['automation_id']}:{now.date().isoformat()}".encode()
    seed = int(hashlib.sha256(seed_src).hexdigest()[:12], 16)
    rng = random.Random(seed)

    win_start_min = _hm_to_min(act["window_start"])
    win_end_min   = _hm_to_min(act["window_end"])
    if win_end_min <= win_start_min:
        # Defensive — caller normalizes, but a bad config shouldn't crash the loop.
        win_end_min = win_start_min + 60
    window_len = win_end_min - win_start_min

    pool = list(act.get("room_pool", []))
    rng.shuffle(pool)
    count = min(len(pool), rng.choice([2, 3]) if len(pool) >= 2 else len(pool))
    chosen = pool[:count]

    jobs: list[dict] = []
    base_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
    brightness_pct = int(act.get("brightness_pct", 70))

    # Stagger rooms across the window with random durations + gaps.
    # cursor advances minute-by-minute; each room consumes (duration + gap).
    cursor = win_start_min + rng.randint(0, max(0, min(30, window_len // 4)))
    for room in chosen:
        duration = rng.randint(45, 90)
        # Jitter the start time ±15 min, clamp to window.
        jitter = rng.randint(-15, 15)
        on_min = max(win_start_min, min(win_end_min - 10, cursor + jitter))
        off_min = min(win_end_min, on_min + duration)
        if off_min - on_min < 10:
            # Too little time left — skip this room rather than emit a flicker.
            continue
        on_ts  = (base_date.timestamp() + on_min  * 60)
        off_ts = (base_date.timestamp() + off_min * 60)
        jobs.append({
            "at_ts": on_ts,
            "kind": "light_on",
            "entity_id": room["entity_id"],
            "room_id": room["id"],
            "brightness_pct": brightness_pct,
            "ir_device_id": None,
        })
        jobs.append({
            "at_ts": off_ts,
            "kind": "light_off",
            "entity_id": room["entity_id"],
            "room_id": room["id"],
            "brightness_pct": None,
            "ir_device_id": None,
        })
        gap = rng.randint(20, 40)
        cursor = off_min + gap
        if cursor >= win_end_min - 10:
            break

    # TV blast: 60–120 min within the window, independent of the room cadence.
    tv_id = act.get("tv_ir_device_id")
    if tv_id and window_len >= 60:
        tv_duration = rng.randint(60, min(120, window_len - 10))
        tv_jitter = rng.randint(-15, 15)
        tv_start = max(
            win_start_min,
            min(win_end_min - tv_duration - 5,
                win_start_min + rng.randint(0, max(0, window_len - tv_duration - 5)) + tv_jitter),
        )
        tv_on_ts  = base_date.timestamp() + tv_start * 60
        tv_off_ts = base_date.timestamp() + (tv_start + tv_duration) * 60
        jobs.append({
            "at_ts": tv_on_ts,  "kind": "tv_on",  "ir_device_id": tv_id,
            "entity_id": None, "room_id": None, "brightness_pct": None,
        })
        jobs.append({
            "at_ts": tv_off_ts, "kind": "tv_off", "ir_device_id": tv_id,
            "entity_id": None, "room_id": None, "brightness_pct": None,
        })

    jobs.sort(key=lambda j: j["at_ts"])
    return {
        "date": now.date().isoformat(),
        "jobs": jobs,
        "executed": [],
    }


# ---------------------------------------------------------------------------
# Job execution
# ---------------------------------------------------------------------------

async def _execute_job(act: dict, job: dict) -> None:
    kind = job["kind"]
    try:
        if kind in ("light_on", "light_off"):
            from services.home_automation import call_service
            entity_id = job.get("entity_id") or ""
            if not entity_id:
                return
            domain = entity_id.split(".")[0] if "." in entity_id else "light"
            if kind == "light_on":
                data = {"entity_id": entity_id}
                bp = job.get("brightness_pct")
                if bp and domain == "light":
                    data["brightness_pct"] = int(bp)
                result = await asyncio.to_thread(call_service, domain, "turn_on", data)
            else:
                result = await asyncio.to_thread(
                    call_service, domain, "turn_off", {"entity_id": entity_id}
                )
            ok = bool(result.get("ok"))
            _bus.emit("automation", VERBOSE, "fake_occupancy_job_done",
                      automation_id=act["automation_id"], kind=kind,
                      entity_id=entity_id, result="ok" if ok else "error")

        elif kind in ("tv_on", "tv_off"):
            # Most TVs use a single toggle "power" code for both directions.
            # ir_manager's assumed-state tracker knows whether the TV is on or
            # off after the previous command and won't double-power the device.
            from services.ir_manager import send_ir_command
            ir_id = job.get("ir_device_id") or ""
            if not ir_id:
                return
            result = await asyncio.to_thread(send_ir_command, ir_id, "power")
            _bus.emit("automation", VERBOSE, "fake_occupancy_job_done",
                      automation_id=act["automation_id"], kind=kind,
                      ir_device_id=ir_id, result="ok" if result.get("ok") else "error")
    except Exception as exc:
        log_error(f"[FakeOccupancy] job {kind} failed: {exc}")
        _bus.emit("automation", BASIC, "fake_occupancy_job_error",
                  automation_id=act["automation_id"], kind=kind, error=str(exc))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm_hm(value: str, default: str) -> str:
    if not value:
        return default
    s = str(value).strip()[:5]
    if len(s) == 5 and s[2] == ":" and s[:2].isdigit() and s[3:].isdigit():
        return s
    return default


def _hm_to_min(hm: str) -> int:
    h, m = hm.split(":")
    return int(h) * 60 + int(m)


def _within_window(now_hm: str, start: str, end: str) -> bool:
    """Inclusive of start, exclusive of end. Same convention as the HA installer
    window in ziggy_scheduler._within_window — we don't support wrap-around
    (e.g. 22:00 → 02:00); the wizard's defaults stay inside one calendar day."""
    return start <= now_hm < end
