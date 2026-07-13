# Canary Home Rebuild — Exact Runbook

This rebuilds your own home ("Canary Home") from zero on a spare mini PC using
the real beta imaging process. Follow it top to bottom. Every step is exact.
When a value must come from one of your accounts, the step tells you exactly
where to click to get it.

**Two phases:**
- **PHASE 1 (this doc, you do it alone):** wipe + rebuild the hub, prove it works
  on your home Wi-Fi, claim it from your phone, confirm Hebrew. Safe — it does
  **not** touch your current live home or the cloud relay.
- **PHASE 2 (do it with Claude):** deploy the new relay, Cloudflare per-home
  routing, remote access, support SSH, and the backup→restore drill. These can
  affect your *current* production home, so we do them together. When Phase 1 is
  green, just say "let's do Phase 2".

Your laptop is a Mac. Your mini PC is assumed to be an Intel/AMD (x86-64) box.
**30-second check:** if the box or its spec sheet says "Intel" or "AMD" or
"N100/N305/Ryzen", you're fine. If it says "ARM", "Rockchip", or "RK35xx",
**stop and tell Claude** — the download is different.

---

## What to physically gather first
1. The spare mini PC + its power supply.
2. A **USB stick, 8 GB or bigger** (its contents get erased).
3. A **monitor with HDMI** + a **USB keyboard**, to plug into the mini PC for the install.
4. An **Ethernet cable** from your router to the mini PC.
5. Your phone, on the **same Wi-Fi** as the mini PC.

---

## PART A — Make 3 things in your accounts (on your Mac, ~15 min)

### A1. GitHub token (so the mini PC can download the code)
1. Go to https://github.com/settings/tokens
2. Click **Generate new token** → **Generate new token (classic)**.
3. Note = `ziggy-canary`. Expiration = `90 days`.
4. Under **Select scopes**, tick the top box **`repo`**.
5. Click **Generate token** (green button at the bottom).
6. **Copy the token** (starts with `ghp_`). Paste it into a note for a minute — you'll use it in Part E.

### A2. Backblaze account + bucket + key (cloud backup storage)
1. Go to https://www.backblaze.com/sign-up/cloud-storage and sign up (email + password). Verify your email.
2. You may be asked for a card — B2 gives 10 GB free; the Canary uses far less.
3. Once logged in, left menu → **Buckets** → **Create a Bucket**:
   - Bucket Unique Name: `ziggy-backups-prod`
   - Files in Bucket are: **Private**
   - Default Encryption: **Disable**
   - Object Lock: **Disable**
   - Click **Create a Bucket**.
4. On the bucket you just made, note the line **Endpoint:** e.g. `s3.us-west-004.backblazeb2.com`. **Copy that whole endpoint** — you need it later.
5. Left menu → **Application Keys** → **Add a New Application Key**:
   - Name of Key: `ziggy-canary`
   - Allow access to Bucket(s): **ziggy-backups-prod**
   - Type of Access: **Read and Write**
   - Click **Create New Key**.
6. It now shows **keyID** and **applicationKey** — this is the **only time** they're shown. **Copy both.**

### A3. Your existing relay admin password
You set this when you first deployed the Ziggy relay. Find it in your password
manager / notes (email = `silentyouval@gmail.com`).
- **If you have it:** good, keep it handy.
- **If you can't find it:** tell Claude — do not guess; we'll reset it in Phase 2.

### A4. Your founder master backup key
This is the one key that encrypts all backups.
- **If you already generated one** (check your password manager for something like
  "Ziggy master key" — a ~44-character string ending in `=`): use that, keep it handy.
- **If you have never made one:** make it now on your Mac and save it:
  ```
  head -c 32 /dev/urandom | base64
  ```
  Copy the output into your password manager as "Ziggy master key". You'll paste it during imaging.

---

