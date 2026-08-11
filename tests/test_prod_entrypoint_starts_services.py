"""Everything the product needs must start in the process that actually runs.

core/ziggy_main.py reads like the entrypoint and is documented as one, but the
shipped container runs `uvicorn backend.server:app`. So ziggy_main's thread list
has never executed in a customer home. That is how the device-registry self-heal
went missing — and with it, 19 hours of a customer being told all 23 of his
devices had been removed.

An audit found three more: task reminders, sensor alerts, and pattern learning.
These tests pin them to the real entrypoint, and guard against the next service
that gets added to ziggy_main and quietly never ships.
"""

import inspect
import re

import pytest


def _startup_source() -> str:
    """Source of backend.server's FastAPI startup hook."""
    import backend.server as srv
    # The startup body is a module-level function registered with FastAPI; read
    # the module source rather than guessing at the handler's name.
    return inspect.getsource(srv)


def _ziggy_main_source() -> str:
    import core.ziggy_main as zm
    return inspect.getsource(zm)


class TestProductionEntrypointStartsTheRealServices:
    @pytest.mark.parametrize("symbol, why", [
        ("start_reminder_thread",
         "task due-date reminders would never fire"),
        ("start_sensor_alerts",
         "door/motion alerts would never notify anyone"),
        ("start_pattern_scheduler",
         "pattern learning never runs, so Suggestions can only be empty"),
    ])
    def test_service_is_started_by_the_prod_entrypoint(self, symbol, why):
        assert symbol in _startup_source(), (
            f"backend/server.py does not start {symbol} — {why}. "
            f"core/ziggy_main.py is NOT the production entrypoint; the container "
            f"runs `uvicorn backend.server:app`."
        )

    def test_the_registry_self_heal_still_runs(self):
        """The original incident. The scheduler owns the reconcile tick."""
        from services import ziggy_scheduler
        assert hasattr(ziggy_scheduler, "_device_registry_reconcile_tick")
        assert "run_scheduler" in _startup_source()

    def test_settings_gates_are_preserved(self):
        """A home that switched sensor alerts off must stay off — wiring these
        into prod must not also turn them on for everyone."""
        src = _startup_source()
        assert "sensor_alerts" in src and 'get("enabled", True)' in src
        assert "pattern_learning" in src


class TestNoSilentlyUnshippedService:
    """A tripwire for the NEXT one.

    Any service ziggy_main starts should either run in prod too, or be listed
    here as a deliberate exclusion with a reason. The point is that skipping
    something becomes a decision someone wrote down, not an accident.
    """

    # Deliberately NOT started by the prod entrypoint:
    DEV_ONLY = {
        # uvicorn IS the API server in prod; starting it again would bind twice.
        "start_api_server": "uvicorn serves the API in prod",
        # Vite is the dev frontend server; prod serves the built bundle.
        "start_vite": "prod serves frontend/dist, not a dev server",
        # No audio device in the container (see _has_audio_input_device).
        "start_voice_interface": "container has no audio input; voice runs on the host",
        # Debug-only Flask dashboard, superseded by the React ops console.
        "start_dashboard": "superseded by the web UI",
        # Local LLM helper; hubs proxy LLM calls through the relay instead.
        "ensure_server_running": "LLM goes through the relay proxy, not local Ollama",
        # Already started from backend/server.py itself.
        "start_reconciliation_loop": "scheduler owns the reconcile tick in prod",
    }

    def test_every_ziggy_main_service_is_shipped_or_explicitly_excluded(self):
        main_src = _ziggy_main_source()
        startup_src = _startup_source()

        # Names ziggy_main imports and hands to a thread — the shape is
        # `start_x` / `ensure_x`, which is the convention this file uses.
        started = set(re.findall(r"\b((?:start|ensure)_[a-z_]+)\b", main_src))
        started -= {"start_reminder_thread"} ^ started & {"start_reminder_thread"}

        missing = []
        for name in sorted(started):
            if name in self.DEV_ONLY:
                continue
            if name in startup_src:
                continue
            missing.append(name)

        assert not missing, (
            "These services are started by core/ziggy_main.py but NOT by the "
            f"production entrypoint, and are not listed as deliberate dev-only "
            f"exclusions: {missing}. Either start them in backend/server.py or "
            f"add them to DEV_ONLY with a reason. ziggy_main does not run in the "
            f"shipped container."
        )
