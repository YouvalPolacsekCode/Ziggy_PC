"""LAN reachability probe — feeds the presence engine without requiring HA.

For each Ziggy person that has `lan_host` set, this module periodically tries
to reach the device on the local network. A reachable phone is a strong "home"
signal: it works while the PWA is closed (iOS Safari suspending the tab is no
longer a problem), and it doesn't need GPS permissions.

Probe strategy (configurable, defaults sane for iPhone/Android on home WiFi):

  1. **ICMP echo** — `ping -c 1 -W 2 <host>` first. Cheap, works for IPs and
     mDNS names (`.local`) when avahi/Bonjour is installed on the host running
     Ziggy. iOS responds to ICMP except when in deep sleep on cellular only.
  2. (If ICMP fails) **TCP probe** — try to open a connection to a port that
     phones tend to leave open while on WiFi (e.g. 62078 on iOS for iTunes
     sync, 5353 for mDNS responder). Skipped by default — enable via
     `presence.lan_use_tcp_probe`.

State logic on top of probe results:

  * Reachable → call `ingest_external_state(..., "home", source="lan")`.
    The engine's dwell makes sure a single one-off reply doesn't flip state.
  * Unreachable, but `lan_last_seen` is recent (within `lan_offline_grace`) →
    no signal. Phone is probably just briefly asleep / off WiFi for a moment.
  * Unreachable beyond `lan_offline_grace` →
    `ingest_external_state(..., "not_home", source="lan_grace")`. Lets us
    detect a real departure quickly even if the GPS PWA isn't running.

Side effects fire through `services.presence_side_effects.schedule_side_effects`
so push + automations work the same as for GPS-driven transitions.
"""
from __future__ import annotations

import asyncio
import os
import select
import shutil
import socket
import struct
import subprocess
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.logger_module import log_info, log_error
from services import presence_engine
from services.presence_engine import _cfg
from services.presence_side_effects import schedule_side_effects


_DEFAULTS = {
    "lan_probe_interval_seconds": 60,
    "lan_offline_grace_minutes":  10,
    # LAN↔GPS fusion: after the offline grace, DON'T flip to not_home if GPS's
    # last fix still puts the person inside the home zone and it's no older than
    # this. Stops a Wi-Fi nap (battery saver, overnight) from reading as a
    # departure now that background GPS is the authoritative position signal.
    # 0 disables the veto (pure LAN behaviour).
    "lan_grace_gps_veto_minutes": 180,
    "lan_use_tcp_probe":          False,
    "lan_tcp_probe_ports":        [62078, 5353],
    "lan_icmp_timeout_seconds":   2,
    # Phones drop a packet or briefly nap on Wi-Fi even while sitting at home;
    # a single lost echo shouldn't read as "unreachable". Retry a couple times
    # before giving up — one reply across the attempts is enough. The engine's
    # lan_offline_grace still guards against a genuinely-departed phone.
    "lan_icmp_attempts":          3,
}


def _lan_cfg(key: str):
    """Engine-style config lookup, with LAN-specific defaults."""
    try:
        v = _cfg(key)
        if v is not None:
            return v
    except Exception:
        pass
    return _DEFAULTS[key]


# ── probe primitives ──────────────────────────────────────────────────────────

# Sequence counter so back-to-back probes in one process don't accept each
# other's echo replies. Probes run sequentially inside one sweep, but bumping
# this per call is cheap insurance and keeps reply-matching unambiguous.
_icmp_seq = 0


