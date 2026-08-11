# Ziggy_03 for Tslil — Exact Imaging Runbook (2026-08-06)

> ## ⚠️ SUPERSEDED — use [RUNBOOK_NEW_HOME.md](RUNBOOK_NEW_HOME.md)
>
> This is a historical record of one specific build. **Do not follow it for a new
> home.** It has drifted from the code in ways that will bite you:
>
> * the bootstrap no longer pins a feature branch — it resolves the newest
>   `release-*` tag;
> * imaging has 16 steps, not 11 — the missing ones install the Cloudflare
>   connector, pin the LAN address and enrol the hub on the update channel;
> * it walks you through scp-ing a secrets file onto the hub, which
>   `scripts/new-home.sh` no longer does (secrets never touch the hub's disk).
>
> Kept for the account of what happened during that build.


Build a **real third home** ("Tslil's Home") from zero on a new mini PC, using the real beta
imaging process. Follow it top to bottom. Every step is exact. When a value must come from an
account, the step says exactly where to click.

**Configuration for this box:**
- **Zigbee: ON** at imaging (Tslil's dongle plugged in; coordinator captured + sealed).
- **Matter/Thread: OFF.** The capability *ships in the image* — the compose file and enable
  script are on the box — but no second Thread dongle, so we do not turn it on. He can enable it
  later with one script and a second dongle; nothing needs re-imaging.
- **Handed over owner-less** — Tslil creates his own account through onboarding. You do **not**
  claim it from your phone.
- **Remote access is now push-button** (it wasn't for David) — see Part I.

**Imaging branch:** `feat/beta-image-readiness`, at its current head (`git ls-remote origin feat/beta-image-readiness`), content-identical to the
fleet head `feat/unified-bundle-wizards`. `hub-bootstrap.sh` pins this branch; nothing to change.

**Hardware:** HM35 mini PC, AMD Ryzen 5 3550H = **x86-64**, so `amd64` Ubuntu is correct.
These ship with Ubuntu pre-installed — **we reflash anyway** (no legacy state, unknown vendor
password). Clean 24.04.

---

## What changed since David's box (2026-07-27) — read once, it affects steps below

| Change | Effect on this imaging |
|---|---|
| **HA URL self-heal + outage alert** landed (`5fe3c34`) | Canary lost 9h50m on 2026-08-05 when DHCP moved the hub and Ziggy kept talking to a dead IP. Tslil's box now re-finds HA automatically **and tells a human**. This code existed but was never committed — David's box does **not** have it (see "Fleet follow-ups"). |
| **New ship-gate check 4b** | Imaging FAILS if `HA_URL` is a literal IP. It must be `http://host.docker.internal:8123`. |
| **New ship-gate check 7 — blank home** | The gate now deletes every HA area + clears room assignments. David's box shipped with 6 leftover areas; Tslil's opens as a clean slate. **This is mutating and expected.** |
| **`GIT_SHA` now defaults to the real SHA** (`4c11033`) | Was the literal `dev`, which broke the phone's OTA check. No longer needs to be passed by hand. |
| **Tunnel connector token is now persisted** | Saved to `/etc/ziggy/imaging.kv`. Part I is a local lookup instead of a re-provision round-trip. |
| **Cloudflare is fully wired on the relay** | `CF_ZONE_ID`, `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_HUB_DOMAIN`, SSH ingress — all set. David's runbook said "we do remote access live together"; now it's scripted (Part I). |
| **Web/PWA onboarding path** (`b7cb9da`) | Tslil can onboard from **any browser** — he does not need the Android app installed to become owner. |
| **Matter/Thread support shipped** (`20f1f74`…`8b2eb99`) | Present in the image, `ENABLE_MATTER=0` skips it cleanly. |
| **Product fixes he inherits** | Rooms are user-driven only (no auto-placement), delete is final (full HA removal + Z2M unpair), preset "1% flash" fixed, IR self-heals on Broadlink DHCP drift, device classification, automation deletes verify removal. |

---

## What to physically gather first
1. The new mini PC + its power supply.
2. **Tslil's Zigbee dongle** (SLZB-07 or Sonoff Dongle-**E**) — plug it into the mini PC.
3. A **USB stick, 8 GB+** (contents erased) — reuse a previous install stick if still flashed.
4. **HDMI monitor + USB keyboard** for the mini PC.
5. **Ethernet cable** to the router — see the cable note below.
6. Tslil's email — **confirmed: `tslilkeren7@gmail.com`** (his home's owner). Nothing to look up.
7. (His Zigbee sensors are NOT needed here — he pairs them at his own home; see Part G.)

> ### ⚠️ If you only have one Ethernet cable, your own home (Canary) goes offline during this
> While the cable is on the new box: your remote control, chat/AI and daily backup pause; local
> Zigbee keeps working if Canary stays powered; I lose SSH into Canary. Everything recovers on
> its own when the cable goes back (Part K). The mini PC also has Wi-Fi — say so if you'd rather
> not down your home and I'll give you the Wi-Fi variant.

> **Dongle note:** this assumes a Silabs coordinator (SLZB-07 or Sonoff Dongle-**E**) → adapter
> `ezsp`/`ember`, auto-picked with fallback. If it's a Sonoff Dongle-**P** (the round
> Texas-Instruments one), **stop and tell me** — it needs `zstack`, which is not the default.

---

## PART A — Accounts (on your Mac, ~5 min)

Reuse the founder relay admin + master key. **Do not reset anything.** You need the reusable
imaging token (already made) and **one Tslil-specific backup key**.

### A1. Imaging token — reuse
You created `ziggy-imaging` for David (fine-grained, `Ziggy_PC`, Contents: Read-only). It lives at
`~/.ziggy/imaging-token.txt`. **If it has expired** (90-day expiry, created 2026-07-27 → expires
~2026-10-25, so it should still be valid), re-mint it the same way at
https://github.com/settings/tokens?type=beta.

### A2. A per-home Backblaze key for Tslil (reuse the existing bucket)
1. Backblaze → left menu **Application Keys** → **Add a New Application Key**.
2. Name of Key: `ziggy-tslil`
3. Allow access to Bucket(s): **ziggy-backups-prod**
4. Type of Access: **Read and Write** → **Create New Key**.
5. Copy the **keyID** and **applicationKey** (shown once). Endpoint is the same as always:
   `s3.eu-central-003.backblazeb2.com`.

---

## PART B — Stage Tslil's imaging values in one file (on your Mac)
```
mkdir -p ~/.ziggy && chmod 700 ~/.ziggy
cat > ~/.ziggy/tslil-secrets.txt <<'EOF'
RELAY_ADMIN_EMAIL=silentyouval@gmail.com
RELAY_ADMIN_PASSWORD=PASTE_FROM_canary-secrets
MASTER_KEY_B64=PASTE_FROM_canary-secrets
B2_KEY_ID=PASTE_ziggy-tslil_keyID
B2_APP_KEY=PASTE_ziggy-tslil_applicationKey
B2_ENDPOINT=s3.eu-central-003.backblazeb2.com
EOF
chmod 600 ~/.ziggy/tslil-secrets.txt
open -e ~/.ziggy/tslil-secrets.txt
```
- `RELAY_ADMIN_PASSWORD` and `MASTER_KEY_B64`: the **same values** from `~/.ziggy/canary-secrets.txt`.
- Keep the `KEY=value` shape, no spaces around `=`. Save, close.

---

## PART C — Make the Ubuntu USB installer (on your Mac, ~10 min — skip if reusing)
1. Download **Ubuntu 24.04** (NOT 26.04):
   **https://releases.ubuntu.com/24.04/ubuntu-24.04.4-live-server-amd64.iso** (~3 GB).
2. Flasher: https://etcher.balena.io → macOS version → drag to Applications → open.
3. Plug in the USB stick.
4. balenaEtcher: **Flash from file** → the `ubuntu-…-amd64.iso`; **Select target** → your USB
   (check the size so it isn't your Mac disk); **Flash!** → wait for "Flash Complete".
5. Eject and unplug.

---

## PART D — Install Ubuntu on the mini PC (~15 min)
1. Mini PC **off**: plug in the **USB stick**, **monitor (HDMI)**, **keyboard**, **Ethernet
   cable**, and **Tslil's Zigbee dongle**.
2. Power on and **tap `F7` repeatedly** for the boot menu (HM35). If none appears, power off and
   tap **`Del`** for BIOS, set USB first, save/exit. Choose the **USB / "UEFI"** entry.

2b. **⚠️ ALWAYS DO THIS — add `nomodeset` or the screen goes black.** Confirmed on every unit in
   this fleet: the Ryzen 3550H / Radeon Vega black-screens the installer console under `amdgpu`.
   At the **GRUB menu** ("Try or Install Ubuntu Server"):
   - Highlight **`Try or Install Ubuntu Server`**, press **`e`** to edit.
   - Find the long line **starting with `linux`** (contains `/casper/vmlinuz`, usually ends
     `quiet splash ---`).
   - Go to the **end of that line**, append a space + `nomodeset`.
   - Press **`Ctrl + X`** (or **F10**) to boot.
   It only affects the local monitor during install; we run headless over SSH afterward.

3. In the installer:
   - Language **English** → Enter.
   - "Installer update available?" → **Continue without updating**.
   - Keyboard **English (US)** → Done.
   - **Ubuntu Server** (plain, not minimized) → Done.
   - Network: leave as-is; **note the IP** → Done.
   - Proxy: **blank** → Done. Mirror: default → Done.
   - Storage: **Use an entire disk** → the **internal disk** (biggest; NOT the USB) → Done →
     **Continue** (erases that disk — expected).
   - Profile:
     - Your name: `Youval`
     - Server's name: **`ziggy-tslil`**
     - Username: `ziggy`
     - Password: choose one and **write it down** ("mini-PC password").
   - "Upgrade to Ubuntu Pro" → **Skip for now**.
   - SSH Setup: **tick "Install OpenSSH server"**. Import identity: **No**.
   - Featured snaps: **none** → Done.
4. At **Reboot Now**: Enter, and **pull out the USB** when the screen goes black.
5. At `ziggy-tslil login:` type `ziggy`, Enter, mini-PC password.
6. Get its IP:
   ```
   hostname -I
   ```
   Note the `192.168.x.x`. From your Mac's Terminal, do the rest over SSH:
   ```
   ssh ziggy@192.168.1.50        # replace with the real IP
   ```
7. **Install your SSH key** so I can drive the box headless (run on your **Mac**):
   ```
   ssh-copy-id ziggy@192.168.1.50
   ssh -o BatchMode=yes ziggy@192.168.1.50 'echo OK'      # must print OK
   ```

---

## PART E — Put Ziggy on the mini PC (~5 min)
**On your Mac** (replace the IP; type the mini-PC password when asked):
```
scp /Users/YouvalPolacsek/ziggy_pc/scripts/canary/hub-bootstrap.sh ziggy@192.168.1.50:~/
scp ~/.ziggy/tslil-secrets.txt ziggy@192.168.1.50:~/tslil-secrets.txt
```
**On the mini PC** — replace `PASTE_TOKEN` with the token from Part A1:
```
sudo GH_TOKEN=PASTE_TOKEN bash ~/hub-bootstrap.sh
```
Installs Docker, clones the code to `/opt/ziggy` on `feat/beta-image-readiness`. Ends with
**"DONE. Ziggy is at /opt/ziggy"**.

**Confirm it landed on the right code** — this must match what `git ls-remote origin feat/beta-image-readiness`
prints on your Mac:
```
sudo git -C /opt/ziggy rev-parse --short HEAD
```

---

## PART F — Identify Tslil's Zigbee dongle (~2 min)
On the mini PC:
```
ls -l /dev/serial/by-id/
dmesg | grep -iE "slzb|cp210|sonoff|ttyUSB|ttyACM" | tail
```
Copy the **whole** `usb-...-if00-port0` line — that's your `DONGLE` value. Then set the type:
- Path contains **`SLZB-07`** → `COORDINATOR_TYPE=smlight`
- Path contains **`Sonoff`** (Dongle-**E**) → `COORDINATOR_TYPE=sonoff_e`

(Nothing appears? Reseat the dongle, re-run. Network SLZB-07 instead of USB? Tell me — we use
`COORDINATOR_IP`, not a device path.)

---

## PART G — Image the hub: Zigbee ON, Matter OFF (~10–15 min)

**Decided: `ZIGBEE_PAIR_SECONDS=0`** — imaging captures and seals his coordinator IEEE only, and
Tslil pairs his own sensors at his home from the app. Same as David's box.

*(For a future bench-paired kit, `ZIGBEE_PAIR_SECONDS=300` holds the network open 5 minutes so
each sensor joins and gets folded into the sealed kit manifest.)*

On the mini PC — paste your real values into the placeholders:
```
cd /opt/ziggy
set -a; source ~/tslil-secrets.txt; set +a
DONGLE='/dev/serial/by-id/usb-...-if00-port0'      # from Part F
COORDINATOR_TYPE=smlight                            # or sonoff_e, from Part F
TSLIL_EMAIL='tslilkeren7@gmail.com'               # Tslil's real email — confirmed
PAIR_SECONDS=0                                      # decided: he pairs at his home
```
**First a dry run** (changes nothing, proves inputs + Zigbee config are valid):
```
sudo -E ENABLE_ZIGBEE=1 ENABLE_MATTER=0 ZIGBEE_PAIR_SECONDS="$PAIR_SECONDS" \
  COORDINATOR_TYPE="$COORDINATOR_TYPE" ZIGBEE_COORDINATOR_DEVICE="$DONGLE" \
  HOME_NAME="Tslil's Home" OWNER_EMAIL="$TSLIL_EMAIL" FRIENDLY_SLUG=tslil \
  ./scripts/factory/ziggy-image-device.sh --dry-run
```
Must end with `DRY-RUN complete`. If a value is missing, fix it in `~/tslil-secrets.txt`
(`nano ~/tslil-secrets.txt`), re-run the `source` line, dry-run again.

**Then the real run** (identical, minus `--dry-run`):
```
sudo -E ENABLE_ZIGBEE=1 ENABLE_MATTER=0 ZIGBEE_PAIR_SECONDS="$PAIR_SECONDS" \
  COORDINATOR_TYPE="$COORDINATOR_TYPE" ZIGBEE_COORDINATOR_DEVICE="$DONGLE" \
  HOME_NAME="Tslil's Home" OWNER_EMAIL="$TSLIL_EMAIL" FRIENDLY_SLUG=tslil \
  ./scripts/factory/ziggy-image-device.sh
```

13 numbered steps: provision his home in the relay (mints his Cloudflare tunnel +
`tslil.ziggy-home.com`), wire MQTT + HA, bring z2m up and read his **real** coordinator IEEE,
seal the per-home key + kit manifest, arm daily encrypted backups, **blank the home so it opens
with zero rooms**, and land a first backup in Backblaze. Ends with **kit-ready**.

> - `matter-enable` will print *"ENABLE_MATTER!=1 — skipping"*. **That is correct and expected.**
> - If z2m is slow to start the script waits; if the adapter is wrong for the firmware it auto-flips
>   `ezsp`↔`ember` and retries.
> - Any step that fails stops the run and prints why. Fix the cause, re-run with `--resume`.
>   Paste me the output — don't improvise.

When it succeeds, wipe the secrets copy off the hub:
```
shred -u ~/tslil-secrets.txt 2>/dev/null || rm -f ~/tslil-secrets.txt
```

---

## PART H — Validate (~3 min)
On the mini PC:
```
cd /opt/ziggy && sudo ./scripts/canary-validate.sh
```
**All non-hardware rows must be PASS.** Paste me the table.

Then these four one-liners — each must match what's in brackets:
```
# 1. the container is running the code we think it is  [prints the same SHA as above, NOT 'dev']
docker exec ziggy-ziggy-1 printenv ZIGGY_GIT_SHA

# 2. HA address is DHCP-immune                          [http://host.docker.internal:8123]
sudo grep '^HA_URL=' /opt/ziggy/.env

# 3. Ziggy can reach the MQTT broker                    [0]
docker exec ziggy-ziggy-1 python3 -c "import socket;s=socket.socket();s.settimeout(2);print(s.connect_ex(('mosquitto',1883)))"

# 4. Zigbee is alive                                    [coordinator + 'online' lines]
docker logs ziggy-zigbee2mqtt-1 2>&1 | grep -iE "online|coordinator|adapter" | tail
```

---

## PART I — Remote access (~5 min, now scripted)

The relay already minted Tslil's tunnel during imaging. Install the connector on his box.

On the mini PC:
```
# The connector token was saved by imaging (root-owned, 0600)
sudo grep '^TUNNEL_TOKEN=' /etc/ziggy/imaging.kv | cut -d= -f2-
```
Then, using that value:
```
curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb
sudo dpkg -i /tmp/cloudflared.deb
sudo cloudflared service install PASTE_TUNNEL_TOKEN
systemctl status cloudflared --no-pager | head -5      # must be active (running)
```
It is a **remotely-managed** connector: routing lives in Cloudflare, so it picks up SSH ingress and
any future route change with no restart, and it reconnects by itself when Tslil moves the box to
his own house.

**Verify from your Mac:**
```
curl -s -o /dev/null -w '%{http_code}\n' https://tslil.ziggy-home.com/health     # 200
```
His home is now reachable from anywhere. His app address is `https://tslil.ziggy-home.com`.

---

## PART J — Hand over to Tslil, owner-less (~5 min)
**Do NOT claim it from your phone** — the first person to complete onboarding becomes the owner,
and that must be Tslil.

He has two doors; both produce the same rich Hebrew wizard (pair → create account → sensors →
person → notifications → location → done):
1. **Browser / PWA (no install needed, new since David):** `https://tslil.ziggy-home.com`
   — or `http://<mini-PC-IP>:8001` on the same Wi-Fi.
2. **Android app:** a Play Internal Testing invite to his Google account (say the word and I'll set
   it up), or sideload the APK.

Then:
3. **At his home:** he plugs the mini PC into power + his router. In the app, **Add device →
   Zigbee**, puts each sensor into pairing mode, and they join his coordinator. (His dongle and
   his box are a matched backup set — that's why we captured the coordinator at imaging.)
4. Confirm with him: interface is **Hebrew, right-to-left**, times are **Israel time**, and turning
   a device on/off works.

---

## PART K — Close out
1. **Give your home its cable back** (if you swapped it): move Ethernet back to Ziggy_01 (Canary).
   It recovers on its own — the tunnel reconnects, the next backup catches up.
2. **Do NOT enable the OTA auto-update timer on this box.** `ziggy-update.timer`'s canary cohort
   force-syncs to `origin/main`, which is currently **older** than the imaging branch — enabling it
   would roll Tslil's hub *backwards*. Imaging does not install it; leave it that way until
   `main` is advanced to the fleet head.
3. Tell me the `HOME_ID` from the imaging output so I can record Ziggy_03 in the fleet.

---

## Done?
When Part H is all-PASS, Part I returns 200, and Tslil has onboarded and controlled a device —
**Ziggy_03 is live** and you're a **fleet of three**. This is also the first box to ship with the
DHCP self-heal, the blank-home gate, and scripted remote access.

## Fleet follow-ups (not today, but don't lose these)
- **David's + Canary's hubs do NOT have the HA self-heal / outage alert** — the modules only landed
  today. Both boxes need a `git pull` + rebuild on their branch to get the same protection.
- **`origin/main` is 7 days behind the fleet head.** Until it's advanced, OTA auto-update is unsafe
  fleet-wide.
- The relay's `/api/homes/{id}/health` fix (telemetry-derived instead of a doomed direct fetch) is
  committed but **not yet deployed to Fly** — fleet health still reads false-negative until
  `flyctl deploy` runs.
- Backup → wipe → restore DR drill still unproven on real hardware (bench task, spare unit).

## If anything goes wrong
Copy the **exact command** and its **exact output**, paste it to me, and I'll give the precise fix.
Don't improvise — I'd rather adjust the script than have you guess.
