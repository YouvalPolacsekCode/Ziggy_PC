# Ziggy — Session Handover (2026-07-16)

Paste the block below into a fresh session to take over fully.

---

You're taking over the Ziggy beta-image effort mid-stream. Ziggy is a locally-hosted
AI smart-home platform (FastAPI backend + React/Capacitor app + Home Assistant + MQTT +
Zigbee + IR). We are productizing it into flashable beta mini-PC kits.

FIRST, read these memory files (they hold the durable context):
project_beta_image_readiness, project_mobile_lan_adoption, project_kit_prepair_zigbee,
project_hebrew_nativization, feedback_mobile_collab_style, feedback_real_life_validation,
feedback_ziggy_product_surface, project_ziggy_kit_hardware.
Then skim: docs/CANARY_REBUILD_RUNBOOK.md (incl. the "onboarding-wizard finding" at the
end), docs/KIT_ZIGBEE_AND_PREPAIR_MODEL.md, docs/ONBOARDING_AUDIT.md.

HOW TO WORK WITH ME: I'm the operator / product owner, NOT an engineer. Dumb everything
down, no jargon, ONE step at a time, give exact copy-paste commands, walk me click-by-
click through any account/hardware step. Only put `sudo` in a command when it's needed.
Confirm before anything that touches production. Nothing "works" until tested on real
hardware — tests earn the right to ask me to test, not to declare success.