## PART B — Save your imaging values in one file (on your Mac)
So you're not hunting for values later, put them in one protected file:
```
mkdir -p ~/.ziggy && chmod 700 ~/.ziggy
cat > ~/.ziggy/canary-secrets.txt <<'EOF'
RELAY_ADMIN_EMAIL=silentyouval@gmail.com
RELAY_ADMIN_PASSWORD=PASTE_YOUR_EXISTING_RELAY_ADMIN_PASSWORD
MASTER_KEY_B64=PASTE_YOUR_MASTER_KEY
B2_KEY_ID=PASTE_BACKBLAZE_keyID
B2_APP_KEY=PASTE_BACKBLAZE_applicationKey
B2_ENDPOINT=PASTE_BACKBLAZE_ENDPOINT
EOF
chmod 600 ~/.ziggy/canary-secrets.txt
open -e ~/.ziggy/canary-secrets.txt
```
The last line opens the file in TextEdit — replace each `PASTE_...` with your real
value from Part A, save, close. (Keep the `KEY=value` shape, no spaces around `=`.)

---

## PART C — Make the Ubuntu USB installer (on your Mac, ~10 min)
1. Download the OS: go to https://ubuntu.com/download/server → click **Download 24.04 LTS**. You get a file named like `ubuntu-24.04.x-live-server-amd64.iso` in your Downloads.
2. Download the flasher: go to https://etcher.balena.io → **Download** → the macOS version. Open the downloaded file and drag **balenaEtcher** to Applications. Open it (if macOS blocks it: System Settings → Privacy & Security → "Open Anyway").
3. Plug the USB stick into your Mac.
4. In balenaEtcher:
   - **Flash from file** → pick the `ubuntu-...-amd64.iso` from Downloads.
   - **Select target** → pick your **USB stick** (double-check the size so you don't pick your Mac disk).
   - **Flash!** → enter your Mac password if asked → wait ~5–10 min → "Flash Complete".
5. Eject the USB (drag to trash / `⌘E`), unplug it.

---

## PART D — Install Ubuntu on the mini PC (~15 min)
1. With the mini PC **off**: plug in the **USB stick**, the **monitor (HDMI)**, the **keyboard**, and the **Ethernet cable**.
2. Power it on and immediately **tap** the boot-menu key repeatedly. It's one of: **F7**, then if that doesn't work try **F11**, **F12**, **Esc**, or **Del**. A menu of drives appears — choose the one with your **USB / "UEFI"** in the name.
3. The Ubuntu installer starts. Make these choices:
   - Language: **English** → Enter.
   - "Installer update available?": **Continue without updating**.
   - Keyboard: **English (US)** (or your layout) → Done.
   - Type of install: **Ubuntu Server** (the plain one, not minimized) → Done.
   - Network: leave it as-is (Ethernet gets an address automatically). **Write down the IP address** it shows, like `192.168.1.50` → Done.
   - Proxy: leave **blank** → Done.
   - Mirror: leave default → Done.
   - Storage: **Use an entire disk** → pick the **internal disk** (usually the biggest one; NOT your ~8–32 GB USB) → Done → on the summary → **Continue** (this erases that disk — that's expected).
   - Profile setup:
     - Your name: `Youval`
     - Your server's name: `ziggy-canary`
     - Pick a username: `ziggy`
     - Password: choose one and **write it down** (call it the "mini-PC password").
   - "Upgrade to Ubuntu Pro": **Skip for now**.
   - SSH Setup: **tick "Install OpenSSH server"**. Import identity: **No**.
   - Featured server snaps: **select none** → Done.
4. It installs. When it says **Reboot Now**: press Enter, and **pull out the USB stick** when the screen goes black. It boots into Ubuntu.
5. At the `ziggy-canary login:` prompt, type `ziggy`, Enter, then your mini-PC password.
6. Get its IP again (in case it changed): type this and press Enter:
   ```
   hostname -I
   ```
   Note the `192.168.x.x` number. You can now unplug the monitor/keyboard and do the rest from your Mac over SSH, or keep using the monitor. To use your Mac, open the Mac **Terminal** app and run (replace the number):
   ```
   ssh ziggy@192.168.1.50
   ```
   Type `yes` if asked, then the mini-PC password.

---

## PART E — Put Ziggy on the mini PC (~5 min)
**On your Mac**, copy the bootstrap script and your secrets file to the mini PC (replace the IP with your mini PC's, and type the mini-PC password when asked):
```
scp /Users/YouvalPolacsek/ziggy_pc/scripts/canary/hub-bootstrap.sh ziggy@192.168.1.50:~/
scp ~/.ziggy/canary-secrets.txt ziggy@192.168.1.50:~/canary-secrets.txt
```
**On the mini PC** (console or your `ssh` session), run this — replace `ghp_YOURTOKEN` with the GitHub token from Part A1:
```
sudo GH_TOKEN=ghp_YOURTOKEN bash ~/hub-bootstrap.sh
```
This installs Docker, downloads the code to `/opt/ziggy`, and puts it on the beta branch.
It ends with **"DONE. Ziggy is at /opt/ziggy"**.

---

## PART F — Image the hub (the real thing, ~10–15 min)
On the mini PC:
```
cd /opt/ziggy
set -a; source ~/canary-secrets.txt; set +a
```
**First do a dry run** (changes nothing, proves the inputs are good):
```
sudo -E ENABLE_ZIGBEE=0 HOME_NAME="Canary Home" OWNER_EMAIL=silentyouval@gmail.com \
  ./scripts/factory/ziggy-image-device.sh --dry-run
```
It should end with `DRY-RUN complete` and exit cleanly. If it complains a value is
missing, fix that line in `~/canary-secrets.txt` (`nano ~/canary-secrets.txt`), re-run
the `source` line, and dry-run again.

**Then the real run** (leave off `--dry-run`):
```
sudo -E ENABLE_ZIGBEE=0 HOME_NAME="Canary Home" OWNER_EMAIL=silentyouval@gmail.com \
  ./scripts/factory/ziggy-image-device.sh
```
It runs 11 numbered steps and finishes with **kit-ready** + a first backup uploaded to
Backblaze. If a step fails, it stops and prints why; fix the cause and re-run with
`--resume` (it continues where it stopped). Paste me the output if any step fails.

When it succeeds, delete the secrets copy on the hub:
```
shred -u ~/canary-secrets.txt 2>/dev/null || rm -f ~/canary-secrets.txt
```

---

## PART G — Validate (~2 min)
On the mini PC:
```
cd /opt/ziggy && sudo ./scripts/canary-validate.sh
```
You get a table of PASS / SKIP-HARDWARE. **All non-hardware rows must be PASS.**
Paste the table to me regardless — green means Phase 1 succeeded.

---

## PART H — Claim it from your phone + check Hebrew (~5 min)
1. Make sure your **phone is on the same Wi-Fi** as the mini PC.
2. On your phone's browser, go to: `http://192.168.1.50/pair` (use the mini PC's IP).
3. You should see a **Hebrew** setup page ("בואו נחבר את זיגי") with a QR code.
4. Open the **Ziggy app** and follow its onboarding to scan that QR / enter the code. The first phone to do this becomes the owner.
5. In the app, confirm: the interface is **Hebrew, right-to-left**, and the clock/times look like **Israel time**.

If the app can't reach it, that's the LAN-vs-cloud boundary — tell me and we handle it in Phase 2.

---

## Phase 1 done?
If Part G is all-PASS and Part H shows a Hebrew app talking to the Canary — **Phase 1 is a success.** Tell me "Phase 1 green" and we start Phase 2 together:
- add your Zigbee coordinator + pair a real sensor and the Broadlink remote,
- deploy the new relay + Cloudflare per-home routing (remote access from anywhere),
- run the backup→wipe→restore drill,
- then decide go/no-go on building the first beta image.

## If anything goes wrong
Copy the exact command you ran and the exact output, paste it to me, and I'll tell
you the precise fix. Don't improvise — I'd rather adjust the script than have you guess.
