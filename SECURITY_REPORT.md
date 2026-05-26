# Security Hardening Report — 2026-05-26

Closes the four launch-blocker findings from `AUDIT.md` (§S1–S4). Code
landed across 19 commits on `main`. Nothing pushed yet; nothing deployed.

## What changed

### S1 — Secrets in tracked `config/settings.yaml`

| Layer | Before | After |
|---|---|---|
| .gitignore rule for `config/settings.yaml` | UTF-16 LE encoded, never matched any file | Plain UTF-8 line, matches; file untracked via `git rm --cached` |
| OpenAI / HA token / Telegram / MQTT / SerpAPI / SMTP / Azure / IFTTT / relay secret | Persisted in `config/settings.yaml` after every `save_settings()` | Three-layer precedence: env var > `config/secrets.yaml` > `config/settings.yaml`. `save_settings()` strips `_SECRET_PATHS` before writing; admin UI endpoints route credential edits through `save_secrets()`. |
| User password hashes + session tokens (up to 20 per user) | In `users[]` block of `settings.yaml`, HMAC-SHA256 with per-user salt | Moved to `user_files/auth.db` (SQLite, gitignored). One-time idempotent migration on boot copies every user + every session token; all active beta sessions preserved. `auth_router`, `auth_deps`, `invite_router`, and `anomaly_engine` read/write through the DB; yaml is a read-only fallback during transition. `save_settings()` strips `users[]` and the legacy `auth{}` block. |

Code-complete. **Two founder-gated steps remain** (see "What remains").

### S2 — Public `POST /api/homes/register-hub` on relay

