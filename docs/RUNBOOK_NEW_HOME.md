# New Beta Home — Exact Runbook

**This is the runbook for every beta home.** It supersedes
[CANARY_REBUILD_RUNBOOK.md](CANARY_REBUILD_RUNBOOK.md),
[DAVID_ZIGGY_02_RUNBOOK.md](DAVID_ZIGGY_02_RUNBOOK.md) and
[TSLIL_ZIGGY_03_RUNBOOK.md](TSLIL_ZIGGY_03_RUNBOOK.md), which describe a
bootstrap and an imaging script that no longer exist in that form.

Follow it top to bottom. Every step is exact.

**Part 0 is one-time per operator.** Once your Mac is set up, building a home is
Parts 1–6 and takes about 45 minutes, most of it waiting.

---

## What changed, if you built a home before

You no longer scp a secrets file to the hub, no longer paste a GitHub token, no
longer start the Cloudflare tunnel by hand, and no longer touch the router. One
command does the build. You are prompted for **exactly one password**: the hub's,
once, so your SSH key can be installed.

---

# PART 0 — One-time setup on your Mac

Do this once, ever. Skip to Part 1 if your Mac is already set up.

### 0.1 The Ziggy repo

```bash
git clone https://github.com/YouvalPolacsekCode/Ziggy_PC.git ~/ziggy_pc
cd ~/ziggy_pc
```

Every command in this runbook is run from this directory.

### 0.2 GitHub CLI — this replaces the personal access token

```bash
brew install gh
gh auth login          # GitHub.com → HTTPS → login with a browser
gh auth token          # should print a token; if it does, you're done forever
```

`new-home.sh` mints a token from this login on every run and streams it to the
hub over stdin. You will never paste a `ghp_…` token again, and no token is ever
written to a hub's disk.

### 0.3 Backblaze B2 (backup storage)

1. Sign up at <https://www.backblaze.com/sign-up/cloud-storage>, verify email.
2. **Buckets → Create a Bucket**: name `ziggy-backups-prod`, Private, encryption
   Disable, Object Lock Disable.
3. Note the bucket's **Endpoint** (e.g. `s3.eu-central-003.backblazeb2.com`).
4. **Application Keys → Add a New Application Key**: name `ziggy-imaging`,
   bucket `ziggy-backups-prod`, access **Read and Write**.
5. Copy the **keyID** and **applicationKey** now — they are shown once.

### 0.4 Relay admin password

You need a relay admin login to provision homes. If you already have one, skip.

```bash
NEWPW=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24); echo "RELAY ADMIN PASSWORD = $NEWPW"
flyctl secrets set -a ziggy-relay RELAY_ADMIN_EMAIL=<your-email> RELAY_ADMIN_PASSWORD="$NEWPW"
flyctl apps restart ziggy-relay
```

Save `$NEWPW`.

### 0.5 Founder master key

One key for the whole fleet. It unseals every home's backup key, so treat it
like the crown jewels.

```bash
head -c 32 /dev/urandom | base64
```

Store the output in your password manager as "Ziggy master key".

### 0.6 The secrets file

```bash
mkdir -p ~/.ziggy && chmod 700 ~/.ziggy
cat > ~/.ziggy/ziggy-secrets.txt <<'EOF'
RELAY_ADMIN_EMAIL=PASTE_YOUR_EMAIL
RELAY_ADMIN_PASSWORD=PASTE_RELAY_ADMIN_PASSWORD
MASTER_KEY_B64=PASTE_FOUNDER_MASTER_KEY
B2_KEY_ID=PASTE_B2_KEY_ID
B2_APP_KEY=PASTE_B2_APP_KEY
B2_ENDPOINT=s3.eu-central-003.backblazeb2.com
EOF
chmod 600 ~/.ziggy/ziggy-secrets.txt
open -e ~/.ziggy/ziggy-secrets.txt
```

Replace each `PASTE_…` with the real value, save, close. Keep the `KEY=value`
shape, no spaces around `=`.

> **This file never leaves your Mac's home directory, and never goes in the
> repo.** `new-home.sh` streams it into the hub's RAM (`/dev/shm`) and shreds it
> when the run ends. Anything in `docs/` is cloned onto every customer hub — a
> credential committed there is a credential on every customer's box and in git
> history forever.

The five keys above are **required**; `new-home.sh` refuses to start without
them and names the ones you missed.

### 0.7 Ubuntu 24.04 USB installer

1. Download **exactly 24.04**, not the newest LTS:
   <https://releases.ubuntu.com/24.04/ubuntu-24.04.4-live-server-amd64.iso>
   (every imaging pin and test targets 24.04).
2. Install balenaEtcher: <https://etcher.balena.io>
3. Flash the ISO to an 8 GB+ USB stick.

Keep this stick. It is reusable for every home.

---

# PART 1 — Gather (per home)

