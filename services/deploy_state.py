"""What code is this hub actually running, and did someone hand-edit it?

Why this exists
---------------
Releases are supposed to flow one way: `scripts/ship.sh` tags `release-*` on
main, and every hub pulls that tag on its update tick. In practice a customer
hub was found running a hand-copied dev build — `/opt/ziggy` sitting 105 modified
files off `4e181ad`, reporting version `0.0.0+local`. Nothing surfaced that, so
it went unnoticed for weeks, and worse: a dirty tree BLOCKS the updater, so the
hub could no longer receive releases at all.

Drift is a health problem, not a bookkeeping problem. This module makes it a
first-class telemetry field so the fleet view can flag it.

Where the facts come from
-------------------------
The container is NOT a git checkout (`/app/.git` does not exist) — the repo
lives on the host at `/opt/ziggy`. So we read, in order of trust:

  1. ``user_files/deploy_state.json`` — written by the host-side updater
     (scripts/linux/ziggy-update.sh) on every run. Host truth: real
     `git describe`, dirty flag, cohort, applied tag. The user_files directory
     is bind-mounted rw, which is how host truth reaches the container.
  2. Environment stamped at image build / compose time (ZIGGY_GIT_SHA,
     ZIGGY_RELEASE_TAG, ZIGGY_COHORT, ZIGGY_BUILD_TIME).

Everything is best-effort: a hub that can report nothing reports
``{"known": false}`` rather than raising.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

# Written by the host updater into the bind-mounted user_files dir.
_DEPLOY_STATE_FILENAME = "deploy_state.json"

# A build whose git SHA is one of these was never stamped by a real release —
# it came from a hand copy or a local build.
_UNSTAMPED_SHAS = frozenset({"", "dev", "unknown", "local", "none"})


def _user_files_dir() -> Path:
    env = os.getenv("ZIGGY_USER_FILES_DIR", "").strip()
    if env:
        return Path(env)
    # services/ -> repo root -> user_files
    return Path(__file__).resolve().parent.parent / "user_files"


def _read_host_state() -> dict:
    try:
        p = _user_files_dir() / _DEPLOY_STATE_FILENAME
        if not p.exists():
            return {}
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _env(name: str) -> Optional[str]:
    v = os.getenv(name, "").strip()
    return v or None


def collect_deploy_state() -> dict[str, Any]:
    """Best-effort description of the running build. Never raises.

    Returns (all keys optional except `known` and `drifted`)::

        {
          "known":        bool,   # did we learn anything at all?
          "drifted":      bool,   # NOT a clean checkout of a release tag
          "drift_reason": str,    # why, in words, for the fleet view
          "release_tag":  "release-2026.08.10",
          "git_describe": "release-2026.08.10-0-gabc1234",
          "git_sha":      "abc1234",
          "dirty":        bool,   # uncommitted changes in the host checkout
          "dirty_files":  int,
          "cohort":       "production",
          "branch":       "main",
          "updater_installed": bool,
          "applied_at":   "<iso8601>",
        }
    """
    host = _read_host_state()
    out: dict[str, Any] = {}

    def _take(key: str, env_name: Optional[str] = None):
        if key in host and host[key] not in (None, ""):
            out[key] = host[key]
        elif env_name:
            v = _env(env_name)
            if v is not None:
                out[key] = v

    _take("release_tag", "ZIGGY_RELEASE_TAG")
    _take("git_describe")
    _take("git_sha", "ZIGGY_GIT_SHA")
    _take("branch")
    _take("cohort", "ZIGGY_COHORT")
    _take("applied_at")
    _take("build_time", "ZIGGY_BUILD_TIME")

    if isinstance(host.get("dirty"), bool):
        out["dirty"] = host["dirty"]
    if isinstance(host.get("dirty_files"), int):
        out["dirty_files"] = host["dirty_files"]
    out["updater_installed"] = bool(host.get("updater_installed"))

    out["known"] = bool(out.get("git_sha") or out.get("release_tag") or host)

    drifted, reason = _classify_drift(out, host_state_present=bool(host))
    out["drifted"] = drifted
    out["drift_reason"] = reason
    return out


def _classify_drift(state: dict, *, host_state_present: bool) -> tuple[bool, str]:
    """Is this hub running something other than a clean release tag?

    Ordered most-severe first so the reason string names the worst problem —
    a dirty tree matters more than a missing cohort because it BLOCKS updates.
    """
    if state.get("dirty"):
        n = state.get("dirty_files")
        detail = f" ({n} files)" if isinstance(n, int) and n else ""
        return True, f"uncommitted local changes{detail} — updater is blocked"

    sha = (state.get("git_sha") or "").strip().lower()
    if sha in _UNSTAMPED_SHAS:
        return True, "build not stamped with a release SHA (hand-copied or local build)"

    if not host_state_present:
        # No updater has ever written its state file here.
        return True, "no updater state on host — hub is not on the release channel"

    if not state.get("updater_installed"):
        return True, "auto-updater not installed — hub cannot receive releases"

    if not state.get("release_tag"):
        return True, "not pinned to a release tag"

    if not state.get("cohort"):
        return True, "no update cohort assigned"

    describe = state.get("git_describe") or ""
    tag = state.get("release_tag") or ""
    # `git describe` on an exact tag is just the tag; anything else carries a
    # "-<n>-g<sha>" suffix meaning N commits past it.
    if tag and describe and describe != tag:
        return True, f"{describe} — ahead of release tag {tag}"

    return False, ""
