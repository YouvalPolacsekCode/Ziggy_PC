"""Sentry for the relay — on only when SENTRY_DSN is set.

The relay is the one always-on component in Ziggy's cloud; an exception here
used to surface only if someone happened to be tailing `fly logs`. With a DSN
in the environment, unhandled errors reach Sentry with the request route and
a stack trace. Without one this module is a no-op, so tests and dev relays
never need the SDK importable.

What never leaves the relay: request bodies (a hub's telemetry payload, a
provisioning request, a webhook), the `Authorization` header (user JWTs) and
`X-Ziggy-Signature` (per-home HMAC). `scrub_event` strips them before send;
`send_default_pii=False` keeps Sentry from attaching IPs and cookies itself.

Env:
    SENTRY_DSN             turns Sentry on
    ZIGGY_ENV              Sentry `environment` (default "prod")
    ZIGGY_GIT_SHA / GIT_SHA / FLY_IMAGE_REF   `release`, first one present
"""
from __future__ import annotations

import logging
import os
from typing import Any, Mapping, Optional

log = logging.getLogger("relay.observability")

TRACES_SAMPLE_RATE = 0.05
DROPPED_HEADERS = frozenset({"authorization", "x-ziggy-signature", "cookie",
                             "x-relay-secret"})
RELEASE_ENV_KEYS = ("ZIGGY_GIT_SHA", "GIT_SHA", "FLY_IMAGE_REF")


def scrub_event(event: dict, hint: Optional[dict] = None) -> Optional[dict]:
    """Sentry `before_send`: drop request bodies and credential headers.

    Pure and defensive — an event of an unexpected shape passes through
    untouched rather than being lost.
    """
    try:
        req = event.get("request")
        if isinstance(req, dict):
            req.pop("data", None)
            req.pop("cookies", None)
            headers = req.get("headers")
            if isinstance(headers, dict):
                req["headers"] = {
                    k: v for k, v in headers.items()
                    if str(k).lower() not in DROPPED_HEADERS
                }
            elif isinstance(headers, list):
                req["headers"] = [
                    kv for kv in headers
                    if not (isinstance(kv, (list, tuple)) and kv
                            and str(kv[0]).lower() in DROPPED_HEADERS)
                ]
    except Exception:
        pass
    return event


def release_from_env(env: Optional[Mapping[str, str]] = None) -> Optional[str]:
    env = os.environ if env is None else env
    for key in RELEASE_ENV_KEYS:
        v = (env.get(key) or "").strip()
        if v:
            return v
    return None


def sentry_options(env: Optional[Mapping[str, str]] = None) -> Optional[dict[str, Any]]:
    """The `sentry_sdk.init` kwargs, or None when SENTRY_DSN is unset."""
    env = os.environ if env is None else env
    dsn = (env.get("SENTRY_DSN") or "").strip()
    if not dsn:
        return None
    opts: dict[str, Any] = {
        "dsn": dsn,
        "environment": (env.get("ZIGGY_ENV") or "prod").strip() or "prod",
        "send_default_pii": False,
        "traces_sample_rate": TRACES_SAMPLE_RATE,
        "before_send": scrub_event,
    }
    release = release_from_env(env)
    if release:
        opts["release"] = release
    return opts


def init_sentry(env: Optional[Mapping[str, str]] = None) -> bool:
    """Initialise the SDK if configured. Returns True when Sentry is on."""
    opts = sentry_options(env)
    if opts is None:
        return False
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        log.warning("SENTRY_DSN is set but sentry-sdk is not installed — "
                    "add sentry-sdk[fastapi] to relay/requirements.txt")
        return False
    sentry_sdk.init(
        integrations=[StarletteIntegration(), FastApiIntegration()],
        **opts,
    )
    log.info("sentry on: env=%s release=%s", opts["environment"], opts.get("release"))
    return True