| | |
|---|---|
| Hardware | Mini PC + PSU, Ubuntu USB stick, HDMI monitor, USB keyboard, Ethernet cable |
| Radios | Zigbee coordinator (SLZB-07 or Sonoff-E). A **second** dongle only for a Matter kit |
| Kit devices | Everything to be pre-paired, with batteries in |
| Details | The home's name, and the customer's email |

---

# PART 2 — Install Ubuntu on the mini PC (~15 min)

1. Mini PC **off**. Plug in: USB stick, monitor, keyboard, **Ethernet**.
   (Wired for imaging. Wi-Fi later if the customer needs it.)
2. Power on and immediately tap **F7** for the boot menu. Choose the USB stick.
3. At the GRUB menu, highlight **Try or Install Ubuntu Server** and press **`e`**.
   Find the line starting `linux`, go to its end, and add a space then:

   ```
   nomodeset
   ```

   Press **F10** to boot.

   > **This is not optional.** Every HM35 / Ryzen 3550H unit in the fleet
   > black-screens during install without `nomodeset`. If you skipped it and see
   > a blank screen, power-cycle and start Part 2 again.

4. Installer choices:
   - Language English, keyboard as you like
   - **Ubuntu Server** (not minimized)
   - Network: leave DHCP — the build pins the address for you later
   - No proxy, default mirror
   - Storage: **Use an entire disk** → confirm → **Continue** past the erase warning
   - Profile: your name, **server name** `ziggy`, **username `ziggy`**, a password
     you will type exactly once
   - **Tick "Install OpenSSH server"** ← required
   - Skip all snaps
5. Wait for install, choose **Reboot Now**, pull the USB out when told.
6. Log in at the console as `ziggy` and get the address:

   ```bash
   hostname -I
   ```

   Note the first address, e.g. `192.168.1.50`.

---

# PART 3 — Plug in the radios

Plug the Zigbee coordinator into a USB port now, before the build. The build
detects which coordinator it is and seals that into the kit manifest — if it is
not plugged in, the build stops and tells you.

Second (Thread) dongle only if this kit ships Matter.

---

# PART 4 — Dry run (~1 min)

From `~/ziggy_pc` on your Mac:

```bash
./scripts/new-home.sh \
  --host ziggy@192.168.1.50 \
  --name "Tslil's Home" \
  --owner tslil@example.com \
  --zigbee --pair-seconds 180 \
  --dry-run
```

This changes nothing. It validates your secrets file, your `gh` login, and
reachability, and prints **which release the home will land on**. Fix anything it
complains about before Part 5.

---

# PART 5 — Build the home (~25 min)

Same command, without `--dry-run`:

```bash
./scripts/new-home.sh \
  --host ziggy@192.168.1.50 \
  --name "Tslil's Home" \
  --owner tslil@example.com \
  --zigbee --pair-seconds 180
```

### Options

| Flag | Use it when |
|---|---|
| `--zigbee` | Any kit shipping a coordinator. **Omit** to validate the customer-adds-Zigbee-later path |
| `--pair-seconds 180` | How long permit-join stays open for pre-pairing. `0` = capture the coordinator only |
| `--matter` | Only when the kit ships a **second** Thread dongle |
| `--coordinator-type smlight\|sonoff_e` | Only to override detection |
| `--coordinator-device /dev/serial/by-id/…` | Only if detection reports an ambiguous dongle |
| `--coordinator-ip <ip>` | Network SLZB-07 instead of USB |
| `--resume` | Re-run after a failure; continues where it stopped |
| `--keep-sudo` | Leave passwordless sudo on the hub (default: revoked at the end) |

### What you will see, in order

| Phase | What is happening | Your involvement |
|---|---|---|
| **Preflight** | Secrets, `gh` token, target release | none |
| **Access** | Installs your SSH key, grants passwordless sudo | **type the hub password once** |
| **Code** | Clones `/opt/ziggy` at the newest release tag | none |
| **Coordinator** | Identifies the dongle and its type | none |
| **Image** | Dry run, then the real run as a detached systemd unit, streaming its log | **pair the kit devices** (below) |
| **Verify** | Backend, connector, OTA timer, network guard, stack service | none |

### Pairing the kit devices

When the log reaches the `zigbee-pair` step it opens permit-join for
`--pair-seconds`. Put each kit device into pairing mode one at a time and watch
for `Interviewing` → `successfully interviewed`. Devices that join here are
recorded in the kit manifest and ship pre-paired.

> Ctrl-C only detaches the log. The build keeps running on the hub. Re-attach:
> `ssh ziggy@<ip> 'sudo journalctl -u ziggy-imaging -f'`

---

# PART 6 — Verify before you leave

The build prints its own verification block and **exits non-zero if anything
fails**. Green means all of this passed:

- Ziggy backend healthy on `:8001`
- Cloudflare connector running **and enabled at boot**
- OTA timer enabled
- Network guard enabled
- Stack service enabled

It also prints the cohort (must be `production`), the release tag, the address
and whether it was pinned, and the mDNS name.

