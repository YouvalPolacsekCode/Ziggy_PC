"""Starter automation pack reader + slot resolver — Prompt 7 chunk 3.3.

Loads services/starter_automations/v1.yaml and offers two surfaces:

  list_available(...) — given the kit_manifest sensors + HA device + entity
    registries, return the subset of starters whose ALL slots can be filled.
    Each returned entry carries its ha_payload with {{slot}} placeholders
    already substituted, so the mobile app can POST it straight to
    /api/automations.

  resolve_payload(starter, ha_devices, ha_entities, manifest_sensors) — the
    join logic isolated for testing. Returns the substituted dict, or None
    if any slot couldn't be resolved.

Schema is documented in v1.yaml. Single-file YAML; if we ever add a v2
schema we'll write it to a sibling file and let callers pick.

Module is read-only. Adding a new starter is a YAML edit, no code change.
"""
from __future__ import annotations

import copy
import os
import re
from pathlib import Path
from typing import Optional

import yaml

from core.logger_module import log_error


_DEFAULT_YAML_PATH = Path(__file__).resolve().parent / "starter_automations" / "v1.yaml"

_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def _yaml_path() -> Path:
    override = os.environ.get("ZIGGY_STARTER_PACK_PATH")
    return Path(override) if override else _DEFAULT_YAML_PATH


def load_starters(path: Optional[Path] = None) -> list[dict]:
    """Read the starter-pack YAML. Returns an empty list on missing file
    or any read/parse error (Ziggy must boot without the file)."""
    p = path if path is not None else _yaml_path()
    if not p.exists():
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or []
    except Exception as e:
        log_error(f"[starter_pack] failed to read {p}: {e}")
        return []
    if not isinstance(raw, list):
        log_error(f"[starter_pack] {p} root must be a YAML list; got {type(raw).__name__}")
        return []
    return [e for e in raw if isinstance(e, dict)]


# ── Entity resolution ───────────────────────────────────────────────────────

def _kit_macs_by_device_type(manifest_sensors: list[dict]) -> dict[str, list[str]]:
    """Group MACs by their manifest device_type."""
    by_type: dict[str, list[str]] = {}
    for s in manifest_sensors:
        dt = (s.get("device_type") or "").lower().strip()
        mac = (s.get("zigbee_mac") or "").lower().replace(":", "").replace("-", "")
        if not dt or not mac:
            continue
        by_type.setdefault(dt, []).append(mac)
    return by_type


def _ha_devices_by_mac(ha_devices: list[dict]) -> dict[str, dict]:
    """Build mac → ha_device map from connections."""
    out: dict[str, dict] = {}
    for d in ha_devices:
        for conn in d.get("connections") or []:
            if not isinstance(conn, (list, tuple)) or len(conn) < 2:
                continue
            kind, value = conn[0], conn[1]
            if kind in ("zigbee", "mac"):
                key = str(value).lower().replace(":", "").replace("-", "")
                if key:
                    out[key] = d
    return out


def _entities_for_device(ha_entities: list[dict], device_id: str,
                         domain: str) -> list[str]:
    """Return entity_ids under `device_id` whose domain matches.

    Order preserves the entity registry's natural order; first hit wins
    at resolve time.
    """
    out: list[str] = []
    prefix = f"{domain}."
    for e in ha_entities:
        if e.get("device_id") != device_id:
            continue
        eid = e.get("entity_id") or ""
        if eid.startswith(prefix):
            out.append(eid)
    return out


def resolve_payload(
    starter: dict,
    *,
    manifest_sensors: list[dict],
    ha_devices: list[dict],
    ha_entities: list[dict],
) -> Optional[dict]:
    """Fill the starter's {{slot}} placeholders with real entity_ids.

    Returns the substituted ha_payload dict on success, or None if any
    slot couldn't be resolved (missing device_type in the kit, or no
    matching HA entity for that domain).
    """
    slots = starter.get("slots") or []
    if not isinstance(slots, list):
        return None

    macs_by_type = _kit_macs_by_device_type(manifest_sensors)
    ha_by_mac    = _ha_devices_by_mac(ha_devices)

    resolutions: dict[str, str] = {}
    used_entities: set[str] = set()
    for slot in slots:
        if not isinstance(slot, dict):
            return None
        slot_name = slot.get("name", "").strip()
        device_type = (slot.get("device_type") or "").lower().strip()
        domain      = (slot.get("ha_domain")  or "").lower().strip()
        if not slot_name or not device_type or not domain:
            return None

        # Find a matching kit-device with an HA entity in the right domain.
        # Prefer entities we haven't used yet so a starter with two slots
        # of the same device_type (rare) doesn't double-bind the same one.
        candidate_macs = macs_by_type.get(device_type) or []
        chosen: Optional[str] = None
        for mac in candidate_macs:
            ha_dev = ha_by_mac.get(mac)
            if not ha_dev:
                continue
            entities = _entities_for_device(ha_entities, ha_dev.get("id"), domain)
            for eid in entities:
                if eid in used_entities:
                    continue
                chosen = eid
                break
            if chosen:
                break
        if not chosen:
            return None
        resolutions[slot_name] = chosen
        used_entities.add(chosen)

    payload_template = starter.get("ha_payload") or {}
    return _substitute(payload_template, resolutions)


def _substitute(node, resolutions: dict[str, str]):
    """Recursively walk a dict/list and replace {{slot}} placeholders in
    string leaves with the resolved entity_id. Non-string leaves untouched.
    """
    if isinstance(node, str):
        def repl(m: re.Match) -> str:
            name = m.group(1)
            return resolutions.get(name, m.group(0))
        return _PLACEHOLDER_RE.sub(repl, node)
    if isinstance(node, list):
        return [_substitute(v, resolutions) for v in node]
    if isinstance(node, dict):
        return {k: _substitute(v, resolutions) for k, v in node.items()}
    return node


# ── Public surface ──────────────────────────────────────────────────────────

def list_available(
    *,
    manifest_sensors: list[dict],
    ha_devices: list[dict],
    ha_entities: list[dict],
    path: Optional[Path] = None,
) -> list[dict]:
    """Return all starters that can be fully resolved against this kit.

    Each result entry carries:
      id, label_en, label_he, description_en, description_he, ha_payload
        — ha_payload has all placeholders substituted, ready to POST to
          /api/automations.

    Order matches the YAML's order (curation-stable). Starters that can't
    resolve are omitted — they get re-evaluated on the next call once the
    user finishes pairing the missing device types.
    """
    out: list[dict] = []
    for starter in load_starters(path):
        payload = resolve_payload(
            starter,
            manifest_sensors=manifest_sensors,
            ha_devices=ha_devices,
            ha_entities=ha_entities,
        )
        if payload is None:
            continue
        out.append({
            "id":             starter.get("id"),
            "label_en":       starter.get("label_en", ""),
            "label_he":       starter.get("label_he", ""),
            "description_en": starter.get("description_en", ""),
            "description_he": starter.get("description_he", ""),
            "ha_payload":     copy.deepcopy(payload),
        })
    return out
