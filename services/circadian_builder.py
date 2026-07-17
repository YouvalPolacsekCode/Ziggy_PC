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

import re
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


def _entity_object_id(alias: str) -> str:
    """The HA entity object_id HA derives from an automation's alias.

    HA sets automation.<object_id> from slugify(alias), NOT from the config
    `id`. So a config saved at id `ziggy_circadian_sunrise` with alias
    "Ziggy Smart Light Schedule — Sunrise" lands as
    `automation.ziggy_smart_light_schedule_sunrise`. Ziggy's list + the UI
    grouping key off that entity id, so all local metadata (trigger/actions
    for display) MUST be keyed by this, not the config id — otherwise the
    Smart Light Schedule renders blank (Bug 6). Mirrors homeassistant.util.slugify
    for the ASCII case, which is all our fixed aliases use.
    """
    s = re.sub(r"[^a-z0-9_]+", "_", alias.lower())
    return re.sub(r"_+", "_", s).strip("_")


def _meta_trigger(phase_id: str, bedtime: str) -> dict:
    """A trigger dict the frontend can read (it reads `.trigger.time` for bedtime)."""
    if phase_id == "bedtime":
        return {"time": bedtime}
    if phase_id == "solar_noon":
        return {"time": "12:00"}
    return {"platform": "sun", "event": "sunrise" if phase_id == "sunrise" else "sunset"}


def _actions_for(lights: list[str], color_temp_k: int, brightness_pct: int,
                 auto_on: bool) -> list[dict]:
    """Per-phase light actions.

    auto_on=True  → turn the lights ON and set warmth/brightness (what the user
                    expects: "all my lights follow the schedule").
    auto_on=False → only re-tint lights already on, via a per-light `choose`
                    gate, so off lights aren't woken.
    """
    settings_data = {"color_temp_kelvin": color_temp_k, "brightness_pct": brightness_pct}
    if auto_on:
        return [{
            "service": "light.turn_on",
            "target":  {"entity_id": lights},
            "data":    settings_data,
        }]
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
                            "data": dict(settings_data),
                        }
                    ],
                }
                for light in lights
            ]
        }
    ]


def _sun_is_up() -> Optional[bool]:
    """True if HA's sun is above the horizon, None if unknown."""
    try:
        resp = requests.get(f"{HA_URL()}/api/states/sun.sun", headers=HEADERS(), timeout=5)
        if resp.status_code == 200:
            return resp.json().get("state") == "above_horizon"
    except Exception:
        pass
    return None


def _current_phase_id(bedtime: str) -> str:
    """Which phase's lighting is 'current' right now.

    Maps the moment to the last phase that would have fired: morning→sunrise,
    afternoon→midday, evening→sunset, night→bedtime. Uses HA's sun state (day vs
    night) plus the local clock, so it's robust without fragile sunrise math.
    """
    import datetime
    try:
        bedtime_hour = int(bedtime.split(":")[0])
    except Exception:
        bedtime_hour = 22
    hour = datetime.datetime.now().hour
    up = _sun_is_up()
    if up is None:
        up = 7 <= hour < 19  # clock-only fallback
    if up:
        return "sunrise" if hour < 12 else "solar_noon"
    # sun down: evening (after noon, before bedtime) = sunset; else deep night = bedtime
    if 12 <= hour < bedtime_hour:
        return "sunset"
    return "bedtime"


