# Ziggy — Deployment & Dev-Environment Guide

This is the single source of truth for **how code moves from the Mac to
production** and how the two environments stay isolated.

```
┌──────────────┐    git push       ┌─────────────────────┐    git pull    ┌──────────────────┐
│   Mac dev    │ ─────────────────▶│  github.com/Ziggy_PC│ ──────────────▶│  Mini PC (prod)  │
│ localhost    │                   │      origin/main    │                │ ziggy-home.com   │
└──────────────┘                   └─────────────────────┘                └──────────────────┘
   uvicorn :8001                                                            docker compose up
   vite     :3000                                                           cloudflared tunnel
```

* **Mac** = development only. Never reachable as `ziggy-home.com`. Never
  controls real Home Assistant unless you explicitly opt in.
* **Git** = source of truth.
* **Mini PC** = the real Ziggy. Pulls from Git, runs `docker compose`,
  exposed via Cloudflare Tunnel as `app.ziggy-home.com`.

---

## Config layering (read this once, you'll need it)

Ziggy resolves config in this order — see [`core/settings_loader.py`](../core/settings_loader.py)
function `_config_path`:

1. `$ZIGGY_CONFIG_PATH` (env var) — wins if set
2. `~/.ziggy/home.yaml` — per-machine production-ish config
3. `<repo>/config/settings.yaml` — last-resort fallback (git-ignored)

Then on top of whichever file wins:

4. `<repo>/config/secrets.yaml` is **deep-merged** in (git-ignored)
5. Environment variables (`HA_URL`, `HA_TOKEN`, `OPENAI_API_KEY`, …) win
   over everything

The recommended layout:

| Machine  | Where the *real* config lives                            |
|----------|-----------------------------------------------------------|
| Mac dev  | `<repo>/config/settings.yaml` is a copy of `settings.dev.yaml.example` — safe placeholders only; **no `relay:` block**, no real HA token |
| Mini PC  | `~/.ziggy/home.yaml` holds the real values, `<repo>/config/settings.yaml` stays as the dev template (so a stray `git pull` never overwrites prod) |

The same code runs on both — only the config differs.

---

## Mac setup (one-time)

