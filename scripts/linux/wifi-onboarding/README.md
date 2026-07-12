# Ziggy Headless Wi-Fi Onboarding

Gets a **headless Ziggy hub with no Ethernet** online on first boot. Ubuntu
Server 24.04 LTS, NetworkManager (`nmcli`). No GUI, no keyboard, no pip.

## The problem

A fresh box with no cable and no known Wi-Fi can never reach the internet — and
without internet the owner can't tell it which Wi-Fi to join. This closes the
loop with a **self-hosted AP + captive portal**, the same pattern used by
smart-home hubs and IoT devices.

## Flow

```
boot ─▶ wait (bounded) for connectivity
          │ online?  ──yes──▶ done (nothing to do)
          │ no
          ▼
        raise WPA2 AP hotspot  "Ziggy-Setup-<device-id>"
          ▼
        serve bilingual (he/en, RTL) captive portal on http://10.42.0.1
          ▼
        owner submits home SSID + password
          ▼
        nmcli device wifi connect  ──▶ verify connectivity
          │ ok  ──▶ persist (autoconnect=yes) + tear down AP + done
          │ fail ─▶ show error, loop back to AP
```

## Files

| File | Purpose |
|------|---------|
| `nmcli-helpers.sh` | Sourced helpers: `run_nm` (argv-only nmcli wrapper), connectivity probes, Wi-Fi device discovery, SSID/AP-password derivation, structured `log`. |
| `connectivity-check.sh` | Bounded "am I online?" gate. Exit 0 online / 1 offline. `--once`, `--timeout`. |
| `wifi-onboard.sh` | Orchestrator: connectivity wait → AP up → portal → join → persist → AP down, with retry loop. `--dry-run`, `--status`. |
| `portal_server.py` | Stdlib-only captive-portal HTTP server: serves the page, parses + sanitizes credentials, joins via `nmcli` (argv-only), verifies, persists. |
| `portal.html` | Self-contained bilingual (he/en) RTL setup page. No external CSS/JS/fonts. |
| `test_portal_server.py` | `unittest` suite: parsing, sanitization, injection-proofing, join argv, HTML escaping, full HTTP round-trip. Hardware-free. |
| `../ziggy-wifi-onboard.service` | systemd unit that runs `wifi-onboard.sh` on boot. |

## Security

- **Injection-proof by construction.** Every `nmcli` call is a Python/Bash
  **argv list** handed to `subprocess`/exec with `shell=False`. A customer SSID
  or password containing `"; rm -rf / #` is inert — it can only ever be one
  argument value. Validation additionally rejects control characters and
  enforces IEEE SSID (≤32) and WPA2 passphrase (8–63) length limits.
- **No secrets invented.** The AP WPA2 password is *derived deterministically*
  from the box's `machine-id` (so it can be printed on the kit label at
  imaging) unless `ZIGGY_AP_PASSWORD` overrides it.
- Portal binds only while onboarding and is torn down on success. POST bodies
  are capped at 4 KB.

## Hardware-free testing

Everything runs without a Wi-Fi radio:

```bash
# Unit tests (parsing, sanitization, injection, HTTP round-trip)
python3 -m unittest scripts/linux/wifi-onboarding/test_portal_server.py -v
python3 scripts/linux/wifi-onboarding/portal_server.py --self-test

# Dry-run the whole boot flow — prints the plan, mutates nothing
scripts/linux/wifi-onboarding/wifi-onboard.sh --dry-run

# Exercise the REAL nmcli argv paths against a mock binary
ZIGGY_NMCLI_BIN=/path/to/mock-nmcli ZIGGY_WIFI_IFACE=wlan0 \
  scripts/linux/wifi-onboarding/wifi-onboard.sh --status
```

Key env overrides: `ZIGGY_NMCLI_BIN`, `ZIGGY_WIFI_DRYRUN=1`, `ZIGGY_WIFI_IFACE`,
`ZIGGY_DEVICE_ID`, `ZIGGY_AP_SSID`, `ZIGGY_AP_PASSWORD`, `ZIGGY_PORTAL_PORT`,
`ZIGGY_CONNECTIVITY_TIMEOUT`, `ZIGGY_MAX_CYCLES`, `ZIGGY_PYTHON_BIN`.

## Install (systemd)

Runs as **root** (needs to create NetworkManager system connections and bind
port 80). See the repo-root report for the exact hook to add to
`install-systemd-units.sh` and `image/cloud-init/user-data`.

```bash
sudo install -m0644 scripts/linux/ziggy-wifi-onboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ziggy-wifi-onboard.service
```

## Known hardware-only caveats

- **Guaranteed captive popup needs DNS hijack.** NetworkManager's shared mode
  runs a dnsmasq for DHCP but does not hijack DNS. The portal answers the common
  OS probe paths (`/generate_204`, `/hotspot-detect.html`, …) and serves the
  page at `http://10.42.0.1`, which is enough for most phones to offer "sign in
  to network". For a 100%-reliable auto-popup on every OS, add a dnsmasq
  `address=/#/10.42.0.1` catch-all to the AP — validate on real hardware.
- **AP + STA on one radio.** Joining the home Wi-Fi drops the AP (single-radio
  adapters can't host and join simultaneously); that is why the AP is torn down
  on success. A second adapter would let the AP persist during the join.
- Regulatory band/channel (`802-11-wireless.band bg`) and 5 GHz support depend
  on the specific adapter + country setting — verify on the shipped hardware.
