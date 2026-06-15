"""Unit tests for services.ha_client.

Pins the key contract that motivates Task 2: credential reads must be DYNAMIC
(no import-time snapshot), so a credential change takes effect on the very
next call without restarting the process.
"""
from __future__ import annotations

import pytest

from services import ha_client


def test_url_reads_settings_live(monkeypatch):
    from core.settings_loader import settings as live_settings
    monkeypatch.setitem(
        live_settings,
        "home_assistant",
        {"url": "http://ha-one.local:8123/", "token": "t1"},
    )
    assert ha_client.url() == "http://ha-one.local:8123"
    assert ha_client.token() == "t1"

    # Credential rotation — no module reload, just a settings mutation.
    monkeypatch.setitem(
        live_settings,
        "home_assistant",
        {"url": "https://ha-two.example.com/", "token": "t2"},
    )
    assert ha_client.url() == "https://ha-two.example.com"
    assert ha_client.token() == "t2"


def test_url_returns_empty_when_unconfigured(monkeypatch):
    from core.settings_loader import settings as live_settings
    monkeypatch.setitem(live_settings, "home_assistant", {})
    assert ha_client.url() == ""
    assert ha_client.token() == ""


def test_ws_url_derives_from_url(monkeypatch):
    from core.settings_loader import settings as live_settings
    monkeypatch.setitem(
        live_settings,
        "home_assistant",
        {"url": "https://ha.example.com/", "token": "x"},
    )
    assert ha_client.ws_url() == "wss://ha.example.com/api/websocket"

    monkeypatch.setitem(
        live_settings,
        "home_assistant",
        {"url": "http://homeassistant.local:8123", "token": "x"},
    )
    assert ha_client.ws_url() == "ws://homeassistant.local:8123/api/websocket"


def test_headers_uses_current_token(monkeypatch):
    from core.settings_loader import settings as live_settings
    monkeypatch.setitem(
        live_settings,
        "home_assistant",
        {"url": "http://h:8123", "token": "alpha"},
    )
    assert ha_client.headers() == {
        "Authorization": "Bearer alpha",
        "Content-Type": "application/json",
    }
    monkeypatch.setitem(
        live_settings,
        "home_assistant",
        {"url": "http://h:8123", "token": "beta"},
    )
    assert ha_client.headers()["Authorization"] == "Bearer beta"


def test_session_is_the_shared_pool():
    """ha_client.session() must return the same Session as home_automation,
    so connection pooling isn't fragmented across the codebase."""
    from services import home_automation
    assert ha_client.session() is home_automation._session


def test_no_import_time_credential_snapshots_in_migrated_modules():
    """None of the previously-leaky modules may have module-level URL/token
    constants anymore. This is a structural guard: regressing here would
    silently break credential rotation."""
    import services.ha_areas as m1
    import services.ha_automations as m2
    import services.ha_scripts as m3
    import services.ha_subscriber as m4
    import services.circadian_builder as m5
    import services.media_manager as m6
    import services.visual_manager as m7
    import services.camera_utils as m8

    for module in (m1, m2, m3, m4, m5, m6, m7, m8):
        # Module-level *string* HA_URL/HA_TOKEN are forbidden. Callable
        # shims of the same name (functions returning ha_client.url()) are
        # the intended replacement, so we allow callables.
        for name in ("HA_URL", "HA_TOKEN", "WS_URL", "REST_STATES_URL",
                     "REST_HEADERS", "HEADERS", "_HA_URL", "_HA_TOKEN"):
            if not hasattr(module, name):
                continue
            value = getattr(module, name)
            assert callable(value), (
                f"{module.__name__}.{name} is a non-callable "
                f"{type(value).__name__} — that's an import-time credential "
                f"snapshot. Replace with a callable that reads ha_client live."
            )


def test_ha_areas_ws_is_an_alias(monkeypatch):
    """ha_areas._ws is re-exported from ha_client so existing importers
    (ha_zigbee, ha_pairing, ha_flow_driver, ha_capabilities) keep working
    without churn."""
    import services.ha_areas as ha_areas
    assert ha_areas._ws is ha_client.ws
