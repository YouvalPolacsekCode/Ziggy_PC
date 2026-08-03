"""
User device-classification overrides.

Ziggy classifies every physical device — which entity is the card's MAIN
control, what KIND of device it is (so the right card renders), and each
sibling entity's ROLE (control / metric / config / diagnostic). For known
devices a curated profile (services.device_profiles) supplies this; for
unknown ones a heuristic does. This module is the third and highest layer:
the USER's explicit correction, which always wins.

Precedence in device_groups.build_groups:
    user override  >  matched profile  >  heuristic

Keyed by DEVICE SIGNATURE, not group_id, so a correction sticks across
restarts/regroupings AND auto-applies to any *identical* device — the same
crowd-sourcing loop Ziggy uses for IR protocol cards. The signature is the
group's shared unique-id token (the Zigbee IEEE / HA device unique-id), which
is stable for a physical device. Falls back to the HA model when present.

Store: user_files/device_overrides.json
    { "<signature>": { "main_entity": "...", "card_kind": "irrigation",
                       "entity_roles": {"<eid>": "config"} } }
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Optional

from core.logger_module import log_info, log_error

_FILE = Path(__file__).resolve().parents[1] / "user_files" / "device_overrides.json"
_lock = threading.Lock()

# Roles the UI lets a user assign to a sibling entity.
VALID_ROLES = {"primary", "control", "metric", "config", "diagnostic", "hidden"}
# Card kinds the UI offers. Open-ended (unknown kinds render the generic card),
# but these are the first-class ones the frontend has bespoke layouts for.
VALID_KINDS = {
    "light", "switch", "outlet", "climate", "cover", "lock", "fan", "media",
    "sensor", "irrigation", "valve", "vacuum", "humidifier", "generic",
}


def _load() -> dict:
    if not _FILE.exists():
        return {}
    try:
        d = json.loads(_FILE.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception as e:
        log_error(f"[device_overrides] read failed: {e}")
        return {}


def _save(data: dict) -> None:
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(_FILE)


def get_all() -> dict:
    return _load()


def get(signature: str) -> dict:
    if not signature:
        return {}
    return _load().get(signature, {}) or {}


def set_override(signature: str, *,
                 main_entity: Optional[str] = None,
                 card_kind: Optional[str] = None,
                 entity_roles: Optional[dict] = None,
                 clear: bool = False) -> dict:
    """Merge an override for one device signature. Only provided fields change;
    entity_roles merges per-entity. `clear=True` wipes the whole override."""
    if not signature:
        raise ValueError("signature required")
    with _lock:
        store = _load()
        if clear:
            store.pop(signature, None)
            _save(store)
            log_info(f"[device_overrides] cleared {signature}")
            return {}
        cur = store.get(signature, {}) or {}
        if main_entity is not None:
            cur["main_entity"] = main_entity or None
            if not cur["main_entity"]:
                cur.pop("main_entity", None)
        if card_kind is not None:
            ck = (card_kind or "").strip().lower()
            if ck and ck not in VALID_KINDS:
                raise ValueError(f"unknown card_kind: {ck}")
            if ck:
                cur["card_kind"] = ck
            else:
                cur.pop("card_kind", None)
        if entity_roles is not None:
            roles = dict(cur.get("entity_roles") or {})
            for eid, role in entity_roles.items():
                r = (role or "").strip().lower()
                if r and r not in VALID_ROLES:
                    raise ValueError(f"unknown role: {r}")
                if r:
                    roles[eid] = r
                else:
                    roles.pop(eid, None)
            if roles:
                cur["entity_roles"] = roles
            else:
                cur.pop("entity_roles", None)
        if cur:
            store[signature] = cur
        else:
            store.pop(signature, None)
        _save(store)
        log_info(f"[device_overrides] set {signature}: {json.dumps(cur)[:160]}")
        return cur
