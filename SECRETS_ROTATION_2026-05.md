# Secrets Rotation & Git History Scrub — May 2026 Runbook

Companion to `SECURITY_REPORT.md`. Walks through the founder-gated steps
that the code changes do not perform.

> **DO NOT skip ahead.** Each step must finish before the next starts.
> If anything breaks in the middle, stop and call it out — partially
> rotated keys are worse than untouched ones because half the surface
> looks "secure".

---

## Step 0 — Confirm baseline

Open this checklist next to your terminal. Run on the operator machine:

```bash
git ls-files config/settings.yaml          # → no output (untracked)
git check-ignore -v --no-index config/settings.yaml
                                            # → .gitignore:25:config/settings.yaml  config/settings.yaml
ls -la config/settings.yaml                 # → file still on disk, owned by you
ls -la .env config/secrets.yaml 2>/dev/null # → both readable only by you (chmod 600 if not)
```

Ziggy boot still works:

```bash
.venv/bin/python -c "from core.settings_loader import settings; print(bool(settings['openai']['api_key']), bool(settings['home_assistant']['token']))"
# → True True
```

---

## Step 1 — Rotate every external service key

Do these **in this order**. For each: rotate in the provider, update `.env`
(or `config/secrets.yaml`), restart Ziggy, confirm the feature.

Keep the OLD keys around until each new one is verified — revert is one
file edit + restart.

### 1.1 — OpenAI

1. https://platform.openai.com/api-keys → Create new secret key.
2. Edit `.env`: replace `OPENAI_API_KEY=sk-proj-PL29uY...` with the new value.
3. Restart: `./scripts/restart_ziggy.sh` (or whatever you use).
4. Test: ask Ziggy a question that hits ChatGPT. Tail logs for `openai`.
5. Revoke the old key in the OpenAI dashboard.

### 1.2 — Home Assistant long-lived token

1. HA → Profile → Security → "Long-lived access tokens" → Create token "Ziggy 2026-05".
2. Edit `.env`: replace `HA_TOKEN=eyJ...` with the new value.
3. Restart Ziggy.
4. Test: a HA-backed command (turn on a light). Tail logs.
5. Revoke the old token in HA Profile.

### 1.3 — Telegram bot

If the bot is still desired in production:

1. `@BotFather` → `/revoke` → confirm. New token is shown immediately.
2. Edit `.env`: replace `TELEGRAM_BOT_TOKEN=...`.
3. Restart.
4. Send `/start` from your phone. Confirm reply.

If the bot is no longer desired: `/deletebot` in BotFather and remove the line from `.env`.

### 1.4 — Gmail SMTP app password

1. https://myaccount.google.com/apppasswords → revoke `ziggyhome.notifications@gmail.com / Ziggy`.
2. Create a new app password.
3. Edit `.env` (or `config/secrets.yaml`):
   ```
   SMTP_PASSWORD=<new app password, no spaces>
   ```
4. Restart Ziggy.
5. Test: `POST /api/settings/email/test` (admin UI → "Send test email").

### 1.5 — Azure Cognitive Services speech key

1. Azure Portal → Cognitive Services resource → Keys and Endpoint → "Regenerate Key 1".
2. Edit `.env`: replace `AZURE_SPEECH_KEY=...`.
3. Restart.
4. Test: trigger TTS (if enabled).

### 1.6 — SerpAPI

1. https://serpapi.com/manage-api-key → regenerate.
2. Edit `.env`.
3. Restart, test a web search.

### 1.7 — MQTT password

(LAN-bound, lower urgency but still on the list.)

1. Generate a new password: `openssl rand -base64 24`.
2. Update Mosquitto's password file on the broker host.
3. Edit `.env`: `MQTT_PASSWORD=<new>`.
4. Restart Ziggy. Restart any other MQTT consumers (HA, etc.).

### 1.8 — Relay shared secret `ziggy-hub-primary-secret-2026`

**This one is handled automatically by the edge agent on first restart
after deployment.** No manual action needed for the legacy hub.

Verify after restart:

```bash
grep -A1 'relay:' config/secrets.yaml      # → secret: <64 hex chars>, NOT the legacy string
```

On the relay (Fly.io console):

```sql
SELECT id, length(relay_secret) FROM homes WHERE id = 'home-ziggy-primary';
-- expect length 64
```

For NEW homes provisioned post-deploy: relay generates a fresh per-home
secret in the provisioner — no operator action.

---

## Step 2 — Wipe `config/settings.yaml` from full git history

Only run this AFTER step 1 is complete and verified. The history rewrite
is destructive — it changes every commit hash and invalidates any clone
of the repository.

### 2.1 — Backup

```bash
cd ..
tar -czf ziggy_pc.pre-filter-repo.tar.gz ziggy_pc/
cd ziggy_pc
```

Keep that tarball until you've verified the rewritten repo works for at
least a week.

### 2.2 — Install git-filter-repo

```bash
brew install git-filter-repo        # macOS
# or
pip install git-filter-repo         # any platform
```

### 2.3 — Run the rewrite

```bash
git filter-repo --path config/settings.yaml --invert-paths --force
```

`--invert-paths` keeps everything EXCEPT the named path. `--force` is
required because git-filter-repo refuses to operate on a repo that has
remotes by default; this is the explicit acknowledgment.

Expected output: "Parsed ... commits / New history written".

### 2.4 — Verify the file is gone from history

```bash
git log --all -- config/settings.yaml      # → no output
git rev-list --all | xargs -I{} git ls-tree -r {} | grep config/settings.yaml
                                            # → no output
```

