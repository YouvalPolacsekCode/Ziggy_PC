# Third-party licenses — Ziggy beta hub image

The hub image bundles third-party software distributed as Docker images. When you
distribute a Ziggy hub (hardware handed to a customer counts as distribution),
you must include the applicable license texts. The verbatim texts now ship in
this directory and are copied onto the image.

| Component | License | Text on image | Source |
|---|---|---|---|
| Zigbee2MQTT | **GPL-3.0** | [`GPL-3.0.txt`](GPL-3.0.txt) | https://github.com/Koenkk/zigbee2mqtt |
| Eclipse Mosquitto | **EPL-2.0 / EDL-1.0** | [`EPL-2.0.txt`](EPL-2.0.txt), [`EDL-1.0.txt`](EDL-1.0.txt) | https://github.com/eclipse/mosquitto |
| Home Assistant | Apache-2.0 | [`Apache-2.0.txt`](Apache-2.0.txt) | https://github.com/home-assistant/core |
| Docker Engine (moby) | Apache-2.0 | [`Apache-2.0.txt`](Apache-2.0.txt) | https://github.com/moby/moby |

## License text provenance

All texts were retrieved verbatim from the canonical upstream sources (no
hand-editing):

- `GPL-3.0.txt` — https://www.gnu.org/licenses/gpl-3.0.txt (674 lines)
- `EPL-2.0.txt` — Eclipse Mosquitto repo `epl-v20`
- `EDL-1.0.txt` — Eclipse Mosquitto repo `edl-v10`
- `Apache-2.0.txt` — https://www.apache.org/licenses/LICENSE-2.0.txt

## GPL-3.0 corresponding-source obligation (Zigbee2MQTT)

Because Zigbee2MQTT is GPL-3.0 and we redistribute its binary (the container),
we must also make its **corresponding source** available on request. The source
is the pinned upstream tag (`Z2M_VERSION` in
[`../compose/versions.env`](../compose/versions.env)); document the written offer
for source in the customer paperwork. Mosquitto (EPL/EDL) is likewise
redistributed as a container and its license texts ship alongside on the image.

## Ship checklist

The CI / ship checklist should fail if any of the bundled-component license
texts above are absent when an image bundling the Z2M or Mosquitto container is
built. `GPL-3.0.txt` in particular is **blocking for GPL compliance**.
