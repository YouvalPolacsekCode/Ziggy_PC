"""Edge-side cache of homes.subscription_state (Prompt 9 chunk 3).

The relay's OTA manifest (relay/app/routers/ota.py, schema 2) carries
two new fields per home:
    subscription_state            "active" | "trialing" | "past_due" | ...
    subscription_state_expires_at ISO 8601, when this value goes stale

services/ota_client.py.poll_once() calls update_from_manifest() after
each successful poll. Cloud LLM (integrations/openai_client.py) and
backup engine (services/backup_engine.py) call the reader helpers
below to decide whether to allow their work.

Cache file:
    user_files/subscription_state.json
    {"subscription_state": str, "expires_at": str, "fetched_at": str}

Why a JSON file (not in-memory state):
  - The backup engine runs as a separate subprocess (CLI: `python -m
    services.backup_engine --once`), so in-process state would not be
    visible to it.
  - The chat/intent code runs inside the long-lived FastAPI process;
    re-reading a 200-byte file on each LLM call costs microseconds.
  - File is the single source of truth shared across processes; no
    coordination needed.

Semantics:

  Missing cache file (fresh install, no OTA poll yet):
    Both gates ALLOW. Backward-compat with the relay-side default of
    subscription_state='active' (chunk 1). Avoids killing first-boot
    onboarding before the first manifest poll lands.

  Cache fresh, state ∈ ACTIVE_STATES ({'trialing','active'}):
    Both gates ALLOW.

  Cache fresh, state ∉ ACTIVE_STATES (past_due, cancelled, refunded,
  pending_setup):
    Cloud LLM DENIES (Ollama fallback works locally).
    Backup DENIES (cancelled hub doesn't accrue more B2 storage cost).

  Cache stale (now > expires_at):
    Cloud LLM DENIES (conservative — paid feature off).
    Backup ALLOWS (permissive — data must survive relay outages, see
    audit §2.5 and the "local kit never breaks" invariant).

The mirror-of-relay constant ACTIVE_STATES below MUST match
relay/app/billing/ACTIVE_SUBSCRIPTION_STATES. Adding a new state
here without adding it on the relay side would create a permanent
kill-switch trip for any home in that state.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

CACHE_PATH = Path("user_files/subscription_state.json")

# Mirror of relay/app/billing/ACTIVE_SUBSCRIPTION_STATES. KEEP IN SYNC.
ACTIVE_STATES = frozenset({"trialing", "active"})


def update_from_manifest(manifest: dict, path: Path = CACHE_PATH) -> None:
    """Persist subscription_state + expires_at from a verified OTA manifest.

    Called by services/ota_client.py after signature verification has
    passed. Silently skipped if the manifest is missing the new fields
    (schema < 2 server, or a partial deploy). Errors are logged but
    never raised — the OTA poll must not fail because of cache write
    problems.
    """
    state = manifest.get("subscription_state")
    expires_at = manifest.get("subscription_state_expires_at")
    if not state or not expires_at:
        return
    payload = {
        "subscription_state": str(state),
        "expires_at":         str(expires_at),
        "fetched_at":         datetime.now(timezone.utc).isoformat(),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, separators=(",", ":")))
    except OSError as e:
        log.warning("subscription_state cache write failed: %s", e)


def _load_cache(path: Path = CACHE_PATH) -> Optional[dict]:
    try:
        raw = path.read_text()
    except FileNotFoundError:
        return None
    except OSError as e:
        log.warning("subscription_state cache read failed: %s", e)
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        log.warning("subscription_state cache malformed: %s", e)
        return None
    if not isinstance(data, dict):
        return None
    return data


def cached_state(path: Path = CACHE_PATH) -> Optional[dict]:
    """Diagnostic accessor — return the raw cache dict or None.

    Useful for /api/health-style introspection. Gates should use
    is_cloud_llm_allowed() / is_backup_allowed() which handle the
    missing/stale logic.
    """
    return _load_cache(path)


def _is_stale(cache: dict, now: Optional[datetime] = None) -> bool:
    if now is None:
        now = datetime.now(timezone.utc)
    try:
        expires = datetime.fromisoformat(cache["expires_at"].replace("Z", "+00:00"))
    except (KeyError, ValueError, AttributeError):
        return True
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return now > expires


def is_cloud_llm_allowed(path: Path = CACHE_PATH,
                         now: Optional[datetime] = None) -> bool:
    """True iff the cloud LLM gate should let a call through.

    Missing cache  → True (fresh-install backward-compat)
    Stale cache    → False (conservative — paid feature off; Ollama covers)
    Fresh + active → True
    Fresh + other  → False
    """
    cache = _load_cache(path)
    if cache is None:
        return True
    if _is_stale(cache, now=now):
        return False
    return cache.get("subscription_state") in ACTIVE_STATES


def is_backup_allowed(path: Path = CACHE_PATH,
                      now: Optional[datetime] = None) -> bool:
    """True iff the backup gate should let a run proceed.

    Missing cache  → True (fresh-install backward-compat)
    Stale cache    → True (permissive — data must survive relay outages;
                           audit §2.5 "local kit never breaks" framing)
    Fresh + active → True
    Fresh + other  → False
    """
    cache = _load_cache(path)
    if cache is None:
        return True
    if _is_stale(cache, now=now):
        return True
    return cache.get("subscription_state") in ACTIVE_STATES
