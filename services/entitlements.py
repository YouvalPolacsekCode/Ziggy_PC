"""Edge-side cache of the home's plan entitlements.

The relay's OTA manifest carries `plan_id` + `entitlements` (a list of feature
names) next to `subscription_state`. ota_client writes them here on every
verified manifest; gates read `has(feature)`.

Fail-open by design: a hub that has never seen a manifest (fresh install,
relay outage before the first poll) gets every feature. Taking away a
capability the user has always had because the relay is unreachable is worse
than a day of generosity. Mirrors services/subscription_state.py.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

CACHE_PATH = Path("user_files/entitlements.json")

# Keep in sync with relay/app/billing/plans.py::ALL_FEATURES.
ALL_FEATURES = frozenset({"diagnostics", "auto_repair", "explain_changes"})

# In-process memo so a chat turn doesn't stat the file for every feature.
_memo: dict | None = None
_memo_mtime: float | None = None


def update_from_manifest(manifest: dict, path: Path = CACHE_PATH) -> None:
    """Persist plan_id + entitlements from a verified manifest. No-op when the
    relay still serves a manifest without the fields (older relay)."""
    global _memo, _memo_mtime
    if not isinstance(manifest, dict) or "entitlements" not in manifest:
        return
    ents = manifest.get("entitlements")
    if not isinstance(ents, list):
        return
    payload = {
        "plan_id": manifest.get("plan_id"),
        "entitlements": sorted(str(e) for e in ents),
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2))
        _memo, _memo_mtime = None, None
    except OSError as e:
        log.warning("entitlements cache write failed: %s", e)


def _load(path: Path = CACHE_PATH) -> Optional[dict]:
    global _memo, _memo_mtime
    try:
        mtime = path.stat().st_mtime
    except OSError:
        return None
    if _memo is not None and _memo_mtime == mtime and path == CACHE_PATH:
        return _memo
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log.warning("entitlements cache unreadable: %s", e)
        return None
    if not isinstance(data, dict) or not isinstance(data.get("entitlements"), list):
        return None
    if path == CACHE_PATH:
        _memo, _memo_mtime = data, mtime
    return data


def has(feature: str, path: Path = CACHE_PATH) -> bool:
    """True when the home's plan includes `feature`. Unknown → True (fail-open)."""
    data = _load(path)
    if data is None:
        return True
    return feature in set(data.get("entitlements") or [])


def snapshot(path: Path = CACHE_PATH) -> dict:
    """Diagnostic accessor for /api/health-style views."""
    data = _load(path)
    if data is None:
        return {"plan_id": None, "entitlements": sorted(ALL_FEATURES), "source": "default"}
    return {"plan_id": data.get("plan_id"), "entitlements": data.get("entitlements"),
            "source": "manifest", "fetched_at": data.get("fetched_at")}
