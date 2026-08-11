# Ziggy_02 for David — Exact Runbook (2026-07-27)

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


Build a **real second home** ("David's Home") from zero on the new mini PC, using the
real beta imaging process. Follow it top to bottom. Every step is exact. When a value
must come from an account, the step says exactly where to click.

This is **not** a throwaway box — it's David's live home. So two things differ from the
Canary rebuild:
1. **Zigbee is ON at imaging** (David's dongle is plugged in; we capture its coordinator,
   David pairs his own sensors later).
2. **We hand it over owner-less** — David creates his own account through the app's
   onboarding wizard. You (Youval) do **not** claim it.
3. **Remote access today** — after Phase 1 we set up David's Cloudflare tunnel together
   so he can control his home from anywhere.

**Code is already staged:** the imaging branch has been fast-forwarded to the exact SHA
running on your live Canary (`5f8c77f`), including the z2m-2.12.1 default and the
ezsp↔ember adapter auto-fallback. David's box images precisely what's proven on your home.

**Hardware:** HM35 mini PC, AMD Ryzen 5 3550H = **x86-64**, so `amd64` Ubuntu is correct.

**These units ship with Ubuntu pre-installed — we reflash anyway** (no legacy state, unknown
vendor password). Clean 24.04.

---

## What to physically gather first
1. The new mini PC + its power supply.
2. **David's Zigbee dongle** (SLZB-07 or Sonoff Dongle-**E**) — plug it into the mini PC.
3. A **USB stick, 8 GB+** (contents erased) — reuse your Canary-install stick if you still have it flashed.
4. **HDMI monitor + USB keyboard** for the mini PC.
5. **Ethernet cable** from the router to the mini PC — see the one-cable note below.
6. **David's email address** (his home's owner + backup-key name).
7. David's phone with the **Ziggy app** (see Part J for how he gets it).

> ### ⚠️ One Ethernet cable — your home (Canary) goes down during this
> You only have one cable, so you'll **move it from Ziggy_01 (Canary) to the new box** for the
> build. That's fine and expected — just know what it means while the cable is on the new box:
> - **Your own home's remote control + chat/AI + daily backup are OFFLINE** (Canary can't reach
>   the internet). Local Zigbee devices keep responding if Canary stays *powered*; anything cloud
>   (app-from-away, voice/chat, backups) pauses until the cable returns. You've said that's OK.
> - **I lose my live SSH view of Canary** the moment it's unplugged — so if you want me to check
>   anything on your home, tell me *before* you pull the cable. (I've already captured what I need:
>   Canary is on `5f8c77f`, healthy.)
> - **The cable goes back to Canary at the end** (Part J), and your home recovers on its own —
>   the tunnel reconnects, the next backup catches up.
>
> Prefer not to down your home? The mini PC has Wi-Fi — say so and I'll give you the Ubuntu-Server
> Wi-Fi steps instead. Otherwise we proceed with the cable-swap.

> **Dongle note:** this runbook assumes a Silabs coordinator (SLZB-07 or Sonoff Dongle-**E**),
> which uses adapter `ezsp`/`ember` — the imaging auto-picks the right one. If David's stick is a
> Sonoff Dongle-**P** (the round Texas-Instruments one), **stop and tell me** — it needs a
> different adapter (`zstack`) that isn't the default.

---

## PART A — Accounts (on your Mac, ~10 min)

You already have the founder relay admin + master key from the Canary setup — **reuse them,
do not reset anything.** You need **one reusable imaging token** (make once, use for every box)
and **one David-specific backup key**.

### A1. Fleet-wide imaging token (make ONCE, reuse for every unit)
This token is only used to download the code during imaging, and the bootstrap **wipes it off
the box right after cloning** — it never lives on David's hub. So it is *not* per-home: create it
once, name it `ziggy-imaging`, and reuse it for Ziggy_02, _03, … Store it in `~/.ziggy/`.
1. Go to https://github.com/settings/tokens?type=beta (**Fine-grained** tokens).
2. **Generate new token**. Name `ziggy-imaging`. Expiration 90 days.
3. **Resource owner** = your account. **Repository access** → *Only select repositories* → **`Ziggy_PC`**.
4. **Permissions** → Repository permissions → **Contents: Read-only** (nothing else).
5. **Generate token** → copy it (starts `github_pat_`). Save it in `~/.ziggy/imaging-token.txt`
   (`chmod 600`). You'll paste it in Part E — same token every future box.

