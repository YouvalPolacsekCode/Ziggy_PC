"""
Smart Light Schedule — native circadian lighting bundle.

Why this lives outside automation_templates.py:
The Ziggy wizard schema models a single-trigger, single-action-list
automation. Circadian lighting is inherently 4 separate automations
(sunrise / solar noon / sunset / bedtime), so the wizard pre-fill can't
flatten into the existing shape. Instead, the Configure flow on the
"Smart Light Schedule" suggestion calls save_circadian_bundle() here,
which POSTs 4 HA-native automation configs directly to HA's REST API.

No adaptive_lighting HACS integration is used or required — we checked,
it's not installed and there is no HACS pipeline. If a future build
installs adaptive_lighting, this module can be swapped for an
adaptive_lighting-backed builder; the API surface (build_bundle /
save_bundle / delete_bundle / get_bundle) stays the same.

Design notes:
  * IDs are deterministic — `ziggy_circadian_<phase>` — so save_bundle()
    is idempotent (re-saving replaces in place) and delete_bundle()
    doesn't need a stored list.
  * "Lights only adjusted if currently on" is enforced per-light via a
    `choose` block in each automation's actions sequence. This avoids
    waking off lights when the time/sun event fires.
  * Solar noon is approximated as 12:00 local time. HA's `sun` platform
    only emits `sunrise`/`sunset` events; computing real solar noon would
    require a state trigger on sun.sun's elevation. 12:00 is close enough
    for the user-facing intent ("cool white at midday").
"""
from __future__ import annotations

from typing import Iterable

import requests

from core.settings_loader import settings
from core.logger_module import log_error, log_info
from services import ha_client


def HA_URL() -> str:  # noqa: N802 — callable shim so credential reads stay dynamic
    return ha_client.url()


def HEADERS() -> dict:  # noqa: N802
    return ha_client.headers()


# ── Phase table ──────────────────────────────────────────────────────────────
# Each entry: (phase_id, alias, trigger_factory, color_temp_kelvin, brightness_pct)
# trigger_factory(bedtime) → list[dict] in HA's native trigger format.

def _sun_trigger(event: str) -> list[dict]:
    return [{"platform": "sun", "event": event}]


def _time_trigger(at: str) -> list[dict]:
    # HA expects "HH:MM:SS"; tolerate "HH:MM" input.
    at = at.strip()
    if len(at) == 5:
        at = at + ":00"
    return [{"platform": "time", "at": at}]


PHASES = [
    # (phase_id,    alias,                                    trigger,                    K,    pct)
    ("sunrise",    "Ziggy Smart Light Schedule — Sunrise",   lambda bt: _sun_trigger("sunrise"),  2700, 70),
    ("solar_noon", "Ziggy Smart Light Schedule — Midday",    lambda bt: _time_trigger("12:00"),   5500, 100),
    ("sunset",     "Ziggy Smart Light Schedule — Sunset",    lambda bt: _sun_trigger("sunset"),   3000, 80),
    ("bedtime",    "Ziggy Smart Light Schedule — Bedtime",   lambda bt: _time_trigger(bt),        2200, 30),
]

ID_PREFIX = "ziggy_circadian_"


def _automation_id(phase_id: str) -> str:
    return f"{ID_PREFIX}{phase_id}"


def _actions_for(lights: list[str], color_temp_k: int, brightness_pct: int) -> list[dict]:
    """One `choose` block per light: only call light.turn_on if the light is currently on."""
    return [
        {
            "choose": [
                {
                    "conditions": [
                        {"condition": "state", "entity_id": light, "state": "on"}
                    ],
                    "sequence": [
                        {
                            "service": "light.turn_on",
                            "target": {"entity_id": light},
                            "data": {
                                "color_temp_kelvin": color_temp_k,
                                "brightness_pct":   brightness_pct,
                            },
                        }
                    ],
                }
                for light in lights
            ]
        }
    ]


def build_bundle(lights: list[str], bedtime: str = "22:00") -> list[dict]:
    """Return the 4 HA-native automation configs (one per phase).

    These configs can be inspected before saving — useful for the review
    report and for a dry-run UI preview.
    """
    cleaned: list[str] = [l for l in lights if isinstance(l, str) and l.startswith("light.")]
    if not cleaned:
        return []

    configs: list[dict] = []
    for phase_id, alias, trig_factory, kelvin, pct in PHASES:
        configs.append({
            "id":          _automation_id(phase_id),
            "alias":       alias,
            "description": f"Ziggy circadian — {phase_id.replace('_', ' ')} @ {kelvin}K / {pct}%",
            "triggers":    trig_factory(bedtime),
            "conditions":  [],
            "actions":     _actions_for(cleaned, kelvin, pct),
            "mode":        "single",
        })
    return configs


def save_bundle(lights: list[str], bedtime: str = "22:00") -> dict:
    """Create/replace the 4 HA automations. Idempotent — re-saving overwrites.

    Returns {"ok": bool, "saved": [...], "failed": [...]}.
    """
    configs = build_bundle(lights, bedtime)
    if not configs:
        return {"ok": False, "saved": [], "failed": [], "error": "No color-temp lights provided"}

    saved: list[str] = []
    failed: list[dict] = []

    for cfg in configs:
        auto_id = cfg["id"]
        try:
            resp = requests.post(
                f"{HA_URL()}/api/config/automation/config/{auto_id}",
                headers=HEADERS(),
                json=cfg,
                timeout=10,
            )
            if resp.status_code in (200, 201):
                saved.append(auto_id)
            else:
                failed.append({"id": auto_id, "status": resp.status_code, "error": resp.text[:300]})
        except Exception as e:
            failed.append({"id": auto_id, "status": 0, "error": str(e)})

    log_info(f"[Circadian] save_bundle: saved={saved} failed={[f['id'] for f in failed]}")
    return {
        "ok":      not failed,
        "saved":   saved,
        "failed":  failed,
        "bedtime": bedtime,
        "lights":  lights,
    }


def delete_bundle() -> dict:
    """Remove all 4 circadian HA automations. Safe to call when none exist."""
    deleted: list[str] = []
    missed: list[str] = []
    for phase_id, *_ in PHASES:
        auto_id = _automation_id(phase_id)
        try:
            resp = requests.delete(
                f"{HA_URL()}/api/config/automation/config/{auto_id}",
                headers=HEADERS(), timeout=10,
            )
            if resp.status_code in (200, 204):
                deleted.append(auto_id)
            else:
                missed.append(auto_id)
        except Exception as e:
            log_error(f"[Circadian] delete {auto_id}: {e}")
            missed.append(auto_id)
    return {"ok": True, "deleted": deleted, "missed": missed}


def get_bundle() -> dict:
    """Inspect current state of the bundle in HA. Returns which phases exist."""
    phases: dict[str, dict] = {}
    for phase_id, *_ in PHASES:
        auto_id = _automation_id(phase_id)
        try:
            resp = requests.get(
                f"{HA_URL()}/api/config/automation/config/{auto_id}",
                headers=HEADERS(), timeout=5,
            )
            phases[phase_id] = {"installed": resp.status_code == 200, "id": auto_id}
        except Exception:
            phases[phase_id] = {"installed": False, "id": auto_id}
    installed = [p for p, info in phases.items() if info["installed"]]
    return {
        "installed":     bool(installed) and len(installed) == len(PHASES),
        "partial":       bool(installed) and len(installed) < len(PHASES),
        "phases":        phases,
        "phase_count":   len(PHASES),
    }
