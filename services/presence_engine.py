"""Presence state machine for Ziggy.

This module owns every presence decision. The router is a thin HTTP wrapper;
the scheduler delegates expiry sweeps here. Side effects (push, automation
fanout) happen in callers based on the returned Decision, so the engine itself
stays sync and easy to unit-test.

Design notes:
  * **Hysteresis**: enter "home" when distance ≤ home_radius_m, leave "home"
    only when distance > away_radius_m (default 100 / 200). A phone parked on
    the boundary cannot flip state forever.
  * **Accuracy gating**: pings with accuracy worse than max_accuracy_m are
    recorded but ignored for state transitions (the position is too uncertain).
  * **Stale timestamp rejection**: pings whose client_ts is older than
    stale_ping_seconds are rejected. Defeats replay / queued-while-offline.
  * **Dwell**: a contradicting raw state must persist for dwell_seconds before
    becoming the confirmed state. Defeats one-sample GPS jitter.
  * **Cooldown / dedup**: identical transitions within cooldown_seconds are
    suppressed; a second commit in the same direction as the last transition
    is also suppressed (idempotent).
  * **Concurrency**: a process-wide RLock guards persons.json read-modify-write.

────────────────────────────────────────────────────────────────────────────
Invariants the engine relies on — break these and you reintroduce spam
────────────────────────────────────────────────────────────────────────────
1. **persons.json is the only state.** The engine holds NO in-memory state
   between calls. A process restart never replays transitions because the
   committed `state` + `last_transition_at` survive in the file. If you add
   in-process caches, you MUST persist them or risk replay on restart.

2. **`fired_transition=True` means side effects MUST run exactly once.**
   The engine has already enforced cooldown/dedup before setting this flag.
   Callers should fire push + automations idempotently — don't add another
   "is this a duplicate?" check on top, and don't re-fire from a different
   code path. The router fires from `_handle_decision`; the scheduler fires
   from `_sweep_presence_expiry`. Both are guarded by the same cooldown
   logic, so an expiry-driven leave + a ping-driven leave can never both
   fire for the same effective transition.

3. **Always pass `now=ts` to `effective_state` from inside the engine.**
   `effective_state` reads `_now()` by default, but the engine internals
   work with the injected `ts` clock for testability. Tests mock `_cfg` and
   inject `now`; external callers (presence_store, anomaly_engine) call
   `effective_state(person)` and get real wall-clock time, which is fine.

4. **Anything that touches persons.json holds `_lock`.** Concurrent pings
   would otherwise race read-modify-write and double-fire the same
   transition. The lock is process-wide (threading.RLock); within a single
   asyncio event loop there's no contention, but external services running
   in threads (HA subscriber, scheduler) coexist correctly.

5. **Migration is lazy but idempotent.** `_load` calls `_migrate_in_place`
   on every read. Adding a new field means: append it to `_NEW_FIELDS`, give
   it a sane default (`None` / `[]`), and the next `_load` will backfill it
   on disk. Never break the read path for old records.

────────────────────────────────────────────────────────────────────────────
Multi-signal ingestion (Ziggy-native — no Home Assistant dependency)
────────────────────────────────────────────────────────────────────────────
There are two ways to feed presence data into the engine:

  * `ingest_ping(token, lat, lon, accuracy, …)` — raw GPS from the PWA. The
    engine computes raw state with hysteresis from the home zone. Best signal
    when the phone is awake / the PWA tab is open.
  * `ingest_external_state(person_id, state, source, …)` — any pre-decided
    home/not_home signal. Skips hysteresis (no lat/lon needed) but still
    applies dwell + cooldown.

Today only one external source feeds `ingest_external_state`:

  - **LAN reachability** (services.lan_presence) — Ziggy on the home network
    pings the phone's hostname/IP every minute. A reachable phone is a STRONG
    "home" signal that works even when the PWA is closed. Sustained
    unreachability flips the signal to "not_home" after a configurable grace
    period (defeats the iOS-Safari-suspends-PWA scenario).

The signals layer naturally — whichever source fires the dwell first commits
the transition; the cooldown then prevents subsequent same-direction commits
from any source. Use this to add new signals (BLE proximity, WiFi SSID hint,
manual override, etc.) without changing the state machine.

Both return a `Decision` and the caller fires side effects when
`fired_transition` is True.

Persistence format (per person, persisted in user_files/persons.json):
  id, name, token, linked_user        — identity / auth
  lan_host                             — optional LAN address of this person's phone
                                          (e.g. "youval-iphone.local" or "192.168.1.42")
  lan_last_probe                       — ISO UTC of last LAN probe attempt
  lan_last_seen                        — ISO UTC of last successful LAN probe
  state                                — confirmed "home" | "not_home" | "unknown"
  last_seen                            — ISO UTC of last accepted ping
  last_lat, last_lon                   — coordinates of last accepted ping
  last_accuracy                        — metres, accuracy of last accepted ping
  last_distance_m                      — distance from home centre at last ping
  candidate_state, candidate_since     — pending state currently being dwelled
  last_transition_at, last_transition_to — last confirmed transition (for cooldown)
  last_decision                        — debug snapshot of the most recent decision
  history                              — small ring buffer of recent decisions
"""
from __future__ import annotations

