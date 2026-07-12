# Production Mosquitto (authenticated) — beta hubs

The dev stack uses `docker/mosquitto.conf` with `allow_anonymous true`. Beta
hubs use **this** directory with `allow_anonymous false` + a hashed
`password_file`, wired by `docker-compose.prod.yml`.

## Files

| File | Tracked? | Purpose |
|---|---|---|
| `mosquitto.conf` | yes | Prod broker config (no anonymous, password_file). |
| `passwordfile.template` | yes | Placeholder + generation instructions. Not valid on its own. |
| `passwordfile` | **no** (git-ignored) | Generated per-hub at imaging; hashed creds. |
| `README.md` | yes | This file. |

## One generated MQTT credential, four consumers

The factory imaging script generates ONE `MQTT_USER` (default `ziggy`) +
`MQTT_PASS` (from `/dev/urandom`) and injects it into all of:

1. **Mosquitto** — hashed into `passwordfile` via `mosquitto_passwd`.
2. **Home Assistant** — MQTT config entry, created headlessly by
   `scripts/ha-seed.sh --with-mqtt` (uses `MQTT_USER`/`MQTT_PASS`/`MQTT_HOST`).
3. **Zigbee2MQTT** — `mqtt.user` / `mqtt.password` in `docker/z2m-data/configuration.yaml`.
4. **Ziggy** — `MQTT_URL=mqtt://<user>:<pass>@mosquitto:1883` in `/opt/ziggy/.env`
   (read by `core/settings_loader.py`).

## Generate the password file (what imaging runs)

```bash
docker run --rm -v "$PWD/docker/mosquitto:/pw" eclipse-mosquitto:2 \
    mosquitto_passwd -b -c /pw/passwordfile "$MQTT_USER" "$MQTT_PASS"
chmod 640 docker/mosquitto/passwordfile
```

`-c` creates/overwrites. The hash is PBKDF2-SHA512 (`$7$`).

## Verify auth is enforced (canary check)

```bash
# Should SUCCEED with creds:
docker run --rm --network container:ziggy-mosquitto-1 eclipse-mosquitto:2 \
  mosquitto_pub -h localhost -u "$MQTT_USER" -P "$MQTT_PASS" -t ziggy/selftest -m ok
# Should FAIL anonymously (exit non-zero = auth working):
docker run --rm --network container:ziggy-mosquitto-1 eclipse-mosquitto:2 \
  mosquitto_pub -h localhost -t ziggy/selftest -m nope
```

`scripts/canary-validate.sh :: check_mqtt_auth_enforced` automates this.
