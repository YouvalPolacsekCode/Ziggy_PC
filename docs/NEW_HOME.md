# Building a new home

**This is the current procedure. It supersedes the per-home runbooks**
(`CANARY_REBUILD_RUNBOOK.md`, `DAVID_ZIGGY_02_RUNBOOK.md`,
`TSLIL_ZIGGY_03_RUNBOOK.md`), which describe a bootstrap that pinned a feature
branch and an imaging script with fewer steps than it has today.

One command builds a home. Everything below it exists so you know what that
command does and what to do when it stops.

---

## The short version

```bash
./scripts/new-home.sh --host ziggy@<hub-ip> \
                      --name "<Customer>'s Home" \
                      --owner <customer@email> \
                      --zigbee --pair-seconds 180
```

You are prompted for exactly one password: the hub's, once, so your SSH key can
be installed. Nothing else is interactive.

Run it with `--dry-run` first. That validates your secrets, your GitHub login,
the hub's reachability and which release the home will land on, and changes
nothing.

---

## What you still do by hand

Only the physical work:

1. **Ubuntu Server 24.04** on the mini PC. Press **F7** for the boot menu, and
   **add `nomodeset` to the installer boot arguments** — the HM35 / Ryzen 3550H
   units black-screen without it. User `ziggy`, OpenSSH enabled, wired Ethernet.
2. **Plug the radios in** — the Zigbee coordinator, and a second dongle only if
   this kit ships Matter/Thread.
3. **Put each kit device into pairing mode** during the permit-join window that
   `--pair-seconds` opens.

That is the whole manual list. Addressing, the GitHub token, the secrets file,
the Cloudflare tunnel and the update-channel enrolment are all automated.

---

## What the script does

| Phase | What happens |
|---|---|
| **Preflight** | Validates your secrets file, mints a GitHub token from your `gh` login, resolves the newest `release-*` tag and tells you which one the home will land on. Fails on your Mac rather than half-way through the hub. |
| **Access** | Installs your SSH key (one password prompt) and grants passwordless sudo. Shreds any secrets a previous manual run left on the box. |
| **Code** | Streams `hub-bootstrap.sh` and the GitHub token over SSH **stdin**. The hub clones `/opt/ziggy` at the newest release tag and strips the token back out of the git remote. |
| **Image** | Stages the imaging secrets in `/dev/shm` (RAM, never the SSD), runs an imaging dry run, then the real run as a **detached systemd unit** so a bounced link cannot kill it half-way. Streams the log. Shreds the secrets on exit — including on Ctrl-C. |
| **Verify** | Backend healthy, connector running, OTA timer enabled, network guard enabled, stack service enabled. Reports cohort, release, address and mDNS name. Revokes passwordless sudo. |

### The imaging steps

`preflight → identity → mqtt-creds → env → stack-up → ha-seed → zigbee-pair →
seal → register-hub → ziggy-up → tunnel → matter-enable → update-channel →
network-pin → kit-ready → first-backup`

Three of those are new and worth knowing:

- **`tunnel`** installs and runs `cloudflared` with the connector token the
  relay minted at `identity`. The relay already created the tunnel and set its
  ingress; this is the hub half that was previously done by hand. The connector
  token lives in `/etc/ziggy/tunnel.env` (0600) and reaches cloudflared only as
  an environment variable — never on a command line, never in the unit file.

- **`network-pin`** rewrites the lease the router already gave this hub as a
  static netplan config, and advertises mDNS. See below.

- **`update-channel`** writes `ZIGGY_COHORT=production` and enables
  `ziggy-update.timer`. This is what makes the home able to receive fixes.

Steps are resumable. If one fails, fix the cause and re-run the script with
`--resume`. Avoid `--from`: it re-runs steps ignoring state, and `ha-seed` dies
against an already-onboarded Home Assistant.

---

## Addressing: why there is no router reservation

A DHCP reservation is a row in **the customer's router**, and there is no
portable way to ask for one. So the hub achieves the same outcome from its own
side, in two halves:

**Pin.** `network-pin` takes the address the router already leased to this MAC
and writes it as a static netplan config. Because it is our existing lease, the
router's own table already agrees with us — we are not squatting on an address.

**Name.** mDNS is advertised as `ziggy-<slug>.local`, so anything that needs the
hub can find it without knowing an address at all. This half is the one that
matters historically: an IP-pinned `HA_URL` cost the Canary a 9h50m outage, a
stale `lan_host` produced false "arrived home" pushes, and a drifting Broadlink
turned IR into 502s.

