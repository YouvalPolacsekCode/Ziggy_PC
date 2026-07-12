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

Optional (founder SSH support access — Linux mini-PC hubs):
  ZIGGY_SSH_INGRESS_ENABLED — "1"/"true"/"yes" (default OFF) to ALSO bind a
                       Cloudflare-Access-gated SSH ingress on the per-home
                       tunnel. SSH ingress is opt-in per home; the default
                       ("0") keeps the HTTP-only behaviour. Even when enabled,
                       the ingress is bound ONLY if a founder allow-list exists
                       (see ZIGGY_SUPPORT_ALLOWED_EMAILS) — it fails closed.
  ZIGGY_SSH_DOMAIN   — apex under which per-home SSH hostnames are minted.
                       Default: "ssh.ziggy-home.com". The resulting hostname
                       is `ssh-<home_id>.<ZIGGY_SSH_DOMAIN>`; it CNAMEs to the
                       home's Cloudflare Tunnel (same CF_ZONE_ID as the hub
                       hostname) and routes to ssh://localhost:22 on the mini
                       PC. support_session.py hands the founder the matching
                       `cloudflared access ssh --hostname ...` command.
  ZIGGY_SUPPORT_ALLOWED_EMAILS — comma-separated founder emails allowed by the
                       Cloudflare Access policy that gates the SSH hostname.
                       This is the ONLY auth gate on the SSH proxy, so it is
                       mandatory: if it is empty the SSH ingress + DNS route are
                       NOT bound at all (fail-closed — no ungated SSH is ever
                       created) and a warning is logged. Never hard-code founder
                       identities; supply them via this env.
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
# Founder SSH support access (Linux mini-PC hubs)
# ---------------------------------------------------------------------------
#
# The per-home tunnel already carries HTTP (localhost:8001). We ALSO bind an
# SSH ingress on the same tunnel so the founder can reach the mini PC's sshd
# (localhost:22) through Cloudflare Access — no inbound port, no VPN. The host
# side is provisioned by scripts/linux/ziggy-support-access.sh, which enables a
# locked-down `ziggy-support` login only for the duration of a session.

# Read env at call time (not import) so tests + operators can flip without a
# module reload, mirroring _dry_run().
SSH_LOCAL_SERVICE = "ssh://localhost:22"
HTTP_LOCAL_SERVICE = "http://localhost:8001"


def _ssh_ingress_enabled() -> bool:
    # Default OFF: SSH ingress is opt-in per home. A forgotten env must never
    # silently stand up a remote-support SSH proxy.
    return os.getenv("ZIGGY_SSH_INGRESS_ENABLED", "0").strip().lower() in ("1", "true", "yes")


def _ssh_domain() -> str:
    return os.getenv("ZIGGY_SSH_DOMAIN", "ssh.ziggy-home.com")


def ssh_hostname_for(home_id: str) -> str:
    """Per-home Cloudflare Access SSH hostname: `ssh-<home_id>.<ZIGGY_SSH_DOMAIN>`.

    Single source of truth shared with routers/support_session.py so the
    hostname the tunnel is bound to and the hostname in the founder's
    `cloudflared access ssh` command can never drift.
    """
    return f"ssh-{home_id}.{_ssh_domain()}"


def _support_allowed_emails() -> list[str]:
    raw = os.getenv("ZIGGY_SUPPORT_ALLOWED_EMAILS", "")
    return [e.strip() for e in raw.split(",") if e.strip()]


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


def _build_ingress(service_url: str, ssh_hostname: Optional[str] = None) -> list[dict]:
    """Build the ordered Cloudflare tunnel ingress rule list.

    Cloudflare evaluates ingress rules top-to-bottom and REQUIRES the final
    rule to be a catch-all (no hostname). When an SSH hostname is supplied we
    prepend a hostname-scoped rule routing it to the local sshd, then keep the
    HTTP catch-all so every other request still lands on Ziggy. Pure function
    so the exact shape is unit-testable without any CF call.
    """
    ingress: list[dict] = []
    if ssh_hostname:
        ingress.append({"hostname": ssh_hostname, "service": SSH_LOCAL_SERVICE})
    ingress.append({"service": service_url})
    return ingress


async def _cf_put_ingress(tunnel_id: str, ingress: list[dict]) -> None:
    """PUT an ingress rule list to the tunnel's server-side config."""
    if _dry_run():
        logger.info(
            "[dry-run] PUT cfd_tunnel/%s/configurations ingress=%s", tunnel_id, ingress
        )
        return
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.put(
            f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/cfd_tunnel/{tunnel_id}/configurations",
            headers={"Authorization": f"Bearer {CF_API_TOKEN}"},
            json={"config": {"ingress": ingress}},
        )
        r.raise_for_status()


