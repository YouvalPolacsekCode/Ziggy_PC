# Third-party licenses — Ziggy beta hub image

The hub image bundles third-party software distributed as Docker images. When you
distribute a Ziggy hub (hardware handed to a customer counts as distribution),
you must include the applicable license texts.

| Component | License | Action required |
|---|---|---|
| Zigbee2MQTT | **GPL-3.0** | **MUST include the full GPL-3.0 text** (`GPL-3.0.txt` below) and offer corresponding source. Source: https://github.com/Koenkk/zigbee2mqtt |
| Home Assistant | Apache-2.0 | Include Apache-2.0 notice. Source: https://github.com/home-assistant/core |
| Eclipse Mosquitto | EPL-2.0 / EDL-1.0 | Include EPL/EDL notice. Source: https://github.com/eclipse/mosquitto |
| Docker Engine (moby) | Apache-2.0 | Include Apache-2.0 notice. |

## TODO before first customer ship

1. Drop the verbatim license texts into this directory:
   - `GPL-3.0.txt` (Zigbee2MQTT) — **blocking for GPL compliance**
   - `Apache-2.0.txt` (Home Assistant, Docker)
   - `EPL-2.0.txt` + `EDL-1.0.txt` (Mosquitto)
2. Because Z2M is GPL-3.0 and we redistribute its binary (container), we must
   also make its **corresponding source** available on request. The source is
   the pinned upstream tag (`Z2M_VERSION` in `image/compose/versions.env`);
   document the offer in the customer paperwork.

This README is a placeholder gate — CI/ship checklist should fail if
`GPL-3.0.txt` is absent when an image bundling the Z2M container is built.