| Layer | Before | After |
|---|---|---|
| Auth | None — anyone with a known `home_id` could overwrite `tunnel_url` (the body's `relay_secret` field was even accepted as a *write*) | HMAC-SHA256 signature header `X-Ziggy-Signature: t=<ts>,v1=<hex>` over the raw body, verified against the home's stored per-home secret. 5-minute timestamp window. Constant-time digest compare. `relay_secret` removed from request body. |
| Auto-create on first call | Yes — creating new homes was a side-effect of register-hub | No. Provisioning is the canonical create path. Unknown `home_id` returns 404. |
| Audit | None | Every call (ok or fail) writes an `audit_log` row with `home_id`, source IP, and reject reason. |
| Legacy hubs holding `ziggy-hub-primary-secret-2026` | n/a | `POST /api/homes/rotate-hub-secret` issues a fresh per-home secret, authenticated by the current stored secret. Edge agent calls it automatically on startup if it detects the legacy value. New secret persisted to `config/secrets.yaml`. |

Bidirectional signature compatibility unit-tested in this session.

### S3 — `POST /api/ha/service` missing allowlist

| Layer | Before | After |
|---|---|---|
| Domain check | None | Default-deny. Allowlist: `light, switch, climate, scene, script, automation, input_boolean, input_select, input_number, media_player, cover, fan, lock, vacuum, remote, notify`. `remote` was added after grepping `frontend/src` — TVRemote and remoteNav both call `remote.send_command` for IR/RF blasters routed through HA. |
| Service-level denylist within allowed domains | None | `automation.reload`, `script.reload`, `scene.reload` blocked. |
| Blocked-service response | 200 OK + dangerous HA call | `403` with new `ErrorCode.HA_SERVICE_BLOCKED` and a clear `reason` in `details`. Logged at info: `[HASvc] BLOCKED <domain>.<service> — <reason>`. |

The seven specific services the audit called out (`homeassistant.restart`, `shell_command.*`, `hassio.*`, `system_log.*`, `persistent_notification.create`, `backup.*`, `recorder.purge`) all verified blocked.

### S4 — Relay password hashing HMAC → bcrypt

| Layer | Before | After |
|---|---|---|
| Hash function | `hmac.new(salt, pw, sha256).hexdigest()` — instantly brute-forced if DB leaks | `passlib.context.CryptContext(["bcrypt"], bcrypt__rounds=12)`. `passlib[bcrypt]` was already a relay dep but unused. |
| Algorithm discriminator | None | New `hash_algo` column on `users`, default `'hmac_sha256'`. Idempotent ALTER in `init_db()` for existing relay deployments. |
| `/login` | Verified against HMAC only | `verify_password()` dispatches by `hash_algo`. Successful login of a legacy HMAC row triggers a transactional rehash to bcrypt; salt column cleared. |
| `/register`, `ensure_relay_admin` | HMAC | bcrypt directly. |
| Session impact | n/a — JWTs are independent of password hash | Active JWT sessions stay valid through the rotation. |

90-day forced-reset sweep for users who never log in: documented in `SECRETS_ROTATION_2026-05.md`; not implemented in code (one-time admin script when the date comes).

## Commits (in order)

```
c3826ba fix(security): repair .gitignore — settings.yaml UTF-16 line
766ab3f chore(security): track config/settings.example.yaml
25245d1 feat(security): extend settings_loader (secrets.yaml + missing env)
5bcbf88 feat(security): save_secrets() + strip secrets from save_settings()
f352ccf feat(security): admin /settings/ha token → save_secrets   *contaminated*
1fb3d80 wip: snapshot of in-progress edits prior to security hardening
d67dd55 wip: snapshot of new untracked files prior to security hardening
f196952 feat(security): admin /settings/integrations keys → save_secrets
0c998c0 feat(security): admin /settings/mqtt password → save_secrets
f389f22 feat(security): admin /settings/email SMTP password → save_secrets
b044652 feat(security): SQLite-backed user + session store
9323418 feat(security): one-time migration yaml users[] → auth.db
ab2449c feat(security): auth_router + auth_deps → auth.db
1fbc5e5 feat(security): invite_router + anomaly_engine → auth.db
2605c78 feat(security): strip users[]/auth{} on save
2c22a4e chore(security): stop tracking config/settings.yaml
2adca49 feat(relay): audit_log table + HMAC sign/verify helpers
001146d fix(relay,security): HMAC-verify register-hub + audit log
573a206 feat(relay,security): /api/homes/rotate-hub-secret
caf2e18 feat(security): edge agent rotates legacy secret + signs register-hub
e38a1cd fix(ha,security): allowlist on POST /api/ha/service
fcda3b2 feat(relay,security): hash_algo column + idempotent migration
955dae0 fix(relay,security): switch HMAC → bcrypt with transparent rehash
```

`f352ccf` is the known-contaminated commit (HA token migration bundled with the operator's prior in-progress edits to `_FEATURE_DEFAULTS`, `get_features` role gate, `_RULE_META` refactor). Recoverable via interactive rebase if desired; no functional issue.

## Secrets exposed in git history (still need rotation)

Every value below appeared in tracked `config/settings.yaml` and is preserved in old commits. Stripping them from the local file does not remove them from history — see "What remains".

| Service | Severity |
|---|---|
| OpenAI API key `sk-proj-PL29uY…` | CRITICAL (billable) |
| Home Assistant long-lived token (expires 2035) | CRITICAL (full HA admin) |
| Telegram bot token `8763855823:AAF…` | CRITICAL |
| Gmail SMTP app password `mcdwuvurgjnzttgg` | CRITICAL |
| Azure speech key `1ZrgnjRo…` | HIGH (billable) |
| SerpAPI key | HIGH (billable) |
| MQTT password `6584ypSB!` | HIGH (LAN-bound) |
| Relay shared secret `ziggy-hub-primary-secret-2026` | CRITICAL — rotated automatically on next edge-agent boot via the new rotate endpoint, **but** still leaked in history |
| User password hashes (HMAC-SHA256, brute-forceable) | CRITICAL |
| Live session tokens (20 per user) | CRITICAL — invalidated by force-push + filter-repo step |

## What remains (founder-gated)

1. **Rotate every external service key.** OpenAI, HA token, Telegram, MQTT, SerpAPI, Gmail SMTP app password, Azure speech key. Generate new values in each provider's dashboard. Update `.env` (or `config/secrets.yaml`). Restart Ziggy. Confirm features.
2. **`git filter-repo`** to scrub `config/settings.yaml` from full history. Force-push. See `SECRETS_ROTATION_2026-05.md` for the exact command and recovery plan.
3. **Deploy new relay** to `ziggy-relay.fly.dev`. **Edge agent must ship first** — old agents against the new relay return 401 on register-hub.
4. **Approve the HA service allowlist.** Default in `backend/routers/ha_router.py:152-160`. `remote` was added on top of the prompt's list to keep IR/RF blasters working.
5. **Schedule the 90-day forced-reset sweep** for any relay users who never log in (target date: 2026-08-22). Script not implemented; runbook entry only.

## Production verification checklist

After deploying:

- [ ] `git ls-files config/settings.yaml` returns nothing.
- [ ] `git check-ignore -v --no-index config/settings.yaml` returns the .gitignore rule.
- [ ] `python -c 'from core.settings_loader import settings; print(bool(settings["openai"]["api_key"]))'` returns `True` on the operator machine (env or `config/secrets.yaml` supplying it).
- [ ] Login as an existing user. Session resolves via `auth.db`. Old session tokens from before the migration still resolve (zero re-login required).
- [ ] Hit `POST /api/ha/service` with `homeassistant.restart` → 403 + `HA_SERVICE_BLOCKED`. Hit it with `light.turn_on` → 200.
- [ ] Tail logs during edge-agent restart. Look for `[Relay] Rotated legacy secret for 'home-ziggy-primary'` once; subsequent restarts skip that line.
- [ ] On relay: `SELECT event, ok, count(*) FROM audit_log GROUP BY 1,2` — expect `register_hub | 1 | N` for the rotated hubs.
- [ ] Log into relay's CloudAdmin (relay_admin). Then `SELECT email, hash_algo FROM users` — every row that has logged in is `bcrypt`; rows that haven't yet are still `hmac_sha256` and will rotate on next login.
- [ ] Issue a test `POST /api/homes/register-hub` with no signature → 401 "Invalid signature." Audit log row has `signature: missing_or_malformed_signature`.

## What did NOT change (out of scope for this session)

Per the prompt, the following are deferred to other prompts:

- Architecture reconciliation (TTS, wake-word, motion→light, Hetzner migration) — `PROMPT_ARCH_RECONCILIATION.md`.
- Edge agent password hashing — still HMAC-SHA256 in `backend/routers/auth_router.py::_hash_password`. The audit's S4 finding was scoped to the relay; the same vulnerability exists on the edge agent and warrants a follow-up commit (similar shape to the relay fix).
- The 11-prompt feature series (cloud rebuild, OTA, backups, billing, etc.).

The contaminated commit `f352ccf` could be cleaned up with an interactive rebase before sharing the branch; it does not affect runtime behavior.
