# Runbook — Remote hub operations (support SSH + hotfix deploy)

How to reach a **deployed beta hub** (a customer mini PC, e.g. David's) from the
founder's Mac and push a code fix to it — with **no trip to the customer's home**.
Everything here works because each hub holds an outbound Cloudflare Tunnel and a
git checkout at `/opt/ziggy`; nothing needs an inbound port or a site visit.

> Written 2026-07-28 after wiring the support-tunnel foundation. If a step here
> stops matching reality, fix the doc in the same PR as the code.

---

## 0. One-time foundation (already done — for reference)

Relay secrets that make remote SSH + remote app work (set once on `ziggy-relay`):

| Secret | Value / meaning |
|--------|-----------------|
| `CF_ZONE_ID` | zone id of `ziggy-home.com` |
| `CF_API_TOKEN` | scopes: Zone→DNS→Edit, Account→Cloudflare Tunnel→Edit, Account→Access: Apps and Policies→Edit |
| `CF_HUB_DOMAIN` | `ziggy-home.com` (flattened to APEX — see cert note) |
| `ZIGGY_SSH_DOMAIN` | `ziggy-home.com` (flattened) |
| `ZIGGY_SSH_INGRESS_ENABLED` | `1` |
| `ZIGGY_SUPPORT_ALLOWED_EMAILS` | `silentyouval@gmail.com,youvalpolacsek@gmail.com` |

**Cert note (why the hostnames are flat):** Cloudflare's FREE universal cert
covers `ziggy-home.com` + `*.ziggy-home.com` — ONE level only. The original
`<id>.hubs.ziggy-home.com` / `ssh-<id>.ssh.ziggy-home.com` were TWO levels deep,
so the edge had no cert → TLS handshake failure. Total TLS needs paid ACM
($10/mo), so we flattened to `<id>.ziggy-home.com` / `ssh-<id>.ziggy-home.com`,
which the free wildcard already covers. Re-provision after changing these.

**Cloudflare Access:** Zero Trust team `withered-lake-3d80`. One-time PIN was NOT
enabled, so login uses "Login with Cloudflare" against the allow-list — that's
why `youvalpolacsek@gmail.com` (the CF-account email) is on the list. Add OTP as
a login method later if a non-CF-account founder email is ever needed.

Re-provision a hub (idempotent — reuses tunnel, refreshes DNS + Access policy):
```bash
JWT=$(curl -s -X POST https://ziggy-relay.fly.dev/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$(grep ^RELAY_ADMIN_EMAIL= ~/.ziggy/david-secrets.txt|cut -d= -f2-)\",\"password\":\"$(grep ^RELAY_ADMIN_PASSWORD= ~/.ziggy/david-secrets.txt|cut -d= -f2-)\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -X POST https://ziggy-relay.fly.dev/api/provision/hub -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"home_id":"<HOME_ID>","home_name":"<Name>","owner_email":"<owner>"}'
```

---

## 1. Get an Access session (once per ~24 h per Mac)

```bash
~/.cloudflared/bin/cloudflared access login https://ssh-<HOME_ID>.ziggy-home.com
# browser opens → "Login with Cloudflare" → done. Token cached ~24h.
```
`cloudflared` binary lives at `~/.cloudflared/bin/` (NOT on PATH).

### DNS gotcha (this bites every time)
The macOS resolver **negative-caches** the hub hostname (from before it existed).
Symptom: `cloudflared ... no such host`, while `dig +short <host> @1.1.1.1` works.
Fix:
```bash
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

---

## 2. Run a command on the hub (non-interactive)

```bash
CF=~/.cloudflared/bin/cloudflared
SSH=ssh-<HOME_ID>.ziggy-home.com
ssh -o ProxyCommand="$CF access ssh --hostname %h" -o StrictHostKeyChecking=accept-new \
    -o BatchMode=yes -i ~/.ssh/id_ed25519 ziggy@"$SSH" '<command>'
```
- User `ziggy`, passwordless sudo. Youval's `~/.ssh/id_ed25519` is already in the
  box's authorized_keys.
- Filter cloudflared's stderr noise: append ` 2>&1 | grep -vE '^[0-9]{4}-.*(INF|WRN|DBG)'`.
- **Heredocs do NOT survive ssh→docker→sh.** Base64-encode multi-line scripts:
  `echo <b64> | base64 -d | sudo docker exec -i ziggy-ziggy-1 python3 -`.

Read live state without SSH (founder relay proxy — no customer password needed):
```bash
curl -s -H "Authorization: Bearer $JWT" https://ziggy-relay.fly.dev/api/proxy/<HOME_ID>/api/devices/grouped
```

---

## 3. Deploy a code fix (hotfix) to a live hub

> ## ⛔ OBSOLETE AND FORBIDDEN — DO NOT FOLLOW THIS SECTION
>
> Everything below describes hand-pushing code onto a hub. **That practice is
> now banned** (see the Release rules at the top of `CLAUDE.md`). On 2026-08-10
> it left one customer hub 105 uncommitted files off its tag — which *blocks*
> the updater, so that home could no longer receive fixes at all — and a second
> hub running a commit that existed nowhere in the repository. Both had to be
> rescued by hand.
>
> It is also factually wrong now: hubs do **not** track
> `feat/beta-image-readiness`, and `main` is not "stale by design" — `main` is
> exactly what ships.
>
> **The only way code reaches a home:**
> ```bash
> ./scripts/ship.sh -m "…"      # cuts a release-* tag on main
> ```
> Each hub's `ziggy-update.timer` pulls it within ~2 minutes. Verify with
> `./scripts/fleet-health.py` (allow ~5 min — hubs deploy on a 2 min timer but
> report on a 5 min one).
>
> Kept only so the old commands are recognisable if you find them in a shell
> history or an older runbook.

**Model (obsolete):** each hub is a git checkout at `/opt/ziggy` tracking a branch
(beta hubs → `feat/beta-image-readiness`; NOT `main`, which is stale by design).
The ziggy container is **built on the box** (`docker compose up -d --build ziggy`),
so a fix reaches the hub by: land on the tracked branch → pull on the box →
rebuild → restart.

> `scripts/update.sh` exists but is hardwired to `origin/main`, so it does NOT
> work for beta hubs. Use the branch-aware steps below (they keep its one
> essential trick: exporting a fresh `GIT_SHA`).

### 3a. Land the fix on the tracked branch (on the Mac)
```bash
# commit on your working branch, then put it on the hub's branch:
git checkout feat/beta-image-readiness
git cherry-pick <sha>
git push origin feat/beta-image-readiness
```

### 3b. Pull + rebuild on the hub (over SSH)
The hub's compose set is `docker-compose.yml` + `docker-compose.prod.yml`, plus
`docker-compose.zigbee-net.yml` for Zigbee kits. **You MUST export a fresh
`GIT_SHA`** or BuildKit reuses a cached, STALE `frontend/dist` and ships old UI
while `/api/version` reports the new sha.
```bash
cd /opt/ziggy
git fetch origin feat/beta-image-readiness
git reset --hard origin/feat/beta-image-readiness     # tree must be clean
export GIT_SHA="$(git rev-parse --short HEAD)"
sudo -E docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.zigbee-net.yml \
  up -d --build ziggy
```
(`sudo -E` preserves `GIT_SHA`. Drop `-f docker-compose.zigbee-net.yml` on a
non-Zigbee kit. Confirm the active set with `docker compose ls` /
`sudo docker inspect ziggy-ziggy-1` if unsure.)

### 3c. Verify the deploy actually shipped
```bash
# the git sha the running container reports MUST equal what you pushed:
curl -s https://<HOME_ID>.ziggy-home.com/api/version
# or SSH:  sudo docker exec ziggy-ziggy-1 printenv ZIGGY_GIT_SHA
```
Then **test the actual change on real hardware** (open the app over the LAN URL
the customer uses — beta users are on `http://<lan-ip>`, a NON-secure context;
see [[project_secure_context_http_lan]]). Nothing is "fixed" until observed live.

### 3d. Rollback
Every deploy appends to `user_files/deploy_log`. To revert:
```bash
cd /opt/ziggy && git checkout <old-sha> && export GIT_SHA="$(git rev-parse --short HEAD)" \
  && sudo -E docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.zigbee-net.yml up -d --build ziggy
```

---

## Fleet reference
- David's Home: `HOME_ID=c7c965d3-034a-4e6e-a618-06b01198e294`, host `ziggy-david`,
  LAN `192.168.1.171`, owner `davidpolacsek@gmail.com`, tracks `feat/beta-image-readiness`.
- Founder relay-admin creds: `~/.ziggy/david-secrets.txt`.
- Related: `docs/RUNBOOK_SUPPORT_TUNNEL.md` (the productized on-demand
  `ziggy-support` account — separate from the standing `ziggy` user used here),
  `docs/ARCHITECTURE_RELAY.md`.
