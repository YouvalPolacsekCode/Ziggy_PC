#!/usr/bin/env python3
import os
import sys
import subprocess
import threading
import time
import signal
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from core.settings_loader import settings
from core.shared_flags import shutdown_event
from core.logger_module import log_info
from interfaces.voice_interface import start_voice_interface
from interfaces.dashboard import start_dashboard
from services.task_manager import start_reminder_thread
from services.push_notify import push_notify_sync
from backend.server import start_api_server

os.environ["FFPLAY_PATH"] = settings.get("audio", {}).get("ffplay_path", "ffplay")


def handle_sigterm(signum, frame):
    log_info("[Main] 🛑 SIGTERM received. Shutting down Ziggy gracefully.")
    shutdown_event.set()


signal.signal(signal.SIGTERM, handle_sigterm)


def _has_audio_input_device() -> bool:
    """Return True if the host exposes at least one audio input device.

    Cloud/Docker deployments have no /dev/snd; spawning the Voice thread there
    just produces a swallowed exception. Probe explicitly so we can skip cleanly.
    """
    try:
        import sounddevice as sd
        return any(d.get("max_input_channels", 0) > 0 for d in sd.query_devices())
    except Exception as e:
        log_info(f"[Main] Audio device probe failed: {e}")
        return False


def main():
    log_info("🚀 Ziggy startup initiated...")

    try:
        from services.device_registry import init as init_device_registry, start_reconciliation_loop
        init_device_registry()
        start_reconciliation_loop()
    except Exception as e:
        log_info(f"[Main] DeviceRegistry init failed (HA may be offline): {e} — continuing with degraded device resolution")

    # IR blaster registry: idempotent migration on cold start. Builds the
    # ir_blasters.json registry from existing ir_devices.json entries on
    # the first boot after upgrade, no-op on subsequent boots. Cheap
    # (parses two JSON files, writes one); won't block startup.
    try:
        from services.ir_blasters import ensure_initialized as init_blasters
        init_blasters()
    except Exception as e:
        log_info(f"[Main] IR blaster registry init failed: {e} — continuing without it")

    def thread_wrapper(name, target):
        def run():
            log_info(f"[Thread:{name}] Starting...")
            try:
                target()
            except Exception as e:
                log_info(f"[Thread:{name}] Exception: {e}")
            log_info(f"[Thread:{name}] Exited.")
        return run

    threads = []

    if settings.get("features", {}).get("voice", True):
        if _has_audio_input_device():
            threads.append(threading.Thread(
                target=thread_wrapper("Voice", start_voice_interface),
                name="Voice",
                daemon=True,
            ))
        else:
            log_info("[Main] No audio input device detected — skipping Voice thread (cloud/headless deployment).")

    if settings.get("debug", {}).get("enable_dashboard", False):
        threads.append(threading.Thread(
            target=thread_wrapper("Dashboard", start_dashboard),
            name="Dashboard",
            daemon=True,
        ))

    threads.append(threading.Thread(
        target=thread_wrapper("Reminder", start_reminder_thread),
        name="Reminder",
        daemon=True,
    ))

    # Smart Light Schedule — continuous adaptive ramp. Cheap when disabled
    # (tick early-outs on cfg.enabled=False), so always spawn it.
    from services.circadian_engine import start_scheduler as start_circadian
    threads.append(threading.Thread(
        target=thread_wrapper("Circadian", start_circadian),
        name="Circadian",
        daemon=True,
    ))

    if settings.get("sensor_alerts", {}).get("enabled", True):
        from services.sensor_alerts import start_sensor_alerts
        _sensor_notify = lambda msg: push_notify_sync("Sensor Alert", msg, "/", "sensor_alert")
        threads.append(threading.Thread(
            target=thread_wrapper("SensorAlerts", lambda: start_sensor_alerts(_sensor_notify)),
            name="SensorAlerts",
            daemon=True,
        ))

    _pl = settings.get("pattern_learning", {})
    if _pl.get("enabled", True) and _pl.get("llm_synthesis", True):
        from integrations.ollama_client import ensure_server_running
        threads.append(threading.Thread(
            target=thread_wrapper("Ollama", ensure_server_running),
            name="Ollama",
            daemon=True,
        ))

    if _pl.get("enabled", True):
        from services.suggestion_engine import start_pattern_scheduler
        from core.shared_flags import shutdown_event as _shutdown_event
        _suggestion_notify = lambda title, body, url="/suggestions": push_notify_sync(title, body, url, "suggestion")
        threads.append(threading.Thread(
            target=thread_wrapper(
                "PatternEngine",
                lambda: start_pattern_scheduler(
                    notify_fn=_suggestion_notify,
                    shutdown=_shutdown_event,
                ),
            ),
            name="PatternEngine",
            daemon=True,
        ))

    if settings.get("web_interface", {}).get("enabled", True):
        threads.append(threading.Thread(
            target=thread_wrapper("API", start_api_server),
            name="API",
            daemon=True,
        ))

    if settings.get("web_interface", {}).get("frontend_dev", True):
        def start_vite():
            import shutil
            frontend_dir = os.path.abspath(
                os.path.join(os.path.dirname(__file__), '..', 'frontend')
            )

            # `shutil.which` honors PATH from the parent shell. If launched from
            # a stripped env (some IDE run configs, launchd plists) the user's
            # Homebrew bin won't be on PATH; fall through to the common locations.
            npm = shutil.which("npm")
            if npm is None:
                for p in ("/opt/homebrew/bin/npm", "/usr/local/bin/npm"):
                    if os.path.isfile(p) and os.access(p, os.X_OK):
                        npm = p
                        break
            if npm is None:
                log_info("[Vite] npm not found on PATH — skipping. Install Node.js or "
                         "add /opt/homebrew/bin to PATH to enable the dev server.")
                return
            log_info(f"[Vite] Starting frontend dev server in {frontend_dir}")

            # `--host` binds both IPv4 + IPv6 (so `localhost:3000` resolves
            # regardless of the browser's preferred family) and exposes the
            # server on the LAN so a phone on the same Wi-Fi can hit it.
            # Pipe output to logs/vite.log so silent crashes are recoverable.
            log_dir = os.path.join(frontend_dir, "logs")
            os.makedirs(log_dir, exist_ok=True)
            log_path = os.path.join(log_dir, "vite.log")
            log_fh = open(log_path, "a", buffering=1)

            # Ensure `node` is reachable by the npm wrapper. We located npm via
            # shutil.which or a Homebrew fallback; the same directory holds
            # `node`, but only if it's actually on PATH inside the child. macOS
            # launchd / IDE-launched Python often have a minimal PATH that
            # excludes /opt/homebrew/bin, which makes npm fail with
            # "env: node: No such file or directory" the moment it tries to
            # invoke its JS entrypoint.
            child_env = os.environ.copy()
            npm_dir = os.path.dirname(npm)
            extra_paths = [npm_dir, "/opt/homebrew/bin", "/usr/local/bin"]
            existing = child_env.get("PATH", "").split(":")
            child_env["PATH"] = ":".join(
                [p for p in extra_paths if p not in existing] + existing
            )

            # IMPORTANT: list-form + shell=False. The previous `shell=True` with
            # a list only ran "npm" and dropped "run dev" silently — that's why
            # the dev server appeared dead while the API thread came up fine.
            proc = subprocess.Popen(
                [npm, "run", "dev", "--", "--host"],
                cwd=frontend_dir,
                env=child_env,
                stdout=log_fh,
                stderr=subprocess.STDOUT,
            )

            # Tear the vite subprocess down when Ziggy is shutting down.
            # daemon=True on the wrapping thread only kills the thread; the
            # spawned npm/vite child would otherwise keep port 3000 occupied
            # after Python exits, requiring a manual `lsof | kill`.
            def _killer():
                shutdown_event.wait()
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                except Exception:
                    pass
            threading.Thread(target=_killer, daemon=True).start()

            proc.wait()

        threads.append(threading.Thread(
            target=thread_wrapper("Vite", start_vite),
            name="Vite",
            daemon=True,
        ))

    for t in threads:
        t.start()

    try:
        count = 0
        while not shutdown_event.is_set():
            count += 1
            if count % 6 == 0:
                active_names = [t.name for t in threading.enumerate()]
                log_info(f"[Main] Ziggy still running. Active threads: {active_names}")
            time.sleep(10)
    except KeyboardInterrupt:
        log_info("[Main] 🔌 KeyboardInterrupt received. Exiting Ziggy.")

    log_info("[Main] 📴 Ziggy has been shut down.")


if __name__ == "__main__":
    print("💡 Ziggy launched via ziggy_main.py")
    main()
