# image/compose

Pinned-version metadata for the beta fleet.

- `versions.env` — the canonical component pins (`HA_VERSION`, `MOSQUITTO_VERSION`,
  `Z2M_VERSION`) and a place to record image **digests** for byte-reproducible
  deployments.

The runtime compose files live at the repo root (`docker-compose.yml` +
`docker-compose.prod.yml`); this directory only holds the version pins so the
golden-image build and per-hub imaging read one source of truth.

## Resolving digests (optional, for a locked fleet)

Tags like `2.0.20` can be re-pushed. To pin by immutable digest:

```bash
docker buildx imagetools inspect eclipse-mosquitto:2.0.20 --format '{{.Manifest.Digest}}'
```

Record the results in `versions.env` under the `*_DIGEST` keys, then reference
those digests from `docker-compose.prod.yml` (swap `image: eclipse-mosquitto:${MOSQUITTO_VERSION}`
for `image: ${MOSQUITTO_DIGEST}`) when you want a fully locked fleet.
