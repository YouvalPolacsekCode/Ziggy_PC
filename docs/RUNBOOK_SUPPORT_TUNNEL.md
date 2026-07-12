# Support Tunnel Runbook — Ubuntu mini-PC hubs

Operator + customer flow for founder SSH access to a deployed Ziggy home.

Every beta home is a physical **Ubuntu 24.04 mini PC** running the full stack
locally (Ziggy + Home Assistant + Zigbee2MQTT). Support access reaches that box
through the home's **Cloudflare Tunnel** — the same tunnel that already carries
the hub's HTTPS traffic — over a Cloudflare-Access-gated SSH ingress. There is
**no inbound port** on the mini PC and **no standing remote login**: the
`ziggy-support` account only holds a key for the duration of a session.

> This supersedes the earlier Windows/Hetzner-VM design. There is no per-home
> VM and no `ziggy` standing user; the host is a Linux mini PC and the login is
> the on-demand `ziggy-support` account.

---

## Moving parts

| Layer | What | Where |
|-------|------|-------|
| Cloudflare tunnel ingress | `ssh-<home_id>.<domain>` → `ssh://localhost:22`, plus the HTTP catch-all | `relay/app/provisioner.py` (bound at provision time) |
| Cloudflare Access policy | Gates the SSH hostname to the founder allow-list. **Mandatory** — if the allow-list is empty the SSH ingress + DNS are NOT bound at all (fail-closed) | `relay/app/provisioner.py` (`ZIGGY_SUPPORT_ALLOWED_EMAILS`) |
| Session record + command | Audit row + the `cloudflared access ssh` command | `relay/app/routers/support_session.py` |
| Host login | On-demand locked-down `ziggy-support` user | `scripts/linux/ziggy-support-access.sh` (on the mini PC) |

---

## Endpoints

`POST /api/admin/homes/{home_id}/support-session` — open
`POST /api/admin/homes/{home_id}/support-session/revoke` — close/revoke

* Auth: founder JWT with role `relay_admin` (the highest role). Ordinary
  `super_admin` / `admin` / `user` tokens are rejected `403`.
* Body: `{ "reason": "<free text, optional>" }` — truncated to 120 chars in
  the audit detail.
* `open` response:
  ```json
  {
    "home_id":      "home-abc",
    "tunnel_url":   "https://home-abc.hubs.ziggy-home.com",
    "cf_tunnel_id": "…",
    "ssh_hostname": "ssh-home-abc.ssh.ziggy-home.com",
    "ssh_snippet":  "cloudflared access ssh --hostname ssh-home-abc.ssh.ziggy-home.com --user ziggy-support",
    "ts":           "<iso8601>",
    "audit_id":     <int>
  }
  ```
* `revoke` response:
  ```json
  {
    "home_id":              "home-abc",
    "audit_only":           true,
    "host_revoke_required": true,
    "detail":               "Relay logged the revoke intent. Host SSH access remains live until ziggy-support-access.sh --disable runs …",
    "ts":                   "<iso8601>",
    "audit_id":             <int>
  }
  ```
  The relay canNOT end host access, so revoke is **audit-only**: it returns
  `audit_only: true` + `host_revoke_required: true` rather than falsely claiming
  the host login was revoked. Actual key removal is host-side (`--disable` or the
  auto-revoke TTL timer).

The relay never establishes the SSH session itself — it writes the (mandatory)
audit row, fires the optional customer-notification hook, and returns the command
for the founder to run locally. The `ssh_hostname` is produced by the shared provisioner helper
(`ssh_hostname_for`), so it always matches the hostname the tunnel is bound to.

---

## Founder one-time setup (per laptop)

```bash
brew install cloudflared          # or the Linux package
cloudflared login                 # browser auth against the Ziggy CF Access team
```

Cloudflare Access remembers your identity ~24 h per device.