async def _cf_set_tunnel_config(tunnel_id: str, service_url: str) -> None:
    """Set the tunnel's HTTP-only ingress (config_src='cloudflare' tunnels).

    A single catch-all rule (service → localhost:8001) is enough: any hostname
    routed into this tunnel (including the per-home public hostname created by
    _cf_upsert_dns_route) lands on the local Ziggy service. Signature is kept
    2-arg for backward compatibility; the additive SSH ingress rule is layered
    on afterwards by _cf_bind_ssh_ingress so this stays the HTTP guarantee.
    """
    await _cf_put_ingress(tunnel_id, _build_ingress(service_url))


async def _cf_bind_ssh_ingress(
    tunnel_id: str, ssh_hostname: str, service_url: str = HTTP_LOCAL_SERVICE
) -> None:
    """Re-assert the tunnel ingress as [SSH hostname → sshd, HTTP catch-all].

    Runs AFTER _cf_set_tunnel_config so the HTTP catch-all is already the
    guaranteed baseline; this adds the founder SSH rule additively. Skipped
    (no network) when CF_ZONE_ID is unset, because without an owned zone the
    ssh hostname CNAME can't exist, so binding the rule would be inert anyway —
    and the HTTP-only config set moments earlier already keeps the hub live.
    """
    ingress = _build_ingress(service_url, ssh_hostname)
    if _dry_run():
        logger.info(
            "[dry-run] PUT cfd_tunnel/%s/configurations ingress=%s (ssh)", tunnel_id, ingress
        )
        return
    if not CF_ZONE_ID:
        logger.warning(
            "CF_ZONE_ID unset — not binding SSH ingress for %s (HTTP config kept).",
            ssh_hostname,
        )
        return
    await _cf_put_ingress(tunnel_id, ingress)


def _cf_tunnel_url(tunnel_id: str) -> str:
    return f"https://{tunnel_id}.cfargotunnel.com"


