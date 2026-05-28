# Support Tunnel Runbook

Operator + customer flow for founder SSH access to a deployed home, as
delivered by Prompt 10 chunk 3 ("Option 1 — manual SSH, audit-only").

This is the **interim** flow. Full automation (one-click WebSSH terminal
in the browser, automated key provisioning, server-side session timer)
is Prompt 5 scope, deferred post-launch.

---

## What it is

A founder support tunnel is a temporary SSH session, initiated by the
founder, that reaches the per-home Hetzner VM through the home's
Cloudflare Tunnel. It bypasses the customer's subscription gate (per
Prompt 9 decision 8) — support must work even when billing has stopped
the customer's remote access. Every session leaves a row in the relay's
`audit_log` table so the customer can see exactly when and why support
connected.

---

## Endpoint

`POST /api/admin/homes/{home_id}/support-session`

* Auth: founder JWT with role `relay_admin`.
* Body: `{ "reason": "<free text, optional>" }`. Truncated to 120 chars
  before being written to the audit detail.
* Response:
  ```json
  {
    "home_id":      "home-abc",
    "tunnel_url":   "https://abc.ziggy.app",
    "cf_tunnel_id": "...",
    "ssh_snippet":  "cloudflared access ssh --hostname ssh-home-abc.ssh.ziggy.app --user ziggy",
    "ts":           "<iso8601>",
    "audit_id":     <int>
  }
  ```

The relay never establishes the SSH session itself — it writes the
audit row and returns the command for the founder to run locally.

---

## Operator flow

1. From the operator dashboard (`/ops/cloud`), click the LifeBuoy icon
   on a relay-managed home's HomeCard.
2. Fill in a free-text reason (optional, but recommended — it ends up
   in `audit_log.detail` for the customer's transparency report).
3. Click **Open session**. The modal shows the audit row id and the
   templated SSH command.
4. Click **Copy command** and paste it into a local terminal.
5. The SSH session uses your local `cloudflared` client + your
   enrolled Cloudflare Access identity.

### One-time founder setup

The first time you do this on a new laptop:

```bash
brew install cloudflared            # or curl-install on Linux
cloudflared login                   # opens browser, authenticates against the
                                    # Ziggy Cloudflare Access team
```

Cloudflare Access remembers your identity for ~24 h per device. After
that you'll get a fresh browser auth prompt on the next session.

### Closing the session

`Ctrl-D` or `exit` in the SSH session. The audit row is the durable
record — there is no separate "session closed" event in v1.

---

## Customer-visible flow

> *v1 scope: design doc only. The mobile-app implementation lives in
> docs/MOBILE_ROUTE_AUDIT.md for the next mobile release.*

The customer can see and revoke active support sessions from the Ziggy
Home mobile app's Privacy screen:

1. Mobile app polls `/api/auth/me/support-sessions` (new edge endpoint,
   not yet built) every time the Privacy screen renders.
2. Each open session shows: founder identity, opened time, reason
   (verbatim from the audit row), and a "Revoke" button.
3. Revoke writes `support_session_revoked` to the audit_log and removes
   the founder's enrolled key from the home's `authorized_keys`.

Push notification on session open is **also** stubbed for v1. When the
mobile app gains a foreground notification handler for
`support_session_opened` audit events (Phase 3 mobile work), the
customer will see a toast in real time.

---

## Hostname pattern

`ssh-<home_id>.<ZIGGY_SSH_DOMAIN>`

`ZIGGY_SSH_DOMAIN` defaults to `ssh.ziggy.app` and is overridable via
env on the relay. The hostname is bound to the home's Cloudflare
Tunnel during provisioning (`relay/app/provisioner.py`). If a home was
provisioned **before** the SSH-Access policy was published, you'll get
"Hostname not found" — provision a fresh Cloudflare Access app for it
manually using the cf_tunnel_id returned in the response body.

---

## Where the audit lands

`audit_log` table on the relay:

| column      | value                                              |
|-------------|----------------------------------------------------|
| `ts`        | ISO timestamp of the relay write                   |
| `event`     | `support_session_opened`                           |
| `home_id`   | the customer's home                                 |
| `source_ip` | founder's client IP (X-Forwarded-For)              |
| `ok`        | `1` on success, `0` on unknown_home / auth failure |
| `detail`    | `by=<founder_email> reason=<truncated>`            |

To see all sessions for a home from the dashboard:

* Open `/ops/audit`.
* Filter `event = support_session_opened` and `home = <home>`.
* Each row's detail shows founder email + reason.

The CloudAdmin HomeCard's per-user expansion includes a "View audit log
for this home" deep link that lands pre-filtered to exactly this query.

---

## Failure modes

| Symptom                                | Cause                                    | Recovery                              |
|----------------------------------------|------------------------------------------|---------------------------------------|
| `404 Home not found`                   | home_id wrong / home deprovisioned       | Confirm home_id in CloudAdmin         |
| `cloudflared: certificate expired`     | Access session > 24 h old                | `cloudflared login` again             |
| `cloudflared: connection refused`      | Per-home Cloudflare Tunnel down          | Check `homes.tunnel_url` is reachable from relay; reprovision if absent |
| SSH prompts for password               | Founder pubkey not on the home's authorized_keys | Re-run the imaging script's SSH bootstrap (`PROMPT_FACTORY_IMAGING.md` §5) |
| Customer reports "I see a session I didn't authorize" | (not a failure mode of this flow) | Investigate audit row; rotate Cloudflare Access policy |

---

## Why not full automation now

* **Prompt 5 deferred (post-launch).** A WebSSH terminal in the browser
  + auto-provisioning the founder pubkey to the home's
  `authorized_keys` + server-side session timer all live there.
* **The audit row is the durable record.** Whether the actual SSH is
  one-click or copy-paste doesn't change what the customer can see in
  their Privacy screen.
* **The customer notification is the hard part.** That requires the
  mobile app to subscribe to a new audit-event push channel, which is
  Phase 3 mobile work, not Prompt 10.

Revisit when Prompt 5 is unblocked.
