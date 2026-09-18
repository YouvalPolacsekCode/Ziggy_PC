"""services/usage_counters — the hub's privacy-preserving feature counters.

What these pin down:
  * the snapshot shape is exactly TRACKING_SPEC §4 "Product";
  * bump() is thread-safe and never raises on an unknown name;
  * the error digest carries a count and exception CLASS NAMES only — never
    a message, a path or a request body;
  * the snapshot rides the telemetry payload, and a counters failure cannot
    break the post;
  * every wiring point (chat, voice, automation, routine, device, app open,
    onboarding, 5xx) actually bumps the counter it claims to.
"""
from __future__ import annotations

import json
import logging
import threading

import pytest

from services import usage_counters as uc


@pytest.fixture(autouse=True)
def _clean_counters():
    uc._reset_for_tests()
    from core.logger_module import error_ring
    error_ring.clear()
    yield
    uc._reset_for_tests()
    error_ring.clear()


SETTINGS = {"features": {"smart_home": True, "voice": True, "scenes": False,
                         "media_music": None, "home_map": 0}}


# ─── Shape ──────────────────────────────────────────────────────────────────

class TestSnapshotShape:
    def test_matches_tracking_spec_product_block(self):
        snap = uc.snapshot_and_reset(settings=SETTINGS)
        assert set(snap) == {"window_s", "counters", "features_enabled", "errors"}
        assert set(snap["counters"]) == set(uc.COUNTER_NAMES)
        assert set(uc.COUNTER_NAMES) == {
            "chat_message", "voice_command", "automation_created",
            "automation_triggered", "routine_run", "device_toggled",
            "scene_applied", "app_open", "onboarding_step", "error_5xx",
        }
        assert snap["errors"] == {"count": 0, "top": []}
        assert isinstance(snap["window_s"], int)

    def test_features_enabled_is_truthy_keys_sorted(self):
        assert uc.features_enabled(SETTINGS) == ["smart_home", "voice"]

    def test_features_enabled_tolerates_missing_section(self):
        assert uc.features_enabled({}) == []
        assert uc.features_enabled({"features": "nope"}) == []

    def test_snapshot_is_small_and_json_serialisable(self):
        for name in uc.COUNTER_NAMES:
            uc.bump(name, 10_000)
        body = json.dumps(uc.snapshot_and_reset(settings=SETTINGS))
        # The relay caps the whole telemetry post at 64 KB; this block must
        # stay a rounding error inside it.
        assert len(body) < 1024


# ─── Counting ───────────────────────────────────────────────────────────────

class TestBump:
    def test_bump_then_snapshot_then_zero(self):
        uc.bump("chat_message")
        uc.bump("chat_message", 2)
        uc.bump("device_toggled")
        snap = uc.snapshot_and_reset(settings=SETTINGS)
        assert snap["counters"]["chat_message"] == 3
        assert snap["counters"]["device_toggled"] == 1
        assert snap["counters"]["voice_command"] == 0
        # Reset: the next window starts from zero.
        assert uc.snapshot_and_reset(settings=SETTINGS)["counters"]["chat_message"] == 0

    def test_unknown_name_and_bad_n_are_ignored(self):
        uc.bump("not_a_counter")
        uc.bump("chat_message", 0)
        uc.bump("chat_message", -5)
        assert uc.peek()["chat_message"] == 0
        assert "not_a_counter" not in uc.peek()

    def test_window_s_is_elapsed_since_last_snapshot(self):
        uc.snapshot_and_reset(settings=SETTINGS, now=1000.0)
        snap = uc.snapshot_and_reset(settings=SETTINGS, now=1300.4)
        assert snap["window_s"] == 300

    def test_thread_safe_under_contention(self):
        def worker():
            for _ in range(2000):
                uc.bump("app_open")
        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert uc.peek()["app_open"] == 16_000

    def test_service_domain_mapping(self):
        assert uc.counter_for_service("light") == "device_toggled"
        assert uc.counter_for_service("climate") == "device_toggled"
        assert uc.counter_for_service("scene") == "scene_applied"
        assert uc.counter_for_service("automation") is None
        assert uc.counter_for_service("notify") is None


# ─── Error digest ───────────────────────────────────────────────────────────

class TestErrorDigest:
    def test_counts_error_records_and_names_exception_types(self):
        log = logging.getLogger("tests.usage_counters")
        try:
            raise ValueError("secret request body must not leak")
        except ValueError:
            log.error("boom", exc_info=True)
        try:
            raise ValueError("again")
        except ValueError:
            log.exception("boom")
        try:
            raise KeyError("k")
        except KeyError:
            log.error("boom", exc_info=True)
        log.error("plain error with no exception")
        log.warning("warnings are not errors")
        log.info("info is not an error")

        snap = uc.snapshot_and_reset(settings=SETTINGS)
        assert snap["errors"]["count"] == 4
        assert snap["errors"]["top"] == ["ValueError", "KeyError"]
        assert "secret" not in json.dumps(snap)

    def test_unhandled_marker_yields_type_name_without_message(self):
        # backend/middleware/error_handler.py logs exactly this prefix.
        logging.getLogger("x").error(
            "[Unhandled] RuntimeError: /home/user/private path\nrequest_id=abc"
        )
        snap = uc.snapshot_and_reset(settings=SETTINGS)
        assert snap["errors"] == {"count": 1, "top": ["RuntimeError"]}
        assert "private" not in json.dumps(snap)

    def test_top_is_capped_at_three(self):
        for name in ("A", "B", "C", "D"):
            exc_type = type(name + "Error", (Exception,), {})
            try:
                raise exc_type()
            except Exception:
                logging.getLogger("x").error("e", exc_info=True)
        snap = uc.snapshot_and_reset(settings=SETTINGS)
        assert snap["errors"]["count"] == 4
        assert len(snap["errors"]["top"]) == 3

    def test_errors_before_the_window_are_not_counted(self):
        logging.getLogger("x").error("old")
        uc.snapshot_and_reset(settings=SETTINGS)   # drains the window
        snap = uc.snapshot_and_reset(settings=SETTINGS)
        assert snap["errors"]["count"] == 0

    def test_ring_handler_never_raises(self):
        from core.logger_module import error_ring

        class Bad(logging.LogRecord):
            def getMessage(self):
                raise RuntimeError("bad record")

        rec = Bad("x", logging.ERROR, "p", 1, "msg %s", (), None)
        error_ring.emit(rec)   # must not raise
        assert uc.errors_since(0)["count"] >= 1