*(Reusing your normal personal token works too, but a read-only, repo-scoped, dedicated token is
safer to type onto a box you're handing over — and do **not** reuse the token from the old chat;
that one should be revoked.)*

### A2. A per-home Backblaze key for David (reuse the existing bucket)
1. Log into Backblaze → left menu **Application Keys** → **Add a New Application Key**.
2. Name of Key: `ziggy-david`
3. Allow access to Bucket(s): **ziggy-backups-prod** (the bucket you already made).
4. Type of Access: **Read and Write** → **Create New Key**.
5. Copy the **keyID** and **applicationKey** (shown only once). The **endpoint** is the same
   one as Canary (e.g. `s3.eu-central-003.backblazeb2.com`).

*(No relay-admin reset, no new master key — those are founder-wide and already staged.)*

---

## PART B — Stage David's imaging values in one file (on your Mac)
```
mkdir -p ~/.ziggy && chmod 700 ~/.ziggy
cat > ~/.ziggy/david-secrets.txt <<'EOF'
RELAY_ADMIN_EMAIL=silentyouval@gmail.com
RELAY_ADMIN_PASSWORD=PASTE_FROM_canary-secrets
MASTER_KEY_B64=PASTE_FROM_canary-secrets
B2_KEY_ID=PASTE_ziggy-david_keyID
B2_APP_KEY=PASTE_ziggy-david_applicationKey
B2_ENDPOINT=s3.eu-central-003.backblazeb2.com
EOF
chmod 600 ~/.ziggy/david-secrets.txt
open -e ~/.ziggy/david-secrets.txt
```
- `RELAY_ADMIN_PASSWORD` and `MASTER_KEY_B64`: copy the **same values** out of your existing
  `~/.ziggy/canary-secrets.txt` (or your password manager).
- `B2_KEY_ID` / `B2_APP_KEY`: the new `ziggy-david` key from Part A2.
- Keep the `KEY=value` shape, no spaces around `=`. Save, close.

---

## PART C — Make the Ubuntu USB installer (on your Mac, ~10 min — skip if reusing)
1. Download **Ubuntu 24.04** (NOT 26.04):
   **https://releases.ubuntu.com/24.04/ubuntu-24.04.4-live-server-amd64.iso** (~3 GB).