### Why it is safe to run on a headless box in someone's living room

Before it touches anything, the pin **arms a transient systemd timer that
restores DHCP**. The timer lives in systemd, not in the shell, so it fires even
if your SSH session dies mid-apply. It is cancelled only after the script proves
the gateway *and* DNS still work. This is `netplan try`'s auto-revert, done in a
way that works without a terminal.

It reverts automatically on any of: netplan rejecting the config, the gateway
going unreachable, DNS breaking, or another device already answering for the
address. And it refuses to start at all if the rollback timer cannot be armed.

**The pin is deliberately non-fatal.** A home whose address may drift is still a
working home, so a failed pin logs and continues rather than failing the build.

### Afterwards

`ziggy-network-guard.service` re-checks at every boot, before the stack starts.
If the customer replaced their router (new subnet) or our address was handed to
another device while the hub was off, it falls back to DHCP. A home that boots
unreachable is the worst outcome, so the guard always prefers DHCP over a broken
pin.

Inspect or undo by hand:

```bash
sudo /opt/ziggy/scripts/linux/ziggy-network-pin.sh --status
sudo /opt/ziggy/scripts/linux/ziggy-network-pin.sh --revert
```

---

## The ship gate

`kit-ready-check.sh` runs as a step and **fails the build** — do not ship a hub
that does not pass it. It checks:

1. `data_key` present and exactly 32 bytes
2. `kit_manifest.yaml` with a real device_id, home_id and coordinator type
3. B2 credentials present and usable
4. Home Assistant reachable and the minted token authenticates
5. `HA_URL` is a hostname, not a literal IP
6. MQTT auth enforced (credentials work, anonymous rejected)
7. Dry-run backup exits 0
8. Home blanked — zero areas, so the customer opens a clean slate
9. **Cloudflare connector running *and* enabled at boot**
10. **Enrolled on the update channel with a valid cohort**

The last two are new. They close the gap where "imaged" and "reachable" could
diverge silently, and where a home could ship unable to ever receive a fix.

A customer home on `canary` is called out loudly — canary follows `origin/main`,
which is untagged code, and belongs only on a founder bench unit.

---

## Handover

1. The owner creates their account through the in-app onboarding wizard. The
   home is blank by design; rooms and device placement are user-driven.
2. Install the app, adopt the home, confirm a light and the chat both respond.
3. Confirm the home appears in `./scripts/fleet-health.py`.

---

## Which release the home lands on, and how it stays current

Imaging resolves **the newest `release-*` tag** at clone time
(`scripts/canary/hub-bootstrap.sh`), which is the same resolution
`scripts/linux/ziggy-update.sh` uses for a `production` hub — so imaging and OTA
can never disagree about "latest".

Afterwards the `update-channel` step has the hub on `ZIGGY_COHORT=production`
with `ziggy-update.timer` enabled. Every two minutes it resolves the newest
release tag, checks it out detached, and rebuilds.

**You ship with `./scripts/ship.sh -m "…"` from `main`. Nothing else reaches a
home.** Never SSH a file onto a hub; on 2026-08-10 hand-pushing left one
customer hub 105 uncommitted files off its tag, which *blocks* the updater, so
that home could no longer receive fixes at all.

> Note: `fleet-health.py` surfaces a home's release tag and cohort only when the
> home is *drifted*. To read the versions the fleet is actually on, query
> `GET /api/admin/homes/{home_id}/telemetry` and read the `deploy` block.

---

## When something fails

| Symptom | Cause | Fix |
|---|---|---|
| `no GitHub token` | not logged in to `gh` | `gh auth login` once on the Mac |
| `secrets file … is missing: B2_APP_KEY` | incomplete `~/.ziggy/*secrets*.txt` | add the key, re-run |
| `connector never registered` | wrong/revoked tunnel token, or no outbound 443 | re-provision the home, or check the hub's internet |
| `could not apply the static configuration` | netplan rejected it, or the link died | nothing to undo — it already reverted to DHCP |
| imaging unit died mid-run | link bounced, step failed | `ssh <hub> 'sudo journalctl -u ziggy-imaging --no-pager'`, then re-run with `--resume` |
| gate fails on the connector | tunnel step skipped (no token) | `sudo /opt/ziggy/scripts/linux/ziggy-tunnel.sh --token <t>` |
