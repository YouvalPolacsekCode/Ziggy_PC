# Hetzner Migration Runbook

**Status:** Plan only. Do not execute until trigger condition fires.

**Trigger:** Execute migration when **(a) 4+ paid cloud-mode customers exist OR (b) Oracle issues any account warning, whichever comes first.**

**Locked decision context:** see [DECISIONS.md](../../Downloads/ziggyfiles/DECISIONS.md) 2026-05-25 entry. Architecture context: [ARCHITECTURE_RELAY.md](ARCHITECTURE_RELAY.md).

---

## What we're migrating

Today, all per-home cloud stacks run on a single Oracle Cloud Always Free ARM VM (4 OCPU / 24 GB RAM). Each home is one `docker-compose` stack with three containers:

| Container | Image | Footprint (steady state) |
|---|---|---|
| `homeassistant` | `ghcr.io/home-assistant/home-assistant:stable` | ~1.5 GB image, 300–600 MB RAM, recorder DB grows with events |
| `ziggy` | `registry.fly.io/ziggy-relay:ziggy-app` | ~0.5–1 GB image, 200–400 MB RAM |
| `cloudflared` | `cloudflare/cloudflared:latest` | ~50 MB image, ~20 MB RAM |

Volumes: `ha-config/` (host mount), `mosquitto/` (host mount), `ziggy_data` (named volume — backs `user_files/`).

Per-home cloud state to preserve in migration: `ha-config/` recorder DB + automations + secrets + scripts, the `ziggy_data` volume contents.

## Target: Hetzner CPX21, one home per VM

| | Oracle ARM Free | Hetzner CPX21 |
|---|---|---|
| vCPU | 4 OCPU (ARM, shared) | 3 AMD (shared) |
| RAM | 24 GB total (one VM, all homes) | 4 GB per VM |
| SSD | 200 GB total | 80 GB per VM |
| Price | $0 | ~€8.46 / month / home |
| Failure isolation | All homes share a VM | One VM per home |

**Why CPX21 over CX22:** CX22 has 4 GB RAM but only 2 Intel vCPUs and 40 GB SSD. HA's recorder + Ziggy's pattern engine + cloudflared peak around 1.2–1.6 GB RSS together, and HA does CPU-bursty work during automation evaluation. CPX21's 3 AMD vCPUs give headroom; 80 GB SSD covers HA recorder growth.

**Why one home per VM:** isolates blast radius. CPX31 (4 vCPU / 8 GB / 160 GB, ~€15) could fit 2–3 homes, but then one home's runaway pattern detector starves the others. At paid-customer scale we want the bill per home to be predictable, not the operational complexity.

## Cost projection

| Paid customers | Monthly cost |
|---|---|
| 5 (trigger) | €42.30 |
| 10 | €84.60 |
| 25 | €211.50 |
| 50 | €423.00 |

Plus existing relay (Fly.io, $0–5/mo) and Cloudflare (free).

## Prerequisites

- [ ] Hetzner Cloud project created
- [ ] Hetzner API token (Read+Write) stored as Fly secret `HETZNER_API_TOKEN`
- [ ] `hcloud` CLI installed locally (operator workstation): `brew install hcloud`
- [ ] SSH key uploaded to Hetzner project: `hcloud ssh-key create --name ziggy-provisioner --public-key-from-file ~/.ssh/ziggy_provisioner.pub`
- [ ] Default location chosen: `fsn1` (Falkenstein, Germany) or `hel1` (Helsinki, Finland) — closer to Israeli customer base than Oracle ARM's region
- [ ] Server type `cpx21` and image `docker-ce` confirmed available in chosen location
- [ ] Decision: parallel cutover (both VMs running, DNS-style flip via tunnel reissue) — see "Cutover" below

## Provisioning a new Hetzner home

Save as `scripts/provision_hetzner_home.sh` in the relay repo at execution time. Shell, minimal new deps. Mirrors the shape of [relay/app/provisioner.py](../relay/app/provisioner.py) so operators can run it by hand and the relay code can later wrap it.