Generate a support keypair once and share the **public** key with provisioning
(it goes into `ZIGGY_SUPPORT_PUBKEY` on the hub, never committed):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/ziggy_support -C "founder@ziggy.app"
```

---

## Operator flow (open → connect → revoke)

1. **Open** the session (dashboard LifeBuoy button, or curl):
   ```bash
   curl -sX POST https://relay.../api/admin/homes/home-abc/support-session \
     -H "Authorization: Bearer $FOUNDER_JWT" \
     -H 'Content-Type: application/json' \
     -d '{"reason":"z2m dropouts"}'
   ```
   This writes `support_session_opened` to `audit_log`, notifies the customer,
   and returns the `ssh_snippet`.

2. **Enable the host login.** The mini PC must arm the `ziggy-support` account
   for the session. This is triggered on the hub (via the authenticated admin
   API / lifecycle watcher, or manually during a hands-on debug):
   ```bash
   sudo ZIGGY_SUPPORT_PUBKEY="$(cat ~/.ssh/ziggy_support.pub)" \
     /opt/ziggy/scripts/linux/ziggy-support-access.sh --enable --ttl 60
   ```
   It installs the founder key with `restrict,pty` options, unlocks the account,
   and schedules an auto-revoke timer (default 60 min). If no scheduler
   (`systemd-run` or `at`) is available it **fails hard and arms nothing** —
   there is never an unrevocable support login. The `ziggy-support` login is a
   plain unprivileged account by default (no `docker`/root-equivalent groups).

3. **Connect** with the returned command + your support key:
   ```bash
   cloudflared access ssh --hostname ssh-home-abc.ssh.ziggy-home.com \
     --user ziggy-support -- -i ~/.ssh/ziggy_support
   ```

4. **Revoke** when done — two independent teardown steps, both idempotent:
   * Host side (removes the key, locks the account, kills live sessions):
     ```bash
     sudo /opt/ziggy/scripts/linux/ziggy-support-access.sh --disable
     ```
     If you forget, the `--ttl` timer runs this automatically.
   * Relay side (durable audit record + customer notification). This is
     **audit-only** — it returns `{"audit_only": true, "host_revoke_required":
     true, …}` and does NOT itself end host access, so always run the host-side
     `--disable` (or rely on the TTL timer) too:
     ```bash
     curl -sX POST https://relay.../api/admin/homes/home-abc/support-session/revoke \
       -H "Authorization: Bearer $FOUNDER_JWT" -d '{"reason":"done"}'
     ```

Check host state any time: `sudo ziggy-support-access.sh --status`.

---

## The host script — security model

`scripts/linux/ziggy-support-access.sh` (`--enable` / `--disable` / `--status`,
plus `--dry-run` on any action):

* The `ziggy-support` account exists but is **locked and keyless** when no
  session is active — login is impossible.
* `--enable` installs the founder public key (from `--pubkey FILE` or
  `ZIGGY_SUPPORT_PUBKEY`, never hard-coded) into
  `~ziggy-support/.ssh/authorized_keys` prefixed with `restrict,pty`
  (all forwarding/agent/X11/tunnel disabled; interactive PTY kept), unlocks the
  account, and schedules `systemd-run` (or `at`) auto-revoke after `--ttl`
  minutes. **It fails hard (exit 1, nothing armed) if no scheduler is available**
  — and if scheduling fails after the account is unlocked, it rolls back to the
  locked/keyless state. There is never an armed login without a self-heal timer.
* **No supplementary groups by default.** `ziggy-support` is a plain,
  unprivileged login. Extra groups are opt-in via `ZIGGY_SUPPORT_GROUPS`
  (comma-separated). Adding `docker` grants **host-root-equivalent** access (the
  docker socket == root); only set it when genuinely required.
* `--disable` truncates the key, expires + locks the account, kills any live
  `ziggy-support` sessions, and cancels the timer.
* A drop-in `/etc/ssh/sshd_config.d/60-ziggy-support.conf` with a
  `Match User ziggy-support` block enforces key-only, no-forwarding for **this
  user only** — it never relaxes anything for other accounts, so normal host
  security is identical whether or not a session is active.
* Idempotent; `--dry-run` prints the full enable/revoke plan and mutates
  nothing (no user created, no key written, no sshd reload).

---

## Provisioning: how the SSH ingress gets bound

SSH ingress is **opt-in per home** (`ZIGGY_SSH_INGRESS_ENABLED=1`) and
**fail-closed**. At `provision_hub` time, when enabled, the relay additively
binds the SSH ingress on the existing per-home tunnel:

0. **Fail-closed guard.** If `ZIGGY_SUPPORT_ALLOWED_EMAILS` is empty, the relay
   binds **nothing** — no SSH ingress, no SSH DNS, no Access app — and logs a
   warning. An allow-list is the only auth gate, so a missing one must never
   yield a world-reachable, ungated SSH proxy.
1. Sets the HTTP-only ingress first (the guaranteed baseline — hub stays live).
2. **Creates/verifies the self-hosted Cloudflare Access application FIRST**, with
   an allow policy reconciled to exactly `ZIGGY_SUPPORT_ALLOWED_EMAILS` (stale
   policies are deleted so a removed email is truly de-authorized). If the Access
   app can't be created, provisioning publishes **no** SSH route.
3. Re-asserts the ingress as `[ssh-<id>.<domain> → ssh://localhost:22, HTTP
   catch-all]`.
4. Creates the SSH hostname CNAME → `<tunnel_id>.cfargotunnel.com` (proxied) —
   only after the Access gate exists.

The Access gate is **mandatory**; the ingress/DNS bind after it is best-effort
and never fails an otherwise-live home. Relevant relay env:

| Env | Meaning | Default |
|-----|---------|---------|
| `ZIGGY_SSH_INGRESS_ENABLED` | Bind the SSH ingress at all (opt-in) | `0` (off) |
| `ZIGGY_SSH_DOMAIN` | Apex for `ssh-<home_id>.<domain>` | `ssh.ziggy-home.com` |
| `ZIGGY_SUPPORT_ALLOWED_EMAILS` | Founder emails for the Access policy (**mandatory**) | *(unset → NO SSH ingress/DNS bound; fail-closed, warning logged)* |
| `ZIGGY_SSH_USER` | Host login the command targets | `ziggy-support` |
| `ZIGGY_CUSTOMER_NOTIFY_URL` | Optional webhook for open/revoke notifications | *(unset → no-op; the audit row is the durable record)* |
| `CF_ZONE_ID` | Owned zone for the SSH CNAME (shared with the hub hostname) | *(unset → SSH DNS + ingress bind skipped)* |
| `CF_PROVISION_DRY_RUN` | Log every intended CF call, perform none | *(unset)* |

Because `ZIGGY_SSH_DOMAIN` (`ssh.ziggy-home.com`) sits under the same zone as
the hub hostname (`hubs.ziggy-home.com`), the existing `CF_ZONE_ID` covers both.

---

## Customer-visible flow

Every relay open and revoke:

1. Writes an `audit_log` row (`support_session_opened` / `support_session_revoked`)
   with the founder email + reason. **This is the mandatory, durable transparency
   record** — it does not depend on the optional webhook. Customers read it from
   the app's Privacy screen / `/ops/audit`.
2. Fires the OPTIONAL `notify_customer` hook. When `ZIGGY_CUSTOMER_NOTIFY_URL` is
   set the relay POSTs `{home_id, event, detail, ts}` so the customer's app (or
   an email relay) can surface the session in real time. **When the env is unset
   this is a no-op** — the audit row is still the durable record. Best-effort — a
   notification failure never blocks the founder's request.

**Honest scope note:** the guaranteed customer-visible record is the *relay-side*
audit row for each open/revoke. The host-side `ziggy-support-access.sh --enable`
runs on the mini PC and does **not** produce a relay audit trace on its own; the
operator flow above pairs each host `--enable`/`--disable` with the corresponding
relay open/revoke so the audit log reflects reality. Do not assume host arming is
independently logged on the relay.

Customers view/revoke sessions from the app's Privacy screen (mobile handler is
tracked separately in `docs/MOBILE_ROUTE_AUDIT.md`).

---

## Where the audit lands

`audit_log` table on the relay:

| column | value |
|--------|-------|
| `ts` | ISO timestamp of the relay write |
| `event` | `support_session_opened` / `support_session_revoked` |
| `home_id` | the customer's home |
| `source_ip` | founder's client IP (X-Forwarded-For) |
| `ok` | `1` on success, `0` on unknown_home / auth failure |
| `detail` | `by=<founder_email> reason=<truncated>` |

Dashboard: `/ops/audit`, filter `event = support_session_*` and `home = <home>`.

---

## Failure modes

| Symptom | Cause | Recovery |
|---------|-------|----------|
| `404 Home not found` | wrong / deprovisioned `home_id` | confirm in CloudAdmin |
| `403 Insufficient permissions` | token is not `relay_admin` | use the founder JWT |
| `cloudflared: certificate expired` | Access session > 24 h | `cloudflared login` again |
| Access page rejects you | your email isn't in `ZIGGY_SUPPORT_ALLOWED_EMAILS` | add it, re-provision the Access app |
| `Permission denied (publickey)` | host session not enabled / expired | run `ziggy-support-access.sh --enable` (check `--status`) |
| `connection refused` on the SSH hostname | tunnel down, or ingress not bound (CF_ZONE_ID was unset at provision) | verify hub tunnel is up; re-provision with `CF_ZONE_ID` set |
| "Hostname not found" | home provisioned before SSH ingress existed | re-run provisioning (idempotent) to bind the ingress + Access app |

---

## Notes / residual caveats

* **Access app auto-creation needs an IdP.** The Cloudflare Access policy is an
  email allow-list; it assumes the Ziggy Access team already has an identity
  provider (One-time PIN or Google) configured. Without one, `cloudflared`
  can't complete the interactive auth.
* **Fail-closed, not ungated.** If `ZIGGY_SUPPORT_ALLOWED_EMAILS` is empty the
  relay binds **no** SSH ingress, DNS route, or Access app at all (a warning is
  logged) — there is never an ungated SSH hostname. Set the allow-list (and
  `ZIGGY_SSH_INGRESS_ENABLED=1`, which is off by default) before relying on
  support access in production.
* **Two-sided revoke.** The relay revoke endpoint is audit-only (returns
  `audit_only: true` / `host_revoke_required: true`); the actual key removal is
  host-side (`--disable` or the auto-revoke timer). Always confirm `--status`
  shows `key: none` after a session.
