"""Tests for backend/middleware/rate_limit.py + login throttle (Stream 5)."""
from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.middleware.rate_limit import (
    SlidingWindowLimiter,
    enforce_login_rate_limit,
    login_limiter,
    LOGIN_RATE_MAX,
)


def test_sliding_window_allows_up_to_max_then_429():
    lim = SlidingWindowLimiter(max_hits=3, window_s=60, name="test")
    # First 3 are fine.
    for _ in range(3):
        lim.check("k")
    # 4th overflows.
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        lim.check("k")
    assert exc.value.status_code == 429
    assert "Retry-After" in exc.value.headers


def test_sliding_window_keys_are_independent():
    lim = SlidingWindowLimiter(max_hits=1, window_s=60)
    lim.check("a")
    lim.check("b")  # different key — not throttled
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        lim.check("a")


def test_reset_clears_window():
    lim = SlidingWindowLimiter(max_hits=1, window_s=60)
    lim.check("a")
    lim.reset("a")
    lim.check("a")  # allowed again after reset


def test_login_dependency_throttles_by_ip():
    login_limiter.reset()
    app = FastAPI()

    @app.post("/login")
    async def _login(_rl: None = Depends(enforce_login_rate_limit)):
        return {"ok": True}

    client = TestClient(app)
    # LOGIN_RATE_MAX allowed, then 429.
    for _ in range(LOGIN_RATE_MAX):
        assert client.post("/login").status_code == 200
    resp = client.post("/login")
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    login_limiter.reset()
