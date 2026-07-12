from __future__ import annotations

"""
Home provisioner — mini-PC-hub model.

Every Ziggy home ships a physical mini PC that runs the full stack locally
(Ziggy + Home Assistant + Zigbee2MQTT with a USB coordinator dongle). This
module's only job is to allocate the cloud-side resources the mini PC needs:

  1. A Cloudflare Tunnel + its ingress config → public HTTPS URL for the hub
  2. A per-home relay_secret → HMAC key the hub uses to authenticate to the
     relay when it registers itself and posts telemetry

The mini PC is bench-provisioned before shipping via scripts/claim-home.ps1,
which POSTs to /api/provision/hub, writes the returned bundle into the mini
PC's .env, and installs cloudflared with the tunnel token. On first boot in
the customer's home the mini PC registers via POST /api/homes/register-hub.

A bare {tunnel_id}.cfargotunnel.com URL is NOT publicly routable — the relay
cannot reach it. To make each hub reachable we create a per-home public
hostname ({home_id}.hubs.ziggy-home.com) as a DNS CNAME to the tunnel in a
Cloudflare zone we own. That reachable URL is what the relay proxy targets.

Required relay env vars:
  CF_API_TOKEN       — Cloudflare API token with Tunnel:Edit scope
  CF_ACCOUNT_ID      — Cloudflare account ID
  RELAY_PUBLIC_URL   — this relay's public URL (surfaced back to the hub)

Optional (per-home public hostname routing):
  CF_ZONE_ID         — Cloudflare zone ID for the hub domain (ziggy-home.com).
                       If unset, DNS route creation is skipped with a warning
                       and the hub is not publicly reachable until a CNAME is
                       created out of band.
  CF_HUB_DOMAIN      — apex under which per-home hostnames are minted.
                       Default: "hubs.ziggy-home.com".
  CF_PROVISION_DRY_RUN — "1"/"true"/"yes" to log every intended Cloudflare API
                       call without performing it. Lets imaging (Stream 1) and
                       mobile (Stream 4) exercise the provision contract with
                       no real CF/Fly account.
"""

import logging
import os
import secrets
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger("ziggy.relay.provisioner")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CF_API_TOKEN  = os.getenv("CF_API_TOKEN", "")
CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID", "")
CF_ZONE_ID    = os.getenv("CF_ZONE_ID", "")
CF_HUB_DOMAIN = os.getenv("CF_HUB_DOMAIN", "hubs.ziggy-home.com")
RELAY_URL     = os.getenv("RELAY_PUBLIC_URL", "")

CF_BASE = "https://api.cloudflare.com/client/v4"


def _dry_run() -> bool:
    """Read at call time so tests + operators can flip it via env without a
    module reload."""
    return os.getenv("CF_PROVISION_DRY_RUN", "").strip().lower() in ("1", "true", "yes")


def _hub_public_hostname(home_id: str) -> str:
    return f"{home_id}.{CF_HUB_DOMAIN}"


def _reachable_url(home_id: str) -> str:
    """The publicly-routable HTTPS URL the relay proxy targets for this home."""
    return f"https://{_hub_public_hostname(home_id)}"


# ---------------------------------------------------------------------------
# Cloudflare Tunnel helpers (free — no domain needed)
# ---------------------------------------------------------------------------

async def _cf_create_tunnel(name: str) -> tuple[str, str]:
    secret = secrets.token_hex(32)
    if _dry_run():
        logger.info("[dry-run] POST cfd_tunnel name=%s", name)
        return (f"dry-tunnel-{name}", secret)
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(
            f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/cfd_tunnel",
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
            json={"name": name, "tunnel_secret": secret, "config_src": "cloudflare"},
        )
        r.raise_for_status()
        data = r.json()["result"]
        return data["id"], secret


async def _cf_get_token(tunnel_id: str) -> str:
    if _dry_run():
        logger.info("[dry-run] GET cfd_tunnel/%s/token", tunnel_id)
        return f"dry-token-{tunnel_id}"
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/cfd_tunnel/{tunnel_id}/token",
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
        )
        r.raise_for_status()
        return r.json()["result"]