```bash
#!/usr/bin/env bash
set -euo pipefail

# provision_hetzner_home.sh
# Required env vars:
#   HOME_ID           e.g. home-userfoo-primary
#   HOME_NAME         human label
#   HETZNER_API_TOKEN (export before running)
#   CF_API_TOKEN      (export before running)
#   CF_ACCOUNT_ID
#   RELAY_URL         e.g. https://ziggy-relay.fly.dev
#   ZIGGY_IMAGE       e.g. registry.fly.io/ziggy-relay:ziggy-app
#   FLY_API_TOKEN     for docker login if ZIGGY_IMAGE on Fly registry
#   ADMIN_EMAIL, ADMIN_PASSWORD  initial superadmin bootstrap

LOCATION="${HETZNER_LOCATION:-fsn1}"
SERVER_TYPE="${HETZNER_SERVER_TYPE:-cpx21}"
IMAGE="${HETZNER_IMAGE:-docker-ce}"
SSH_KEY_NAME="${HETZNER_SSH_KEY:-ziggy-provisioner}"

HOME_DIR="/opt/ziggy-homes/${HOME_ID}"
RELAY_SECRET="$(openssl rand -hex 32)"

# 1. Create Hetzner VM
hcloud server create \
  --name "ziggy-${HOME_ID}" \
  --type "${SERVER_TYPE}" \
  --image "${IMAGE}" \
  --location "${LOCATION}" \
  --ssh-key "${SSH_KEY_NAME}" \
  --label "home_id=${HOME_ID}" \
  --label "managed_by=ziggy-relay"

# wait for SSH to come up
SERVER_IP="$(hcloud server ip "ziggy-${HOME_ID}")"
until ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 \
  "root@${SERVER_IP}" "true" 2>/dev/null; do
  sleep 5
done

# 2. Create Cloudflare Tunnel (same as Oracle path)
TUNNEL_JSON="$(curl -fsS -X POST \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"ziggy-${HOME_ID:0:12}\",\"tunnel_secret\":\"$(openssl rand -hex 32)\",\"config_src\":\"cloudflare\"}" \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel")"
TUNNEL_ID="$(echo "${TUNNEL_JSON}" | jq -r .result.id)"
CF_TOKEN="$(curl -fsS \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/token" \
  | jq -r .result)"
TUNNEL_URL="https://${TUNNEL_ID}.cfargotunnel.com"

# 3. Lay down config on the VM
ssh "root@${SERVER_IP}" "mkdir -p ${HOME_DIR}/ha-config ${HOME_DIR}/mosquitto"

cat <<EOF | ssh "root@${SERVER_IP}" "cat > ${HOME_DIR}/docker-compose.yml"
version: "3.9"
services:
  homeassistant:
    image: ghcr.io/home-assistant/home-assistant:stable
    restart: unless-stopped
    privileged: true
    volumes:
      - ./ha-config:/config
    environment:
      - TZ=UTC

  ziggy:
    image: ${ZIGGY_IMAGE}
    restart: unless-stopped
    depends_on:
      - homeassistant
    environment:
      - CLOUD_MODE=true
      - HOME_ID=${HOME_ID}
      - HOME_NAME=${HOME_NAME}
      - HOME_TYPE=cloud
      - RELAY_URL=${RELAY_URL}
      - RELAY_SECRET=${RELAY_SECRET}
      - TUNNEL_URL=${TUNNEL_URL}
      - HA_URL=http://homeassistant:8123
      - INITIAL_ADMIN_EMAIL=${ADMIN_EMAIL}
      - INITIAL_ADMIN_PASSWORD=${ADMIN_PASSWORD}
      - ZIGGY_CONFIG_PATH=/app/user_files/settings.yaml
    volumes:
      - ziggy_data:/app/user_files

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    depends_on:
      - ziggy
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CF_TOKEN}

volumes:
  ziggy_data:
EOF

cat <<'EOF' | ssh "root@${SERVER_IP}" "cat > ${HOME_DIR}/ha-config/configuration.yaml"
homeassistant:
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
EOF

# 4. Pull + start
if [[ -n "${FLY_API_TOKEN:-}" && "${ZIGGY_IMAGE}" == registry.fly.io/* ]]; then
  ssh "root@${SERVER_IP}" "docker login registry.fly.io -u x -p ${FLY_API_TOKEN} >/dev/null 2>&1"
fi
ssh "root@${SERVER_IP}" "cd ${HOME_DIR} && docker compose pull --quiet && docker compose up -d"

# 5. Print outputs for the operator to log into the relay
cat <<EOF
PROVISIONED ${HOME_ID}
  server_ip:    ${SERVER_IP}
  tunnel_id:    ${TUNNEL_ID}
  tunnel_url:   ${TUNNEL_URL}
  relay_secret: ${RELAY_SECRET}
EOF
```

## Cutover for an existing Oracle home

For each existing home, in a maintenance window the user agrees to (no slot >10 min per home):

