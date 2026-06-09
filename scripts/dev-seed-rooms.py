#!/usr/bin/env python3
"""
Seed the dev HA with areas (rooms) and assign every entity from
docker/ha-config-dev/configuration.yaml to its room.

Idempotent — re-running is safe; areas that exist are reused, entities
already assigned to the right area are left alone.

Reads HA_URL + HA_TOKEN from .env in the repo root (or from the
environment). Uses HA's WebSocket API since the area_registry is not
exposed via REST.

Run after `./scripts/dev-up.sh` and (the first time) after editing
`docker/ha-config-dev/configuration.yaml`:
    source .venv/bin/activate
    python scripts/dev-seed-rooms.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# Where each entity belongs. Keys = entity_id (the *resolved* HA entity_id,
# which is what HA generates from the unique_id / friendly_name). Values =
# area name. Add new entities here as you grow the dev set.
ENTITY_ROOM_MAP: dict[str, str] = {
    # Lights
    "light.dev_living_room_light":        "Living Room",  # legacy wiring-test
    "light.living_room_ceiling_light":    "Living Room",
    "light.living_room_lamp":             "Living Room",
    "light.bedroom_ceiling_light":        "Bedroom",
    "light.bedroom_lamp":                 "Bedroom",
    "light.kitchen_ceiling_light":        "Kitchen",
    "light.kitchen_under_cabinet_lights": "Kitchen",
    "light.bathroom_light":               "Bathroom",
    "light.office_light":                 "Office",
    # Switches
    "switch.living_room_tv":              "Living Room",
    "switch.bedroom_fan":                 "Bedroom",
    "switch.kitchen_kettle":              "Kitchen",
    "switch.bathroom_fan":                "Bathroom",
    "switch.office_monitor":              "Office",
    # Binary sensors
    "binary_sensor.living_room_motion":   "Living Room",
    "binary_sensor.bedroom_motion":       "Bedroom",
    "binary_sensor.front_door":           "Entryway",
    # Sensors (temperature)
    "sensor.living_room_temperature":     "Living Room",
    "sensor.bedroom_temperature":         "Bedroom",
    "sensor.outdoor_temperature":         "Outside",
}

REPO_ROOT = Path(__file__).resolve().parent.parent


def load_env() -> tuple[str, str]:
    env_path = REPO_ROOT / ".env"
    url = os.environ.get("HA_URL", "")
    token = os.environ.get("HA_TOKEN", "")
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k == "HA_URL" and not url:
                url = v.strip()
            elif k == "HA_TOKEN" and not token:
                token = v.strip()
    if not url or not token:
        print("ERROR: HA_URL and HA_TOKEN must be set (in .env or env)", file=sys.stderr)
        sys.exit(1)
    return url.rstrip("/"), token


async def run() -> int:
    try:
        import websockets
    except ImportError:
        print("ERROR: websockets not installed. Run: pip install websockets", file=sys.stderr)
        return 1

    url, token = load_env()
    ws_url = url.replace("http://", "ws://").replace("https://", "wss://") + "/api/websocket"
    print(f"Connecting to {ws_url} ...")

    async with websockets.connect(ws_url) as ws:
        # Handshake
        hello = json.loads(await ws.recv())
        assert hello["type"] == "auth_required", f"unexpected: {hello}"
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth_ok = json.loads(await ws.recv())
        if auth_ok.get("type") != "auth_ok":
            print(f"ERROR: auth failed: {auth_ok}", file=sys.stderr)
            return 1

        next_id = 1

        async def call(msg: dict) -> dict:
            nonlocal next_id
            msg = {**msg, "id": next_id}
            next_id += 1
            await ws.send(json.dumps(msg))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get("id") == msg["id"]:
                    return resp
                # Ignore unrelated event messages

        # 1) Fetch existing areas → name → area_id map
        resp = await call({"type": "config/area_registry/list"})
        existing_areas = {a["name"]: a["area_id"] for a in resp.get("result", [])}
        print(f"Existing areas: {sorted(existing_areas.keys()) or '(none)'}")

        wanted_area_names = sorted(set(ENTITY_ROOM_MAP.values()))
        area_id_by_name: dict[str, str] = {}
        for name in wanted_area_names:
            if name in existing_areas:
                area_id_by_name[name] = existing_areas[name]
                print(f"  area exists: {name}")
            else:
                resp = await call({"type": "config/area_registry/create", "name": name})
                if "result" in resp:
                    area_id_by_name[name] = resp["result"]["area_id"]
                    print(f"  area CREATED: {name}")
                else:
                    print(f"  ERROR creating area {name}: {resp}", file=sys.stderr)

        # 2) Fetch entity registry → assign each entity to its area
        resp = await call({"type": "config/entity_registry/list"})
        entities_by_id = {e["entity_id"]: e for e in resp.get("result", [])}

        unmatched = []
        already_ok = 0
        updated = 0
        for entity_id, room_name in ENTITY_ROOM_MAP.items():
            target_area_id = area_id_by_name.get(room_name)
            if not target_area_id:
                continue
            entity = entities_by_id.get(entity_id)
            if not entity:
                unmatched.append(entity_id)
                continue
            if entity.get("area_id") == target_area_id:
                already_ok += 1
                continue
            resp = await call({
                "type": "config/entity_registry/update",
                "entity_id": entity_id,
                "area_id": target_area_id,
            })
            if "result" in resp:
                updated += 1
                print(f"  assigned {entity_id} -> {room_name}")
            else:
                print(f"  ERROR assigning {entity_id}: {resp}", file=sys.stderr)

        print()
        print(f"Summary: {updated} updated, {already_ok} already correct, {len(unmatched)} not found in HA")
        if unmatched:
            print("  Not-found entities (waiting for HA restart to pick up new YAML?):")
            for e in unmatched:
                print(f"    {e}")
        return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(run()))