The **ship gate** (`kit-ready`) already ran inside imaging and would have failed
the build. It proves: 32-byte data key, a real kit manifest, B2 credentials, HA
reachable with a working token, `HA_URL` is a hostname not an IP, MQTT auth
enforced with anonymous rejected, a clean dry-run backup, **zero rooms** so the
customer opens a blank home, the connector, and the update channel.

Then confirm the home joined the fleet — allow ~5 minutes, since hubs deploy on
a 2-minute timer but report on a 5-minute one:

```bash
./scripts/fleet-health.py
```

> `fleet-health.py` shows a home's release tag **only when it is drifted**. To
> read the version a home is actually on:
> `GET /api/admin/homes/<home_id>/telemetry` → the `deploy` block.

---

# PART 7 — Handover to the customer

1. Sit them down with the app and let them **create their own account** through
   the onboarding wizard. Do not create it for them.
2. The home is blank by design. Walk them through naming their first room and
   placing a device or two — rooms and placement are user-driven and nothing
   auto-creates them.
3. Confirm together: a light responds, and chat responds.
4. Tell them updates arrive automatically and they never need to do anything.

Leave nothing on the hub. The build already shredded the imaging secrets, wiped
any secrets an earlier run left behind, and revoked passwordless sudo.

---

# PART 8 — How the home stays current

The `update-channel` step put the hub on `ZIGGY_COHORT=production` with
`ziggy-update.timer` enabled. Every 2 minutes it resolves the newest `release-*`
tag, checks it out, and rebuilds.

**Code reaches a home exactly one way:**

```bash
./scripts/ship.sh -m "what changed"     # cuts a release-* tag on main
```

Never SSH a file onto a hub, never `docker compose build` on a customer's box,
never hand-edit `/opt/ziggy`. On 2026-08-10 hand-pushing left one customer hub
105 uncommitted files off its tag — which *blocks* the updater, so that home
could no longer receive fixes at all — and a second hub running a commit that
existed nowhere in the repository.

New homes image at the newest release tag, so anything not in a tag reaches
neither existing homes nor new ones.

---

# Troubleshooting

| What you see | What it means | What to do |
|---|---|---|
| `No GitHub token` | not logged in to `gh` | `gh auth login`, then re-run |
| `secrets file … is missing: B2_APP_KEY` | incomplete secrets file | add the key, re-run |
| `no USB serial device found` | coordinator not plugged in | plug it in, re-run |
| `none recognisable as a Zigbee coordinator` | unusual dongle | re-run with `--coordinator-device` and `--coordinator-type` from the printed list |
| `bootstrap failed` | GitHub unreachable, or token lacks repo access | check `gh auth status` |
| `connector never registered` | bad/revoked tunnel token, or no outbound 443 | check the hub's internet; re-provision if it persists |
| `could not apply the static configuration` | netplan rejected it, or the link died | nothing to undo — it already reverted to DHCP. The home is fine |
| `KIT-READY GATE FAILED` | a ship-blocking check failed | read which check; **do not ship** until it passes |
| imaging unit died mid-run | a step failed | `ssh ziggy@<ip> 'sudo journalctl -u ziggy-imaging --no-pager'`, fix, re-run with `--resume` |
| blank screen during Ubuntu install | `nomodeset` missing | power-cycle, redo Part 2 step 3 |

**Never use `--from <step>`.** It re-runs steps ignoring state, and `ha-seed`
dies against an already-onboarded Home Assistant. Use `--resume`.

---

# Manual fallbacks

Only if you are recovering a hub, not building one.

```bash
# Cloudflare connector, by hand
sudo /opt/ziggy/scripts/linux/ziggy-tunnel.sh --token <connector-token>
sudo /opt/ziggy/scripts/linux/ziggy-tunnel.sh --status

# Address pin
sudo /opt/ziggy/scripts/linux/ziggy-network-pin.sh --status
sudo /opt/ziggy/scripts/linux/ziggy-network-pin.sh          # pin
sudo /opt/ziggy/scripts/linux/ziggy-network-pin.sh --revert # back to DHCP

# Ship gate on its own
sudo /opt/ziggy/scripts/factory/kit-ready-check.sh

# Imaging steps + progress
/opt/ziggy/scripts/factory/ziggy-image-device.sh --list
```

---

# Appendix — what is automated, and what is not

**Automated:** GitHub token, secrets handling and shredding, code at the newest
release tag, relay provisioning, MQTT credentials, HA onboarding, Zigbee stack
and coordinator detection, sealing, tunnel bring-up and verification, update
channel enrolment, address pin + mDNS, the ship gate, first backup.

**Still manual, by nature:** installing Ubuntu with `nomodeset`, plugging in the
radios, putting kit devices into pairing mode, and sitting with the customer at
handover.

**On addressing:** there is no DHCP reservation on the customer's router and
there cannot be one — a reservation is a row in *their* router and no portable
protocol asks for it. Instead the hub pins the lease the router already gave it,
behind a systemd timer that restores DHCP if connectivity is not proven, plus a
boot guard that falls back to DHCP if the router was replaced or the address was
taken. mDNS (`ziggy-<slug>.local`) means drift stops mattering either way.
