"""Stream 5 wiring regression tests.

Guards the two mounts that this stream added to backend/server.py:
  - /api/alerts (alerts_router — was implemented but never mounted → live 404)
  - /api/admin/factory-reset|safe-mode|customer-reset (lifecycle_router)

Also asserts the login route carries the rate-limit dependency and the locale
helper resolves Hebrew/English correctly.
"""
from __future__ import annotations

import pytest


def _app_paths():
    from backend.server import app
    return {getattr(r, "path", None) for r in app.routes}


def test_alerts_router_mounted():
    assert "/api/alerts" in _app_paths()


def test_lifecycle_routes_mounted():
    paths = _app_paths()
    assert "/api/admin/factory-reset" in paths
    assert "/api/admin/safe-mode" in paths
    assert "/api/admin/customer-reset" in paths


def test_login_route_has_rate_limit_dependency():
    from backend.server import app
    login = [r for r in app.routes if getattr(r, "path", None) == "/api/auth/login"]
    assert login, "login route missing"
    dep_calls = [d.call for d in login[0].dependant.dependencies]
    from backend.middleware.rate_limit import enforce_login_rate_limit
    assert enforce_login_rate_limit in dep_calls


def test_locale_helper_switches_language(monkeypatch):
    from core import result_utils
    # Force Hebrew.
    monkeypatch.setattr(result_utils, "current_language", lambda: "he")
    assert result_utils.L("Hello", "שלום") == "שלום"
    # Force English.
    monkeypatch.setattr(result_utils, "current_language", lambda: "en")
    assert result_utils.L("Hello", "שלום") == "Hello"


def test_current_language_reads_system_block(monkeypatch):
    from core import result_utils
    from core import settings_loader
    monkeypatch.setitem(settings_loader.settings, "system", {"language": "he-IL"})
    assert result_utils.current_language() == "he"
    monkeypatch.setitem(settings_loader.settings, "system", {"language": "en"})
    monkeypatch.setitem(settings_loader.settings, "language", "en")
    assert result_utils.current_language() == "en"