async def _cf_upsert_cname(hostname: str, tunnel_id: str) -> str:
    """Create/update a proxied CNAME  <hostname> → <tunnel_id>.cfargotunnel.com.

    Idempotent: if a record for the hostname already exists it is updated
    rather than duplicated, so re-provisioning the same home_id is safe.
    Returns the hostname. If CF_ZONE_ID is unset (or dry-run), the intended
    call is logged and no HTTP request is made.
    """
    target = f"{tunnel_id}.cfargotunnel.com"

    if _dry_run():
        logger.info(
            "[dry-run] DNS upsert CNAME %s -> %s (zone=%s, proxied=true)",
            hostname, target, CF_ZONE_ID or "<unset>",
        )
        return hostname

    if not CF_ZONE_ID:
        logger.warning(
            "CF_ZONE_ID unset — skipping DNS route for %s. Not publicly "
            "reachable until a CNAME %s -> %s (proxied) exists.",
            hostname, hostname, target,
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


async def _cf_upsert_dns_route(home_id: str, tunnel_id: str) -> str:
    """Per-home HTTP hostname CNAME → the tunnel (the relay-reachable URL)."""
    return await _cf_upsert_cname(_hub_public_hostname(home_id), tunnel_id)


async def _cf_upsert_ssh_dns_route(home_id: str, tunnel_id: str) -> str:
    """Per-home SSH hostname CNAME → the tunnel (founder support access)."""
    return await _cf_upsert_cname(ssh_hostname_for(home_id), tunnel_id)


async def _cf_delete_cname(hostname: str) -> None:
    """Delete a CNAME by name. Idempotent; best-effort."""
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


async def _cf_delete_dns_route(home_id: str) -> None:
    """Delete the per-home HTTP public hostname CNAME. Idempotent; best-effort."""
    await _cf_delete_cname(_hub_public_hostname(home_id))


async def _cf_delete_ssh_dns_route(home_id: str) -> None:
    """Delete the per-home SSH hostname CNAME. Idempotent; best-effort."""
    await _cf_delete_cname(ssh_hostname_for(home_id))


# ---------------------------------------------------------------------------
# Cloudflare Access application gating the SSH hostname
# ---------------------------------------------------------------------------

async def _cf_upsert_access_app(ssh_hostname: str) -> None:
    """Create/update a self-hosted Cloudflare Access application on the SSH
    hostname, restricted to the founder email allow-list.

    Without this the SSH hostname would be reachable by anyone who can resolve
    it — Access is the auth gate the `cloudflared access ssh` client satisfies
    interactively. Idempotent (matches an existing app by domain). RAISES on a
    CF failure so the caller can withhold the public DNS route until the gate
    exists (fail-closed): a route with no Access app would be ungated SSH.

    The caller (_provision_ssh_ingress) refuses to bind any ingress when the
    allow-list is empty, so this normally receives a non-empty list. The empty
    guard here is retained as defense-in-depth: it never creates an ungated app.
    """
    emails = _support_allowed_emails()

    if _dry_run():
        logger.info(
            "[dry-run] Access app upsert domain=%s allow_emails=%s",
            ssh_hostname, emails or "<unset>",
        )
        return

    if not emails:
        # Defense-in-depth: the caller already fails closed on an empty
        # allow-list. Never publish an ungated app; signal so no route follows.
        raise RuntimeError(
            f"refusing to create ungated Access app for {ssh_hostname}: "
            "ZIGGY_SUPPORT_ALLOWED_EMAILS is empty"
        )

    headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}
    base = f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/access/apps"
    app_payload = {
        "name": f"ziggy-support {ssh_hostname}",
        "domain": ssh_hostname,
        "type": "self_hosted",
        "session_duration": "1h",
    }
    policy_payload = {
        "name": "founder-support",
        "decision": "allow",
        "include": [{"email": {"email": e}} for e in emails],
    }
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.get(base, headers=headers)
        r.raise_for_status()
        existing = [a for a in (r.json().get("result", []) or [])
                    if a.get("domain") == ssh_hostname]
        if existing:
            app_id = existing[0]["id"]
            r2 = await c.put(f"{base}/{app_id}", headers=headers, json=app_payload)
        else:
            r2 = await c.post(base, headers=headers, json=app_payload)
        r2.raise_for_status()
        app_id = r2.json()["result"]["id"]
        # Reconcile policies so the current allow-list is AUTHORITATIVE. A plain
        # POST would only *add* an allow policy, so removing an email and
        # re-provisioning would leave the removed person still authorized. List
        # every existing policy on the app and delete it, then create the single
        # fresh allow policy for exactly the current emails.
        rlist = await c.get(f"{base}/{app_id}/policies", headers=headers)
        rlist.raise_for_status()
        for pol in (rlist.json().get("result", []) or []):
            pol_id = pol.get("id")
            if pol_id:
                await c.delete(f"{base}/{app_id}/policies/{pol_id}", headers=headers)
        rp = await c.post(f"{base}/{app_id}/policies", headers=headers, json=policy_payload)
        rp.raise_for_status()
    logger.info("Access app ready: %s (allow %d founder email(s))", ssh_hostname, len(emails))


