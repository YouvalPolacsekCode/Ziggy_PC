"""
Parked v1 — kit ships via mobile-first MobileOnboarding.jsx flow. See docs/ONBOARDING_AUDIT.md §3.2 for context. Revisit for BYO-hardware v1.1+ tier.

Onboarding state persistence.

Tracks which first-run wizard steps a home has completed so the FE can:
  - Block the main app until the required steps are done.
  - Resume from the right step after the user closes and re-opens the app.
  - Show a "Finish setting up" card on the Dashboard until completion.
  - Re-onboard from scratch via POST /api/onboarding/reset.

State lives at user_files/onboarding.json so it survives container restarts
without being entangled with the device registry. One file per home — the
fleet/cloud layer can lift this out later if multi-home support lands here.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from typing import Iterable, Optional

from core.logger_module import log_error, log_info


ONBOARDING_FILE = "user_files/onboarding.json"

# Canonical step ids — extending this list is fine; the FE picks the next
# pending step from the order it sees them in. Don't rename — IDs are
# persisted in onboarding.json.
STEP_IDS = (
    "language",
    "account",
    "home_name",
    "timezone",
    "connect_ha",
    "coordinator",
    "home_zone",
    "rooms",
    "device_categories",
    "devices",
    "notifications",
    "suggested_automations",
    "voice",
    "mobile",
    "done",
)

# Steps a user MUST complete before being released from onboarding.
# Devices / coordinator / voice / mobile are skippable in the FE.
REQUIRED_STEPS = frozenset({"account", "home_name", "rooms"})


_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _default_state() -> dict:
    return {
        "steps_completed": [],
        "skipped":         [],
        "last_step":       None,
        "completed_at":    None,
        "created_at":      _now(),
    }


def load_state() -> dict:
    """Read the current state. Returns a default skeleton if the file doesn't exist."""
    if not os.path.exists(ONBOARDING_FILE):
        return _default_state()
    try:
        with open(ONBOARDING_FILE, "r", encoding="utf-8") as f:
            data = json.load(f) or {}
    except Exception as e:
        log_error(f"[onboarding] failed to read {ONBOARDING_FILE}: {e}")
        return _default_state()

    skeleton = _default_state()
    skeleton.update(data)
    skeleton["steps_completed"] = list(skeleton.get("steps_completed") or [])
    skeleton["skipped"] = list(skeleton.get("skipped") or [])
    return skeleton


def _save_state(state: dict) -> None:
    os.makedirs(os.path.dirname(ONBOARDING_FILE), exist_ok=True)
    tmp = ONBOARDING_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    os.replace(tmp, ONBOARDING_FILE)


def _mutate(fn) -> dict:
    with _lock:
        state = load_state()
        fn(state)
        _save_state(state)
        return state


def mark_step(step_id: str, *, skipped: bool = False) -> dict:
    """Record that the user finished (or skipped) a step. Returns the new state."""
    if step_id not in STEP_IDS:
        log_error(f"[onboarding] unknown step id: {step_id}")

    def apply(state: dict) -> None:
        completed = state.setdefault("steps_completed", [])
        skipped_list = state.setdefault("skipped", [])
        if skipped:
            if step_id not in skipped_list:
                skipped_list.append(step_id)
            if step_id in completed:
                completed.remove(step_id)
        else:
            if step_id not in completed:
                completed.append(step_id)
            if step_id in skipped_list:
                skipped_list.remove(step_id)
        state["last_step"] = step_id

    return _mutate(apply)


def mark_complete() -> dict:
    """Stamp completion. Doesn't second-guess required steps — the FE owns the gate."""
    def apply(state: dict) -> None:
        state["completed_at"] = _now()
    return _mutate(apply)


def reset() -> dict:
    """Wipe all progress. Used by /api/onboarding/reset (super_admin only)."""
    fresh = _default_state()
    with _lock:
        _save_state(fresh)
    log_info("[onboarding] state reset")
    return fresh


def is_completed(state: Optional[dict] = None) -> bool:
    s = state or load_state()
    return bool(s.get("completed_at"))


def required_remaining(state: Optional[dict] = None) -> list[str]:
    """Required step ids the user hasn't completed yet (in canonical order)."""
    s = state or load_state()
    done = set(s.get("steps_completed") or [])
    return [sid for sid in STEP_IDS if sid in REQUIRED_STEPS and sid not in done]


def next_pending_step(state: Optional[dict] = None) -> Optional[str]:
    """First canonical step not in completed or skipped — what the FE should show next."""
    s = state or load_state()
    done = set(s.get("steps_completed") or [])
    skipped = set(s.get("skipped") or [])
    for sid in STEP_IDS:
        if sid == "done":
            continue
        if sid not in done and sid not in skipped:
            return sid
    return None
