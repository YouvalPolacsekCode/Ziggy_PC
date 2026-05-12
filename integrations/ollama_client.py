"""
Ollama client for Ziggy pattern synthesis.

Uses the OpenAI-compatible API that Ollama exposes at localhost:11434.
No tokens are billed — all inference runs locally.

Configure via settings.yaml:
  ollama:
    base_url: http://localhost:11434/v1
    model: qwen2.5:3b
    timeout: 30
    autostart: true          # launch 'ollama serve' at Ziggy startup if not running
    autostart_timeout: 15    # seconds to wait for server to become ready
"""
from __future__ import annotations

import shutil
import subprocess
import time
import urllib.request

from core.settings_loader import settings
from core.logger_module import log_info, log_error


def get_client():
    """Return an openai.OpenAI instance pointed at the local Ollama server."""
    from openai import OpenAI

    cfg = _cfg()
    return OpenAI(
        base_url=cfg.get("base_url", "http://localhost:11434/v1"),
        api_key="ollama",  # Ollama ignores the key value; any non-empty string works
        timeout=cfg.get("timeout", 30),
    )


def is_available() -> bool:
    """Return True if Ollama is reachable."""
    base = _base_url()
    try:
        with urllib.request.urlopen(f"{base}/api/tags", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def default_model() -> str:
    return _cfg().get("model", "qwen2.5:3b")


def ensure_server_running() -> None:
    """
    Called once at Ziggy startup.

    If Ollama is already running, returns immediately.
    If not, launches 'ollama serve' as a background subprocess and waits
    up to autostart_timeout seconds for it to become ready.
    Safe to call even when autostart is disabled — it just returns.
    """
    cfg = _cfg()
    if not cfg.get("autostart", True):
        return

    if is_available():
        log_info("[Ollama] Server already running.")
        return

    exe = _find_exe()
    if not exe:
        log_error("[Ollama] ollama executable not found — cannot autostart. "
                  "Install Ollama or add it to PATH.")
        return

    log_info(f"[Ollama] Starting server: {exe} serve")
    try:
        subprocess.Popen(
            [exe, "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError as e:
        log_error(f"[Ollama] Failed to launch server: {e}")
        return

    timeout = cfg.get("autostart_timeout", 15)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(1)
        if is_available():
            log_info("[Ollama] Server is ready.")
            return

    log_error(f"[Ollama] Server did not become ready within {timeout}s. "
              "Pattern synthesis will fall back to heuristic mode.")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_exe() -> str | None:
    """Return the path to the ollama executable, checking common Windows install locations."""
    import os

    # Check PATH first
    found = shutil.which("ollama")
    if found:
        return found

    candidates = [
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\Ollama\ollama.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Ollama\ollama.exe"),
        r"C:\Users\Youval Polacsek\AppData\Local\Programs\Ollama\ollama.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path

    return None


def _base_url() -> str:
    base = _cfg().get("base_url", "http://localhost:11434/v1")
    # Strip the /v1 suffix to get the root API base
    return base.rstrip("/").removesuffix("/v1")


def _cfg() -> dict:
    return settings.get("ollama", {})
