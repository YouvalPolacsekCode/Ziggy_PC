"""Reusable in-memory sliding-window rate limiter.

Generalizes the per-endpoint pattern that already guards /api/voice
(backend/routers/intent_router.py:23-61) into a small class other routers can
share. In-memory only — state lives in the process, so on a multi-worker
deployment each worker keeps its own window. That is intentional and adequate
for the current single-uvicorn-worker hub: the goal is to blunt brute-force
and accidental request storms, not to be a distributed quota service. If Ziggy
ever runs multiple API workers behind a load balancer, swap the backing store
for Redis without changing call sites.

Thread-safe: hub background threads and the async request path can both call
`check()` concurrently, so all mutation of the per-key deque is under a Lock.
"""
from __future__ import annotations

import time
from collections import deque
from threading import Lock
from typing import Deque, Dict, Optional

from fastapi import HTTPException, Request


class SlidingWindowLimiter:
    """Fixed-count-per-rolling-window limiter, keyed by an arbitrary string.

    - `max_hits` requests are allowed per `window_s` seconds per key.
    - The window slides: expired timestamps are evicted on each check.
    - On overflow, raises HTTPException(429) with a Retry-After header so the
      unified error handler and HTTP clients both do the right thing.
    """

    def __init__(self, max_hits: int, window_s: float, name: str = "request"):
        self.max_hits = int(max_hits)
        self.window_s = float(window_s)
        self.name = name
        self._hits: Dict[str, Deque[float]] = {}
        self._lock = Lock()

    def check(self, key: str) -> None:
        """Record a hit for `key`; raise 429 if the window is already full."""
        now = time.time()
        cutoff = now - self.window_s
        with self._lock:
            dq = self._hits.setdefault(key, deque())
            while dq and dq[0] < cutoff:
                dq.popleft()
            if len(dq) >= self.max_hits:
                retry_after = max(1, int(dq[0] + self.window_s - now))
                raise HTTPException(
                    status_code=429,
                    detail=(
                        f"Too many {self.name} attempts "
                        f"({self.max_hits}/{int(self.window_s)}s). "
                        f"Retry in {retry_after}s."
                    ),
                    headers={"Retry-After": str(retry_after)},
                )
            dq.append(now)

    def peek(self, key: str) -> int:
        """Return how many hits are currently counted in the window (no record)."""
        now = time.time()
        cutoff = now - self.window_s
        with self._lock:
            dq = self._hits.get(key)
            if not dq:
                return 0
            while dq and dq[0] < cutoff:
                dq.popleft()
            return len(dq)

    def reset(self, key: Optional[str] = None) -> None:
        """Clear one key's window, or all keys when `key` is None (tests)."""
        with self._lock:
            if key is None:
                self._hits.clear()
            else:
                self._hits.pop(key, None)


def client_key(request: Request, prefix: str = "ip") -> str:
    """Best-effort per-client key.

    Prefer the authenticated identity if one is already on request.state
    (set by get_current_user); otherwise fall back to the peer IP. For the
    login endpoint there is no user yet, so this resolves to the source IP —
    exactly what brute-force protection needs.
    """
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        ident = user.get("username") or user.get("user_id")
        if ident:
            return f"u:{ident}"
    host = request.client.host if request.client else "unknown"
    return f"{prefix}:{host}"


def peer_key(request: Request, prefix: str = "ip") -> str:
    """Per-client key bound strictly to the DIRECT socket peer.

    Unlike `client_key`, this never consults an authenticated identity or a
    forwarded header — the no-auth first-boot pairing endpoints have no user
    yet and X-Forwarded-For is attacker-spoofable, so brute-force protection
    there must key on the one address a remote party cannot forge.
    """
    host = request.client.host if request.client else "unknown"
    return f"{prefix}:{host}"


# ---------------------------------------------------------------------------
# Login limiter — brute-force guard for POST /api/auth/login.
#
# The endpoint is unauthenticated and internet-exposed (via the per-home
# Cloudflare Tunnel), so it was flagged in the security audit as an
# unlimited credential-stuffing surface. 10 attempts / 60s / IP is generous
# for a human fat-fingering a password while making automated stuffing
# expensive. Keyed by IP because there is no session yet.
# ---------------------------------------------------------------------------
LOGIN_RATE_MAX = 10
LOGIN_RATE_WINDOW_S = 60

login_limiter = SlidingWindowLimiter(LOGIN_RATE_MAX, LOGIN_RATE_WINDOW_S, name="login")


async def enforce_login_rate_limit(request: Request) -> None:
    """FastAPI dependency: throttle login attempts per source IP."""
    login_limiter.check(client_key(request, prefix="login"))


# ---------------------------------------------------------------------------
# First-boot pairing / ownership limiters — brute-force guard for the no-auth
# endpoints that gate hub ownership: POST /api/mobile/pair and
# POST /api/onboarding/claim.
#
# The claim code is ~30 bits with a 30-day TTL, so without a throttle an
# attacker on the LAN could spray codes fast enough to matter. All three
# limiters key on the DIRECT peer IP (peer_key) because these endpoints are
# pre-account and X-Forwarded-For is spoofable.
#
#   pair_limiter       generic throughput ceiling on /pair redemptions.
#   pair_fail_limiter  tighter lockout that ONLY counts invalid/expired codes,
#                      so a legitimate one-shot redemption is never blocked but
#                      a sprayer trips it after a handful of misses.
#   claim_limiter      throughput ceiling on /api/onboarding/claim.
# ---------------------------------------------------------------------------
PAIR_RATE_MAX = 10
PAIR_RATE_WINDOW_S = 60
pair_limiter = SlidingWindowLimiter(PAIR_RATE_MAX, PAIR_RATE_WINDOW_S, name="pair")

PAIR_FAIL_MAX = 5
PAIR_FAIL_WINDOW_S = 300
pair_fail_limiter = SlidingWindowLimiter(
    PAIR_FAIL_MAX, PAIR_FAIL_WINDOW_S, name="pair-failure"
)

CLAIM_RATE_MAX = 10
CLAIM_RATE_WINDOW_S = 60
claim_limiter = SlidingWindowLimiter(CLAIM_RATE_MAX, CLAIM_RATE_WINDOW_S, name="claim")