async def _cf_delete_access_app(ssh_hostname: str) -> None:
    """Delete the Access application gating the SSH hostname. Best-effort."""
    if _dry_run() or not CF_API_TOKEN:
        logger.info("[dry-run/skip] Access app delete domain=%s", ssh_hostname)
        return
    headers = {"Authorization": f"Bearer {CF_API_TOKEN}"}
    base = f"{CF_BASE}/accounts/{CF_ACCOUNT_ID}/access/apps"
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.get(base, headers=headers)
            r.raise_for_status()
            for a in (r.json().get("result", []) or []):
                if a.get("domain") == ssh_hostname:
                    await c.delete(f"{base}/{a['id']}", headers=headers)
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
    ssh_hostname:  str = ""


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

    # Founder SSH support ingress (additive). Computed up-front so the SSH
    # hostname can be baked into the tunnel ingress rule alongside the HTTP
    # catch-all. Empty string when disabled → _build_ingress falls back to the
    # exact pre-existing HTTP-only config, so nothing changes for HTTP-only
    # deployments.
    ssh_host = ssh_hostname_for(home_id) if _ssh_ingress_enabled() else ""

    if existing_tunnel_id:
        # Idempotent re-provision — reuse the tunnel + secret.
        tunnel_id    = existing_tunnel_id
        relay_secret = existing_relay_secret or secrets.token_hex(32)
        tunnel_token = await _cf_get_token(tunnel_id)
        try:
            await _cf_set_tunnel_config(tunnel_id, HTTP_LOCAL_SERVICE)
        except Exception:
            # Non-fatal on re-provision: the config may already be correct and
            # a transient CF hiccup shouldn't fail an otherwise-live home.
            logger.warning("re-provision: set_tunnel_config failed for %s (continuing)", tunnel_id)
        await _cf_upsert_dns_route(home_id, tunnel_id)
        await _provision_ssh_ingress(home_id, tunnel_id, ssh_host)
    else:
        relay_secret = secrets.token_hex(32)
        tunnel_id, _ = await _cf_create_tunnel(f"ziggy-{home_id[:12]}")
        try:
            tunnel_token = await _cf_get_token(tunnel_id)
            # Point the tunnel at Ziggy on the mini PC. cloudflared runs locally
            # on the mini PC alongside Ziggy, so localhost:8001 is the ingress
            # target. Without this call the tunnel exists but returns CF's default
            # 404 for every request.
            await _cf_set_tunnel_config(tunnel_id, HTTP_LOCAL_SERVICE)
            # Create the per-home public hostname so the relay can actually
            # reach the hub (bare cfargotunnel.com is not publicly routable).
            await _cf_upsert_dns_route(home_id, tunnel_id)
        except Exception as e:
            try:
                await _cf_delete_tunnel(tunnel_id)
            except Exception:
                pass
            raise RuntimeError(f"Cloudflare tunnel setup failed: {e}")
        # SSH ingress is best-effort AFTER the tunnel is live — a CF Access
        # hiccup must not roll back an otherwise-working home.
        await _provision_ssh_ingress(home_id, tunnel_id, ssh_host)

    return HubProvisionResult(
        home_id       = home_id,
        home_name     = home_name,
        relay_url     = relay_url or RELAY_URL,
        relay_secret  = relay_secret,
        tunnel_id     = tunnel_id,
        tunnel_url    = _cf_tunnel_url(tunnel_id),
        tunnel_token  = tunnel_token,
        reachable_url = _reachable_url(home_id),
        ssh_hostname  = ssh_host,
    )


async def _provision_ssh_ingress(home_id: str, tunnel_id: str, ssh_host: str) -> None:
    """Create the Access gate + SSH ingress/DNS route for the SSH hostname.

    Fail-closed. Two invariants:

      1. No allow-list → no SSH at all. ZIGGY_SUPPORT_ALLOWED_EMAILS is the ONLY
         auth gate on the SSH proxy, so if it is empty we log a clear warning and
         RETURN before binding any ingress or publishing any DNS. A forgotten
         allow-list must never yield a world-reachable, ungated SSH proxy to the
         hub's sshd.
      2. Gate before route. The Cloudflare Access app is created/verified FIRST;
         only if it succeeds do we bind the tunnel ingress rule and publish the
         public DNS CNAME that makes the hostname resolvable. If the Access app
         can't be created, no route is published, so the hostname never resolves.

    No-op when the SSH hostname is empty (feature disabled). Bind/route failures
    after the gate exists are logged and swallowed so a transient CF hiccup never
    fails an otherwise-live home.
    """
    if not ssh_host:
        return

    if not _support_allowed_emails():
        logger.warning(
            "ZIGGY_SUPPORT_ALLOWED_EMAILS empty — refusing to bind SSH ingress/DNS "
            "for %s. No ungated SSH proxy created (set the allow-list to enable "
            "support access).",
            home_id,
        )
        return

    try:
        # Gate FIRST — raises if the Access app can't be created, so no route
        # is published (fail-closed: never an ungated public SSH hostname).
        await _cf_upsert_access_app(ssh_host)
        await _cf_bind_ssh_ingress(tunnel_id, ssh_host)
        await _cf_upsert_ssh_dns_route(home_id, tunnel_id)
    except Exception:
        logger.warning("SSH support ingress setup failed for %s (continuing)", home_id)


async def deprovision_hub(cf_tunnel_id: Optional[str], home_id: Optional[str] = None) -> None:
    """Delete the home's Cloudflare Tunnel + DNS routes + Access app. Idempotent;
    caller drops the DB row."""
    if home_id:
        await _cf_delete_dns_route(home_id)
        # Tear down the founder SSH support ingress alongside the HTTP route.
        await _cf_delete_ssh_dns_route(home_id)
        await _cf_delete_access_app(ssh_hostname_for(home_id))
    if cf_tunnel_id and CF_API_TOKEN and not cf_tunnel_id.startswith("local-"):
        try:
            await _cf_delete_tunnel(cf_tunnel_id)
        except Exception:
            pass