def _icmp_checksum(data: bytes) -> int:
    """Standard 16-bit one's-complement checksum for an ICMP packet."""
    if len(data) % 2:
        data += b"\x00"
    total = sum(struct.unpack("!%dH" % (len(data) // 2), data))
    total = (total >> 16) + (total & 0xFFFF)
    total += total >> 16
    return (~total) & 0xFFFF


def _icmp_reachable_raw(host: str, timeout_s: float) -> bool:
    """One ICMP echo via a raw socket — no `ping` binary required.

    The `iputils` `ping` executable is NOT present in the Ziggy container image,
    so the `subprocess`-based `_icmp_reachable` below silently no-ops there
    (shutil.which → None). Docker's default capability set includes CAP_NET_RAW,
    so we can craft the echo request ourselves. This is the PRIMARY probe; the
    binary path stays as a fallback for hosts/images where raw sockets are
    blocked but `ping` exists.

    Returns True only on a matching echo reply from the target within timeout.
    `.local` (mDNS) names resolve only if the host has an mDNS-aware resolver
    (avahi/nss-mdns); otherwise getaddrinfo raises and we return False — the
    user is guided toward a fixed IP / DHCP reservation for exactly this reason.
    """
    global _icmp_seq
    try:
        dest = socket.getaddrinfo(host, None, socket.AF_INET, socket.SOCK_RAW)[0][4][0]
    except OSError:
        return False

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
    except (PermissionError, OSError):
        # No CAP_NET_RAW — let the caller fall back to the ping binary / TCP.
        return False

    try:
        sock.setblocking(False)
        ident = os.getpid() & 0xFFFF
        _icmp_seq = (_icmp_seq + 1) & 0xFFFF
        seq = _icmp_seq
        payload = b"ziggy-presence"
        header = struct.pack("!BBHHH", 8, 0, 0, ident, seq)          # type=8 (echo), code=0, csum=0
        chksum = _icmp_checksum(header + payload)
        packet = struct.pack("!BBHHH", 8, 0, chksum, ident, seq) + payload

        try:
            sock.sendto(packet, (dest, 0))
        except OSError:
            return False

        deadline = time.monotonic() + timeout_s
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            ready, _, _ = select.select([sock], [], [], remaining)
            if not ready:
                return False
            try:
                data, addr = sock.recvfrom(1024)
            except OSError:
                return False
            # Only a reply from the host we pinged counts.
            if addr[0] != dest:
                continue
            ihl = (data[0] & 0x0F) * 4          # IPv4 header length
            icmp = data[ihl:ihl + 8]
            if len(icmp) < 8:
                continue
            r_type, _r_code, _csum, r_id, r_seq = struct.unpack("!BBHHH", icmp)
            if r_type == 0 and r_id == ident and r_seq == seq:   # echo reply, ours
                return True
    finally:
        sock.close()


def _icmp_reachable(host: str, timeout_s: float) -> bool:
    """One ICMP echo. Returns True if exit code 0.

    Uses the system `ping` so mDNS (`.local`) names are resolved by the OS
    resolver (works on macOS by default and on Linux with avahi-daemon).
    """
    if not shutil.which("ping"):
        return False
    # macOS and Linux differ on the timeout flag:
    #   linux: -W <seconds>  (per-reply timeout)
    #   macos: -W <ms>       (per-reply timeout, milliseconds)
    # `-c 1` (count) is portable. Use a wrapping timeout to be safe.
    try:
        proc = subprocess.run(
            ["ping", "-c", "1", "-W", str(int(timeout_s * 1000)), host],
            capture_output=True,
            timeout=timeout_s + 1,
        )
        if proc.returncode == 0:
            return True
        # Fallback: Linux-style integer seconds.
        proc = subprocess.run(
            ["ping", "-c", "1", "-W", str(max(1, int(timeout_s))), host],
            capture_output=True,
            timeout=timeout_s + 1,
        )
        return proc.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return False


def _tcp_reachable(host: str, ports: list[int], timeout_s: float) -> bool:
    """Try to open a TCP connection to any of the given ports."""
    import socket
    for port in ports:
        try:
            with socket.create_connection((host, port), timeout=timeout_s):
                return True
        except (OSError, socket.timeout):
            continue
    return False


def _probe_host(host: str) -> bool:
    """Best-effort reachability check. Returns True if any method succeeded.

    Order: raw-socket ICMP (works in the container — no `ping` binary needed),
    then the `ping` executable if present, then the opt-in TCP probe.
    """
    timeout_s = float(_lan_cfg("lan_icmp_timeout_seconds"))
    attempts = max(1, int(_lan_cfg("lan_icmp_attempts")))
    for _ in range(attempts):
        if _icmp_reachable_raw(host, timeout_s):
            return True
    if _icmp_reachable(host, timeout_s):
        return True
    if bool(_lan_cfg("lan_use_tcp_probe")):
        ports = list(_lan_cfg("lan_tcp_probe_ports") or [])
        if ports and _tcp_reachable(host, ports, timeout_s):
            return True
    return False


# ── main probe loop, called by services.ziggy_scheduler ──────────────────────

async def probe_all_persons() -> None:
    """One sweep — probe every person that has `lan_host` set.

    Called once per `lan_probe_interval_seconds`. Each probe runs in the
    asyncio thread pool so the (blocking) `ping` subprocess doesn't stall
    the event loop.
    """
    persons = presence_engine.list_lan_hosts()
    if not persons:
        return

    loop      = asyncio.get_running_loop()
    grace_min = int(_lan_cfg("lan_offline_grace_minutes"))
    now       = datetime.now(timezone.utc)

    for entry in persons:
        host      = entry["lan_host"]
        person_id = entry["id"]
        name      = entry["name"]
        try:
            reachable = await loop.run_in_executor(None, _probe_host, host)
        except Exception as exc:
            log_error(f"[LAN] probe failed for {name} ({host}): {exc}")
            continue

        presence_engine.record_lan_probe(person_id, reachable, now=now)

        if reachable:
            decision = presence_engine.ingest_external_state(
                person_id     = person_id,
                new_state     = "home",
                source        = "lan",
                reason_suffix = f"lan_host={host}",
                now           = now,
            )
            presence_engine.log_decision(decision)
            schedule_side_effects(decision)
            continue

        # Not reachable — only fire "not_home" if the device was previously
        # reachable AND the grace period has elapsed. Otherwise the device
        # might just be briefly asleep / off WiFi.
        person = presence_engine.find_person_by_id(person_id)
        if person is None:
            continue
        last_seen_iso = person.get("lan_last_seen")
        if not last_seen_iso:
            # We've never seen this device on LAN — no signal to send.
            continue
        try:
            last_seen = datetime.fromisoformat(last_seen_iso)
            if last_seen.tzinfo is None:
                last_seen = last_seen.replace(tzinfo=timezone.utc)
        except Exception:
            continue
        offline_for = now - last_seen
        if offline_for < timedelta(minutes=grace_min):
            continue  # within grace — no signal

        # LAN↔GPS fusion: Wi-Fi gone past grace, but if GPS still places them
        # inside the home zone (fresh enough), they haven't left — the phone
        # just dropped Wi-Fi. Don't fire not_home. Background GPS reports a real
        # departure (position moves out / geofence-exit ping), which lifts the veto.
        veto_min = float(_lan_cfg("lan_grace_gps_veto_minutes"))
        if veto_min > 0 and presence_engine.gps_recent_home(person, veto_min, now=now):
            log_info(
                f"[LAN] {host} offline {int(offline_for.total_seconds())}s but GPS still "
                f"places {person.get('name')} in the home zone — not flipping to not_home"
            )
            continue

        decision = presence_engine.ingest_external_state(
            person_id     = person_id,
            new_state     = "not_home",
            source        = "lan_grace",
            reason_suffix = f"lan_host={host} offline_for={int(offline_for.total_seconds())}s",
            now           = now,
        )
        presence_engine.log_decision(decision)
        schedule_side_effects(decision)