def apply_current_phase(lights: list[str], bedtime: str = "22:00", auto_on: bool = True) -> dict:
    """Immediately set the lights to the phase appropriate for the current time.

    Called right after save so the schedule 'takes effect now' instead of waiting
    for the next sun/time event. Respects auto_on: when False, only lights that
    are already on are re-tinted (off lights are left off).
    """
    cleaned = [l for l in lights if isinstance(l, str) and l.startswith("light.")]
    if not cleaned:
        return {"applied": False, "reason": "no_lights"}
    pid = _current_phase_id(bedtime)
    kelvin, pct = next(((k, p) for phase_id, _a, _t, k, p in PHASES if phase_id == pid), (3000, 80))

    targets = cleaned
    if not auto_on:
        # Only adjust lights already on.
        try:
            resp = requests.get(f"{HA_URL()}/api/states", headers=HEADERS(), timeout=8)
            live = {s["entity_id"]: s.get("state") for s in resp.json()} if resp.status_code == 200 else {}
            targets = [l for l in cleaned if live.get(l) == "on"]
        except Exception:
            targets = []
    if not targets:
        return {"applied": True, "phase": pid, "lights": 0}
    try:
        requests.post(
            f"{HA_URL()}/api/services/light/turn_on",
            headers=HEADERS(),
            json={"entity_id": targets, "color_temp_kelvin": kelvin, "brightness_pct": pct},
            timeout=10,
        )
    except Exception as e:
        log_error(f"[Circadian] apply_current_phase: {e}")
        return {"applied": False, "error": str(e)}
    log_info(f"[Circadian] applied phase '{pid}' ({kelvin}K/{pct}%) to {len(targets)} light(s)")
    return {"applied": True, "phase": pid, "lights": len(targets)}


def build_bundle(lights: list[str], bedtime: str = "22:00", auto_on: bool = True) -> list[dict]:
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
            "actions":     _actions_for(cleaned, kelvin, pct, auto_on),
            "mode":        "single",
        })
    return configs


def save_bundle(lights: list[str], bedtime: str = "22:00", auto_on: bool = True) -> dict:
    """Create/replace the 4 HA automations. Idempotent — re-saving overwrites.

    Returns {"ok": bool, "saved": [...], "failed": [...]}.
    """
    from services.local_automation_actions import save_automation_meta, save_ziggy_actions

    configs = build_bundle(lights, bedtime, auto_on)
    if not configs:
        return {"ok": False, "saved": [], "failed": [], "error": "No color-temp lights provided"}

    cleaned = [l for l in lights if isinstance(l, str) and l.startswith("light.")]
    # phase_id + settings, indexed the same as configs, for the local meta write.
    phase_info = {_automation_id(pid): (pid, alias, k, pct)
                  for pid, alias, _trig, k, pct in PHASES}

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
                # Persist Ziggy-side metadata keyed by the ENTITY object_id (what
                # the list/UI groups on), so the Smart Light Schedule renders its
                # lights + bedtime instead of blank (Bug 6).
                pid, alias, k, pct = phase_info[auto_id]
                obj_id = _entity_object_id(alias)
                save_automation_meta(obj_id, {
                    "name":     alias,
                    "trigger":  _meta_trigger(pid, bedtime),
                    "rooms":    [],
                    "auto_on":  auto_on,
                    "circadian": True,
                })
                save_ziggy_actions(obj_id, [{
                    "service":   "light.turn_on",
                    "entity_id": cleaned,
                    "data":      {"color_temp_kelvin": k, "brightness_pct": pct},
                }])
            else:
                failed.append({"id": auto_id, "status": resp.status_code, "error": resp.text[:300]})
        except Exception as e:
            failed.append({"id": auto_id, "status": 0, "error": str(e)})

    log_info(f"[Circadian] save_bundle: saved={saved} failed={[f['id'] for f in failed]} auto_on={auto_on}")
    # Apply the current phase immediately so saving 'takes effect now' rather
    # than waiting for the next sun/time event.
    applied = {}
    if saved:
        applied = apply_current_phase(cleaned, bedtime, auto_on)
    return {
        "ok":      not failed,
        "saved":   saved,
        "failed":  failed,
        "bedtime": bedtime,
        "auto_on": auto_on,
        "lights":  lights,
        "applied": applied,
    }


def delete_bundle() -> dict:
    """Remove all 4 circadian HA automations. Safe to call when none exist."""
    from services.local_automation_actions import delete_automation_meta, delete_ziggy_actions

    deleted: list[str] = []
    missed: list[str] = []
    for phase_id, alias, *_ in PHASES:
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
        # Purge Ziggy-side metadata keyed by the entity object_id.
        obj_id = _entity_object_id(alias)
        try:
            delete_automation_meta(obj_id)
            delete_ziggy_actions(obj_id)
        except Exception:
            pass
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