CURRENT STATE (what's already done):
- All work is on branch feat/beta-image-readiness (pushed to origin; NOT merged to main).
- I rebuilt my own home from scratch tonight = the "Canary": HM35 mini PC (AMD Ryzen 5
  3550H, Ubuntu Server 24.04), home_id=home-69856ab2ab19d473. SSH: ziggy@10.100.102.15
  (my Canary password in my notes). Repo at /opt/ziggy on the beta branch.
- Validated on hardware: full imaging pipeline, kit-ready gate, a REAL AES-encrypted
  backup uploaded to Backblaze B2, HA crash-recovery, MQTT auth, no secrets in the image,
  Hebrew locale. canary-validate.sh passes.
- I REPLACED my old home: a cloudflared service on the Canary now serves my address
  app.ziggy-home.com (CNAME repointed). So my app reaches the Canary over HTTPS.
- The mobile app (Galaxy S24+, com.ziggyhome.app) connects: I created my owner account
  and see my home in full Hebrew RTL. A debug APK (per-home routing build) is installed.
- Fixes committed tonight: container-reachable HA_URL (host.docker.internal + extra_hosts),
  hide HA backup entity from the device list, B2 endpoint scheme, mosquitto RO-mount
  crash, container NTP, HA-config mount, canary-validate crash test.
- On the Canary I manually set HA_URL=http://10.100.102.15:8123 in /opt/ziggy/.env to get
  HA reachable (the code now writes host.docker.internal; either works).

KEY FACTS / GOTCHAS:
- Imaging creds live in ~/.ziggy/canary-secrets.txt (relay admin, master key, B2).
- SECURITY TODO: I pasted a GitHub token (ghp_...) and secrets in the old chat — REVOKE
  that GitHub token and mint a fresh one; treat pasted secrets as exposed.
- Android builds need JDK 21 (Android Studio JBR at
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home"); JDK 25 breaks Gradle.
  Build: ZIGGY_PC=~/ziggy_pc bash ~/ziggy_mobile/scripts/sync-frontend.sh, then
  cd ~/ziggy_mobile/android && JAVA_HOME=<JBR> ./gradlew assembleDebug ; adb install -r.
  WIRELESS ADB PORTS ROTATE constantly — use a USB-C→USB-C cable for stable adb.
- HA runs network_mode:host; the ziggy container reaches it via host.docker.internal.

** TWO KEY ONBOARDING/KIT WIRING ITEMS (the heart of the pre-paired-kit vision — do not lose these): **
  (i)  FACTORY-PAIRED DEVICES MUST FEED THE ONBOARDING LIST. The wizard's SensorsStep
       (rename each device + assign a room, with manifest-suggested names) is BUILT, but
       it only shows devices that come through the onboarding-sensors endpoint / kit
       manifest. The Zigbee-ON factory pairing must populate that list so the customer's
       pre-paired devices actually appear for them to name + place. (Ties item C -> B.)
  (ii) CUSTOMER MUST RELIABLY ENTER THE WIZARD ON FIRST RUN. Today there are two account-
       creation doors — LoginPage "setup" (bare, dumps to dashboard) vs the wizard's CLAIM
       step. A fresh home's first run must ALWAYS route into the rich wizard regardless of
       entry path (QR-pair, address, or login). Reproduced on the Canary: address entry
       hit the bare door and skipped onboarding entirely.
Together these two are what turn "box arrives pre-paired" into "customer opens app once,
walks a guided wizard, names their devices, assigns rooms, done." Both are in A/B/C below.

OUTSTANDING WORK (roughly prioritized):

A. FINISH THE CANARY (on hardware, with me):
   1. Apply pending fixes to the running Canary: re-pull + rebuild the ziggy service to
      pick up the "hide backup device" fix:
      `sudo GH_TOKEN=<fresh token> bash ~/hub-bootstrap.sh` then
      `cd /opt/ziggy && sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build ziggy`
   2. Turn Zigbee ON (it was imaged ENABLE_ZIGBEE=0): plug my dongle, detect it, bring up
      the zigbee2mqtt compose profile, seed z2m config, pair a real device. Validates the
      "add devices later" path every kit needs.
   3. FIX the HA<->MQTT config-entry: ha-seed.sh logged "MQTT flow did not create_entry ...
      cannot_connect" during imaging. Zigbee reaches HA via MQTT, so this MUST work.
   4. Pair the Broadlink RM4 (IR) and confirm TV/AC control.
   5. Prove backup -> wipe -> restore on the hardware (DR drill; ziggy-restore-device.sh).

B. ONBOARDING WIZARD entry fix (finding tonight — details in CANARY_REBUILD_RUNBOOK.md):
   The rich wizard IS built (MobileOnboarding.jsx: pair -> CLAIM -> SensorsStep [renames
   each device + assigns a room, with manifest-suggested names] -> StarterStep [starter
   automations] -> person/notify/location/motion). But there are TWO account-creation
   doors: LoginPage "setup" (bare, dumps you on the dashboard) vs the wizard's CLAIM. I
   came in via my home address tonight and hit the bare door, skipping the wizard. FIX:
   a fresh home's first run must reliably enter the wizard regardless of entry path. Also
   investigate why the native pair-redirect (App.jsx MobileOnboardingRedirector, device-
   token based) didn't fire post-setup.

C. ZIGBEE-ON IMAGING for pre-paired kits (see project_kit_prepair_zigbee):
   Build the ENABLE_ZIGBEE=1 imaging path: dongle detect (USB sonoff_e / network smlight
   via tcp://), z2m seed, pair devices DURING imaging, capture the REAL COORDINATOR_IEEE,
   then seal. Make the paired devices populate the onboarding SensorsStep list. My NEXT
   mini PC should be imaged Zigbee-ON. Model: kits ship pre-paired; dongle=network key,
   PC=device list; ship as a MATCHED SET (dongle+PC+devices together).

D. MOBILE multi-home (see project_mobile_lan_adoption): the app can't cleanly adopt a
   SECOND/LAN home (CORS + cleartext + onboarding-trigger); fix = route API/WS through
   CapacitorHttp (native, bypasses both) in frontend/src/lib/nativeApiBase.js. The address-
   repoint sidesteps this for my one home, but true multi-home needs it. Finish the
   add-home / switch-home UX (Stream 4 built the plumbing: homeConfig, pairingCapture).

E. CLOUD/RELAY Phase 2b (for multi-home + remote-from-anywhere + support SSH): deploy the
   updated relay code to Fly (ziggy-relay) — WS proxy, per-home public-hostname routing,
   config_guard, support SSH. Set Fly secrets first (CF_ZONE_ID/CF_API_TOKEN/CF_ACCOUNT_ID,
   ZIGGY_SUPPORT_ALLOWED_EMAILS; RELAY_ADMIN_PASSWORD already reset). Touches the live
   relay — do it deliberately with rollback. (My one home currently uses a direct
   cloudflared tunnel, not the relay.)

F. HEBREW (likely a dedicated session): DeviceControls.jsx per-action labels ("Turn On"/
   "Mode"/"Preset"/"Swing") + state labels ("Heating"/"Cooling") still English; plus a
   review pass with the hebrew-content-writer / hebrew-rtl-best-practices skills.

G. STORE PUBLISHING (blocked on Google identity verification + Apple payment): Google Play
   Internal Testing (+ iOS TestFlight later). A separate handoff prompt exists; ask me.

H. FINAL BETA GATES / CLEANUP: verify the ~10 history-leaked provider keys were revoked;
   revoke the GitHub token I pasted; hardware-test the headless Wi-Fi onboarding and
   factory-reset/safe-mode/customer-reset; decide the main-branch/OTA strategy now that my
   prod home = the Canary; then go/no-go on flashing the first beta units.

Start by asking me which of A–H I want to tackle, or just "where did we leave off." My
likely next want: finish the Canary (A) — turn on Zigbee and pair a real device.
