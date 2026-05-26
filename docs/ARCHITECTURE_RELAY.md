# Relay Architecture — v1

This is the canonical description of how the user app reaches the mini PC running Ziggy + Home Assistant in a typical deployment. The transport is **Cloudflare Tunnel per home, fronted by a Fly.io relay**. There is no WireGuard, no inbound NAT pinhole, no per-home DNS to manage.

## Topology

```
┌─────────────────────────────┐
│ User app (PWA / mobile)     │
└──────────────┬──────────────┘
               │  HTTPS + JWT (relay-issued)
               ▼
┌─────────────────────────────┐
│ Fly.io: ziggy-relay         │   single VM (ams region, 512 MB / 1 shared CPU)
│   FastAPI, port 8080        │   relay/app/
│   - /api/auth               │   aiosqlite: homes, users, invites on Fly volume
│   - /api/homes              │
│   - /api/invites            │
│   - /api/proxy/{home_id}/*  │   ← forwards user requests to that home's tunnel
└──────────────┬──────────────┘
               │  HTTPS to {tunnel_id}.cfargotunnel.com
               │  + X-Relay-Secret, X-Relay-User, X-Relay-Role, X-Relay-Home
               ▼
┌─────────────────────────────┐
│ Cloudflare edge             │   NAT traversal only — Cloudflare cannot
│   (Argo Tunnel network)     │   read tunnel contents (E2E encrypted
│                             │    between relay and cloudflared on the home)
└──────────────┬──────────────┘
               │  outbound tunnel maintained by cloudflared container
               ▼
┌─────────────────────────────────────────────────┐
│ Mini PC (hub) or Oracle ARM VM (cloud home)     │
│                                                 │
│   docker-compose:                               │
│   ┌─────────────┐  ┌──────────┐  ┌──────────┐  │
│   │ cloudflared │→ │ ziggy    │← │ home-    │  │
│   │             │  │ :8001    │  │ assistant│  │
│   │             │  │ FastAPI  │  │ :8123    │  │
│   └─────────────┘  └──────────┘  └──────────┘  │
│                         │                       │
│                         ▼                       │
│                    user_files/, ha-config/      │
└─────────────────────────────────────────────────┘
```

## Why this shape

| Choice | Reason |
|---|---|
| Cloudflare Tunnel | Free, gives each home a stable `*.cfargotunnel.com` URL with no DNS or domain ownership required. No port forwarding on the user's router. |
| Fly.io relay in front | Stable public URL for the user app (`ziggy-relay.fly.dev`). User JWT auth happens here, then traffic is proxied to the right home. Hides Cloudflare URLs from clients. |
| Per-home tunnel | Single shared tunnel would couple home isolation to relay correctness. Per-home isolates blast radius if a tunnel/secret is compromised. |
| `X-Relay-Secret` middleware | Relay → hub is server-to-server. The shared per-home secret authorizes the relay's bypass of normal user-token auth, lets the relay inject a synthetic user identity. |

## Onboarding flow — provisioning a new home

Implementation: [relay/app/provisioner.py:provision_home()](../relay/app/provisioner.py)

```
1. POST /api/provision/home  (relay admin)
        │
        ▼
2. relay generates relay_secret (32-byte hex)
        │
        ▼
3. Cloudflare API: create tunnel
   POST /accounts/{CF_ACCOUNT_ID}/cfd_tunnel
   → returns tunnel_id + tunnel_secret
        │
        ▼
4. Cloudflare API: fetch tunnel connector token
   GET /accounts/{CF_ACCOUNT_ID}/cfd_tunnel/{tunnel_id}/token
   → returns cf_token (embedded in cloudflared container as TUNNEL_TOKEN)
        │
        ▼
5. tunnel_url = https://{tunnel_id}.cfargotunnel.com
        │
        ▼
6. SSH into Oracle ARM VM (or, future, Hetzner CPX21):
   - mkdir /opt/ziggy-homes/{home_id}/
   - write docker-compose.yml (homeassistant + ziggy + cloudflared)
   - write ha-config/configuration.yaml
   - write mosquitto/mosquitto.conf
   - docker compose pull && docker compose up -d
        │
        ▼
7. Hub container boots:
   - reads RELAY_URL, RELAY_SECRET, TUNNEL_URL from env
   - 2 seconds after FastAPI startup, POSTs to relay /api/homes/register-hub
        │
        ▼
8. Relay updates homes table:
   tunnel_url, relay_secret, status='active'
        │
        ▼
9. User accepts invite → JWT minted → /api/proxy/{home_id}/* works.
```

