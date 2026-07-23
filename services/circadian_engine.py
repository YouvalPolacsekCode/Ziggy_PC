"""Smart Light Schedule — continuous adaptive ramp engine.

Replaces the old 4-event circadian bundle (services/circadian_builder.py) with a
Ziggy-driven continuous ramp: a scheduled light's warmth + brightness is a smooth
function of the time of day, interpolated between two user anchors —

    day peak   (brightest + coolest, at solar noon)
    night floor(dimmest  + warmest, held overnight)

and the user's wake / bedtime. See
docs/superpowers/specs/2026-07-20-smart-light-schedule-continuous-ramp-design.md.

How it stays applied:
  - tick()            — every ~10 min: re-tint every scheduled light that is ON
                        and not manually overridden, to the current ramp point.
  - on_light_turned_on— the instant a scheduled light goes off→on it joins the
                        schedule (enroll: clears manual flag + applies now).
  - sync_now()        — the play button: re-enroll ALL scheduled lights and snap
                        them to the current point (the escape hatch, since a
                        hand-changed light is otherwise left alone).

"Until manually set": when the user changes a scheduled light by hand (detected
in ha_subscriber), the engine marks it manual and stops adjusting it until the
light is next switched off→on or the user taps Sync now. The manual flag is the
engine's own (NOT the executor's 30-min manual_overrides TTL) so it persists for
the rest of the day rather than silently expiring.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime
from typing import Optional
from zoneinfo import ZoneInfo

from core.logger_module import log_info, log_error

# The container runs in UTC, but the ramp anchors (wake/noon/bedtime) are the
# user's LOCAL wall-clock times — so "now" must be the home's local time, or the
# whole schedule runs shifted by the UTC offset (e.g. Israel evening reads as
# afternoon → too bright/cool). Resolve the home timezone from HA's core config
# (canonical), fall back to the Israel-first default. Cached once resolved.
_home_tz_cache: Optional[ZoneInfo] = None
_DEFAULT_HOME_TZ = "Asia/Jerusalem"


def _home_tz() -> ZoneInfo:
    global _home_tz_cache
    if _home_tz_cache is not None:
        return _home_tz_cache
    tz_name = None
    try:
        from core.settings_loader import settings
        tz_name = (settings.get("home") or {}).get("timezone") or None
    except Exception:
        pass
    if not tz_name:
        try:
            import requests
            from services.home_automation import _ha_url, _headers
            resp = requests.get(f"{_ha_url()}/api/config", headers=_headers(), timeout=4)
            if resp.ok:
                tz_name = resp.json().get("time_zone")
        except Exception:
            pass
    if tz_name:
        try:
            _home_tz_cache = ZoneInfo(tz_name)   # only cache a real resolution
            return _home_tz_cache
        except Exception:
            pass
    try:
        return ZoneInfo(_DEFAULT_HOME_TZ)        # not cached — retry HA next call
    except Exception:
        return ZoneInfo("UTC")


def home_now() -> datetime:
    """Current time in the home's local timezone (tz-aware)."""
    return datetime.now(_home_tz())

_CONFIG_FILE = "user_files/circadian_config.json"

DEFAULTS = {
    "enabled":  False,
    # auto_on=False → only adjust lights that are already ON (never switch a light
    # on/off; the ramp just re-tints on-lights). This is the default and the right
    # mode when occupancy/Smart Room owns on/off.
    # auto_on=True  → the schedule also switches scheduled lights ON to the ramp
    # point (keeps them lit at the right level; a light turned off comes back on
    # at the next tick). The old "turn on lights vs only adjust on-lights" picker.
    "auto_on":  False,
    "lights":   [],
    "peak":     {"kelvin": 5500, "pct": 100},   # day: cool + bright, at solar noon
    "floor":    {"kelvin": 2200, "pct": 30},    # night: warm + dim
    "wake":     "07:00",                         # morning ramp begins
    "bedtime":  "22:00",                         # reaches the floor
    "noon":     "12:00",                         # solar-noon anchor (peak moment)
}

# Engine-owned manual-control set: scheduled lights the user grabbed by hand.
# Cleared on off→on (enroll) or Sync now. In-memory — a manual override is a
# transient hint, and losing it on restart just means the next tick re-tints.
_manual: set[str] = set()
_last_target: tuple[int, int] | None = None     # (kelvin, pct) last computed — for the View modal
_lock = threading.Lock()


# ── config ───────────────────────────────────────────────────────────────────

def load_config() -> dict:
    try:
        if os.path.exists(_CONFIG_FILE):
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                return {**DEFAULTS, **(json.load(f) or {})}
    except Exception as e:
        log_error(f"[Circadian] load_config: {e}")
    return dict(DEFAULTS)


