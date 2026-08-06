"""Self-healing Home Assistant base URL.

WHY THIS EXISTS
---------------
Home Assistant runs `network_mode: host`, so the bridge-networked ziggy
container cannot reach it by compose service name — it goes through the docker
host gateway. `docker-compose.prod.yml` declares
`extra_hosts: ["host.docker.internal:host-gateway"]` and the imaging pipeline
writes `HA_URL=http://host.docker.internal:8123` precisely because that name is
immune to the host's LAN address changing.

Any hub that instead carries a literal LAN IP dies silently the moment DHCP
moves the box: `ha_subscriber` retries forever with "No route to host" because
nothing in the system ever asks whether the *address* is still correct.

That is not hypothetical. Canary, 2026-08-05: a power cut moved the lease from
10.100.102.15 to 10.100.102.4; HA, Zigbee2MQTT, MQTT and Matter all stayed
healthy; Ziggy spent 9h50m and 558 reconnect attempts talking to a dead IP.
MQTT survived the same event because `MQTT_URL` uses a service name, and
`core/settings_loader.py` even documents the DHCP-shift failure mode — for
MQTT. This module closes the same hole for HA.

WHAT IT DOES
------------
Answers exactly one question: *"using the token we already hold, is there a
reachable Home Assistant at some other address?"* It never invents
credentials, never guesses tokens, and changes nothing unless a candidate
completes a real WebSocket auth handshake.
"""
from __future__ import annotations

import ipaddress
import socket
import struct
from typing import Awaitable, Callable, Optional
from urllib.parse import urlsplit

from core.logger_module import log_error, log_info

DEFAULT_HA_PORT = 8123

# Ordered, DHCP-immune hosts. `host.docker.internal` first: it is what imaging
# writes and the only name that reaches a network_mode:host HA from inside this
# bridge container. `homeassistant` covers cloud homes where HA is a compose
# service (see relay/app/provisioner.py). `localhost` covers host-run/dev.
_STABLE_HOSTS = ("host.docker.internal", "homeassistant", "localhost")

_PROC_NET_ROUTE = "/proc/net/route"

ProbeFn = Callable[..., Awaitable[dict]]


# ── URL helpers ─────────────────────────────────────────────────────────────

def _split(url: str):
    """urlsplit that tolerates a bare host and never raises."""
    if not url:
        return None
    try:
        parts = urlsplit(url if "//" in url else f"http://{url}")
        return parts if parts.hostname else None
    except ValueError:
        return None


def host_of(url: str) -> str:
    parts = _split(url)
    return parts.hostname if parts else ""


def port_of(url: str, default: int = DEFAULT_HA_PORT) -> int:
    parts = _split(url)
    if not parts:
        return default
    try:
        return parts.port or default
    except ValueError:
        # Malformed port in the URL — fall back rather than explode.
        return default


def scheme_of(url: str, default: str = "http") -> str:
    parts = _split(url)
    return (parts.scheme if parts and parts.scheme else default)


def is_ip_pinned(url: str) -> bool:
    """True when the URL's host is a literal IP address rather than a name.

    An IP-pinned HA_URL is the specific misconfiguration that caused the
    2026-08-05 Canary outage. Callers use this to warn loudly at startup and
    to gate a hub as not-ship-ready.
    """
    host = host_of(url)
    if not host:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


# ── Gateway discovery ───────────────────────────────────────────────────────

def parse_proc_net_route(text: str) -> list[str]:
    """Extract default-gateway IPv4 addresses from /proc/net/route content.

    The default route is the row whose Destination is all-zero; the Gateway
    column is little-endian hex. Returns [] for anything unparseable — a
    missing gateway must degrade to "no extra candidate", never to a crash.
    """
    gateways: list[str] = []
    for line in (text or "").splitlines()[1:]:      # skip header
        fields = line.split()
        if len(fields) < 3:
            continue
        destination, gateway = fields[1], fields[2]
        if destination != "00000000":
            continue
        try:
            packed = struct.pack("<L", int(gateway, 16))
            ip = socket.inet_ntoa(packed)
        except (ValueError, struct.error, OSError):
            continue
        if ip != "0.0.0.0" and ip not in gateways:
            gateways.append(ip)
    return gateways