```
1.  Stop traffic to the Oracle home (relay admin sets status='suspended')
2.  On Oracle:
      cd /opt/ziggy-homes/${HOME_ID}
      docker compose stop                    # don't down -v; keep volume
      docker run --rm -v ${HOME_DIR}:/src -v $(pwd):/dest alpine \
        tar czf /dest/${HOME_ID}_ha.tgz /src/ha-config
      docker run --rm -v ziggy_${HOME_ID}_data:/src -v $(pwd):/dest alpine \
        tar czf /dest/${HOME_ID}_ziggy.tgz /src
3.  scp the two .tgz files from Oracle to operator workstation
4.  Run provision_hetzner_home.sh for this home_id (above)
      → outputs new tunnel_url, new relay_secret
5.  Before starting Hetzner stack, push the snapshots in:
      scp ${HOME_ID}_*.tgz root@${HETZNER_IP}:/opt/ziggy-homes/${HOME_ID}/
      ssh root@${HETZNER_IP} "cd /opt/ziggy-homes/${HOME_ID} && \
        tar xzf ${HOME_ID}_ha.tgz && \
        docker volume create ziggy_${HOME_ID}_data && \
        docker run --rm -v ziggy_${HOME_ID}_data:/dest -v $(pwd):/src alpine \
          tar xzf /src/${HOME_ID}_ziggy.tgz -C /dest --strip-components=1"
6.  docker compose up -d on the Hetzner VM
7.  Wait for hub to POST /api/homes/register-hub to the relay
     (it does this 2s after FastAPI startup with the NEW tunnel_url
      and NEW relay_secret — the relay's homes row gets updated atomically)
8.  Relay admin: status='active' on the home; verify /api/proxy round-trip
9.  User app starts working again (no app-side change — they hit the relay,
    relay routes to the new tunnel_url)
10. Smoke test (5 min):
      - dashboard loads
      - one device toggle works
      - one voice command resolves
      - push notification arrives
11. Wait 24h. Oracle stack stays stopped but data intact (rollback window).
12. After 24h with no regressions: on Oracle, `docker compose down -v` + rm -rf the home_dir.
13. After all homes migrated and 7 days have passed: terminate Oracle VM.
```

## Downtime per home

- Snapshot + scp: 1–3 min (depends on `ha-config/` size; recorder DB usually 50–500 MB).
- Provision new VM: 60–90 s.
- Restore + start: 2–4 min.
- Cloudflare DNS-style flip: 0 — user app hits relay, relay reads new `tunnel_url` from `homes` table immediately after hub re-registers.

**Total: 5–10 minutes per home in the typical case.** Worst case (5+ GB recorder DB): 30 min.

## Rollback plan

The Oracle stack is `stop`'d, not `down -v`'d, until step 12. To roll back any home in the first 24 h:

```
1. Relay admin: status='suspended' on the home (stops user traffic to Hetzner)
2. On Oracle: cd ${HOME_DIR} && docker compose start
3. Hub re-registers with relay using the OLD tunnel_url + OLD relay_secret
4. Relay admin: status='active'
5. Optionally: stop the Hetzner stack and delete the VM.
```

The 24-h window is non-negotiable for paying customers. Mark it on the maintenance calendar before starting the migration.

## Open questions to resolve before execution

1. **Backups during the cutover window.** Today there's no automated backup. The snapshot approach above is per-cutover. Before migrating, confirm a backup pipeline exists or accept that mistakes mean rebuilding HA-config by hand.
2. **HA `recorder` DB size cap.** Default retention is `purge_keep_days: 10`. If any paying customer has tweaked this, their `ha-config` snapshot could be >5 GB and blow the 80 GB disk budget. Audit `recorder:` config in each home before migration.
3. **Per-home billing accounting.** With one VM per home, Hetzner invoices itemize by server name. Plan to label servers `home_id=...` (the script does) so finance can map line items to homes.
4. **DNS / cert pinning.** Tunnels reissue freely (URL changes on cutover), so customers using the relay-proxied path see no change. Only customers with hardcoded direct-tunnel access (none today) would notice. Verify before execution.
5. **Relay code changes.** None required for v1 of this migration. Long term, fold `provision_hetzner_home.sh` into a `relay/app/provisioner_hetzner.py` parallel to the Oracle provisioner, switchable per home via a `provider` column on the `homes` table.

## Related runbooks / cross-refs

- Architecture: [ARCHITECTURE_RELAY.md](ARCHITECTURE_RELAY.md)
- Voice runbook: [RUNBOOK_VOICE.md](RUNBOOK_VOICE.md)
- Secret rotation: PROMPT_SECURITY_HARDENING.md (in ZigguInstructions; out of scope here)
- Locked decision: [DECISIONS.md](../../Downloads/ziggyfiles/DECISIONS.md) 2026-05-25 entry