The relay holds `(home_id → tunnel_url, relay_secret, status)`. Per-home state (devices, IR codes, automations, push subs) lives on the hub; the relay never sees it.

## Secret inventory

| Secret | Lives at | Used for |
|---|---|---|
| `home_id` + `relay_secret` | Hub `config/settings.yaml` `relay:` + relay `homes` row | Hub→relay auth on `/api/homes/register-hub`; relay→hub auth via `X-Relay-Secret` header |
| `tunnel_secret` | Cloudflare (held), `cloudflared` container env (`TUNNEL_TOKEN`) | cloudflared ↔ Cloudflare auth |
| `CF_API_TOKEN`, `CF_ACCOUNT_ID` | Fly secrets on relay | Provision/delete tunnels |
| `PROVISION_SSH_KEY` | Fly secrets on relay | SSH into provisioning VM |
| `FLY_API_TOKEN` | Fly secrets on relay (also `cloudflared` images pulled from Fly registry) | docker login on the provisioning VM |
| `JWT_SECRET` | Fly secrets on relay | Sign user JWTs (30-day expiry) |
| `INITIAL_ADMIN_EMAIL/PASSWORD` | Hub container env at provision time | Bootstrap super_admin on first boot |

**Rotation:** per-home secret rotation, JWT rotation, and Cloudflare token rotation are handled in [PROMPT_SECURITY_HARDENING.md](../../Downloads/ziggyfiles/PROMPT_SECURITY_HARDENING.md) (out of scope here). The relay's `POST /api/homes/register-hub` accepts a new `(tunnel_url, relay_secret)` pair on each call, which gives the rotation path room to operate.

## What the user app sees

- Login: `POST https://ziggy-relay.fly.dev/api/auth/login` → JWT
- Everything else: `https://ziggy-relay.fly.dev/api/proxy/{home_id}/*` with `Authorization: Bearer <jwt>`

The proxy adds `X-Relay-Secret`, `X-Relay-User`, `X-Relay-Role`, `X-Relay-Home` based on the validated JWT and looks up the home's `tunnel_url`. The hub's `RelayAuthMiddleware` ([backend/middleware/relay_auth.py](../backend/middleware/relay_auth.py)) trusts these headers when `X-Relay-Secret` matches the configured value and synthesizes a user identity for the rest of the request pipeline.

## What ships v1, what ships v1.1

| Capability | v1 | v1.1 plan |
|---|---|---|
| User remote access | ✅ Cloudflare Tunnel + Fly relay | unchanged |
| Per-home isolation | ✅ one tunnel + one relay_secret per home | unchanged |
| Provisioning host | Oracle Cloud Free Tier ARM VM | Hetzner CPX21 (see [RUNBOOK_HETZNER_MIGRATION.md](RUNBOOK_HETZNER_MIGRATION.md)) |
| Fly region | ams only (single VM) | + iad as warm failover when justified by paid-user count |
| Relay backups | manual | scheduled snapshot of relay `aiosqlite` DB |
| Cloudflare cert pinning | not enforced | TBD |

## Failure modes to know about

1. **Relay VM down** → users see proxy errors; hub keeps working locally for anyone on the LAN. PWA hits hub directly if `ziggy_local_url` is configured.
2. **Cloudflare Tunnel down** → relay can reach the home but tunnel proxy fails. The hub's `_register_with_relay()` will retry on next restart; manual: re-run provision or recreate tunnel.
3. **Provisioner SSH key out of sync** → new-home provisioning fails; existing homes unaffected.
4. **Relay loses `homes` row** → `/api/proxy/{home_id}/*` returns 404. Hub `_register_with_relay()` re-creates the row on next hub restart provided env vars are intact. No data loss.

## Code references

- Hub side: [backend/server.py:_register_with_relay()](../backend/server.py)
- Relay side: [relay/app/provisioner.py](../relay/app/provisioner.py), [relay/app/routers/](../relay/app/routers/)
- Per-home compose template: generated inline by [`_compose_yaml()`](../relay/app/provisioner.py)
- Hub middleware: [backend/middleware/relay_auth.py](../backend/middleware/relay_auth.py)
