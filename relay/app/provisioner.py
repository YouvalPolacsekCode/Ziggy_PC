from __future__ import annotations

"""
Home provisioner — SSHes into a provisioning VM (Oracle Cloud free ARM) and
creates a Docker Compose stack per home containing:
  - homeassistant   (HA Core — free public image)
  - ziggy           (Ziggy backend + frontend, built from repo Dockerfile)
  - cloudflared     (Cloudflare Tunnel — free, gives stable HTTPS URL)

Required relay secrets / env vars:
  PROVISION_HOST     — Oracle VM public IP or hostname
  PROVISION_USER     — SSH user (ubuntu / opc / root)
  PROVISION_SSH_KEY  — PEM private key content (newlines as \\n)
  PROVISION_SSH_PORT — SSH port (default 22)
  HOMES_BASE_DIR     — base dir on VM (default /opt/ziggy-homes)
  ZIGGY_IMAGE        — Ziggy Docker image (e.g. registry.fly.io/ziggy-relay:ziggy-app)
  FLY_API_TOKEN      — only needed if ZIGGY_IMAGE is on Fly registry
  CF_API_TOKEN       — Cloudflare API token (free account)
  CF_ACCOUNT_ID      — Cloudflare account ID

Free resources used:
  Oracle Cloud Always Free ARM VM  — 4 OCPUs / 24 GB RAM, hosts all homes
  Cloudflare Tunnel               — free, gives each home a *.cfargotunnel.com URL
  Ziggy image on Fly registry     — pulled once per home using FLY_API_TOKEN
"""

import asyncio
import os
import secrets
from dataclasses import dataclass
from typing import Optional

import httpx

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PROVISION_HOST     = os.getenv("PROVISION_HOST", "")
PROVISION_USER     = os.getenv("PROVISION_USER", "ubuntu")
PROVISION_SSH_KEY  = os.getenv("PROVISION_SSH_KEY", "")   # PEM, \\n encoded
PROVISION_SSH_PORT = int(os.getenv("PROVISION_SSH_PORT", "22"))
HOMES_BASE_DIR     = os.getenv("HOMES_BASE_DIR", "/opt/ziggy-homes")
ZIGGY_IMAGE        = os.getenv("ZIGGY_IMAGE", "")
FLY_API_TOKEN      = os.getenv("FLY_API_TOKEN", "")
CF_API_TOKEN       = os.getenv("CF_API_TOKEN", "")
CF_ACCOUNT_ID      = os.getenv("CF_ACCOUNT_ID", "")
RELAY_URL          = os.getenv("RELAY_PUBLIC_URL", "")
HA_IMAGE           = "ghcr.io/home-assistant/home-assistant:stable"
CF_IMAGE           = "cloudflare/cloudflared:latest"
MOSQUITTO_IMAGE    = "eclipse-mosquitto:2"

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


def _cf_tunnel_url(tunnel_id: str) -> str:
    return f"https://{tunnel_id}.cfargotunnel.com"


# ---------------------------------------------------------------------------
# SSH helpers
# ---------------------------------------------------------------------------

def _get_key():
    import asyncssh
    raw = PROVISION_SSH_KEY.replace("\\n", "\n").strip()
    return asyncssh.import_private_key(raw)


async def _ssh(cmd: str) -> str:
    """Run a shell command on the provisioning VM."""
    import asyncssh
    async with asyncssh.connect(
        PROVISION_HOST, port=PROVISION_SSH_PORT,
        username=PROVISION_USER, client_keys=[_get_key()],
        known_hosts=None,
    ) as conn:
        result = await conn.run(cmd)
        if result.returncode != 0:
            raise RuntimeError(f"SSH command failed (rc={result.returncode}): {result.stderr[:500]}")
        return (result.stdout or "").strip()


async def _sftp_write(remote_path: str, content: str) -> None:
    """Write a text file to the provisioning VM."""
    import asyncssh
    async with asyncssh.connect(
        PROVISION_HOST, port=PROVISION_SSH_PORT,
        username=PROVISION_USER, client_keys=[_get_key()],
        known_hosts=None,
    ) as conn:
        async with conn.start_sftp_client() as sftp:
            async with await sftp.open(remote_path, "w") as f:
                await f.write(content)


# ---------------------------------------------------------------------------
# Docker Compose template — Ziggy + HA + cloudflared on one VM
# ---------------------------------------------------------------------------

def _compose_yaml(home_id: str, cf_token: str, relay_url: str,
                  relay_secret: str, ziggy_image: str,
                  admin_email: str, admin_password: str, home_name: str) -> str:
    return f"""version: "3.9"
services:
  homeassistant:
    image: {HA_IMAGE}
    restart: unless-stopped
    privileged: true
    volumes:
      - ./ha-config:/config
    environment:
      - TZ=UTC
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8123/api/"]
      interval: 30s
      timeout: 10s
      retries: 5

  ziggy:
    image: {ziggy_image}
    restart: unless-stopped
    depends_on:
      - homeassistant
    environment:
      - CLOUD_MODE=true
      - HOME_ID={home_id}
      - HOME_NAME={home_name}
      - HOME_TYPE=cloud
      - RELAY_URL={relay_url}
      - RELAY_SECRET={relay_secret}
      - TUNNEL_URL={_cf_tunnel_url('PLACEHOLDER')}
      - HA_URL=http://homeassistant:8123
      - INITIAL_ADMIN_EMAIL={admin_email}
      - INITIAL_ADMIN_PASSWORD={admin_password}
      - ZIGGY_CONFIG_PATH=/app/user_files/settings.yaml
    volumes:
      - ziggy_data:/app/user_files

  cloudflared:
    image: {CF_IMAGE}
    restart: unless-stopped
    depends_on:
      - ziggy
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN={cf_token}

volumes:
  ziggy_data:
"""


