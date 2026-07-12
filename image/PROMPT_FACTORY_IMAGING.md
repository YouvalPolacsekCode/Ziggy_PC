# PROMPT_FACTORY_IMAGING.md — operator imaging runbook

The step-by-step an operator follows to image ONE Ziggy hub. It wraps
`scripts/factory/ziggy-image-device.sh` and owns the human ceremony (relay login,
master-key paste, kit-manifest values). The seal specifics live in
`docs/SEAL_KEY_SNIPPET_FOR_FACTORY_IMAGING.md`.

## 0. Before you start — have these ready

| Thing | Where from | Secret? |
|---|---|---|
| A flashed hub on the golden base | `image/README.md` (cloud-init or Packer) | no |
| Relay admin email + password | founder credentials | yes |
| Founder **master key** (base64, 32 bytes) | 1Password → paste when prompted | **yes — never logged** |
| Per-home Backblaze app key (`B2_KEY_ID`/`B2_APP_KEY`) | B2 console or `b2 application-key create` (SEAL §4) | yes |
| Coordinator type | kit sheet: `smlight` or `sonoff_e` | no |
| Coordinator IEEE | read after pairing the Zigbee stick | no |
| Home name / owner email | the customer | no |

Secrets are supplied via **environment variables or interactive prompts** — never
committed, never hardcoded. The script `unset`s the master key after the seal.

## 1. SSH into the hub

```bash
ssh ziggy@<hub-ip>
cd /opt/ziggy
git status   # confirm the pinned release tag
```

## 2. Dry-run first (no relay, no hardware, no secrets)

Proves the toolchain end-to-end into a sandbox; touches nothing real:

```bash
./scripts/factory/ziggy-image-device.sh --dry-run
```

Expect `DRY-RUN complete`. Inspect the printed sandbox `env` + `etc-ziggy/`.

## 3. Pair the Zigbee coordinator, note its IEEE

Bring the stick up, pair it, and record `COORDINATOR_IEEE`
(e.g. `00:12:4b:00:11:22:33:44`). Set `ENABLE_ZIGBEE=1` if this kit ships Zigbee.

## 4. Run the real imaging

```bash
sudo COORDINATOR_TYPE=smlight \
     COORDINATOR_IEEE=00:12:4b:00:11:22:33:44 \
     B2_KEY_ID=... B2_APP_KEY=... \
     HOME_NAME="דירת ישראלי" OWNER_EMAIL=customer@example.com \
     ENABLE_ZIGBEE=1 \
     ./scripts/factory/ziggy-image-device.sh
```

You will be prompted for:
- **Relay admin email / password** (login → founder JWT).
- **Founder master key** (hidden paste from 1Password).

The script then, in order: mints identity + provisions the home in the relay,
generates MQTT creds, writes `/opt/ziggy/.env`, brings up HA + Mosquitto, onboards
HA headlessly + mints the long-lived token, seals the `data_key` + writes the kit
manifest, registers the tunnel, brings up Ziggy, runs the kit-ready gate, and
takes the first real backup.

### Resuming after a failure

State is recorded in `/etc/ziggy/imaging.state`. Re-run to continue:

```bash
sudo ./scripts/factory/ziggy-image-device.sh --resume
# or force-start at a step:
sudo ./scripts/factory/ziggy-image-device.sh --from seal
sudo ./scripts/factory/ziggy-image-device.sh --list   # see step state
```

## 5. Verify before you ship

```bash
sudo ./scripts/factory/kit-ready-check.sh      # the ship GATE — must say KIT READY
./scripts/canary-validate.sh                   # acceptance suite (SKIP-HARDWARE ok)
```

`kit-ready-check.sh` fails the ship if: `data_key` isn't 32 bytes, kit manifest is
missing/placeholder, HA token doesn't authenticate, MQTT accepts anonymous, or the
dry-run backup is non-zero. **Do not ship a hub that fails the gate.**

## 6. Record provenance

The relay now holds the home row + sealed keys. Note the `HOME_ID` the script
printed (adopt the relay-assigned id — see the identity contract note in the
script header). Fill the kit's `version.json` provenance and hand off.

## What the operator must NEVER do

- Paste the master key anywhere that logs (it transits memory only).
- Commit `/opt/ziggy/.env`, `docker/mosquitto/passwordfile`,
  `docker/ha-config/secrets.yaml`, or anything under `/etc/ziggy`.
- Ship on a failed kit-ready gate.
