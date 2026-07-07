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

Required relay env vars:
  CF_API_TOKEN       — Cloudflare API token with Tunnel:Edit scope
  CF_ACCOUNT_ID      — Cloudflare account ID
  RELAY_PUBLIC_URL   — this relay's public URL (surfaced back to the hub)
"""

import os
import secrets
from dataclasses import dataclass
from typing import Optional

import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CF_API_TOKEN  = os.getenv("CF_API_TOKEN", "")
CF_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID", "")
RELAY_URL     = os.getenv("RELAY_PUBLIC_URL", "")

CF_BASE = "https://api.cloudflare.com/client/v4"


# ---------------------------------------------------------------------------
# Cloudflare Tunnel helpers (free — no domain needed)
# ---------------------------------------------------------------------------

async def _cf_create_tunnel(name: str) -> tuple[str, str]:
    secret = secrets.token_hex(32)
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
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(
            f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/cfd_tunnel/{tunnel_id}/token",
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
        )
        r.raise_for_status()
        return r.json()["result"]


async def _cf_delete_tunnel(tunnel_id: str) -> None:
    async with httpx.AsyncClient(timeout=30) as c:
        await c.delete(
            f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/cfd_tunnel/{tunnel_id}",
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
        )


async def _cf_set_tunnel_config(tunnel_id: str, service_url: str) -> None:
    """Set the tunnel's server-side ingress config (config_src='cloudflare' tunnels)."""
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


async def provision_hub(
    home_id:   str,
    home_name: str,
    relay_url: str,
) -> HubProvisionResult:
    """Create Cloudflare Tunnel + relay secret for a mini-PC hub. No SSH."""
    if not CF_API_TOKEN or not CF_ACCOUNT_ID:
        raise RuntimeError(
            "CF_API_TOKEN and CF_ACCOUNT_ID required for Cloudflare Tunnel. "
            "Get them free at dash.cloudflare.com → My Profile → API Tokens."
        )
    relay_secret = secrets.token_hex(32)
    tunnel_id, _ = await _cf_create_tunnel(f"ziggy-{home_id[:12]}")
    try:
        tunnel_token = await _cf_get_token(tunnel_id)
        # Point the tunnel at Ziggy on the mini PC. cloudflared runs locally
        # on the mini PC alongside Ziggy, so localhost:8001 is the ingress
        # target. Without this call the tunnel exists but returns CF's default
        # 404 for every request.
        await _cf_set_tunnel_config(tunnel_id, "http://localhost:8001")
    except Exception as e:
        try:
            await _cf_delete_tunnel(tunnel_id)
        except Exception:
            pass
        raise RuntimeError(f"Cloudflare tunnel setup failed: {e}")
    return HubProvisionResult(
        home_id      = home_id,
        home_name    = home_name,
        relay_url    = relay_url or RELAY_URL,
        relay_secret = relay_secret,
        tunnel_id    = tunnel_id,
        tunnel_url   = _cf_tunnel_url(tunnel_id),
        tunnel_token = tunnel_token,
    )


async def deprovision_hub(cf_tunnel_id: Optional[str]) -> None:
    """Delete the home's Cloudflare Tunnel. Idempotent; caller drops the DB row."""
    if cf_tunnel_id and CF_API_TOKEN and not cf_tunnel_id.startswith("local-"):
        try:
            await _cf_delete_tunnel(cf_tunnel_id)
        except Exception:
            pass