import json
import math
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from core.logger_module import log_info, log_error
from core.settings_loader import settings

# ── defaults — overridable via settings.presence ──────────────────────────────
_DEFAULTS = {
    "home_radius_m":       100.0,
    "away_radius_m":       200.0,
    "max_accuracy_m":      150.0,
    "dwell_seconds":       60,
    "cooldown_seconds":    600,
    "stale_ping_seconds":  90,
    "stale_home_hours":    8,        # max trust window when LAN actively confirms home
    "stale_home_no_lan_minutes": 30, # GPS-only fallback — iOS Safari suspends watchPosition the moment the tab backgrounds, so a person who left will never send "I'm away" GPS. Decay home → unknown after this if there's no LAN confirmation.
    "lan_fresh_seconds":   180,      # LAN probe is "active" if a successful reachability check happened within this window
    "stale_away_minutes":  30,
    "history_size":        20,
}


def _cfg(key: str):
    p = settings.get("presence", {}) or {}
    v = p.get(key)
    return v if v is not None else _DEFAULTS[key]


_REGISTRY = Path(__file__).resolve().parent.parent / "user_files" / "persons.json"
_lock = threading.RLock()

# In-memory cache for _load(). Audit found `ingest_ping()` calls _load() 9–10×
# per pass (find_person → load → state checks → ... → save). The cached list
# is deep-copied on every read so callers can mutate freely without poisoning
# the cache. Validity is gated on file mtime + size so writes from the HTTP
# router (which uses its own _load/_save against the same file) are picked
# up on the next call, not deferred for any TTL window.
_load_cache: tuple[float, int, list[dict]] | None = None  # (mtime_ns, size, persons)


# Fields added by the engine refactor. _migrate_in_place backfills them when
# loading legacy records so the engine never has to defend against `KeyError`
# in its hot paths.
_NEW_FIELDS = (
    "last_accuracy",
    "last_distance_m",
    "candidate_state",
    "candidate_since",
    "last_transition_at",
    "last_transition_to",
    "last_decision",
    "last_gps_at",      # ISO UTC of the last accepted GPS ping (NOT bumped by LAN — the true GPS-fix freshness, used for LAN↔GPS fusion)
    "lan_host",         # IP, hostname, or *.local (mDNS) name of this person's phone on the home LAN
    "lan_last_probe",   # ISO UTC of last LAN probe attempt
    "lan_last_seen",    # ISO UTC of last successful LAN probe (reachable on LAN)
    "lan_host_suggested",  # client IP captured server-side on a same-home-LAN ping; a candidate lan_host we offer the user to accept (never probed until they do)
    "lan_host_auto",       # True → lan_host is auto-managed (the app self-reports its own Wi-Fi IP; re-reported on every reconnect so DHCP changes self-heal). False → user typed it manually; auto reports must not clobber it.
)

# zone_states is a dict, not None — keep it separate so the empty default is {}.
_NEW_DICT_FIELDS = (
    "zone_states",      # {zone_id: {state, candidate_state, candidate_since, last_transition_at, last_transition_to}}
)


def _migrate_in_place(persons: list[dict]) -> bool:
    """Fill in missing fields on legacy records. Returns True if anything changed."""
    changed = False
    for p in persons:
        for k in _NEW_FIELDS:
            if k not in p:
                p[k] = None
                changed = True
        for k in _NEW_DICT_FIELDS:
            if k not in p:
                p[k] = {}
                changed = True
        if "history" not in p:
            p["history"] = []
            changed = True
    return changed


# ── decision record ───────────────────────────────────────────────────────────

@dataclass
class ZoneTransition:
    """A per-zone entry/exit event. Independent of the primary home/not_home
    state machine — extra zones each have their own dwell + cooldown.
    """
    zone_id:     str
    zone_name:   str
    direction:   str            # "entered" | "left"
    ts:          datetime
    person_id:   str
    person_name: str
    distance_m:  Optional[float] = None
    reason:      str = ""


@dataclass
class Decision:
    """The outcome of a single ingest or sweep call.

    The caller (router) is responsible for firing side effects when
    `fired_transition` is True. `zone_transitions` carries any extra-zone
    enter/leave events fired by the same position update — the caller fires
    `zone_entered` / `zone_left` automations for these.
    """
    person_id:      str
    person_name:    str
    ts:             datetime
    source:         str                       # "ping" | "manual" | "expiry"
    raw_state:      str                       # "home" | "not_home" | "unknown"
    distance_m:     Optional[float] = None
    accuracy_m:     Optional[float] = None
    prev_confirmed: str = "unknown"
    new_confirmed:  str = "unknown"
    result:         str = "no_change"
    reason:         str = ""
    fired_transition: bool = False
    zone_transitions: list = field(default_factory=list)  # list[ZoneTransition]

    def to_log_dict(self) -> dict:
        return {
            "ts":         self.ts.isoformat(),
            "person":     self.person_name,
            "source":     self.source,
            "raw":        self.raw_state,
            "dist":       round(self.distance_m, 1) if self.distance_m is not None else None,
            "acc":        round(self.accuracy_m, 1) if self.accuracy_m is not None else None,
            "prev":       self.prev_confirmed,
            "new":        self.new_confirmed,
            "result":     self.result,
            "reason":     self.reason,
            "fired":      self.fired_transition,
        }