def _ha_config() -> str:
    return """homeassistant:
  name: Ziggy Home
  unit_system: metric
  time_zone: UTC
default_config:
api:
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 0.0.0.0/0
logger:
  default: warning
"""


def _mosquitto_conf() -> str:
    return """listener 1883
allow_anonymous true
persistence true
persistence_location /mosquitto/data/
"""


# ---------------------------------------------------------------------------
# Main provision / deprovision
# ---------------------------------------------------------------------------

@dataclass
class ProvisionResult:
    home_id:      str
    tunnel_url:   str
    tunnel_id:    str
    relay_secret: str
    app_name:     str  # = home_id for SSH-based homes


async def provision_home(
    home_id:        str,
    home_name:      str,
    relay_url:      str,
    index:          int,
    ziggy_image:    str = "",
    admin_email:    str = "",
    admin_password: str = "",
) -> ProvisionResult:
    """
    Provision a new home on the Oracle Cloud VM via SSH:
      1. Create Cloudflare Tunnel (free — gives stable HTTPS URL)
      2. Write docker-compose stack to VM
      3. Pull images and start containers
    """
    if not PROVISION_HOST:
        raise RuntimeError(
            "PROVISION_HOST not set. Set up an Oracle Cloud free ARM VM and configure "
            "PROVISION_HOST, PROVISION_USER, PROVISION_SSH_KEY on the relay."
        )
    if not CF_API_TOKEN or not CF_ACCOUNT_ID:
        raise RuntimeError(
            "CF_API_TOKEN and CF_ACCOUNT_ID required for Cloudflare Tunnel. "
            "Get them free at dash.cloudflare.com → My Profile → API Tokens."
        )

    image = ziggy_image or ZIGGY_IMAGE
    if not image:
        raise RuntimeError("ZIGGY_IMAGE not set on relay.")

    relay_secret = secrets.token_hex(32)
    home_dir     = f"{HOMES_BASE_DIR}/{home_id}"

    # 1. Create Cloudflare Tunnel (free, gives *.cfargotunnel.com URL)
    tunnel_id, _tunnel_secret = await _cf_create_tunnel(f"ziggy-{home_id[:12]}")
    cf_token   = await _cf_get_token(tunnel_id)
    tunnel_url = _cf_tunnel_url(tunnel_id)

    try:
        # 2. Create directory structure on VM
        await _ssh(f"mkdir -p {home_dir}/ha-config {home_dir}/mosquitto")

        # 3. Write config files
        compose = _compose_yaml(
            home_id, cf_token, relay_url or RELAY_URL,
            relay_secret, image, admin_email, admin_password, home_name,
        )
        # Patch the tunnel URL placeholder with the real one
        compose = compose.replace(_cf_tunnel_url("PLACEHOLDER"), tunnel_url)
        await _sftp_write(f"{home_dir}/docker-compose.yml", compose)
        await _sftp_write(f"{home_dir}/ha-config/configuration.yaml", _ha_config())
        await _sftp_write(f"{home_dir}/mosquitto/mosquitto.conf", _mosquitto_conf())

        # 4. Authenticate Docker with Fly registry if needed, then pull + start
        auth_cmd = ""
        if FLY_API_TOKEN and "registry.fly.io" in image:
            auth_cmd = f"docker login registry.fly.io -u x -p {FLY_API_TOKEN} 2>/dev/null && "

        await _ssh(
            f"{auth_cmd}"
            f"cd {home_dir} && "
            f"docker compose pull --quiet 2>&1 | tail -5 && "
            f"docker compose up -d"
        )

    except Exception as e:
        # Clean up CF tunnel on failure
        try:
            await _cf_delete_tunnel(tunnel_id)
        except Exception:
            pass
        raise RuntimeError(f"Provisioning failed: {e}")

    return ProvisionResult(
        home_id      = home_id,
        tunnel_url   = tunnel_url,
        tunnel_id    = tunnel_id,
        relay_secret = relay_secret,
        app_name     = home_id,
    )


async def deprovision_home(home_id: str, cf_tunnel_id: Optional[str] = None) -> None:
    """Stop containers and delete the home directory + CF tunnel."""
    home_dir = f"{HOMES_BASE_DIR}/{home_id}"
    if PROVISION_HOST:
        try:
            await _ssh(f"cd {home_dir} && docker compose down -v --remove-orphans 2>/dev/null; rm -rf {home_dir}")
        except Exception:
            pass
    if cf_tunnel_id and CF_API_TOKEN and not cf_tunnel_id.startswith("local-"):
        try:
            await _cf_delete_tunnel(cf_tunnel_id)
        except Exception:
            pass