def default_gateway_ips() -> list[str]:
    """Best-effort docker-bridge gateway lookup. Never raises."""
    try:
        with open(_PROC_NET_ROUTE, "r", encoding="utf-8") as fh:
            return parse_proc_net_route(fh.read())
    except OSError:
        return []


# ── Candidates ──────────────────────────────────────────────────────────────

def candidate_urls(current: str, *, gateways: Optional[list[str]] = None) -> list[str]:
    """Ordered, de-duplicated addresses worth trying instead of `current`.

    `current` is excluded — the caller only asks after it has already failed.
    Scheme and port are inherited from `current` so a hub on a non-default
    port keeps it.
    """
    if gateways is None:
        gateways = default_gateway_ips()

    scheme = scheme_of(current)
    port = port_of(current)

    out: list[str] = []
    for host in (*_STABLE_HOSTS, *gateways):
        url = f"{scheme}://{host}:{port}"
        if url != current and url not in out:
            out.append(url)
    return out


# ── Resolution ──────────────────────────────────────────────────────────────

async def resolve_working_url(
    current: str,
    token: str,
    *,
    probe: Optional[ProbeFn] = None,
    gateways: Optional[list[str]] = None,
) -> Optional[str]:
    """Return the first candidate URL that completes HA's auth handshake.

    Uses `ha_runtime.probe_ha`, which performs a real WebSocket auth — so a
    "success" here means Ziggy can genuinely drive this Home Assistant, not
    merely that a TCP port is open. Returns None if nothing answers.
    """
    if not token:
        # Every probe would fail auth; don't generate pointless traffic.
        return None

    if probe is None:
        from services.ha_runtime import probe_ha as probe   # local: avoid import cycle

    for url in candidate_urls(current, gateways=gateways):
        try:
            result = await probe(url, token)
        except Exception as e:
            log_error(f"[ha_url_resolver] probe of {url} raised: {e}")
            continue
        if isinstance(result, dict) and result.get("ok"):
            log_info(f"[ha_url_resolver] Home Assistant answered at {url}")
            return url
    return None


# How many consecutive reconnect failures before we start asking "did the
# address move?". Three failures is ~15s of backoff — long enough that a
# routine HA restart is not mistaken for a relocation, short enough that a real
# DHCP move is repaired in well under a minute rather than never.
HEAL_AFTER_FAILURES = 3


def should_attempt_heal(consecutive_failures: int) -> bool:
    """Throttle re-resolution to every Nth consecutive failure.

    Retrying on *every* failure would probe up to four addresses per cycle
    forever while HA is simply down for maintenance.
    """
    if consecutive_failures < HEAL_AFTER_FAILURES:
        return False
    return consecutive_failures % HEAL_AFTER_FAILURES == 0


async def heal_url(*, probe: Optional[ProbeFn] = None) -> Optional[str]:
    """Find a working HA address and persist it. Returns the new URL or None.

    Persisting goes through `ha_runtime.set_ha_credentials`, so the change
    lands in settings.yaml, invalidates the registry cache and kicks the
    subscriber — the next reconnect uses the new address with no restart
    (`ha_client.url()` reads settings live).

    NOTE: this repairs the *running* hub and its settings.yaml. A hub whose
    `HA_URL` env var is IP-pinned will be overridden by that env var again on
    the next container recreate, because env beats settings.yaml in
    `core/settings_loader.py`. The env var is the thing to fix permanently;
    `scripts/factory/kit-ready-check.sh` gates on it.
    """
    from services import ha_client, ha_runtime

    current, token = ha_client.url(), ha_client.token()
    new_url = await resolve_working_url(current, token, probe=probe)
    if not new_url:
        return None

    log_info(
        f"[ha_url_resolver] HA moved: {current or '<unset>'} → {new_url}. "
        "Updating settings and reconnecting."
    )
    ha_runtime.set_ha_credentials(url=new_url, token=None)
    return new_url