async def _cf_delete_tunnel(tunnel_id: str) -> None:
    if _dry_run():
        logger.info("[dry-run] DELETE cfd_tunnel/%s", tunnel_id)
        return
    async with httpx.AsyncClient(timeout=30) as c:
        await c.delete(
            f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/cfd_tunnel/{tunnel_id}",
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
        )


async def _cf_set_tunnel_config(tunnel_id: str, service_url: str) -> None:
    """Set the tunnel's server-side ingress config (config_src='cloudflare' tunnels).

    A single catch-all rule (service → localhost:8001) is enough: any hostname
    routed into this tunnel (including the per-home public hostname created by
    _cf_upsert_dns_route) lands on the local Ziggy service.
    """
    if _dry_run():
        logger.info("[dry-run] PUT cfd_tunnel/%s/configurations service=%s", tunnel_id, service_url)
        return
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.put(
            f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/cfd_tunnel/{tunnel_id}/configurations",
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
            json={
                "config": {
                    "ingress": [
                        {"service": service_url},
                    ]
                }
            },
        )
        r.raise_for_status()


def _cf_tunnel_url(tunnel_id: str) -> str:
    return f"https://{tunnel_id}.cfargotunnel.com"


async def _cf_upsert_dns_route(home_id: str, tunnel_id: str) -> str:
    """Create/update the per-home public hostname CNAME → the tunnel.

    {home_id}.{CF_HUB_DOMAIN}  CNAME  {tunnel_id}.cfargotunnel.com  (proxied)

    Idempotent: if a record for the hostname already exists it is updated
    rather than duplicated, so re-provisioning the same home_id is safe.
    Returns the hostname. If CF_ZONE_ID is unset (or dry-run), the intended
    call is logged and no HTTP request is made.
    """
    hostname = _hub_public_hostname(home_id)
    target   = f"{tunnel_id}.cfargotunnel.com"

    if _dry_run():
        logger.info(
            "[dry-run] DNS upsert CNAME %s -> %s (zone=%s, proxied=true)",
            hostname, target, CF_ZONE_ID or "<unset>",
        )
        return hostname

    if not CF_ZONE_ID:
        logger.warning(
            "CF_ZONE_ID unset — skipping DNS route for %s. Hub is NOT publicly "
            "reachable until a CNAME %s -> %s (proxied) exists.",
            home_id, hostname, target,
        )
        return hostname

    headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}
    payload = {"type": "CNAME", "name": hostname, "content": target,
               "proxied": True, "ttl": 1}
    async with httpx.AsyncClient(timeout=30) as c:
        # Look up an existing record so re-provision updates in place.
        r = await c.get(
            f"{CF_BASE}/zones/{CF_ZONE_ID}/dns_records",
            headers=headers, params={"type": "CNAME", "name": hostname},
        )
        r.raise_for_status()
        existing = r.json().get("result", []) or []
        if existing:
            rec_id = existing[0]["id"]
            r2 = await c.put(
                f"{CF_BASE}/zones/{CF_ZONE_ID}/dns_records/{rec_id}",
                headers=headers, json=payload,
            )
        else:
            r2 = await c.post(
                f"{CF_BASE}/zones/{CF_ZONE_ID}/dns_records",
                headers=headers, json=payload,
            )
        r2.raise_for_status()
    logger.info("DNS route ready: %s -> %s", hostname, target)
    return hostname


async def _cf_delete_dns_route(home_id: str) -> None:
    """Delete the per-home public hostname CNAME. Idempotent; best-effort."""
    hostname = _hub_public_hostname(home_id)
    if _dry_run() or not CF_ZONE_ID:
        logger.info("[dry-run/skip] DNS delete CNAME %s", hostname)
        return
    headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(
                f"{CF_BASE}/zones/{CF_ZONE_ID}/dns_records",
                headers=headers, params={"type": "CNAME", "name": hostname},
            )
            r.raise_for_status()
            for rec in (r.json().get("result", []) or []):
                await c.delete(
                    f"{CF_BASE}/zones/{CF_ZONE_ID}/dns_records/{rec['id']}",
                    headers=headers,
                )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Hub provisioning + deprovisioning
