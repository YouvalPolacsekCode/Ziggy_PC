# Edge Agent Security Hardening Report — 2026-05-26 (S5)

Closes the follow-up flagged in `SECURITY_REPORT.md` "What did NOT change":
the edge agent's `backend/routers/auth_router.py::_hash_password` was still
HMAC-SHA256 after the S1-S4 work. Same vulnerability, same fix shape as
S4 on the relay. Code landed across 5 commits on `main`. Nothing pushed
yet; nothing deployed.

## What changed

### S5 — Edge agent password hashing HMAC → bcrypt

| Layer | Before | After |
|---|---|---|
| Hash function | `hmac.new(salt, pw, sha256).hexdigest()` in `auth_router._hash_password` — instantly brute-forced if `user_files/auth.db` leaks | `passlib.context.CryptContext(["bcrypt"], bcrypt__rounds=12)` in new `services/auth_hashing.py`. Identical config to the relay so both surfaces produce interchangeable `$2b$12$…` hashes. |
| Dependency | `passlib` / `bcrypt` not in `requirements.txt`, not in `.venv` | `passlib[bcrypt]==1.7.4` (pinned to match relay) plus `bcrypt<4.1` — passlib 1.7.4 reads `bcrypt.__about__` which was removed in 4.1, and bcrypt 5.0 added a 72-byte hard limit that breaks passlib's startup self-test. |
| Schema | `auth.db` users table already had `hash_algo TEXT NOT NULL DEFAULT 'hmac_sha256'` from S1; no migration needed (unlike relay which needed an `ALTER`). | Unchanged. |
| `/api/auth/setup`, `/api/auth/users` POST/PATCH, `/api/auth/change-password` | All called `_hash_password` (HMAC) and wrote `hash_algo='hmac_sha256'`. | All call `hash_password_bcrypt()` and write `hash_algo='bcrypt'` with empty `salt` (bcrypt embeds its own). |
| `invite_router.accept_invite` | Inlined HMAC | bcrypt via shared helper. |
| `server._bootstrap_cloud_admin` | Inlined HMAC + appended to `settings["users"]` + `save_settings()` — but S1's strip drops `users[]` on write, so the bootstrap user never persisted. Bug pre-dated this work. | bcrypt via shared helper, writes to `auth_db.create_user` (post-S1 source of truth). Side-effect fix. |
| `/api/auth/login` | Verified against HMAC only via direct `_hash_password` + `hmac.compare_digest`. | `verify_password()` dispatches by `users.hash_algo`. Successful login of a legacy HMAC row triggers a transactional rehash to bcrypt; `salt` column cleared. Failed logins do NOT rehash (no verified plaintext to encode). |
| Audit | None. | Successful rehash logs `[Auth] Hash upgraded user_id=<id> username=<u> old_algo=hmac_sha256 new_algo=bcrypt` via existing `core.logger_module`. Matches edge-agent auth-log style; no new SQLite table introduced. |
| Session impact | n/a | `sessions` rows are keyed by `(token, user_id)` only — independent of `password_hash` and `salt`. Active sessions remain valid through the rotation. Verified end-to-end against a temp DB. |

90-day forced-reset sweep for users who never log in: documented in `SECRETS_ROTATION_2026-05.md` Step 4 (edge target **2026-08-24**); not implemented in code (one-time admin SQL when the date comes).

## Commits (in order)

```
97ff7c4 chore(security): pin passlib[bcrypt] for edge agent
c182066 feat(security): services/auth_hashing — shared bcrypt + legacy HMAC helpers
0cffd3c feat(security): edge agent new-hash sites switch HMAC → bcrypt
8ed8492 fix(security): edge agent login — transparent HMAC → bcrypt rehash + audit
576bbe7 docs(security): schedule 90-day edge-agent HMAC sweep (2026-08-24)
```

Each is independently revertible. Commit 3 (`0cffd3c`) wires bcrypt into NEW hash sites but does NOT rehash legacy rows; Commit 4 (`8ed8492`) adds the rehash. Reverting Commit 4 alone leaves the system in a "new users bcrypt, legacy users still HMAC, no rehash" state — usable as a safety brake without re-deploying old HMAC code paths.

## State at time of writing

Edge agent `user_files/auth.db`:

| id | username | role | hash_algo | sessions |
|---|---|---|---|---|
| 1 | youvalpolacsek@gmail.com | super_admin | hmac_sha256 | 20 |
| 2 | silentyouval@gmail.com | super_admin | hmac_sha256 | 1 |

Both will flip to `bcrypt` on the next successful login. 21 active sessions remain valid through the rotation.

## Verification checklist

After deploying:

- [ ] Login as an existing user. Confirm a `[Auth] Hash upgraded …` line appears exactly once per legacy user. Subsequent logins from the same user do NOT log it again.
- [ ] `sqlite3 user_files/auth.db "SELECT username, hash_algo, length(password_hash), length(salt) FROM users"` — every row that has logged in shows `bcrypt`, hash length 60, salt length 0.
- [ ] Any session token captured before the upgrade still authenticates (no re-login forced).
- [ ] Create a new user via super_admin `POST /api/auth/users` → row lands as `bcrypt` directly.
- [ ] Failed login on a still-HMAC user (e.g. wrong password) → 401, row still `hmac_sha256`.
- [ ] `python -c "from services.auth_hashing import verify_password; print(verify_password('x', '', '', 'bcrypt'))"` → `False` (defensive short-circuit).

## What did NOT change

- `auth_router._hash_password()` and the `import hashlib` / `import hmac` lines at the top of `auth_router.py` are now unused but kept — per the operator's "ask before deleting anything" preamble. Mark as future cleanup.
- `_ensure_user_in_db()` and `auth_db.migrate_from_yaml()` still write `hash_algo='hmac_sha256'` for yaml-migrated users; correct, because those carry pre-existing HMAC hashes and the rehash happens on login.
- `relay/requirements.txt` was NOT touched, even though the relay also needs the `bcrypt<4.1` pin for any future image rebuild. Out of scope for this prompt (relay was the prior session's S4); add as separate follow-up if the relay image is rebuilt before bcrypt 4.0.x falls out of the Docker cache.
