import threading

# Shared shutdown signal
shutdown_event = threading.Event()

# Voice mic master switch.
#   set()    → backend wake-word listener is active (or always-listen mode is running)
#   clear()  → backend mic is released; voice loop waits idle until re-enabled
# Persisted as voice.mic_enabled in settings.yaml; defaults to True if absent so
# existing installs preserve current behavior after upgrade.
mic_enabled_event = threading.Event()

try:
    from core.settings_loader import settings as _settings
    if _settings.get("voice", {}).get("mic_enabled", True):
        mic_enabled_event.set()
except Exception:
    # Settings unavailable (very early boot or test harness) — default to enabled.
    mic_enabled_event.set()