# ---------------------------------------------------------------------------

@dataclass
class HubProvisionResult:
    home_id:      str
    home_name:    str
    relay_url:    str
    relay_secret: str
    tunnel_id:    str
    tunnel_url:   str
    tunnel_token: str
    reachable_url: str = ""


async def provision_hub(
    home_id:   str,
    home_name: str,
    relay_url: str,
    existing_tunnel_id:    Optional[str] = None,
    existing_relay_secret: Optional[str] = None,
) -> HubProvisionResult:
    """Allocate cloud resources for a mini-PC hub. No SSH.

    Fresh provision: create a Cloudflare Tunnel, a per-home relay secret, the
    tunnel ingress config, and the per-home public-hostname DNS route.

    Idempotent re-provision: when ``existing_tunnel_id`` is supplied (the home
    was provisioned before, e.g. imaging re-runs claim-home with a stable
    DEVICE_ID==HOME_ID), the tunnel + secret are reused. No second tunnel is
    created; the ingress + DNS route are re-asserted (both idempotent) and a
    fresh connector token is fetched.
    """
    if not _dry_run() and (not CF_API_TOKEN or not CF_ACCOUNT_ID):
        raise RuntimeError(
            "CF_API_TOKEN and CF_ACCOUNT_ID required for Cloudflare Tunnel. "
            "Get them free at dash.cloudflare.com → My Profile → API Tokens. "
            "(Set CF_PROVISION_DRY_RUN=1 to exercise the flow without CF.)"
        )

    if existing_tunnel_id:
        # Idempotent re-provision — reuse the tunnel + secret.
        tunnel_id    = existing_tunnel_id
        relay_secret = existing_relay_secret or secrets.token_hex(32)
        tunnel_token = await _cf_get_token(tunnel_id)
        try:
            await _cf_set_tunnel_config(tunnel_id, "http://localhost:8001")
        except Exception:
            # Non-fatal on re-provision: the config may already be correct and
            # a transient CF hiccup shouldn't fail an otherwise-live home.
            logger.warning("re-provision: set_tunnel_config failed for %s (continuing)", tunnel_id)
        await _cf_upsert_dns_route(home_id, tunnel_id)
    else:
        relay_secret = secrets.token_hex(32)
        tunnel_id, _ = await _cf_create_tunnel(f"ziggy-{home_id[:12]}")
        try:
            tunnel_token = await _cf_get_token(tunnel_id)
            # Point the tunnel at Ziggy on the mini PC. cloudflared runs locally
            # on the mini PC alongside Ziggy, so localhost:8001 is the ingress
            # target. Without this call the tunnel exists but returns CF's default
            # 404 for every request.
            await _cf_set_tunnel_config(tunnel_id, "http://localhost:8001")
            # Create the per-home public hostname so the relay can actually
            # reach the hub (bare cfargotunnel.com is not publicly routable).
            await _cf_upsert_dns_route(home_id, tunnel_id)
        except Exception as e:
            try:
                await _cf_delete_tunnel(tunnel_id)
            except Exception:
                pass
            raise RuntimeError(f"Cloudflare tunnel setup failed: {e}")

    return HubProvisionResult(
        home_id       = home_id,
        home_name     = home_name,
        relay_url     = relay_url or RELAY_URL,
        relay_secret  = relay_secret,
        tunnel_id     = tunnel_id,
        tunnel_url    = _cf_tunnel_url(tunnel_id),
        tunnel_token  = tunnel_token,
        reachable_url = _reachable_url(home_id),
    )


async def deprovision_hub(cf_tunnel_id: Optional[str], home_id: Optional[str] = None) -> None:
    """Delete the home's Cloudflare Tunnel + DNS route. Idempotent; caller
    drops the DB row."""
    if home_id:
        await _cf_delete_dns_route(home_id)
    if cf_tunnel_id and CF_API_TOKEN and not cf_tunnel_id.startswith("local-"):
        try:
            await _cf_delete_tunnel(cf_tunnel_id)
        except Exception:
            pass