# ── persistence helpers ───────────────────────────────────────────────────────

def _ensure_registry() -> None:
    if not _REGISTRY.exists():
        _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
        _REGISTRY.write_text("[]", encoding="utf-8")


def _file_signature() -> tuple[float, int] | None:
    try:
        st = _REGISTRY.stat()
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def _load() -> list[dict]:
    """Return the current persons list. Cached and invalidated by file
    mtime+size so concurrent writes from the HTTP router (which uses its
    own _save against the same file) are reflected on the next call.
    """
    global _load_cache
    import copy

    _ensure_registry()
    sig = _file_signature()

    with _lock:
        if _load_cache is not None and sig is not None:
            cached_mtime, cached_size, cached_persons = _load_cache
            if (cached_mtime, cached_size) == sig:
                return copy.deepcopy(cached_persons)

    try:
        persons = json.loads(_REGISTRY.read_text(encoding="utf-8"))
    except Exception:
        return []
    if _migrate_in_place(persons):
        try:
            _save(persons)
            sig = _file_signature()
        except Exception as exc:
            log_error(f"[Presence] Migration save failed: {exc}")

    if sig is not None:
        with _lock:
            _load_cache = (sig[0], sig[1], copy.deepcopy(persons))
    return persons


def _save(persons: list[dict]) -> None:
    global _load_cache
    import copy

    _REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    _REGISTRY.write_text(
        json.dumps(persons, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    sig = _file_signature()
    if sig is not None:
        with _lock:
            _load_cache = (sig[0], sig[1], copy.deepcopy(persons))


# ── geometry ──────────────────────────────────────────────────────────────────

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points, in metres."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def gps_recent_home(person: dict, max_age_minutes: float, now: Optional[datetime] = None) -> bool:
    """True when the person's LAST GPS fix is inside the home zone AND fresh
    enough to trust. Used to VETO a LAN-grace 'not_home': if Wi-Fi drops but GPS
    still has you home, you haven't left — the phone just napped off Wi-Fi.

    Position is the real discriminator (a real departure moves last_lat/lon
    outside home, or the geofence-exit ping already flipped you). The freshness
    bound only stops a stone-dead GPS (no fix in a long time) from vetoing
    forever — beyond max_age we can't vouch for "home" and let LAN decide.
    """
    lat = person.get("last_lat")
    lon = person.get("last_lon")
    if lat is None or lon is None:
        return False
    gps_at = _parse_iso(person.get("last_gps_at"))
    if gps_at is None:
        return False
    n = now or _now()
    if (n - gps_at) > timedelta(minutes=max_age_minutes):
        return False
    zone = _home_zone()
    if not zone:
        return False
    hlat, hlon, radius = zone
    try:
        return haversine_m(float(lat), float(lon), hlat, hlon) <= float(radius)
    except (TypeError, ValueError):
        return False


def _home_zone() -> Optional[tuple[float, float, float]]:
    """Return (lat, lon, radius_m) for the home zone, or None if unconfigured.

    Priority: Ziggy settings → HA zone.home → HA core config.
    radius_m here is the "centre" radius — the engine derives enter/exit radii
    from settings.presence.{home_radius_m, away_radius_m} regardless.
    """
    hz = settings.get("home_zone", {}) or {}
    lat    = hz.get("lat")
    lon    = hz.get("lon")
    if lat is not None and lon is not None:
        return float(lat), float(lon), float(hz.get("radius_m", 100))

    try:
        from services.home_automation import get_state
        r = get_state("zone.home")
        if r.get("ok"):
            attrs  = r.get("data", {}).get("attributes", {})
            ha_lat = attrs.get("latitude")
            ha_lon = attrs.get("longitude")
            if ha_lat is not None and ha_lon is not None:
                return float(ha_lat), float(ha_lon), float(attrs.get("radius", 100))
    except Exception:
        pass

    try:
        from services.home_automation import _ha_url, _headers
        import requests as _req
        resp = _req.get(f"{_ha_url()}/api/config", headers=_headers(), timeout=5)
        if resp.ok:
            cfg    = resp.json()
            ha_lat = cfg.get("latitude")
            ha_lon = cfg.get("longitude")
            if ha_lat is not None and ha_lon is not None:
                return float(ha_lat), float(ha_lon), 100.0
    except Exception as exc:
        log_error(f"[Presence] Could not read HA config: {exc}")

    return None


# ── core decision logic ───────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        ts = datetime.fromisoformat(s)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts
    except Exception:
        return None


def effective_state(person: dict, now: Optional[datetime] = None) -> str:
    """Return the displayed state after asymmetric staleness decay.

    Home staleness has TWO windows:
      * If LAN probe is actively confirming presence (lan_last_seen within
        `lan_fresh_seconds`) we trust "home" for up to `stale_home_hours`
        (default 8 h) — phone backgrounded overnight at home is fine.
      * Otherwise we have GPS only. iOS Safari suspends watchPosition the
        moment the tab is backgrounded, so a person who left won't send any
        "I'm away" ping. Decay home → unknown after
        `stale_home_no_lan_minutes` (default 30 min) so the Dashboard chip
        stops lying.

    Not-home decays after `stale_away_minutes` regardless (came back to home
    Wi-Fi without opening the app is the common case).

    `now` is dependency-injected for tests; external callers omit it.
    """
    state = person.get("state", "unknown")
    if state == "unknown":
        return "unknown"
    ts = _parse_iso(person.get("last_seen"))
    if ts is None:
        return "unknown"
    n   = now or _now()
    age = n - ts

    if state == "home":
        lan_seen   = _parse_iso(person.get("lan_last_seen"))
        lan_recent = (
            lan_seen is not None
            and (n - lan_seen) < timedelta(seconds=int(_cfg("lan_fresh_seconds")))
        )
        if lan_recent:
            if age > timedelta(hours=_cfg("stale_home_hours")):
                return "unknown"
        else:
            if age > timedelta(minutes=_cfg("stale_home_no_lan_minutes")):
                return "unknown"
    else:
        if age > timedelta(minutes=_cfg("stale_away_minutes")):
            return "unknown"
    return state


def _raw_state_with_hysteresis(
    confirmed: str,
    distance_m: float,
) -> str:
    """Compute the candidate raw state from a single sample using hysteresis."""
    home_r = float(_cfg("home_radius_m"))
    away_r = float(_cfg("away_radius_m"))
    if confirmed == "home":
        # already home — only "leave" once we're well outside the zone
        return "home" if distance_m <= away_r else "not_home"
    # currently not_home or unknown — only "enter" once we're well inside
    return "home" if distance_m <= home_r else "not_home"


def _append_history(person: dict, decision: Decision) -> None:
    hist = person.get("history") or []
    hist.append({
        "ts":     decision.ts.isoformat(),
        "src":    decision.source,
        "raw":    decision.raw_state,
        "dist":   round(decision.distance_m, 1) if decision.distance_m is not None else None,
        "acc":    round(decision.accuracy_m, 1) if decision.accuracy_m is not None else None,
        "prev":   decision.prev_confirmed,
        "new":    decision.new_confirmed,
        "result": decision.result,
        "reason": decision.reason,
    })
    max_n = int(_cfg("history_size"))
    if len(hist) > max_n:
        hist = hist[-max_n:]
    person["history"] = hist
    person["last_decision"] = {
        "ts":     decision.ts.isoformat(),
        "result": decision.result,
        "reason": decision.reason,
        "raw":    decision.raw_state,
        "dist":   round(decision.distance_m, 1) if decision.distance_m is not None else None,
        "acc":    round(decision.accuracy_m, 1) if decision.accuracy_m is not None else None,
    }


def _commit_transition(person: dict, new_state: str, ts: datetime) -> None:
    person["state"] = new_state
    person["candidate_state"] = None
    person["candidate_since"] = None
    person["last_transition_at"] = ts.isoformat()
    person["last_transition_to"] = new_state


def _within_cooldown(person: dict, new_state: str, ts: datetime) -> tuple[bool, str]:
    """Return (should_suppress, reason)."""
    last_to = person.get("last_transition_to")
    last_at = _parse_iso(person.get("last_transition_at"))

    if last_to == new_state and last_at is not None:
        # Same direction as the most recent transition — always suppress (idempotent).
        return True, f"already_in_{new_state}_since_{last_at.isoformat()}"

    cooldown_s = int(_cfg("cooldown_seconds"))
    if last_at is not None and (ts - last_at).total_seconds() < cooldown_s:
        return True, f"cooldown_active_{int((ts - last_at).total_seconds())}s_of_{cooldown_s}s"

    return False, ""


def _decide_from_sample(
    person: dict,
    raw_state: str,
    ts: datetime,
    source: str,
    distance_m: Optional[float] = None,
    accuracy_m: Optional[float] = None,
) -> Decision:
    """Run the dwell/cooldown state machine for one accepted sample.

    Mutates `person` with the new candidate / state if applicable.
    Does NOT persist — the caller saves after all mutations.
    """
    prev_confirmed = effective_state(person, now=ts)
    decision = Decision(
        person_id      = person["id"],
        person_name    = person["name"],
        ts             = ts,
        source         = source,
        raw_state      = raw_state,
        distance_m     = distance_m,
        accuracy_m     = accuracy_m,
        prev_confirmed = prev_confirmed,
        new_confirmed  = prev_confirmed,
    )

    # 1. raw matches confirmed → clear any candidate, no change.
    if raw_state == prev_confirmed:
        person["candidate_state"] = None
        person["candidate_since"] = None
        decision.result = "no_change"
        decision.reason = f"raw_matches_confirmed_{prev_confirmed}"
        return decision

    # 2. raw differs → manage dwell candidate.
    cand_state = person.get("candidate_state")
    cand_since = _parse_iso(person.get("candidate_since"))
    dwell_s    = int(_cfg("dwell_seconds"))

    if cand_state != raw_state or cand_since is None:
        person["candidate_state"] = raw_state
        person["candidate_since"] = ts.isoformat()
        decision.result = "candidate_started"
        decision.reason = f"dwelling_for_{raw_state}_need_{dwell_s}s"
        return decision

    dwelled_s = (ts - cand_since).total_seconds()
    if dwelled_s < dwell_s:
        decision.result = "candidate_progressing"
        decision.reason = f"dwelled_{int(dwelled_s)}s_of_{dwell_s}s_for_{raw_state}"
        return decision

    # 3. dwell satisfied — try to commit.
    suppress, why = _within_cooldown(person, raw_state, ts)
    if suppress:
        # Still clear the candidate so we don't keep retrying.
        person["candidate_state"] = None
        person["candidate_since"] = None
        decision.result = "suppressed_cooldown"
        decision.reason = why
        return decision

    _commit_transition(person, raw_state, ts)
    decision.new_confirmed   = raw_state
    decision.result          = "committed"
    decision.reason          = f"dwell_satisfied_{int(dwelled_s)}s"
    decision.fired_transition = True
    return decision


# ── public API ────────────────────────────────────────────────────────────────

def get_home_zone() -> Optional[tuple[float, float, float]]:
    """Return the configured (lat, lon, radius_m) home zone, or None."""
    return _home_zone()


def list_persons() -> list[dict]:
    """All persons in the registry, with `effective_state` attached."""
    persons = _load()
    out = []
    for p in persons:
        row = dict(p)
        row["effective_state"] = effective_state(p)
        out.append(row)
    return out


def is_all_away(exclude_person_id: Optional[str] = None) -> bool:
    """True iff every tracked person is currently not at home.

    `unknown` counts as away — a person whose phone hasn't reported in a long
    time is treated as not at home for the purpose of "everybody left" gating.
    `exclude_person_id` lets a caller ask "would all be away if this person
    were excluded" — useful from inside a person_leaves handler that hasn't
    yet committed the new state to disk.

    Returns False when the person list is empty so an unconfigured install
    never accidentally fires all-away automations.
    """
    persons = _load()
    if not persons:
        return False
    any_relevant = False
    for p in persons:
        if exclude_person_id and p.get("id") == exclude_person_id:
            continue
        any_relevant = True
        if effective_state(p) == "home":
            return False
    return any_relevant


def find_person_by_token(token: str) -> Optional[dict]:
    return next((p for p in _load() if p.get("token") == token), None)


def find_person_by_id(person_id: str) -> Optional[dict]:
    return next((p for p in _load() if p.get("id") == person_id), None)


def find_person_by_username(username: str) -> Optional[dict]:
    """linked_user exact match, else name substring of username."""
    if not username:
        return None
    persons = _load()
    u = username.lower()
    for p in persons:
        if (p.get("linked_user") or "").lower() == u:
            return p
    for p in persons:
        if p["name"].lower() in u:
            return p
    return None


def ingest_ping(
    token: str,
    lat: float,
    lon: float,
    accuracy: Optional[float] = None,
    client_ts: Optional[datetime] = None,
    wifi_home_hint: bool = False,
    now: Optional[datetime] = None,
) -> Decision:
    """Process one GPS ping identified by per-person URL token (invite-link flow).

    For the in-app authenticated flow (a logged-in Ziggy user tracking themselves)
    use `ingest_ping_for_person_id` instead.

    `wifi_home_hint`: if True, treat as "home" regardless of GPS distance.
    `client_ts`: if provided, must be within stale_ping_seconds of `now`; else rejected.
    `now`: dependency-injected clock for testing.
    """
    ts = now or _now()
    with _lock:
        persons = _load()
        person = next((p for p in persons if p.get("token") == token), None)
        if person is None:
            return Decision(
                person_id="?", person_name="?", ts=ts, source="ping",
                raw_state="unknown",
                result="rejected_unknown_token",
                reason="no_person_matches_token",
            )
        return _ingest_position_locked(
            person, persons, ts,
            lat=lat, lon=lon, accuracy=accuracy,
            client_ts=client_ts, wifi_home_hint=wifi_home_hint,
        )


def ingest_ping_for_person_id(
    person_id: str,
    lat: float,
    lon: float,
    accuracy: Optional[float] = None,
    client_ts: Optional[datetime] = None,
    wifi_home_hint: bool = False,
    now: Optional[datetime] = None,
) -> Decision:
    """Same as `ingest_ping` but identifies the person by id, not token.

    Used by the authenticated `/api/presence/me/ping` endpoint where the user
    is already logged in via JWT — no invite link / token needed.
    """
    ts = now or _now()
    with _lock:
        persons = _load()
        person = next((p for p in persons if p.get("id") == person_id), None)
        if person is None:
            return Decision(
                person_id=person_id, person_name="?", ts=ts, source="ping",
                raw_state="unknown",
                result="rejected_unknown_person",
                reason="no_person_matches_id",
            )
        return _ingest_position_locked(
            person, persons, ts,
            lat=lat, lon=lon, accuracy=accuracy,
            client_ts=client_ts, wifi_home_hint=wifi_home_hint,
        )


def _ingest_position_locked(
    person: dict,
    persons: list[dict],
    ts: datetime,
    *,
    lat: float,
    lon: float,
    accuracy: Optional[float],
    client_ts: Optional[datetime],
    wifi_home_hint: bool,
) -> Decision:
    """Run the per-position state machine. Caller MUST hold `_lock` and have
    pre-loaded the persons list (the caller's lookup found `person` inside).

    Persists the mutated persons list before returning.
    """
    # Stale timestamp gate.
    stale_s = int(_cfg("stale_ping_seconds"))
    if client_ts is not None:
        try:
            ct = client_ts if client_ts.tzinfo else client_ts.replace(tzinfo=timezone.utc)
            age = (ts - ct).total_seconds()
            if age > stale_s:
                eff = effective_state(person, now=ts)
                decision = Decision(
                    person_id=person["id"], person_name=person["name"],
                    ts=ts, source="ping",
                    raw_state=eff,
                    distance_m=None, accuracy_m=accuracy,
                    prev_confirmed=eff,
                    new_confirmed=eff,
                    result="rejected_stale",
                    reason=f"client_ts_age_{int(age)}s_>_{stale_s}s",
                )
                _append_history(person, decision)
                _save(persons)
                return decision
            if age < -stale_s:
                # Allow small clock skew, but reject far-future timestamps.
                eff = effective_state(person, now=ts)
                decision = Decision(
                    person_id=person["id"], person_name=person["name"],
                    ts=ts, source="ping",
                    raw_state=eff,
                    distance_m=None, accuracy_m=accuracy,
                    prev_confirmed=eff,
                    new_confirmed=eff,
                    result="rejected_clock_skew",
                    reason=f"client_ts_future_by_{int(-age)}s",
                )
                _append_history(person, decision)
                _save(persons)
                return decision
        except Exception:
            pass  # ignore invalid client_ts, treat as missing

    # Always record the position even if we don't transition.
    person["last_seen"]     = ts.isoformat()
    person["last_gps_at"]   = ts.isoformat()   # GPS-specific stamp (last_seen is also bumped by LAN)
    person["last_lat"]      = lat
    person["last_lon"]      = lon
    if accuracy is not None:
        person["last_accuracy"] = accuracy

    # Determine raw state.
    confirmed = effective_state(person, now=ts)
    zone = _home_zone()

    if wifi_home_hint:
        raw_state  = "home"
        distance_m = 0.0  # explicitly "inside"
    elif zone is None:
        decision = Decision(
            person_id=person["id"], person_name=person["name"],
            ts=ts, source="ping",
            raw_state="unknown",
            distance_m=None, accuracy_m=accuracy,
            prev_confirmed=confirmed, new_confirmed=confirmed,
            result="rejected_no_zone",
            reason="home_zone_not_configured",
        )
        _append_history(person, decision)
        _save(persons)
        return decision
    else:
        home_lat, home_lon, _ = zone
        distance_m = haversine_m(lat, lon, home_lat, home_lon)
        person["last_distance_m"] = round(distance_m, 1)
        raw_state = _raw_state_with_hysteresis(confirmed, distance_m)

    # Accuracy gate — only block actual transitions, not state recording.
    max_acc = float(_cfg("max_accuracy_m"))
    if (
        accuracy is not None
        and accuracy > max_acc
        and raw_state != confirmed
    ):
        decision = Decision(
            person_id=person["id"], person_name=person["name"],
            ts=ts, source="ping",
            raw_state=raw_state,
            distance_m=distance_m, accuracy_m=accuracy,
            prev_confirmed=confirmed, new_confirmed=confirmed,
            result="rejected_accuracy",
            reason=f"accuracy_{accuracy:.0f}m_>_max_{int(max_acc)}m",
        )
        _append_history(person, decision)
        _save(persons)
        return decision

    # Main state-machine call.
    decision = _decide_from_sample(
        person, raw_state, ts, source="ping",
        distance_m=distance_m, accuracy_m=accuracy,
    )

    # Extra-zone state machine — runs only when we have a real GPS fix,
    # not when wifi_home_hint forced the position to (0, 0).
    if not wifi_home_hint:
        decision.zone_transitions = _evaluate_zones_for_position(
            person, lat, lon, ts,
        )

    _append_history(person, decision)
    _save(persons)
    return decision


# ── extra-zone state machine ─────────────────────────────────────────────────

def _evaluate_zones_for_position(
    person: dict,
    lat: float,
    lon: float,
    ts: datetime,
) -> list[ZoneTransition]:
    """Run the per-zone in/out state machine for every extra zone.

    Mutates `person["zone_states"]` and returns the list of confirmed
    transitions (dwell satisfied AND cooldown not blocked). For each zone the
    state machine is independent: enter when distance ≤ radius, leave only
    when distance > radius * zone_hysteresis_factor (default 1.5).
    """
    try:
        from services import zones_registry
        zones = zones_registry.list_zones()
    except Exception as exc:
        log_error(f"[Presence] zones list failed: {exc}")
        return []
    if not zones:
        return []

    states = person.get("zone_states")
    if not isinstance(states, dict):
        states = {}
        person["zone_states"] = states

    dwell_s    = int(_cfg("dwell_seconds"))
    cooldown_s = int(_cfg("cooldown_seconds"))
    factor     = float(
        (settings.get("presence", {}) or {}).get("zone_hysteresis_factor", 1.5)
    )

    fired: list[ZoneTransition] = []

    for zone in zones:
        zid   = zone.get("id")
        zname = zone.get("name", zid)
        zlat  = zone.get("lat")
        zlon  = zone.get("lon")
        zr    = float(zone.get("radius_m", 200))
        if zid is None or zlat is None or zlon is None:
            continue

        dist = haversine_m(lat, lon, zlat, zlon)
        zs   = states.get(zid) or {}
        confirmed = zs.get("state", "unknown")

        if confirmed == "in":
            raw = "in" if dist <= zr * factor else "out"
        else:
            raw = "in" if dist <= zr else "out"

        # Same-as-confirmed → clear any candidate, no transition.
        if raw == confirmed:
            if zs.get("candidate_state") is not None:
                zs["candidate_state"] = None
                zs["candidate_since"] = None
            zs["last_distance_m"] = round(dist, 1)
            states[zid] = zs
            continue

        # Manage dwell candidate.
        cand_state = zs.get("candidate_state")
        cand_since = _parse_iso(zs.get("candidate_since"))
        if cand_state != raw or cand_since is None:
            zs["candidate_state"] = raw
            zs["candidate_since"] = ts.isoformat()
            zs["last_distance_m"] = round(dist, 1)
            states[zid] = zs
            continue

        dwelled = (ts - cand_since).total_seconds()
        if dwelled < dwell_s:
            zs["last_distance_m"] = round(dist, 1)
            states[zid] = zs
            continue

        # Cooldown / idempotency check.
        last_to = zs.get("last_transition_to")
        last_at = _parse_iso(zs.get("last_transition_at"))
        suppress = False
        if last_to == raw and last_at is not None:
            suppress = True
        elif last_at is not None and (ts - last_at).total_seconds() < cooldown_s:
            suppress = True
        if suppress:
            zs["candidate_state"] = None
            zs["candidate_since"] = None
            zs["last_distance_m"] = round(dist, 1)
            states[zid] = zs
            continue

        # Commit.
        zs["state"]              = raw
        zs["candidate_state"]    = None
        zs["candidate_since"]    = None
        zs["last_transition_at"] = ts.isoformat()
        zs["last_transition_to"] = raw
        zs["last_distance_m"]    = round(dist, 1)
        states[zid] = zs
        fired.append(ZoneTransition(
            zone_id     = zid,
            zone_name   = zname,
            direction   = "entered" if raw == "in" else "left",
            ts          = ts,
            person_id   = person["id"],
            person_name = person["name"],
            distance_m  = round(dist, 1),
            reason      = f"dwell_{int(dwelled)}s_radius_{int(zr)}m",
        ))

    return fired


def list_lan_hosts() -> list[dict]:
    """Return [{id, name, lan_host}] for every person that has a LAN host set."""
    return [
        {"id": p["id"], "name": p["name"], "lan_host": p["lan_host"]}
        for p in _load()
        if (p.get("lan_host") or "").strip()
    ]


def record_lan_probe(
    person_id: str,
    reachable: bool,
    now: Optional[datetime] = None,
) -> None:
    """Update lan_last_probe / lan_last_seen on a person record.

    Called by services.lan_presence after probing. Does NOT change presence
    state — the caller decides whether to feed a state into the engine based
    on consecutive results, configured grace, etc.
    """
    ts = now or _now()
    with _lock:
        persons = _load()
        person = next((p for p in persons if p["id"] == person_id), None)
        if person is None:
            return
        person["lan_last_probe"] = ts.isoformat()
        if reachable:
            person["lan_last_seen"] = ts.isoformat()
        _save(persons)


def ingest_external_state(
    person_id: str,
    new_state: str,
    source: str = "ha",
    reason_suffix: str = "",
    now: Optional[datetime] = None,
) -> Decision:
    """Feed a pre-decided home/not_home state from an upstream system (e.g. HA
    Companion via ha_presence_bridge).

    Unlike `ingest_ping`, this skips hysteresis/accuracy gating (no lat/lon).
    It still runs the same dwell + cooldown state machine so the upstream's
    debouncing is layered on top of Ziggy's. Use this for any external
    geofencing source where the home/away decision has already been made.
    """
    ts = now or _now()

    if new_state not in ("home", "not_home"):
        # Upstream sent "unknown" / zone-name / unavailable — record but don't transition.
        with _lock:
            persons = _load()
            person = next((p for p in persons if p.get("id") == person_id), None)
            if person is None:
                return Decision(
                    person_id=person_id, person_name="?", ts=ts, source=source,
                    raw_state="unknown",
                    result="rejected_unknown_person", reason="no_person",
                )
            decision = Decision(
                person_id=person["id"], person_name=person["name"],
                ts=ts, source=source,
                raw_state="unknown",
                prev_confirmed=effective_state(person, now=ts),
                new_confirmed=effective_state(person, now=ts),
                result="ignored_non_binary_state",
                reason=f"upstream_state_{new_state}{('_' + reason_suffix) if reason_suffix else ''}",
            )
            _append_history(person, decision)
            _save(persons)
            return decision

    with _lock:
        persons = _load()
        person = next((p for p in persons if p.get("id") == person_id), None)
        if person is None:
            return Decision(
                person_id=person_id, person_name="?", ts=ts, source=source,
                raw_state=new_state,
                result="rejected_unknown_person", reason="no_person",
            )

        # Touch last_seen so staleness decay doesn't fire incorrectly.
        person["last_seen"] = ts.isoformat()

        decision = _decide_from_sample(
            person, raw_state=new_state, ts=ts, source=source,
        )
        # Propagate any extra context into the reason so debug history is useful.
        if reason_suffix and decision.reason:
            decision.reason = f"{decision.reason} ({reason_suffix})"
        _append_history(person, decision)
        _save(persons)
        return decision


def manual_override(person_id: str, new_state: str, now: Optional[datetime] = None) -> Decision:
    """Force a person's state (admin). Subject to the same cooldown/dedup rules."""
    ts = now or _now()
    if new_state not in ("home", "not_home", "unknown"):
        return Decision(
            person_id=person_id, person_name="?", ts=ts, source="manual",
            raw_state=new_state, result="rejected_invalid_state",
            reason=f"unknown_state_{new_state}",
        )

    with _lock:
        persons = _load()
        person = next((p for p in persons if p.get("id") == person_id), None)
        if person is None:
            return Decision(
                person_id=person_id, person_name="?", ts=ts, source="manual",
                raw_state=new_state, result="rejected_unknown_person",
                reason="no_person",
            )

        prev_confirmed = effective_state(person, now=ts)
        person["last_seen"] = ts.isoformat()

        if new_state == "unknown":
            # Forced reset — clear state, no transition fired.
            person["state"] = "unknown"
            person["candidate_state"] = None
            person["candidate_since"] = None
            decision = Decision(
                person_id=person["id"], person_name=person["name"],
                ts=ts, source="manual",
                raw_state="unknown",
                prev_confirmed=prev_confirmed, new_confirmed="unknown",
                result="committed_unknown",
                reason="manual_reset",
            )
            _append_history(person, decision)
            _save(persons)
            return decision

        # Manual overrides bypass dwell (it's an explicit human decision) but
        # still honour cooldown so a runaway script can't spam transitions.
        suppress, why = _within_cooldown(person, new_state, ts)
        if suppress:
            decision = Decision(
                person_id=person["id"], person_name=person["name"],
                ts=ts, source="manual",
                raw_state=new_state,
                prev_confirmed=prev_confirmed, new_confirmed=prev_confirmed,
                result="suppressed_cooldown",
                reason=why,
            )
            _append_history(person, decision)
            _save(persons)
            return decision

        _commit_transition(person, new_state, ts)
        decision = Decision(
            person_id=person["id"], person_name=person["name"],
            ts=ts, source="manual",
            raw_state=new_state,
            prev_confirmed=prev_confirmed, new_confirmed=new_state,
            result="committed",
            reason="manual_override",
            fired_transition=True,
        )
        _append_history(person, decision)
        _save(persons)
        return decision


def sweep_expiry(now: Optional[datetime] = None) -> list[Decision]:
    """Detect home → unknown transitions caused by ping expiry.

    Called by the scheduler on a fixed interval. Only emits a "left home" style
    transition (home → unknown) — arrivals always come from real pings.
    """
    ts = now or _now()
    out: list[Decision] = []

    with _lock:
        persons = _load()
        for person in persons:
            prev_confirmed = person.get("state", "unknown")
            eff = effective_state(person, now=ts)
            if prev_confirmed == "home" and eff == "unknown":
                # Stale ping → treat as departure, subject to cooldown.
                suppress, why = _within_cooldown(person, "not_home", ts)
                if suppress:
                    decision = Decision(
                        person_id=person["id"], person_name=person["name"],
                        ts=ts, source="expiry",
                        raw_state="unknown",
                        prev_confirmed=prev_confirmed, new_confirmed=prev_confirmed,
                        result="suppressed_cooldown",
                        reason=why,
                    )
                    _append_history(person, decision)
                    out.append(decision)
                    continue

                # Commit as "not_home" so downstream automations get the leave event.
                _commit_transition(person, "not_home", ts)
                decision = Decision(
                    person_id=person["id"], person_name=person["name"],
                    ts=ts, source="expiry",
                    raw_state="not_home",
                    prev_confirmed=prev_confirmed, new_confirmed="not_home",
                    result="committed",
                    reason="ping_expired",
                    fired_transition=True,
                )
                _append_history(person, decision)
                out.append(decision)

        if out:
            _save(persons)

    return out


_NO_CHANGE_LOG_THROTTLE_S = 60
_last_no_change_log_at: dict[str, datetime] = {}


def log_decision(decision: Decision) -> None:
    """Emit a single structured-ish log line for a decision.

    Transitions (`fired_transition=True`) always log. Non-transitions log too,
    but the `no_change` heartbeat (raw matches the confirmed state — the most
    common ping result for an at-home phone) is throttled to once per minute
    per person to keep the console readable. The decision is still recorded in
    the person's ring buffer regardless, so debugging via /api/presence/debug
    sees every sample.
    """
    d = decision.to_log_dict()
    if decision.fired_transition:
        log_info(
            f"[Presence] {d['person']} {d['prev']}→{d['new']} "
            f"src={d['source']} dist={d['dist']} acc={d['acc']} "
            f"result={d['result']} reason={d['reason']}"
        )
        return

    if decision.result == "no_change":
        last = _last_no_change_log_at.get(decision.person_id)
        if last is not None and (decision.ts - last).total_seconds() < _NO_CHANGE_LOG_THROTTLE_S:
            return
        _last_no_change_log_at[decision.person_id] = decision.ts

    log_info(
        f"[Presence] {d['person']} raw={d['raw']} "
        f"src={d['source']} dist={d['dist']} acc={d['acc']} "
        f"prev={d['prev']} result={d['result']} reason={d['reason']}"
    )
