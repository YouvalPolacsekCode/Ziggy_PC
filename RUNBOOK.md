# Ziggy Operator Runbook

One page. Skim this when you need to do anything to Ziggy. Deep dive lives
in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## Where everything lives

| Thing | Location |
|---|---|
| Production URL | `https://app.ziggy-home.com` |
| Mini PC | `10.100.102.23` (Windows, user `"youval polacsek"`) |
| HA VM | `10.100.102.21` (VirtualBox on the mini PC) |
| SSH into mini PC | `ssh "youval polacsek"@10.100.102.23` |
| Mac dev URL | `http://localhost:3000` (frontend) + `:8001` (backend) |
| Dev HA URL | `http://localhost:8123` (Docker on Mac) |
| Repo (Mac) | `/Users/YouvalPolacsek/ziggy_pc` |
| Repo (mini PC) | `C:\ziggy` |
| Per-machine config (mini PC) | `~/.ziggy/home.yaml` |
| Mac-side prod-backup configs | `~/.ziggy/*.prod-backup-*` |
| GitHub | `github.com/YouvalPolacsekCode/Ziggy_PC` |
| Mobile app repo | `github.com/YouvalPolacsekCode/Ziggy_Mobile` (`~/ziggy_mobile/`) |
| Cloudflare Tunnel name | `ziggy-home` |

---

## "I changed code, how do I ship it?"

### Quick fix / experiment → goes to canary (your house) within 5 min

```bash
cd /Users/YouvalPolacsek/ziggy_pc
git add <files>
git commit -m "<msg>"
git push origin main
```

Within 5 minutes, the mini PC's scheduled task pulls, rebuilds, verifies.
If anything fails, auto-rollback reverts to the last good SHA.

### Ship to production homes → only via a release tag

```bash
git tag release-2026.06.06 -m "ship: <what's in this release>"
git push origin release-2026.06.06
```

Homes with `ZIGGY_COHORT=production` in their `.env` pull this tag.
Bare pushes to `main` never touch production homes.

### Promote your house from canary to production

Currently it's canary (default). To move it: SSH into the mini PC, edit
`C:\ziggy\.env`, add `ZIGGY_COHORT=production`. Next auto-tick (within 5 min)
the home starts following `release-*` tags instead of `main`. To go back,
delete that line.

---

## "Where's the system at right now?"

### Single home

```bash
curl https://app.ziggy-home.com/api/version
```

### All homes at once (when you have more than one)

```bash
cd /Users/YouvalPolacsek/ziggy_pc
./scripts/fleet-status.sh
```

Add more homes by editing `scripts/fleet.yml`.

### Recent deploys on a specific home

```bash
curl https://app.ziggy-home.com/api/__deploy__ | python3 -m json.tool
```

Or on the mini PC: `type C:\ziggy\user_files\deploy_log`.

---

## Dev environment (Mac)

### Start the dev stack (HA + Mosquitto in Docker)

```bash
cd /Users/YouvalPolacsek/ziggy_pc
./scripts/dev-up.sh
```

### Start Ziggy backend + frontend in one terminal

```bash
./scripts/dev-ziggy.sh
```

Open `http://localhost:3000` in Private/Incognito.

### Stop the dev stack

```bash
./scripts/dev-down.sh        # keep HA state
./scripts/dev-down.sh -v     # wipe HA state for a clean reset
```

---

## "Help, something's broken"

### Prod URL won't load

1. `curl -s -o /dev/null -w "%{http_code}\n" https://app.ziggy-home.com/api/version` — if you get `530`, Cloudflare can't reach the tunnel; SSH in and check `Get-Service cloudflared` (should be `Running`).
2. If `200` from curl but browser fails — browser cache / service worker. Hard reload + try Incognito.
3. If both fail — SSH in: `docker compose ps` (container `Up`?), then `docker compose logs ziggy --tail=50`.

### Auto-update isn't deploying my push

1. `curl https://app.ziggy-home.com/api/version` — note the SHA. Compare to `git rev-parse origin/main` on Mac.
2. SSH in. `type C:\ziggy\user_files\update.log` — recent entries tell you what the task did.
3. Common cause: dirty working tree on mini PC. `cd C:\ziggy; git status` — `git checkout -- .` to clean.
4. Force a deploy manually: `cd C:\ziggy; .\scripts\update.ps1`.

### Container won't start after a deploy

Auto-rollback should have fired. Check `user_files/deploy_log` for a `kind: rollback` entry. If it didn't auto-rollback:

```powershell
cd C:\ziggy
# Find the last-good SHA from deploy_log
type user_files\deploy_log | Select-Object -Last 30
# Manually rollback
git checkout <good-sha>
$env:GIT_SHA = '<good-sha>'
docker compose up -d --build --no-deps ziggy
```

### Mac dev Ziggy shows the prod home's devices

You're pointed at the wrong HA. Mac `.env` should have
`HA_URL=http://localhost:8123/` and a token minted in the **dev HA** UI
(`http://localhost:8123`), NOT prod credentials.

### Dev HA broke / I want to start over

```bash
./scripts/dev-down.sh -v
./scripts/dev-up.sh
# Re-do HA onboarding at localhost:8123, mint new token
./scripts/dev-set-ha-token.sh <new-token>
```

---

## Telling Claude what to do

You don't have to remember any of this. Just say what you want and reference this file:

* "Push this to canary" → I do `git push origin main`.
* "Ship this to production" → I `git tag release-YYYY.MM.DD && git push --tags`.
* "Roll back prod to <sha>" → I walk you through `git checkout`.
* "What's on prod right now?" → I curl `/api/version`.
* "Onboard a new home" → I open `docs/DEPLOYMENT.md` and follow the mini PC setup section.

The full architecture is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md);
[`CLAUDE.md`](CLAUDE.md) tells future Claude sessions to read both before
making suggestions.

---

## One-time setup that's already done (don't redo)

- ✅ Mac dev env: Docker Desktop installed, dev HA running, `.env` configured for dev
- ✅ Mini PC: Docker Desktop, OpenSSH server, Ziggy container, cloudflared service, scheduled task `ZiggyAutoUpdate`
- ✅ Cloudflare: `app.ziggy-home.com` CNAME → `<tunnel-id>.cfargotunnel.com`
- ✅ Mobile app: `capacitor.config.ts` → `server.url: https://app.ziggy-home.com`

If you nuke a machine and need to rebuild, the deep-dive setup steps are in `docs/DEPLOYMENT.md`.