2. Flasher: https://etcher.balena.io → Download the macOS version → drag balenaEtcher to Applications → open.
3. Plug in the USB stick.
4. In balenaEtcher: **Flash from file** → the `ubuntu-…-amd64.iso`; **Select target** → your USB
   (check the size so it isn't your Mac disk); **Flash!** → wait for "Flash Complete".
5. Eject and unplug the USB.

---

## PART D — Install Ubuntu on the mini PC (~15 min)
0. **Move the Ethernet cable:** unplug it from Ziggy_01 (Canary) and bring it to the new box.
   Your home's cloud features are now paused until Part J — expected.
1. Mini PC **off**: plug in the **USB stick**, **monitor (HDMI)**, **keyboard**, the **Ethernet
   cable** (now free), and **David's Zigbee dongle**.
2. Power on and **tap `F7` repeatedly** for the boot menu (HM35). If none, power off and tap
   **`Del`** for BIOS, set USB first, save/exit. Choose the **USB / "UEFI"** entry.
2b. **⚠️ ALWAYS DO THIS on these mini PCs — add `nomodeset` or the screen goes black.** The
   HM35's AMD Ryzen 3550H / Radeon (Vega) graphics black-screens the installer console under the
   `amdgpu` driver. At the **GRUB menu** (the "Try or Install Ubuntu Server" screen):
   - Highlight **`Try or Install Ubuntu Server`**, then press **`e`** to edit.
   - Find the long line that **starts with `linux`** (contains `/casper/vmlinuz`, usually ends
     `quiet splash ---`).
   - Go to the **end of that line** and append a space + `nomodeset` (e.g. `… quiet splash --- nomodeset`).
   - Press **`Ctrl + X`** (or **F10**) to boot.
   This is confirmed on **every unit in this fleet** — treat it as a required step, not a fix.
   (It only affects the local monitor during install; we run headless over SSH afterward, so the
   installed server needs nothing further.)
3. In the Ubuntu installer:
   - Language **English** → Enter.
   - "Installer update available?" → **Continue without updating**.
   - Keyboard **English (US)** → Done.
   - **Ubuntu Server** (plain, not minimized) → Done.
   - Network: leave as-is; **note the IP** it shows → Done.
   - Proxy: **blank** → Done. Mirror: default → Done.
   - Storage: **Use an entire disk** → the **internal disk** (biggest; NOT the USB) → Done →
     **Continue** (erases that disk — expected).
   - Profile:
     - Your name: `Youval`
     - Server's name: **`ziggy-david`**
     - Username: `ziggy`
     - Password: choose one and **write it down** ("mini-PC password").
   - "Upgrade to Ubuntu Pro" → **Skip for now**.
   - SSH Setup: **tick "Install OpenSSH server"**. Import identity: **No**.
   - Featured snaps: **none** → Done.
4. When it says **Reboot Now**: Enter, and **pull out the USB** when the screen goes black.
5. At `ziggy-david login:` type `ziggy`, Enter, mini-PC password.
6. Get its IP:
   ```
   hostname -I
   ```
   Note the `192.168.x.x`. From your Mac's **Terminal** you can now do the rest over SSH
   (replace the IP):
   ```
   ssh ziggy@192.168.1.50
   ```
   Type `yes` if asked, then the mini-PC password.

---

## PART E — Put Ziggy on the mini PC (~5 min)
**On your Mac** (replace the IP with David's mini PC; type the mini-PC password when asked):
```
scp /Users/YouvalPolacsek/ziggy_pc/scripts/canary/hub-bootstrap.sh ziggy@192.168.1.50:~/
scp ~/.ziggy/david-secrets.txt ziggy@192.168.1.50:~/david-secrets.txt
```
**On the mini PC**, run this — replace `ghp_YOURTOKEN` with the token from Part A1:
```
sudo GH_TOKEN=ghp_YOURTOKEN bash ~/hub-bootstrap.sh
```
Installs Docker, downloads the code to `/opt/ziggy` on the validated beta branch. Ends with
**"DONE. Ziggy is at /opt/ziggy"**.

---

## PART F — Identify David's Zigbee dongle (~2 min) — NEW
On the mini PC:
```
ls -l /dev/serial/by-id/
dmesg | grep -iE "slzb|cp210|sonoff|ttyUSB|ttyACM" | tail
```
You'll see one stable path under `/dev/serial/by-id/`. Copy the **whole** `usb-...-if00-port0`
line — that's your `DONGLE` value below. Then set the type:
- Path contains **`SLZB-07`** → `COORDINATOR_TYPE=smlight`
- Path contains **`Sonoff`** (Dongle-**E**) → `COORDINATOR_TYPE=sonoff_e`

(If nothing appears: reseat the dongle, re-run. If it's a network SLZB-07 instead of USB,
tell me — we use its IP, not a device path.)

---

## PART G — Image the hub, Zigbee ON (~10–15 min)
On the mini PC — **paste your real dongle path and email** into the two placeholders:
```
cd /opt/ziggy
set -a; source ~/david-secrets.txt; set +a
DONGLE='/dev/serial/by-id/usb-...-if00-port0'      # from Part F
COORDINATOR_TYPE=smlight                            # or sonoff_e, from Part F
DAVID_EMAIL='david@example.com'                     # David's real email
```
**First a dry run** (changes nothing, proves inputs + the Zigbee config are valid):
```
sudo -E ENABLE_ZIGBEE=1 ZIGBEE_PAIR_SECONDS=0 \
  COORDINATOR_TYPE="$COORDINATOR_TYPE" ZIGBEE_COORDINATOR_DEVICE="$DONGLE" \
  HOME_NAME="David's Home" OWNER_EMAIL="$DAVID_EMAIL" \
  ./scripts/factory/ziggy-image-device.sh --dry-run
```
Should end with `DRY-RUN complete`. If it says a value is missing, fix that line in
`~/.ziggy/david-secrets.txt` (`nano ~/david-secrets.txt`), re-run the `source` line, dry-run again.

**Then the real run** (drop `--dry-run`):
```
sudo -E ENABLE_ZIGBEE=1 ZIGBEE_PAIR_SECONDS=0 \
  COORDINATOR_TYPE="$COORDINATOR_TYPE" ZIGBEE_COORDINATOR_DEVICE="$DONGLE" \
  HOME_NAME="David's Home" OWNER_EMAIL="$DAVID_EMAIL" \
  ./scripts/factory/ziggy-image-device.sh
```
What happens: 12 numbered steps — provision David's home in the relay, wire MQTT + HA,
**bring z2m up and read David's real coordinator IEEE** (`ZIGBEE_PAIR_SECONDS=0` = capture only,
pair nothing now), seal the per-home key + kit manifest, arm daily encrypted backups, and land a
first backup in Backblaze. It ends with **kit-ready**.

> If z2m is slow to start, the script waits, and if the adapter is wrong for the dongle's
> firmware it auto-flips `ezsp`↔`ember` and retries — you don't need to do anything. If any step
> fails it stops and prints why; fix the cause and re-run with `--resume`. Paste me the output.

When it succeeds, wipe the secrets copy off the hub:
```
shred -u ~/david-secrets.txt 2>/dev/null || rm -f ~/david-secrets.txt
```

---

## PART H — Validate (~2 min)
On the mini PC:
```
cd /opt/ziggy && sudo ./scripts/canary-validate.sh
```
A table of PASS / SKIP-HARDWARE prints. **All non-hardware rows must be PASS**, and the Zigbee
row should now show the coordinator online. Paste me the table.

Quick Zigbee sanity check (optional):
```
docker logs ziggy-zigbee2mqtt-1 2>&1 | grep -iE "online|coordinator|adapter" | tail
```

---

## PART I — Remote access (Phase 2, we do this together — ping me)
David wants control from away, so before handover we give his home a stable Cloudflare address.
This needs a browser login to Cloudflare and DNS on `ziggy-home.com`, so **we do it live** —
say **"ready for Phase 2"** and I'll walk each step. The shape:
1. Install `cloudflared` on the hub, `cloudflared tunnel login` (you approve in the browser).
2. Create David's tunnel + route a hostname (e.g. **`david.ziggy-home.com`**) to `localhost:8001`.
3. Run it as a **systemd service** so it auto-starts on boot.
4. Register that tunnel URL with the relay so the app can reach David's home by name.

After this, David's home is reachable from anywhere — even after he moves the box to his house
(the tunnel is outbound; it reconnects on his network automatically).

---

## PART J — Hand over to David, owner-less (~5 min)
**Do NOT claim it from your phone** — the first phone to complete onboarding becomes the owner,
and that must be David.

1. **Get David the app:** the cleanest path is a **Play Internal Testing** invite to David's
   Google account (say the word and I'll set the invite up), or sideload the debug APK. He
   installs "Ziggy".
2. **David onboards via the pair path** (this is what triggers the rich Hebrew wizard —
   pair → create account → sensors → person → notifications → location → done):
   - On David's phone browser: `http://<mini-PC-IP>:8001/pair` on the same Wi-Fi, **or**
     `https://david.ziggy-home.com/pair` once Phase 2 is done.
   - He scans the QR / enters the code in the app and follows onboarding. **He** becomes owner.
3. **At David's home:** he plugs the mini PC into power + his router (Ethernet). Then in the app
   he opens **Add device → Zigbee**, puts each of his sensors into pairing mode, and they join his
   coordinator. (This is why we captured the coordinator at imaging — his dongle + box are a
   matched backup set.)
4. Confirm with David: interface is **Hebrew, right-to-left**, times look like **Israel time**,
   and turning a device on/off works.
5. **Give your home back its cable:** once David's box is powered down to travel (or plugged into
   *his* own router), move the Ethernet cable back to **Ziggy_01 (Canary)**. Your home reconnects
   on its own — the tunnel comes back and the next backup catches up. (At David's house he uses
   his own cable/router — step 3.)

---

## Done?
When Part H is all-PASS, Phase 2 is up, and David has onboarded and controlled a device —
**Ziggy_02 is live.** That also makes you a **fleet of two**, and finally validates the clean
Zigbee-ON image + the real-customer onboarding wizard on hardware for the first time.

## Not done today (separate bench task)
The **backup → wipe → restore** disaster drill can't run on David's live box. We prove restore on
a spare unit another day — David's daily backups are already armed by the seal step.

## If anything goes wrong
Copy the **exact command** and its **exact output**, paste it to me, and I'll give the precise
fix. Don't improvise — I'd rather adjust the script than have you guess.

## Security housekeeping (when convenient)
- The old `docs/CANARY_REBUILD_RUNBOOK.md` has real secret values pasted in Part B — worth
  scrubbing those out of the repo history.
- The GitHub token from an earlier chat is still worth rotating.