The Mac runs its **own** isolated HA in Docker (NOT the real home's HA).
Pre-seeded with a `Dev Test Light` you can toggle to verify the wiring.

```bash
# 1) Install Docker Desktop if not already present:
#      https://www.docker.com/products/docker-desktop/
#    Launch it once, wait for the whale icon to stop animating.

cd /Users/YouvalPolacsek/ziggy_pc

# 2) Bring up the dev HA stack (HA + Mosquitto in Docker, NO Ziggy container)
./scripts/dev-up.sh
# First boot pulls the HA image (~1 GB) and takes ~30-60s to become healthy.

# 3) Open http://localhost:8123 in your browser. Complete HA onboarding —
#    any name/password/location values are fine, this is a throwaway dev HA.

# 4) Profile (avatar, bottom-left) -> Security -> Long-Lived Access Tokens
#    -> Create Token. Name it "ziggy-dev-mac". Copy the token.

# 5) Inject the token into your Mac .env
./scripts/dev-set-ha-token.sh <paste-token-here>

# 6) Frontend + Python deps (skip if already installed)
cd frontend && npm install --legacy-peer-deps && cd ..
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

You're now set up. The dev HA persists across reboots; you only do steps 3-5
once. To stop the dev stack: `./scripts/dev-down.sh`. To wipe and start
fresh: `./scripts/dev-down.sh -v`.

---

## Mac day-to-day

```bash
# Terminal 0 — dev HA (only if it's not already running)
cd /Users/YouvalPolacsek/ziggy_pc
./scripts/dev-up.sh

# Terminal 1 — Ziggy backend
cd /Users/YouvalPolacsek/ziggy_pc
source .venv/bin/activate
uvicorn backend.server:app --host 127.0.0.1 --port 8001 --reload

# Terminal 2 — Ziggy frontend
cd /Users/YouvalPolacsek/ziggy_pc/frontend
npm run dev
# → http://localhost:3000
# Vite proxies /api and /ws → localhost:8001 (see vite.config.js)
# The Ziggy UI should show "Dev Living Room Light" — toggle it and watch
# the state flip in HA at http://localhost:8123.
```

If `Ziggy` ever logs `[Ziggy] DEV WARNING: home.type=hub but relay config is
populated` at startup — your local config has drifted toward production.
Open the active config file (whichever `_config_path` resolved to) and
remove the `relay:` block.

---

## Pushing from Mac

```bash
cd /Users/YouvalPolacsek/ziggy_pc
git status              # always eyeball first
git diff                # review the actual diff
git add <specific files>
# DO NOT do `git add -A` while .env is in working dir — .gitignore covers
# it, but being explicit is safer when working alongside secrets.
git commit -m "<message>"
git push origin main
```

---

## Mini PC setup (one-time)

Run **on the mini PC**, as the user that will own the Ziggy process:

```bash
# 1) Clone
cd ~
git clone https://github.com/YouvalPolacsekCode/Ziggy_PC.git ziggy
cd ziggy

# 2) Real per-machine config — NOT in git
mkdir -p ~/.ziggy
nano ~/.ziggy/home.yaml
# Required keys (see config/settings.example.yaml for the full schema):
#   home.id           — stable id (e.g. "home-youval-primary")
#   home.type         — "hub"  (mini PC is a hub, NOT cloud)
#   home_assistant.url
#   home_assistant.token
#   openai.api_key
# Relay block: leave EMPTY unless you've consciously wired this hub into
# the Fly.io relay (most self-hosted hubs don't need it).

# 3) Repo-local .env for things the Dockerfile reads
cp .env.example .env
nano .env
# Fill HA_URL, HA_TOKEN, OPENAI_API_KEY, MQTT_* (this duplicates what's in
# ~/.ziggy/home.yaml but the docker-compose.yml uses env-vars; keep them
# in sync. .env is git-ignored.)

# 4) Cloudflare Tunnel — see § "ziggy-home.com routing" below

# 5) Bring up the stack
docker compose up -d --build
docker compose logs -f ziggy
```

---

## Mini PC updates (every time you push from Mac)

```bash
ssh <user>@<mini-pc-host>
cd ~/ziggy
./scripts/update.sh
```

That script:
1. Records the current SHA in `user_files/deploy_log` (for rollback).
2. `git fetch` + shows what's about to come in.
3. `git pull --ff-only` (refuses non-fast-forwards — keeps history clean).
4. `docker compose up -d --build`.
5. Tails `docker compose logs ziggy` for 20 lines so you see startup.

If anything looks wrong, roll back:

```bash
cd ~/ziggy
tail -5 user_files/deploy_log    # find the last-good SHA
git checkout <sha>
docker compose up -d --build
```

---

## Release management

Ziggy uses a two-track release model so you can keep iterating on `main`
without every push landing in every home.

```
          ┌──────────────┐     git push origin main       ┌────────────────┐
   main ──┤ canary homes │ ◀───────────────────────────── │  Mac dev (you) │
          │ (your house) │                                └────────────────┘
          └──────────────┘                                        │
                                                          git tag release-*
                                                          git push --tags
                                                                  ▼
          ┌──────────────────┐                            ┌───────────────────┐
release-* │ production homes │ ◀───────────────────────── │ origin/release-*  │
          └──────────────────┘                            └───────────────────┘
```

### The two tracks

* **Canary** -- follows `origin/main`. Every push auto-deploys within
  ~5 min (the `update.ps1` tick interval). Your own house runs here so
  you eat your own dog food before anyone else does.
* **Production** -- follows the latest `release-YYYY.MM.DD` tag. Homes
  on this track only move when you cut a new tag. If no tag exists yet,
  `update.ps1` exits silently and the home stays put.

Cutting a release from the Mac:

```bash
cd /Users/YouvalPolacsek/ziggy_pc
git checkout main
git pull origin main
git tag release-2026.06.06 -m "ship: weekly cut"
git push origin release-2026.06.06
# Production homes pick it up on their next 5-min tick.
```

### Promoting a home from canary to production

The cohort is selected by the `ZIGGY_COHORT` env var read by
`scripts/update.ps1`. Default is `canary` (so existing homes keep their
current behavior with no change required).

On the home's mini PC, edit the repo-local `.env` (docker-compose passes
env-vars through more reliably than the YAML loader):

```bash
# On the mini PC
cd ~/ziggy
nano .env
# Add (or change):
#   ZIGGY_COHORT=production
# Default if unset: canary

# Take effect immediately:
docker compose up -d
# ...or just wait up to 5 min for the next auto-update tick.
```

To demote a home back to canary, set `ZIGGY_COHORT=canary` (or remove
the line) and restart.

### Auto-rollback

After every `docker compose --build`, `update.ps1` polls
`/api/version` for up to 60s. If the running container doesn't report
the SHA it just built, the script:

1. Reads the last verified SHA from `user_files/deploy_log`.
2. Checks out that SHA and rebuilds.
3. Appends a `kind: rollback` entry to `user_files/deploy_log`:
   `ts, old=<failed-sha>, new=<rollback-sha>, branch=<branch>, verified=true, kind=rollback`
4. Writes a `ROLLBACK` line to `update.log` with details.

What this catches: **the container won't come up** (boot failure,
import error, port conflict, broken Dockerfile change). What it does
**not** catch: logic bugs that successfully start the container but
break behavior. Treat auto-rollback as a safety net for "it's totally
broken," not as a substitute for testing on canary first.

Manual rollback is still supported and useful for the latter case:

```powershell
# On the mini PC
cd ~/ziggy
Get-Content user_files/deploy_log | Select-Object -Last 5    # find the SHA
git checkout <sha>
$env:GIT_SHA = '<sha>'
docker compose up -d --build --no-deps ziggy
```

### Signed releases (opt-in)

Anyone with push access to `origin` can ship code to every home that
follows the cohort. If that's a concern, enforce GPG-signed tags on
production homes.

**On the Mac (one-time, operator setup):**

```bash
# Find your KEY-ID (the long form, e.g. ABCD1234EF567890)
gpg --list-secret-keys --keyid-format=long

# Tell git to sign by default
git config --global commit.gpgsign true
git config --global tag.gpgsign true
git config --global user.signingkey <KEY-ID>

# From now on, `git tag release-...` produces a signed tag.
```

**On each production home (one-time, trust setup):**

```bash
# On the Mac: export your public key
gpg --export <KEY-ID> | base64 > pubkey.b64
# Copy pubkey.b64 to the home however you like (scp, paste, etc.)

# On the home: import it
base64 -d pubkey.b64 | gpg --import
# Windows mini PC: install Gpg4win first (https://gpg4win.org/),
# then run the same `gpg --import` from a Gpg4win shell.
```

**Enforcement per home** -- add to the home's `.env`:

```
ZIGGY_REQUIRE_SIGNED_TAGS=true
```

When set, `update.ps1` runs `git verify-tag <tag>` before checkout.
If the tag isn't signed by a trusted key, the rollout is aborted and
the home stays on its previous tag. Default is off (the script warns
but doesn't enforce), so adopting GPG signing is opt-in per home.

Recommendation: turn this on for production homes once your threat
model warrants it. Keep canary unsigned for developer agility (you
push small fixes too often for the signing ceremony to be worth it
there).

### Fleet status

`scripts/fleet-status.sh` (Mac-side) reads `scripts/fleet.yml` and
prints a one-line-per-home table of SHA, uptime, HA-configured, and
last-deploy timestamp:

```bash
cd /Users/YouvalPolacsek/ziggy_pc
./scripts/fleet-status.sh
# NAME              SHA       UPTIME    HA   LAST DEPLOY
# home-youval       3794789   2d 4h     OK   2026-06-04 09:12
# home-cousin       42fe393   6h 11m    OK   2026-06-03 18:44
# ...
```

`scripts/fleet.yml` is the home registry -- a list of
`{name, url}` entries. Add a new home there when you onboard it. The
script exits non-zero if any home is drifting (e.g. SHA doesn't match
its cohort's expected ref), which makes it cron/launchd-friendly:

```bash
# Example launchd plist or cron entry, runs hourly:
0 * * * * cd /Users/YouvalPolacsek/ziggy_pc && ./scripts/fleet-status.sh \
  || osascript -e 'display notification "Ziggy fleet drift" with title "Ziggy"'
```

### Day-to-day rhythm

```bash
# Quick fix -- lands in canary in ~5 min, production untouched
git commit -m "fix: stop the thing from doing the bad thing"
git push origin main

# Ship to production -- production homes pick it up in ~5 min
git tag release-2026.06.06 -m "ship: weekly cut + AC scene fixes"
git push origin release-2026.06.06

# "Roll back" production -- note the gotcha:
git tag -d release-2026.06.06
git push --delete origin release-2026.06.06
# This does NOT move production homes back. They already pulled the
# tag and update.ps1 only moves forward -- deleting the tag just stops
# *new* homes from pulling it. To actually retreat, cut a fresh
# release-* tag pointing at a known-good SHA:
git tag release-2026.06.06-hotfix <last-good-sha> -m "revert: ..."
git push origin release-2026.06.06-hotfix
# Easier rule of thumb: don't push a bad tag. Soak it on canary first.
```

---

## `ziggy-home.com` routing

`app.ziggy-home.com` currently resolves to Cloudflare IPs
(`104.21.0.0/16`, `172.67.0.0/16`) — i.e. it's proxied through Cloudflare.
The standard Ziggy pattern (see [docs/RUNBOOK_HETZNER_MIGRATION.md](RUNBOOK_HETZNER_MIGRATION.md))
is a per-machine Cloudflare Tunnel:

```
app.ziggy-home.com  ──CNAME──▶  <tunnel-id>.cfargotunnel.com
                                        │
                                    cloudflared (on mini PC)
                                        │
                                  http://localhost:8001
                                  (Ziggy backend)
```

There are two ways to verify which path is in use for **your own home**:

* **Cloudflare dashboard**: DNS → `ziggy-home.com` zone. Look for an
  `app` record. If it's a CNAME ending in `cfargotunnel.com`, it's a
  Tunnel; if it's an A record to a Fly.io IP, it's routed through the
  relay.
* **From any machine**: `dig +trace app.ziggy-home.com` — but
  Cloudflare's proxy hides the origin so this won't reveal it.

### Setting up the tunnel on the mini PC (if not already)

There's a reference script at [`scripts/setup_cloudflare_tunnel.sh`](../scripts/setup_cloudflare_tunnel.sh)
but it's pathed for Windows (`cloudflared.exe`). On Linux/macOS:

```bash
# On the mini PC
brew install cloudflared    # or apt install cloudflared
cloudflared tunnel login    # browser auth
cloudflared tunnel create ziggy-home
# Note the Tunnel ID printed.

mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <TUNNEL_ID>
credentials-file: /home/<user>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: app.ziggy-home.com
    service: http://localhost:8001
  - service: http_status:404
EOF

# Point app.ziggy-home.com at this tunnel in Cloudflare dashboard:
#   DNS → ziggy-home.com → Add record →
#     Type: CNAME, Name: app, Target: <TUNNEL_ID>.cfargotunnel.com, Proxy: ON

# Run as a service
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

---

## OTA vs Git: which is the update path?

This repo has **two unrelated update systems**. Don't confuse them:

| System | Files | What it actually does | Use it? |
|---|---|---|---|
| HA update notifier | [`services/ha_update_checker.py`](../services/ha_update_checker.py), [`backend/routers/update_router.py`](../backend/routers/update_router.py) | Tells the UI "HA has a new version" — no install logic | Nothing to do, runs fine |
| Real Ziggy OTA | [`services/ota_client.py`](../services/ota_client.py), [`relay/app/routers/ota.py`](../relay/app/routers/ota.py) | Edge polls Fly.io relay for an HMAC-signed manifest, stages it to `user_files/ota_state.json` | **Not yet** — see below |

The OTA poller is wired up but **the installer that actually applies a
staged manifest is not implemented in this codebase** (the docstring of
`ota_client.py` defers it to "Prompt 4 / chunk 4"). There's also no
rollback at the edge. It's designed for the multi-tenant cloud product
(per-home VMs on Hetzner / Oracle ARM), not for a single self-hosted hub.

**Decision: stay on `git pull` + `docker compose up -d --build` for your
own mini PC.** Revisit OTA when you ship to other people's homes and the
installer + rollback path are real.

To make sure the OTA poller stays quiet on your hub: leave `relay.url`
empty in `~/.ziggy/home.yaml`. The poller short-circuits with
`reason=missing_config` (see `ota_client.py` line ~238) and stages
nothing.

---

## Safety checklist

Before any push:

* [ ] `git status` shows no `.env`, no `config/settings.yaml`, no
      `config/secrets.yaml`, no `user_files/*` (they're git-ignored
      but always double-check)
* [ ] `git diff` reviewed
* [ ] If you modified `core/settings_loader.py` or anything in
      `backend/server.py`, run a local boot:
      `python -c "from core.settings_loader import load_settings; load_settings()"`

Before any pull on mini PC:

* [ ] Read the diff: `git log --oneline HEAD..origin/main`
* [ ] Use `./scripts/update.sh`, not raw `git pull` — you'll lose the
      SHA breadcrumb for rollback
* [ ] After update: `docker compose logs ziggy | tail -50` — look for
      tracebacks
