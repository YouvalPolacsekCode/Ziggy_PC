"""Forward a hub's `usage_counters` block to PostHog, server-side.

The hub never talks to an analytics vendor — it posts counters to the relay
inside the telemetry it already sends, and the relay projects them onto
PostHog events with `distinct_id = home_id` (TRACKING_SPEC §1, §4):

    feature_used  {feature, count, home_id, release_tag, cohort, window_s}
    hub_errors    {count, top, home_id, release_tag, cohort, window_s}

Only counters > 0 become events: a zero is "nothing happened", which PostHog
expresses as the absence of an event in that window. `hub_errors` fires once
per post when the hub reported any ERROR-level records.

Delivery is fire-and-forget: the telemetry handler must answer the hub in
milliseconds regardless of a vendor's mood. A failed batch writes one
audit_log row (`posthog_forward`, ok=False) and is dropped — the next post
carries fresh counters, and PostHog is not the system of record (the raw
payload already sits in telemetry_raw).

Configuration (relay env / Fly secrets):
    POSTHOG_PROJECT_KEY   the project's write-only `phc_…` key; unset = off
    POSTHOG_HOST          defaults to https://eu.i.posthog.com (EU residency)
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from .audit import log_event

log = logging.getLogger("relay.posthog")

DEFAULT_HOST = "https://eu.i.posthog.com"
FORWARD_TIMEOUT_S = 5.0

# create_task() only holds a weak reference; without this set a task can be
# garbage-collected mid-flight and its exception silently vanishes.
_inflight: set[asyncio.Task] = set()


def posthog_config(env: Optional[dict] = None) -> tuple[Optional[str], str]:
    """(project_key or None, host). Key unset/blank means forwarding is off."""
    env = os.environ if env is None else env
    key = (env.get("POSTHOG_PROJECT_KEY") or "").strip() or None
    host = (env.get("POSTHOG_HOST") or DEFAULT_HOST).strip().rstrip("/") or DEFAULT_HOST
    return key, host


def build_events(home_id: str, payload: dict, *, ts: Optional[str] = None) -> list[dict]:
    """Pure: the PostHog batch entries for one telemetry payload.

    Returns [] when the payload carries no `usage_counters` block (old hub)
    or nothing happened in the window.
    """
    uc = payload.get("usage_counters") if isinstance(payload, dict) else None
    if not isinstance(uc, dict):
        return []
    deploy = payload.get("deploy") if isinstance(payload.get("deploy"), dict) else {}
    context = {
        "home_id":     home_id,
        "release_tag": deploy.get("release_tag") or deploy.get("git_describe"),
        "cohort":      deploy.get("cohort"),
        "window_s":    uc.get("window_s"),
    }
    timestamp = ts or datetime.now(timezone.utc).isoformat()

    events: list[dict] = []
    counters = uc.get("counters") if isinstance(uc.get("counters"), dict) else {}
    for feature, count in counters.items():
        if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
            continue
        events.append({
            "event": "feature_used",
            "distinct_id": home_id,
            "timestamp": timestamp,
            "properties": {"feature": str(feature), "count": count, **context},
        })

    errors = uc.get("errors") if isinstance(uc.get("errors"), dict) else {}
    e_count = errors.get("count")
    if isinstance(e_count, int) and not isinstance(e_count, bool) and e_count > 0:
        top = errors.get("top") if isinstance(errors.get("top"), list) else []
        events.append({
            "event": "hub_errors",
            "distinct_id": home_id,
            "timestamp": timestamp,
            "properties": {
                "count": e_count,
                "top": [str(t) for t in top][:3],
                **context,
            },
        })
    return events


async def forward(home_id: str, payload: dict, *,
                  env: Optional[dict] = None,
                  client: Optional[httpx.AsyncClient] = None,
                  timeout_s: float = FORWARD_TIMEOUT_S) -> dict:
    """POST one batch. Never raises; returns {ok, sent, reason?}."""
    key, host = posthog_config(env)
    if not key:
        return {"ok": True, "sent": 0, "reason": "disabled"}
    events = build_events(home_id, payload)
    if not events:
        return {"ok": True, "sent": 0, "reason": "nothing_to_send"}

    body: dict[str, Any] = {"api_key": key, "batch": events}
    url = f"{host}/batch"
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=timeout_s)
    try:
        resp = await client.post(url, json=body, timeout=timeout_s)
        if 200 <= resp.status_code < 300:
            return {"ok": True, "sent": len(events)}
        reason = f"http_{resp.status_code}"
    except Exception as e:   # network, timeout, DNS — all the same to us
        reason = f"{type(e).__name__}: {str(e)[:120]}"
    finally:
        if own_client:
            try:
                await client.aclose()
            except Exception:
                pass

    log.warning("posthog forward failed for %s: %s", home_id, reason)
    await log_event("posthog_forward", home_id=home_id, ok=False,
                    detail=f"events={len(events)} {reason}")
    return {"ok": False, "sent": 0, "reason": reason}


def schedule_forward(home_id: str, payload: dict) -> Optional[asyncio.Task]:
    """Fire-and-forget from a request handler. No-op when PostHog is off."""
    key, _ = posthog_config()
    if not key:
        return None
    try:
        task = asyncio.get_running_loop().create_task(forward(home_id, payload))
    except RuntimeError:   # no running loop (sync test harness) — skip quietly
        return None
    _inflight.add(task)
    task.add_done_callback(_inflight.discard)
    return task