def save_config(cfg: dict) -> dict:
    merged = {**DEFAULTS, **(cfg or {})}
    # Only color-temp-capable makes sense to schedule, but store what's given;
    # apply() filters by live capability.
    merged["lights"] = [l for l in (merged.get("lights") or []) if isinstance(l, str) and l.startswith("light.")]
    try:
        os.makedirs(os.path.dirname(_CONFIG_FILE), exist_ok=True)
        with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(merged, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log_error(f"[Circadian] save_config: {e}")
    return merged


def scheduled_lights() -> list[str]:
    return load_config().get("lights") or []


# ── ramp math (pure, unit-tested) ─────────────────────────────────────────────

def _hm_to_min(hm: str, fallback: int) -> int:
    try:
        h, m = str(hm).split(":")[:2]
        return int(h) * 60 + int(m)
    except Exception:
        return fallback


def _lerp(a: float, b: float, frac: float) -> float:
    frac = 0.0 if frac < 0 else 1.0 if frac > 1 else frac
    return a + (b - a) * frac


def compute_target(now: datetime, cfg: dict) -> tuple[int, int]:
    """Return (color_temp_kelvin, brightness_pct) for `now` under `cfg`.

    Piecewise-linear between the two anchors:
        t < wake or t >= bed   → floor (night, held)
        wake ≤ t < noon        → floor → peak  (morning rise)
        noon ≤ t < bed         → peak → floor  (afternoon/evening fall)
    Robust to degenerate configs (wake≥noon, noon≥bed) — never divides by zero.
    """
    peak, floor = cfg.get("peak") or DEFAULTS["peak"], cfg.get("floor") or DEFAULTS["floor"]
    Kp, Bp = int(peak.get("kelvin", 5500)), int(peak.get("pct", 100))
    Kf, Bf = int(floor.get("kelvin", 2200)), int(floor.get("pct", 30))

    wake = _hm_to_min(cfg.get("wake"), 7 * 60)
    noon = _hm_to_min(cfg.get("noon"), 12 * 60)
    bed  = _hm_to_min(cfg.get("bedtime"), 22 * 60)
    t = now.hour * 60 + now.minute

    # Guard ordering so the segments are well-formed.
    noon = max(noon, wake + 1)
    bed  = max(bed, noon + 1)

    if t < wake or t >= bed:
        k, b = Kf, Bf
    elif t < noon:
        frac = (t - wake) / (noon - wake)
        k, b = _lerp(Kf, Kp, frac), _lerp(Bf, Bp, frac)
    else:
        frac = (t - noon) / (bed - noon)
        k, b = _lerp(Kp, Kf, frac), _lerp(Bp, Bf, frac)

    return int(round(k)), max(1, min(100, int(round(b))))


def current_target(cfg: Optional[dict] = None) -> tuple[int, int]:
    cfg = cfg or load_config()
    k, b = compute_target(home_now(), cfg)
    global _last_target
    _last_target = (k, b)
    return k, b


# ── applying to HA ────────────────────────────────────────────────────────────

def _split_by_color_temp(eids: list[str]) -> tuple[list[str], list[str]]:
    """(color_temp-capable, brightness-only) from the live state cache."""
    ct, plain = [], []
    try:
        from services.ha_subscriber import state_cache
        cache = state_cache or {}
    except Exception:
        cache = {}
    for eid in eids:
        modes = ((cache.get(eid) or {}).get("attributes") or {}).get("supported_color_modes") or []
        (ct if "color_temp" in modes else plain).append(eid)
    return ct, plain


def _turn_on(eids: list[str], data: dict) -> None:
    if not eids:
        return
    from services.home_automation import call_service
    from services.manual_overrides import register_ziggy_call
    for eid in eids:
        register_ziggy_call(eid)   # so our write isn't misread as a manual change
    call_service("light", "turn_on", {"entity_id": eids, **data}, origin="circadian")


def apply(eids: list[str], kelvin: int, pct: int, *, enroll: bool = False) -> int:
    """Set the given lights to (kelvin, pct). enroll=True first clears the manual
    flag (used by turn-on + Sync now). Returns how many lights were written."""
    eids = [e for e in eids if e]
    if not eids:
        return 0
    if enroll:
        with _lock:
            for e in eids:
                _manual.discard(e)
    ct, plain = _split_by_color_temp(eids)
    _turn_on(ct,    {"color_temp_kelvin": int(kelvin), "brightness_pct": int(pct)})
    _turn_on(plain, {"brightness_pct": int(pct)})
    return len(eids)


def _live_on(eids: list[str]) -> list[str]:
    try:
        from services.ha_subscriber import state_cache
        cache = state_cache or {}
    except Exception:
        cache = {}
    return [e for e in eids if (cache.get(e) or {}).get("state") == "on"]


# ── public engine operations ──────────────────────────────────────────────────

def tick() -> dict:
    """Periodic pass — re-tint every scheduled light that is ON and not manually
    overridden, to the current ramp point. Skips off + hand-controlled lights."""
    cfg = load_config()
    if not cfg.get("enabled") or not cfg.get("lights"):
        return {"ran": False}
    k, b = current_target(cfg)
    with _lock:
        manual = set(_manual)
    # auto_on: also switch scheduled lights ON to the ramp; otherwise only re-tint
    # the ones already on (the coexistence-safe default — occupancy owns on/off).
    pool = cfg["lights"] if cfg.get("auto_on") else _live_on(cfg["lights"])
    targets = [e for e in pool if e not in manual]
    n = apply(targets, k, b) if targets else 0
    log_info(f"[Circadian] tick → {k}K/{b}% on {n} light(s); skipped {len(manual)} manual"
             f"{' (auto_on)' if cfg.get('auto_on') else ''}")
    return {"ran": True, "kelvin": k, "pct": b, "applied": n, "manual": len(manual)}


def on_light_turned_on(entity_id: str) -> None:
    """A scheduled light just went off→on — enroll it and snap to current point."""
    cfg = load_config()
    if not cfg.get("enabled") or entity_id not in (cfg.get("lights") or []):
        return
    k, b = current_target(cfg)
    apply([entity_id], k, b, enroll=True)
    log_info(f"[Circadian] {entity_id} turned on → joined schedule at {k}K/{b}%")


def mark_manual(entity_id: str) -> None:
    """User grabbed a scheduled light by hand — stop adjusting it until off→on / sync."""
    if entity_id in (load_config().get("lights") or []):
        with _lock:
            _manual.add(entity_id)
        log_info(f"[Circadian] {entity_id} taken manual — leaving it until off→on or Sync")


def sync_now() -> dict:
    """Play button — re-enroll ALL scheduled lights (clear manual) and snap the
    ones currently on to the current point."""
    cfg = load_config()
    lights = cfg.get("lights") or []
    with _lock:
        _manual.clear()
    if not lights:
        return {"ok": True, "applied": 0}
    k, b = current_target(cfg)
    pool = lights if cfg.get("auto_on") else _live_on(lights)
    n = apply(pool, k, b, enroll=True)
    log_info(f"[Circadian] sync_now → {k}K/{b}% on {n} light(s)")
    return {"ok": True, "kelvin": k, "pct": b, "applied": n}


def _legacy_lights() -> list[str]:
    """Pull the light list off a legacy circadian HA automation (if any)."""
    try:
        import requests
        from services import ha_client
        r = requests.get(f"{ha_client.url()}/api/config/automation/config/ziggy_circadian_sunrise",
                         headers=ha_client.headers(), timeout=6)
        if r.status_code != 200:
            return []
        found: set[str] = set()
        def walk(x):
            if isinstance(x, dict):
                tgt = (x.get("target") or {}).get("entity_id")
                if isinstance(tgt, str): found.add(tgt)
                elif isinstance(tgt, list): found.update(tgt)
                for v in x.values(): walk(v)
            elif isinstance(x, list):
                for v in x: walk(v)
        cfg = r.json()
        walk(cfg.get("actions") or cfg.get("action") or [])
        return sorted(e for e in found if e.startswith("light."))
    except Exception:
        return []


def migrate_from_bundle() -> dict:
    """One-time: replace the 4 legacy circadian HA automations with an engine
    config carrying the same lights, then delete them (so both don't run).
    No-op if a config file already exists or no legacy bundle is found."""
    if os.path.exists(_CONFIG_FILE):
        return {"migrated": False, "reason": "config_exists"}
    lights = _legacy_lights()
    if not lights:
        return {"migrated": False, "reason": "no_legacy"}
    save_config({**DEFAULTS, "enabled": True, "lights": lights})
    try:
        from services.circadian_builder import delete_bundle
        delete_bundle()
    except Exception as e:
        log_error(f"[Circadian] legacy delete during migrate: {e}")
    log_info(f"[Circadian] migrated {len(lights)} light(s) off the legacy bundle → continuous ramp")
    return {"migrated": True, "lights": len(lights)}


def start_scheduler(interval_s: int = 600) -> None:
    """Background loop — apply the current ramp point every `interval_s` (~10 min).
    Spawned as a daemon thread from ziggy_main. Exits on shutdown_event."""
    from core.shared_flags import shutdown_event
    log_info(f"[Circadian] scheduler started (every {interval_s}s)")
    # A short settle before the first tick so the state cache is populated.
    if shutdown_event.wait(30):
        return
    try:
        migrate_from_bundle()
    except Exception as e:
        log_error(f"[Circadian] migrate failed: {e}")
    while not shutdown_event.is_set():
        try:
            tick()
        except Exception as e:
            log_error(f"[Circadian] tick failed: {e}")
        # Sleep in one interruptible wait so shutdown is prompt.
        if shutdown_event.wait(interval_s):
            break


def status() -> dict:
    """For the View modal + card: config + current point + which lights are hand-controlled."""
    cfg = load_config()
    k, b = current_target(cfg)
    with _lock:
        manual = sorted(_manual)
    return {
        **cfg,
        "current": {"kelvin": k, "pct": b},
        "manual_lights": manual,
    }
