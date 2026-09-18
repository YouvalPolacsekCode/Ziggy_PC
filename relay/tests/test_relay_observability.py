"""relay/app/observability.py (Sentry) + fly.toml health check.

Sentry is on only with SENTRY_DSN, never sends request bodies or the two
credential headers, samples 5% of traces, and is initialised at import time
by relay/app/main.py. The Fly check is HTTP GET /health every 30 s — a TCP
check cannot tell a wedged event loop from a healthy one.
"""
from __future__ import annotations

import inspect
import os

import pytest

from relay.app import observability as obs


class TestScrub:
    def test_drops_body_cookies_and_credential_headers(self):
        event = {
            "request": {
                "url": "https://relay/api/devices/h1/telemetry",
                "data": {"usage_counters": {"counters": {"chat_message": 1}}},
                "cookies": {"session": "x"},
                "headers": {
                    "Authorization": "Bearer jwt",
                    "X-Ziggy-Signature": "sha256=abc",
                    "x-relay-secret": "s",
                    "Content-Type": "application/json",
                    "User-Agent": "ziggy-hub",
                },
            },
            "exception": {"values": [{"type": "ValueError"}]},
        }
        out = obs.scrub_event(event, {})
        req = out["request"]
        assert "data" not in req and "cookies" not in req
        assert req["headers"] == {"Content-Type": "application/json", "User-Agent": "ziggy-hub"}
        assert req["url"].endswith("/telemetry")
        assert out["exception"]["values"][0]["type"] == "ValueError"

    def test_header_list_form_is_scrubbed_too(self):
        event = {"request": {"headers": [["authorization", "x"], ["Accept", "*/*"]]}}
        assert obs.scrub_event(event)["request"]["headers"] == [["Accept", "*/*"]]

    def test_event_without_request_passes_through(self):
        assert obs.scrub_event({"message": "hi"}) == {"message": "hi"}
        assert obs.scrub_event({"request": "weird"}) == {"request": "weird"}


class TestOptions:
    def test_off_without_dsn(self):
        assert obs.sentry_options({}) is None
        assert obs.sentry_options({"SENTRY_DSN": "  "}) is None
        assert obs.init_sentry({}) is False

    def test_options_are_the_safe_ones(self):
        opts = obs.sentry_options({"SENTRY_DSN": "https://k@o.ingest.sentry.io/1"})
        assert opts["dsn"] == "https://k@o.ingest.sentry.io/1"
        assert opts["environment"] == "prod"
        assert opts["send_default_pii"] is False
        assert opts["traces_sample_rate"] == 0.05
        assert opts["before_send"] is obs.scrub_event
        assert "release" not in opts

    def test_environment_and_release_from_env(self):
        opts = obs.sentry_options({"SENTRY_DSN": "d", "ZIGGY_ENV": "staging",
                                   "ZIGGY_GIT_SHA": "abc1234"})
        assert opts["environment"] == "staging" and opts["release"] == "abc1234"
        assert obs.release_from_env({"GIT_SHA": "def"}) == "def"
        assert obs.release_from_env({}) is None

    def test_init_calls_sdk_when_installed(self, monkeypatch):
        sentry_sdk = pytest.importorskip("sentry_sdk")
        seen = {}
        monkeypatch.setattr(sentry_sdk, "init", lambda **kw: seen.update(kw))
        assert obs.init_sentry({"SENTRY_DSN": "https://k@o.ingest.sentry.io/1"}) is True
        assert seen["send_default_pii"] is False
        assert seen["before_send"] is obs.scrub_event
        assert any(type(i).__name__ == "FastApiIntegration" for i in seen["integrations"])


def test_main_inits_sentry_at_import_time():
    from relay.app import main
    src = inspect.getsource(main)
    assert "init_sentry()" in src
    # Before the app / routers are built, not inside lifespan.
    assert src.index("init_sentry()") < src.index("app = FastAPI(")


def test_requirements_pin_sentry_fastapi_extra():
    path = os.path.join(os.path.dirname(__file__), "..", "requirements.txt")
    with open(path, encoding="utf-8") as f:
        assert "sentry-sdk[fastapi]" in f.read()


def test_fly_health_check_is_http_get_health_every_30s():
    tomllib = pytest.importorskip("tomllib")
    path = os.path.join(os.path.dirname(__file__), "..", "fly.toml")
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    svc = cfg["services"][0]
    assert "tcp_checks" not in svc
    (check,) = svc["http_checks"]
    assert check["path"] == "/health"
    assert check["method"].lower() == "get"
    assert check["interval"] == "30s"
    # Everything else untouched.
    assert svc["internal_port"] == 8080
    assert cfg["app"] == "ziggy-relay"
    assert cfg["mounts"][0]["destination"] == "/data"