If either returns anything, the filter did not fully run.

### 2.5 — Sanity check the rewritten tree

```bash
.venv/bin/python -c "from core.settings_loader import settings; print(len(settings))"
# Boot still works.

git log --oneline -25                       # All commit hashes will be different.
git diff <pre-filter-repo-hash> HEAD        # Will fail — hashes are unrelated. Expected.
```

### 2.6 — Force-push (NEEDS YOUR EXPLICIT GO-AHEAD)

This is the irreversible step.

```bash
git remote -v                               # confirm where you're pushing to
git push --force origin main
```

**Notify every collaborator** that they need to re-clone. Any local clone
based on pre-rewrite hashes will not be able to merge.

If anyone has a feature branch off the old `main`, they need to:

```bash
git fetch origin
git rebase --onto origin/main <old-base> their-branch
```

### 2.7 — Re-add the new safe file (optional)

If you want a starter `settings.yaml` for new installs, copy from the
template — but **do not** commit it, the .gitignore now catches it.

```bash
cp config/settings.example.yaml config/settings.yaml      # local only
```

---

## Step 3 — Deploy

In this order:

1. Edge agent (Ziggy backend) ships first. Old agents against the new
   relay get 401 on register-hub; new agents against the old relay
   work because the relay ignores the unrecognized signature header.
2. Relay deploys to `ziggy-relay.fly.dev`.

Verify after deploy:

```bash
# From the operator machine, restart Ziggy. Expected logs:
#   [Relay] Rotated legacy secret for 'home-ziggy-primary'   (only once)
#   [Relay] Registered hub 'home-ziggy-primary' with relay
```

On the relay:

```sql
SELECT event, ok, count(*) FROM audit_log GROUP BY 1, 2;
-- register_hub      | 1 | <count of restarts since deploy>
-- rotate_hub_secret | 1 | 1   (one-shot)
```

---

## Step 4 — 90-day forced-reset sweep (2026-08-22 relay, 2026-08-24 edge)

Some users may never log in within the 90-day window. Their password
rows will still be HMAC-SHA256 because the rehash only triggers on
successful login. Two parallel sweeps — one per surface.

### Relay sweep (target 2026-08-22)

After 2026-08-22, on the Fly.io relay DB:

```sql
-- Find users still on legacy hash:
SELECT email, role, created_at FROM users WHERE hash_algo = 'hmac_sha256';

-- Force them to reset by clearing the hash. Next login attempt returns
-- 401; the operator emails the affected users with a reset link.
UPDATE users SET password_hash = '', hash_algo = 'forced_reset'
WHERE hash_algo = 'hmac_sha256';
```

`/auth/login` returns 401 for any row with `password_hash = ''` because
`verify_password()` short-circuits on empty stored hash. No code change
needed.

### Edge-agent sweep (target 2026-08-24)

The edge agent's S5 fix landed 2026-05-26; 90 days out is **2026-08-24**.
After that date, on each edge agent's `user_files/auth.db`:

```sql
-- Find users still on legacy hash:
SELECT id, username, role, created_at FROM users WHERE hash_algo = 'hmac_sha256';

-- Force reset on stragglers. Operator informs the user out of band.
UPDATE users SET password_hash = '', salt = '', hash_algo = 'forced_reset'
WHERE hash_algo = 'hmac_sha256';
```

`/api/auth/login` returns 401 because the new `verify_password()`
short-circuits on `not stored_hash`. The operator then either runs
`/api/auth/setup` (if it's the only account, after deleting the row) or
issues a new password via the super_admin `PATCH /api/auth/users/{u}`.

The same fact lives in `SECURITY_REPORT.md` so whoever opens either file
sees the trigger date.

---

## What to do if something goes wrong

| Symptom | Likely cause | Recovery |
|---|---|---|
| Ziggy fails to boot after step 1.x | New env value typo'd | Edit `.env`, restart. Old key still valid (revoke last). |
| `register-hub` returns 401 in logs | Edge agent has wrong secret (rotation crashed mid-flight) | Check relay's `homes.relay_secret` in DB. If different from edge agent's `config/secrets.yaml`, manually align by editing `secrets.yaml`. |
| `register-hub` returns 404 | `home-ziggy-primary` not in relay DB | Insert it: `INSERT INTO homes (id, name, type, tunnel_url, status, relay_secret, created_at) VALUES ('home-ziggy-primary', 'Home', 'hub', '<your tunnel>', 'active', '<your secret>', datetime('now'))`. |
| Login broken for one user post-bcrypt-switch | bcrypt verification path mis-dispatched | `SELECT email, hash_algo, length(password_hash) FROM users WHERE email = '<them>'`. If `hash_algo='bcrypt'` and length != 60, the hash got truncated somewhere — restore from backup. |
| `git filter-repo` removed too much | `--path` typo | Restore from the tarball in step 2.1. The repo is untouched by filter-repo if you abort before push. |

---

## Sign-off

Date completed: ____________________
Operator: ____________________

External keys rotated:
- [ ] OpenAI
- [ ] HA token
- [ ] Telegram
- [ ] Gmail SMTP
- [ ] Azure speech
- [ ] SerpAPI
- [ ] MQTT
- [ ] Relay (auto)

History scrubbed:
- [ ] `git filter-repo` ran cleanly
- [ ] Force-push completed
- [ ] All collaborators notified to re-clone

Deploy:
- [ ] Edge agent rolled to operator machine
- [ ] Relay deployed
- [ ] Audit log shows one `rotate_hub_secret` event per legacy hub

90-day sweep scheduled for: 2026-08-22
