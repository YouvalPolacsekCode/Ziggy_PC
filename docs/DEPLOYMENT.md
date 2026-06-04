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

```bash
cd /Users/YouvalPolacsek/ziggy_pc

# 1) Make sure your real-home config is off the repo path
#    (the repo's config/settings.yaml is git-ignored, but it's still the
#    fallback the loader uses if ~/.ziggy/home.yaml is missing)
mkdir -p ~/.ziggy
# Only do this if you ALSO want to be able to point Mac at real HA
# manually. Skip if you want Mac to be 100% local-only.
cp config/settings.yaml ~/.ziggy/home.yaml   # optional

# 2) Replace the repo's config/settings.yaml with the dev-safe template
cp config/settings.dev.yaml.example config/settings.yaml
#    config/settings.yaml is git-ignored, so this stays local.

# 3) Frontend deps
cd frontend && npm install --legacy-peer-deps && cd ..

# 4) Python deps
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Mac day-to-day

```bash
# Terminal 1 — backend
cd /Users/YouvalPolacsek/ziggy_pc
source .venv/bin/activate
uvicorn backend.server:app --host 127.0.0.1 --port 8001 --reload
# Note: --host 127.0.0.1 keeps it loopback-only. Use 0.0.0.0 only if you
# need another LAN device to hit your dev backend.

# Terminal 2 — frontend
cd /Users/YouvalPolacsek/ziggy_pc/frontend
npm run dev
# → http://localhost:3000
# Vite proxies /api and /ws → localhost:8001 (see vite.config.js)
```

If `Ziggy` ever logs `[Ziggy] DEV WARNING: home.type=hub but relay.url/secret
is set` at startup — your local config has drifted toward production. Open
the active config file (whichever `_config_path` resolved to) and remove
the `relay:` block.

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
