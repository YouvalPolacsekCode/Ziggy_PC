import os
import datetime
import platform
import subprocess

def get_time():
    """
    Return the current system time in HH:MM format.
    """
    return datetime.datetime.now().strftime("%H:%M")

def get_date():
    """
    Return the current system date in YYYY-MM-DD format.
    """
    return datetime.datetime.now().strftime("%Y-%m-%d")

def restart_ziggy():
    """
    Restart the Ziggy process (placeholder logic).
    """
    # You can customize this based on how you deploy Ziggy (e.g., systemd, script call, etc.)
    return "Restarting Ziggy... (not implemented)"

def shutdown_ziggy():
    """
    Shut down the system Ziggy is running on.
    """
    system = platform.system().lower()
    try:
        if system == "windows":
            subprocess.run("shutdown /s /t 1", shell=True)
        elif system == "linux" or system == "darwin":
            subprocess.run("sudo shutdown now", shell=True)
        return "Shutdown command issued."
    except Exception as e:
        return f"Failed to shut down: {e}"
