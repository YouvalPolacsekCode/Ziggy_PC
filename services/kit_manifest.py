"""Kit manifest reader — Prompt 7 chunk 2.

Reads the per-kit YAML manifest written by the factory imaging script (see
PROMPT_FACTORY_IMAGING.md §2). The manifest tells Ziggy which sensors and IR
devices were pre-paired at the factory and what room labels the founder
intended for each — enough for the mobile onboarding flow to render a
naming wizard with sensible Hebrew + English defaults instead of a raw
HA device list.

Path
----
Production:  /etc/ziggy/kit_manifest.yaml  (mode 600, owned by `ziggy`)
Override:    ZIGGY_KIT_MANIFEST_PATH env var (for dev + tests)

Schema (per PROMPT_FACTORY_IMAGING.md §2; missing keys tolerated)
----------------------------------------------------------------
    kit_sku:        str   e.g. "home-v1"
    owner_email:    str   customer this kit ships to
    coordinator_type: str   "smlight" | "sonoff_e"
    coordinator_ip:  str   optional, only for smlight
    bulk_order_id:   str   traceability back to supplier shipment
    sensors:
      - device_type:             str   e.g. "motion" | "door" | "temp_humidity"
        vendor_model:            str   e.g. "aqara_p1"
        zigbee_mac:              str   pre-known or written-back at imaging
        intended_room_label_he:  str   Hebrew room label
        intended_room_label_en:  str   English room label
    irs:
      - same pattern, vendor_model = "broadlink_rm4_mini" etc.

Graceful absence
----------------
A box with no manifest file (e.g. dev laptop, beta unit imaged before the
factory script existed) yields an empty-but-valid result —
`{sensors: [], irs: [], kit_sku: None, ...}` — so callers can iterate
without guarding for None. This is the dev-laptop posture; production
boxes will always have the file.

Module is intentionally read-only. The factory script writes the YAML;
nothing in Ziggy mutates it.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import yaml

from core.logger_module import log_error, log_info


DEFAULT_MANIFEST_PATH = "/etc/ziggy/kit_manifest.yaml"


# Per-device-type sticker / sensor sticker fallback label when the manifest
# omits both intended_room_label_he and intended_room_label_en. The mobile
# wizard treats these as last-resort placeholders the user MUST rename
# before completing the step.
_FALLBACK_LABEL_EN_BY_TYPE: dict[str, str] = {
    "motion":        "Motion sensor",
    "door":          "Door sensor",
    "temp_humidity": "Temp/humidity",
    "plug":          "Smart plug",
    "bulb":          "Smart bulb",
    "mmwave":        "Presence sensor",
}
_FALLBACK_LABEL_HE_BY_TYPE: dict[str, str] = {
    "motion":        "חיישן תנועה",
    "door":          "חיישן דלת",
    "temp_humidity": "חיישן טמפ׳/לחות",
    "plug":          "שקע חכם",
    "bulb":          "נורה חכמה",
    "mmwave":        "חיישן נוכחות",
}


def _manifest_path() -> Path:
    """Production path unless ZIGGY_KIT_MANIFEST_PATH overrides it."""
    return Path(os.environ.get("ZIGGY_KIT_MANIFEST_PATH", DEFAULT_MANIFEST_PATH))


def _empty_manifest() -> dict:
    return {
        "kit_sku":          None,
        "owner_email":      None,
        "coordinator_type": None,
        "coordinator_ip":   None,
        "bulk_order_id":    None,
        "sensors":          [],
        "irs":              [],
    }


def load_manifest(path: Optional[Path] = None) -> dict:
    """Read the kit manifest. Returns a normalized dict with defaults filled in.

    Returns `_empty_manifest()` if the file is missing OR malformed — Ziggy
    must keep booting even on a manifest-less or corrupt-manifest box. A
    malformed manifest is logged at error level so the founder sees it in
    the factory imaging logs; a missing one is silent (legitimate dev case).
    """
    p = path if path is not None else _manifest_path()
    if not p.exists():
        return _empty_manifest()
    try:
        with open(p, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
    except Exception as e:
        log_error(f"[kit_manifest] failed to read {p}: {e}")
        return _empty_manifest()

    if not isinstance(raw, dict):
        log_error(f"[kit_manifest] {p} is not a YAML mapping; ignoring")
        return _empty_manifest()

    out = _empty_manifest()
    for key in ("kit_sku", "owner_email", "coordinator_type",
                "coordinator_ip", "bulk_order_id"):
        v = raw.get(key)
        if isinstance(v, str) and v.strip():
            out[key] = v.strip()

    out["sensors"] = _normalize_sensor_list(raw.get("sensors"))
    out["irs"]     = _normalize_sensor_list(raw.get("irs"))
    log_info(
        f"[kit_manifest] loaded {p} — kit_sku={out['kit_sku']} "
        f"sensors={len(out['sensors'])} irs={len(out['irs'])}"
    )
    return out


def _normalize_sensor_list(raw: object) -> list[dict]:
    """Drop entries that aren't dicts, coerce strings, fill fallback labels.

    Each surviving entry has at minimum:
      device_type:            str
      vendor_model:           str
      zigbee_mac:             str   (empty if unknown)
      intended_room_label_he: str
      intended_room_label_en: str
    """
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        device_type  = _safe_str(entry.get("device_type"))
        vendor_model = _safe_str(entry.get("vendor_model"))
        if not device_type and not vendor_model:
            # Useless entry — no way for the wizard to display it.
            continue
        mac = _safe_str(entry.get("zigbee_mac"))
        raw_he = _safe_str(entry.get("intended_room_label_he"))
        raw_en = _safe_str(entry.get("intended_room_label_en"))
        # Fallback chain: prefer the other language's manifest value over a
        # device-type default. Compute both legs from the ORIGINAL raw values
        # so a freshly-substituted Hebrew fallback doesn't bleed into the
        # English leg.
        label_he = raw_he or raw_en or _FALLBACK_LABEL_HE_BY_TYPE.get(device_type, device_type or "חיישן")
        label_en = raw_en or raw_he or _FALLBACK_LABEL_EN_BY_TYPE.get(device_type, device_type or "Sensor")
        out.append({
            "device_type":            device_type,
            "vendor_model":           vendor_model,
            "zigbee_mac":             mac,
            "intended_room_label_he": label_he,
            "intended_room_label_en": label_en,
        })
    return out


def _safe_str(v: object) -> str:
    if isinstance(v, str):
        return v.strip()
    if isinstance(v, (int, float)):
        return str(v)
    return ""


def get_sensors(path: Optional[Path] = None) -> list[dict]:
    """Convenience: return just the sensors list."""
    return load_manifest(path).get("sensors") or []


def get_irs(path: Optional[Path] = None) -> list[dict]:
    """Convenience: return just the IR devices list."""
    return load_manifest(path).get("irs") or []


def find_sensor_by_mac(mac: str, path: Optional[Path] = None) -> Optional[dict]:
    """Look up a sensor entry by its zigbee MAC. Case-insensitive.

    Used by /api/onboarding/sensors to enrich HA registry entries with the
    manifest's intended room labels — the MAC is what survives the
    factory-imaging → HA-device-registry mapping reliably.
    """
    needle = (mac or "").strip().lower()
    if not needle:
        return None
    for s in get_sensors(path):
        if s.get("zigbee_mac", "").lower() == needle:
            return s
    return None