# ─── Telemetry integration ──────────────────────────────────────────────────

class TestTelemetryPayload:
    @pytest.fixture
    def quiet_collectors(self, monkeypatch):
        from services import telemetry_client as tc
        for fn in ("_get_ha_version", "_collect_sensors", "_collect_containers",
                   "_collect_last_automation_trigger", "_collect_health",
                   "_collect_container_health"):
            monkeypatch.setattr(tc, fn, lambda *_a, **_k: None)
        for fn in ("_collect_system_metrics", "_collect_system_uptime",
                   "_collect_sensor_counts"):
            monkeypatch.setattr(tc, fn, lambda *_a, **_k: {})
        monkeypatch.setattr(tc, "_collect_deploy", lambda: {"release_tag": "t"})
        return tc

    def test_payload_carries_usage_counters(self, quiet_collectors):
        uc.bump("chat_message", 3)
        body = quiet_collectors._build_payload(dict(SETTINGS), timeout_s=1.0)
        assert body["usage_counters"]["counters"]["chat_message"] == 3
        assert body["usage_counters"]["features_enabled"] == ["smart_home", "voice"]
        assert set(body["usage_counters"]) == {"window_s", "counters",
                                               "features_enabled", "errors"}

    def test_counters_failure_never_breaks_the_post(self, quiet_collectors, monkeypatch):
        def boom(**_k):
            raise RuntimeError("counters exploded")
        monkeypatch.setattr(uc, "snapshot_and_reset", boom)
        body = quiet_collectors._build_payload(dict(SETTINGS), timeout_s=1.0)
        assert "usage_counters" not in body
        assert "ziggy_version" in body   # the rest of the post is intact


# ─── Wiring — each call site bumps what it says ────────────────────────────

class TestWiring:
    def test_unhandled_exception_bumps_error_5xx(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from backend.middleware.error_handler import install_error_handlers

        app = FastAPI()
        install_error_handlers(app)

        @app.get("/boom")
        async def boom():
            raise RuntimeError("nope")

        with TestClient(app, raise_server_exceptions=False) as c:
            assert c.get("/boom").status_code == 500
        assert uc.peek()["error_5xx"] == 1
        # The digest sees the same failure by class name.
        assert uc.errors_since(0)["top"] == ["RuntimeError"]

    def test_http_exception_5xx_bumps_but_4xx_does_not(self):
        from fastapi import FastAPI, HTTPException
        from fastapi.testclient import TestClient
        from backend.middleware.error_handler import install_error_handlers

        app = FastAPI()
        install_error_handlers(app)

        @app.get("/bad-gateway")
        async def bad_gateway():
            raise HTTPException(502, "HA error")

        @app.get("/missing")
        async def missing():
            raise HTTPException(404, "no")

        with TestClient(app, raise_server_exceptions=False) as c:
            c.get("/bad-gateway")
            c.get("/missing")
        assert uc.peek()["error_5xx"] == 1

    def test_onboarding_mark_step_bumps(self, tmp_path, monkeypatch):
        from services import onboarding_state as ob
        monkeypatch.setattr(ob, "STATE_PATH", str(tmp_path / "onboarding.json"),
                            raising=False)
        monkeypatch.setattr(ob, "_save_state", lambda state: None)
        monkeypatch.setattr(ob, "load_state", lambda: ob._default_state())
        ob.mark_step(next(iter(ob.STEP_IDS)))
        assert uc.peek()["onboarding_step"] == 1

    def test_ha_automation_last_triggered_change_counts_once(self):
        from services.ha_subscriber import _automation_fired
        old = {"attributes": {"last_triggered": "2026-09-18T10:00:00+00:00"}}
        assert _automation_fired(old, {"last_triggered": "2026-09-18T10:05:00+00:00"})
        # Same last_triggered (e.g. the automation was toggled off) — no fire.
        assert not _automation_fired(old, {"last_triggered": "2026-09-18T10:00:00+00:00"})
        # Never triggered yet.
        assert not _automation_fired({}, {"last_triggered": None})
        assert not _automation_fired(None, {})

    @pytest.mark.parametrize("module, marker", [
        ("backend.routers.intent_router",     '_usage_bump("chat_message")'),
        ("backend.routers.intent_router",     '_usage_bump("voice_command")'),
        ("backend.routers.automation_router", '_usage_bump("automation_created")'),
        ("backend.routers.automation_router", '_usage_bump("automation_triggered")'),
        ("backend.routers.routine_router",    '_usage_bump("routine_run")'),
        ("backend.server",                    '_usage_bump("app_open")'),
        ("services.ha_subscriber",            '_usage_bump("automation_triggered")'),
        ("services.home_automation",          "counter_for_service(domain)"),
    ])
    def test_call_site_is_wired(self, module, marker):
        import importlib
        import inspect
        src = inspect.getsource(importlib.import_module(module))
        assert marker in src, f"{module} no longer bumps {marker}"
