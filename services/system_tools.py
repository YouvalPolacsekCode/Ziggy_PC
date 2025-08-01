import os
import sys
import time
import datetime
import platform
import subprocess
import socket
import signal
import psutil  # Make sure to install: pip install psutil
from core.shared_flags import shutdown_event

def get_time():
    return datetime.datetime.now().strftime("%H:%M")

def get_date():
    return datetime.datetime.now().strftime("%Y-%m-%d")

def get_day_of_week():
    return f"Today is {datetime.datetime.now().strftime('%A')}."

def restart_ziggy():
    """
    Restart the Ziggy process using restart_ziggy.bat located in /core.
    Adds log and delay before exit.
    """
    try:
        from core.logger_module import log_info
        import time

        ziggy_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        bat_path = os.path.join(ziggy_root, "core", "restart_ziggy.bat")

        if not os.path.exists(bat_path):
            return f"restart_ziggy.bat not found at: {bat_path}"

        log_info("[System] 🔄 Restart command issued. Restarting Ziggy in 2 seconds...")
        subprocess.Popen(bat_path, shell=True)

        # Delay and shutdown
        time.sleep(2)
        log_info("[System] 💥 Exiting Ziggy now...")
        os._exit(0)

    except Exception as e:
        return f"Failed to restart Ziggy: {e}"

def shutdown_ziggy():
    try:
        from core.logger_module import log_info
        log_info("[System] 🛑 Ziggy shutdown requested. Cleaning up...")
        shutdown_event.set()
        return "Ziggy is shutting down (gracefully)..."
    except Exception as e:
        return f"Failed to shut down Ziggy: {e}"

def get_system_status():
    try:
        cpu = psutil.cpu_percent(interval=1)
        mem = psutil.virtual_memory().percent
        uptime = datetime.datetime.now() - datetime.datetime.fromtimestamp(psutil.boot_time())
        return f"🖥 CPU: {cpu:.1f}% | 🧠 Memory: {mem:.1f}% | ⏱ Uptime: {str(uptime).split('.')[0]}"
    except Exception as e:
        return f"Failed to get system status: {e}"

def get_ip_address():
    try:
        hostname = socket.gethostname()
        ip = socket.gethostbyname(hostname)
        return f"📡 Ziggy's IP is {ip}"
    except Exception as e:
        return f"Failed to get IP: {e}"

def get_disk_usage():
    try:
        usage = psutil.disk_usage('C:\\') if platform.system().lower() == "windows" else psutil.disk_usage('/')
        total = round(usage.total / (1024 ** 3), 2)
        used = round(usage.used / (1024 ** 3), 2)
        percent = usage.percent
        return f"💾 Disk: {used}/{total} GB used ({percent}%)"
    except Exception as e:
        return f"Failed to get disk usage: {e}"

import subprocess

def get_wifi_status():
    try:
        # First try PowerShell method
        ps_cmd = 'powershell "Get-NetConnectionProfile | Where-Object {$_.InterfaceAlias -like \'Wi-Fi*\'} | Select-Object -ExpandProperty Name"'
        ps_result = subprocess.check_output(ps_cmd, shell=True, stderr=subprocess.DEVNULL).decode("utf-8").strip()

        if ps_result:
            return f"📶 Connected to Wi-Fi network: {ps_result}"

        # Fallback to netsh method
        netsh_result = subprocess.check_output("netsh wlan show interfaces", shell=True).decode("utf-8")
        for line in netsh_result.splitlines():
            if "SSID" in line and "BSSID" not in line:
                return f"📶 {line.strip()}"

        return "⚠️ Wi-Fi interface found, but not connected."

    except subprocess.CalledProcessError:
        return "⚠️ No active Wi-Fi interface found or Wi-Fi is disabled."
    except Exception as e:
        return f"❌ Failed to get Wi-Fi status: {e}"

def get_network_adapters():
    try:
        result = subprocess.check_output("ipconfig /all", shell=True).decode("utf-8").strip()
        # Split into chunks of 4000 characters max
        chunks = [result[i:i + 4000] for i in range(0, len(result), 4000)]
        return chunks
    except Exception as e:
        return [f"❌ Failed to get network adapters: {e}"]

def ping_test(domain="google.com"):
    try:
        result = subprocess.check_output(f"ping {domain} -n 2", shell=True).decode("utf-8")
        return result.strip()
    except Exception as e:
        return f"Ping failed: {e}"
