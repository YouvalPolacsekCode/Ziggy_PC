#!/usr/bin/env python3
"""
One-shot ZHA → Zigbee2MQTT migration script for the Ziggy hub.

Run this ONCE during the cut-over evening, AFTER:
  1. Z2M is up (`COMPOSE_PROFILES=zigbee-z2m docker compose up -d`)
  2. ZHA has been disabled / removed in HA
  3. Every Zigbee device has been re-paired into Z2M (room by room walk)
  4. You've hand-built mapping.yaml with old→new entity_ids

The script then rewrites Ziggy's stored references so the new entity_ids
take effect everywhere without a restart of the universe.

Usage:
    python -m scripts.migrate_zha_to_z2m \\
        --mapping path/to/mapping.yaml \\
        --ha-url http://homeassistant.local:8123 \\
        --ha-token "$HA_TOKEN" \\
        [--dry-run]

mapping.yaml shape:
    entities:
      - old: binary_sensor.lumi_lumi_sensor_motion_aq2_occupancy
        new: binary_sensor.kitchen_motion
      - old: light._tz3210_r5afgmkl_ts0505b_light
        new: light.bedroom_light
      # ... one entry per Zigbee entity that existed under ZHA

Phases (each can be re-run idempotently):
    1. device_registry  — remap entity_id keys in user_files/device_registry.json
    2. settings_yaml    — remap sensor_alerts / global_sensors / calendar / todo
    3. ir_devices       — remap ha_entity_id field in user_files/ir_devices.json
    4. ha_automations   — fetch every HA automation, rewrite entity_ids in
                          triggers/conditions/actions, PUT back via REST
    5. state_reset      — clear state_memory.json, events.jsonl, anomaly state
                          (these re-learn from scratch — intentional)

Phases that intentionally do NOTHING:
    - manual_overrides: in-memory only, evaporates on restart
    - ha_subscriber state_cache: rebuilt from HA on next connect
    - device_groups: rebuilds from HA's entity registry on next read

Exit codes:
    0 — all phases completed (or skipped cleanly in dry-run)
    1 — one or more phases hit an unrecoverable error; details on stdout
    2 — invalid mapping.yaml or CLI args
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import yaml


# ── mapping load + validate ────────────────────────────────────────────────

def load_mapping(path: Path) -> dict[str, str]:
    """Return {old_entity_id: new_entity_id}. Raises on malformed input."""
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"mapping file not found: {path}")
    except yaml.YAMLError as e:
        raise SystemExit(f"mapping yaml parse error: {e}")
    if not isinstance(data, dict) or "entities" not in data:
        raise SystemExit("mapping.yaml must have top-level `entities:` list")
    out: dict[str, str] = {}
    for i, entry in enumerate(data["entities"]):
        if not isinstance(entry, dict) or "old" not in entry or "new" not in entry:
            raise SystemExit(f"mapping entry {i}: must have `old:` and `new:`")
        old, new = str(entry["old"]).strip(), str(entry["new"]).strip()
        if not old or not new:
            raise SystemExit(f"mapping entry {i}: empty old or new")
        if old in out:
            raise SystemExit(f"mapping entry {i}: duplicate old entity_id {old!r}")
        out[old] = new
    if not out:
        raise SystemExit("mapping.yaml has no entries")
    return out


# ── phase 1: device_registry.json ──────────────────────────────────────────

def remap_device_registry(mapping: dict[str, str], dry_run: bool) -> dict:
    """Rewrite user_files/device_registry.json so entity_id keys are updated.

    Strategy: load → rewrite the `entity_id` field per row → write back.
    Rows whose entity_id isn't in the mapping pass through unchanged (could
    be IR-only rows that have no HA entity).
    """
    path = Path("user_files/device_registry.json")
    if not path.is_file():
        return {"phase": "device_registry", "skipped": "file not found", "remapped": 0}
    rows = json.loads(path.read_text(encoding="utf-8"))
    remapped = 0
    unmatched_ha: list[str] = []
    for row in rows:
        old_eid = row.get("entity_id")
        if not old_eid:
            continue
        if old_eid in mapping:
            row["entity_id"] = mapping[old_eid]
            remapped += 1
        elif old_eid.split(".", 1)[0] not in ("ir", "input_boolean"):
            unmatched_ha.append(old_eid)
    if not dry_run:
        path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    return {
        "phase": "device_registry",
        "remapped": remapped,
        "unmatched_ha_entities": unmatched_ha,
        "total_rows": len(rows),
    }


# ── phase 2: config/settings.yaml ──────────────────────────────────────────

_SETTINGS_SECTIONS_FLAT = (
    # (section, [key paths to remap])
    ("global_sensors", ["internet_status", "person_home",
                        "sun_dawn", "sun_dusk", "sun_rising", "sun_setting"]),
    ("calendar", ["birthdays", "holidays", "personal"]),
    ("todo", ["shopping_list"]),
)


def remap_settings_yaml(mapping: dict[str, str], dry_run: bool) -> dict:
    """Remap entity_id strings embedded in config/settings.yaml.

    Two shapes:
      A. Flat scalar fields (global_sensors.sun_dawn, calendar.birthdays, ...)
      B. sensor_alerts.sensors[*].entity_id — a list of dicts
    """
    path = Path("config/settings.yaml")
    if not path.is_file():
        return {"phase": "settings_yaml", "skipped": "file not found", "remapped": 0}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    remapped = 0
    for section, keys in _SETTINGS_SECTIONS_FLAT:
        sect = data.get(section)
        if not isinstance(sect, dict):
            continue
        for k in keys:
            cur = sect.get(k)
            if isinstance(cur, str) and cur in mapping:
                sect[k] = mapping[cur]
                remapped += 1
    sa = data.get("sensor_alerts")
    if isinstance(sa, dict):
        for entry in sa.get("sensors") or []:
            if not isinstance(entry, dict):
                continue
            eid = entry.get("entity_id")
            if isinstance(eid, str) and eid in mapping:
                entry["entity_id"] = mapping[eid]
                remapped += 1
    if not dry_run:
        path.write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True),
                        encoding="utf-8")
    return {"phase": "settings_yaml", "remapped": remapped}


# ── phase 3: user_files/ir_devices.json ────────────────────────────────────

def remap_ir_devices(mapping: dict[str, str], dry_run: bool) -> dict:
    """Update the optional `ha_entity_id` field on each IR device entry."""
    path = Path("user_files/ir_devices.json")
    if not path.is_file():
        return {"phase": "ir_devices", "skipped": "file not found", "remapped": 0}
    devices = json.loads(path.read_text(encoding="utf-8"))
    remapped = 0
    broken_links: list[str] = []
    for dev in devices:
        link = dev.get("ha_entity_id")
        if not link:
            continue
        if link in mapping:
            dev["ha_entity_id"] = mapping[link]
            remapped += 1
        else:
            # Linked to an entity that doesn't appear in the mapping. Could
            # be a non-Zigbee link (Wi-Fi / Z-Wave) that survives the
            # migration, or a stale link. Drop into a warning list so the
            # operator can review without auto-clearing valid links.
            broken_links.append(link)
    if not dry_run:
        path.write_text(json.dumps(devices, indent=2, ensure_ascii=False), encoding="utf-8")
    return {
        "phase": "ir_devices",
        "remapped": remapped,
        "unmatched_links": broken_links,
    }


# ── phase 4: HA automations (over REST) ───────────────────────────────────

def remap_ha_automations(mapping: dict[str, str], ha_url: str,
                         ha_token: str, dry_run: bool) -> dict:
    """Fetch every HA automation, rewrite entity_ids inside, PUT back.

    HA exposes automations at GET /api/config/automation/config/<id>. Each
    is YAML/JSON with arbitrary trigger/condition/action shapes — we walk
    the structure recursively and substitute any value whose string form
    appears as a key in `mapping`.
    """
    import requests  # local import; not all callers have network
    headers = {"Authorization": f"Bearer {ha_token}", "Content-Type": "application/json"}

    list_url = ha_url.rstrip("/") + "/api/states"
    resp = requests.get(list_url, headers=headers, timeout=15)
    if resp.status_code != 200:
        return {"phase": "ha_automations", "error": f"GET /api/states -> {resp.status_code}"}
    automation_ids = [
        s["entity_id"].split(".", 1)[1]
        for s in resp.json()
        if s.get("entity_id", "").startswith("automation.")
        and s.get("attributes", {}).get("id")
    ]
    remapped_in: list[str] = []
    failed: list[dict] = []
    for aid in automation_ids:
        cfg_url = ha_url.rstrip("/") + f"/api/config/automation/config/{aid}"
        g = requests.get(cfg_url, headers=headers, timeout=15)
        if g.status_code != 200:
            failed.append({"automation_id": aid, "error": f"GET {g.status_code}"})
            continue
        cfg = g.json()
        new_cfg, changes = _walk_and_remap(cfg, mapping)
        if changes == 0:
            continue
        remapped_in.append(aid)
        if dry_run:
            continue
        p = requests.post(cfg_url, headers=headers, json=new_cfg, timeout=15)
        if p.status_code not in (200, 201):
            failed.append({"automation_id": aid, "error": f"POST {p.status_code}"})
    return {
        "phase": "ha_automations",
        "automations_touched": len(remapped_in),
        "automation_ids": remapped_in,
        "failed": failed,
    }


def _walk_and_remap(node: Any, mapping: dict[str, str]) -> tuple[Any, int]:
    """Return (new_node, count_of_substitutions).

    Two kinds of substitution:

    1. Exact-match string: a value whose entire string IS an old entity_id
       (`entity_id: light.kitchen`, `target.entity_id: [light.kitchen]`).

    2. Embedded Jinja templates: a value that CONTAINS an old entity_id
       somewhere inside it (`'{{ states("light.kitchen") }}'`,
       `'{% if is_state("binary_sensor.foo", "on") %}'`). HA stores
       these as plain strings; we substring-replace each old → new where
       the old appears as a whole identifier (bounded by non-id chars on
       both sides). Identifier-boundary check keeps us from rewriting
       `light.kitchen_island` when the mapping has `light.kitchen`.
    """
    changes = 0
    if isinstance(node, dict):
        out_d: dict = {}
        for k, v in node.items():
            new_v, c = _walk_and_remap(v, mapping)
            out_d[k] = new_v
            changes += c
        return out_d, changes
    if isinstance(node, list):
        out_l = []
        for v in node:
            new_v, c = _walk_and_remap(v, mapping)
            out_l.append(new_v)
            changes += c
        return out_l, changes
    if isinstance(node, str):
        # Whole-string match (the common case).
        if node in mapping:
            return mapping[node], 1
        # Embedded match — only attempt if the string is template-ish or
        # carries multiple entity ids in a CSV/list. Cheaper than always
        # scanning every string field.
        if "{" in node or "," in node or " " in node:
            new_node, embedded_changes = _substitute_embedded(node, mapping)
            return new_node, embedded_changes
    return node, 0


def _substitute_embedded(text: str, mapping: dict[str, str]) -> tuple[str, int]:
    """Replace each old entity_id with its new value, as whole tokens.

    A token boundary is any char that's NOT [A-Za-z0-9_.]. So
    `light.kitchen` inside `is_state('light.kitchen', 'on')` matches
    (quote and paren are boundaries) but `light.kitchen_2` does not.
    Returns (new_text, count_of_replacements).
    """
    import re
    out = text
    total = 0
    for old, new in mapping.items():
        # Escape regex metachars in the entity_id (mostly the dot).
        pat = r"(?<![A-Za-z0-9_.])" + re.escape(old) + r"(?![A-Za-z0-9_.])"
        out, n = re.subn(pat, new, out)
        total += n
    return out, total


# ── phase 5: reset learning state ─────────────────────────────────────────

def reset_learning_state(dry_run: bool) -> dict:
    """Clear state_memory, events.jsonl, anomaly state. Intentional reset —
    these stores key on entity_ids that no longer exist; rather than try
    to remap, we let pattern learning rebuild on the new entity_ids."""
    cleared: list[str] = []
    targets = [
        Path("user_files/state_memory.json"),
        Path("user_files/events.jsonl"),
        Path("user_files/anomaly_state.json"),  # written by anomaly_engine if present
    ]
    for p in targets:
        if not p.is_file():
            continue
        if not dry_run:
            p.unlink()
        cleared.append(str(p))
    return {"phase": "state_reset", "cleared": cleared}


# ── orchestration ──────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--mapping", required=True, type=Path)
    p.add_argument("--ha-url", default=os.environ.get("HA_URL"))
    p.add_argument("--ha-token", default=os.environ.get("HA_TOKEN"))
    p.add_argument("--dry-run", action="store_true",
                   help="Compute changes; do not write to disk or HA")
    p.add_argument("--skip", action="append", default=[],
                   choices=["device_registry", "settings_yaml", "ir_devices",
                            "ha_automations", "state_reset"],
                   help="Skip a phase (repeatable). Useful when re-running.")
    args = p.parse_args(argv)

    mapping = load_mapping(args.mapping)
    print(f"[mapping] {len(mapping)} entity remap rules loaded")

    results: list[dict] = []

    def _run(name, fn, *fargs):
        if name in args.skip:
            results.append({"phase": name, "skipped": "via --skip"})
            print(f"[{name}] skipped (via --skip)")
            return
        try:
            r = fn(*fargs)
            results.append(r)
            print(f"[{name}] {json.dumps({k: v for k, v in r.items() if k != 'phase'})}")
        except Exception as e:
            results.append({"phase": name, "error": str(e)})
            print(f"[{name}] ERROR: {e}", file=sys.stderr)

    _run("device_registry", remap_device_registry, mapping, args.dry_run)
    _run("settings_yaml",   remap_settings_yaml,   mapping, args.dry_run)
    _run("ir_devices",      remap_ir_devices,      mapping, args.dry_run)
    if args.ha_url and args.ha_token:
        _run("ha_automations", remap_ha_automations, mapping,
             args.ha_url, args.ha_token, args.dry_run)
    else:
        print("[ha_automations] skipped (no --ha-url / --ha-token)")
        results.append({"phase": "ha_automations", "skipped": "no HA creds"})
    _run("state_reset", reset_learning_state, args.dry_run)

    print("\n=== summary ===")
    for r in results:
        print(json.dumps(r, indent=2, ensure_ascii=False))

    any_error = any("error" in r for r in results)
    return 1 if any_error else 0


if __name__ == "__main__":
    sys.exit(main())
