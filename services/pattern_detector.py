"""
Persistent pattern detector for Ziggy.

Replaces the old stateless per-run approach with a candidate store that
accumulates evidence across weeks. Each pattern candidate tracks:
  - how many times the behavior occurred
  - across how many distinct calendar days and weeks
  - how recently it was seen
  - how tight its timing is (time-based patterns)
  - how often the action was immediately reversed

A multi-factor confidence score gates candidates before they become
suggestions. The evidence gate and confidence threshold together ensure
only genuine, consistent, currently-active habits surface.

Candidate identity key format (stable, never includes time values):
  {pattern_type}|{intent}|{room_canonical}|{action}|{day_class}

Supported pattern types:
  time_based  — same action occurs at a similar time of day, repeatedly
  sequence    — action B consistently follows action A within a short gap

The group pattern type is effectively disabled (requires 10+ occurrences
across 4+ weeks) until behavioral data is rich enough to support it.
"""
from __future__ import annotations

import json
import math
import threading
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import NamedTuple

from services.pattern_logger import load_events, _SKIP_INTENTS
from core.settings_loader import settings

CANDIDATES_FILE = Path("user_files/pattern_candidates.json")

# Minimum evidence required before confidence is even calculated
_MIN_OCCURRENCES = 5
_MIN_UNIQUE_WEEKS = 3
_MIN_UNIQUE_DAYS = 3
_MAX_STALENESS_DAYS = 21          # pattern must have been seen within this window
_MAX_REVERSAL_RATE = 0.40         # if >40% of actions were immediately reversed, skip

# Minimum composite score to be considered a qualified candidate
CONFIDENCE_THRESHOLD = 0.65


class QualifiedCandidate(NamedTuple):
    key: str
    pattern_type: str
    intent: str
    room: str
    action: str
    day_class: str
    occurrences: int
    confidence: float
    scores: dict
    details: dict           # type-specific fields (avg time, sequence pair, etc.)
    user_message: str
    evidence_summary: dict  # frozen, human-readable evidence snapshot for display


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def update_and_detect(extra_events: list[dict] | None = None) -> list[QualifiedCandidate]:
    """
    Main entry point called by the suggestion engine.

    1. Loads events from the lookback window.
    2. Updates (or creates) candidates in the persistent store.
    3. Returns candidates that pass both the evidence gate and the confidence threshold.
    """
    cfg = _cfg()
    lookback = cfg.get("lookback_days", 30)
    events = load_events(lookback_days=lookback)
    if extra_events:
        events = extra_events + events

    # Only use successfully executed, automatable, non-reversed actions
    events = [
        e for e in events
        if e.get("result") == "ok"
        and e.get("automatable", True)
        and not e.get("reversed", False)
    ]
    if not events:
        return []

    events.sort(key=lambda e: e["ts"])

    candidates = _load_candidates()
    _update_time_based(events, candidates)
    _update_sequence(events, candidates)
    _save_candidates(candidates)

    return _qualify(candidates)


# Keep the old name as an alias so any code that imports detect_patterns still works
def detect_patterns(extra_events: list[dict] | None = None) -> list[QualifiedCandidate]:
    return update_and_detect(extra_events)


# ---------------------------------------------------------------------------
# Template signal detector (Prompt 2 infrastructure)
#
# Curated templates may declare a `habit_signal` dict that watches for a
# specific user intent firing N+ times within a window. When the signal fires
# we re-surface the template in the Suggested tab — bypassing the full
# multi-layer qualification gate above, because these signals are curated
# (one template author wrote them) not discovered (statistically inferred
# from arbitrary user behavior).
#
# This is intentionally a separate function from update_and_detect() so the
# habit-pattern pipeline keeps its own evidence/scoring/persistence flow.
# ---------------------------------------------------------------------------

# Context predicates: each takes an event dict and returns True if the event
# falls within the named context. Templates reference these by string name in
# their habit_signal.context field.
_HABIT_SIGNAL_CONTEXTS: dict[str, "callable"] = {
    "after_midnight": lambda ev: 0 <= (ev.get("ctx") or {}).get("hour", -1) < 5,
    "late_night":     lambda ev: (ev.get("ctx") or {}).get("hour", -1) >= 22
                                  or 0 <= (ev.get("ctx") or {}).get("hour", -1) < 5,
    "morning":        lambda ev: 5 <= (ev.get("ctx") or {}).get("hour", -1) < 12,
    "evening":        lambda ev: 18 <= (ev.get("ctx") or {}).get("hour", -1) < 22,
    "weekend":        lambda ev: (ev.get("ctx") or {}).get("day_of_week", -1) in (5, 6),
    "weekday":        lambda ev: 0 <= (ev.get("ctx") or {}).get("day_of_week", -1) <= 4,
}


def template_signal_detector(
    templates: list[dict] | None = None,
    extra_events: list[dict] | None = None,
) -> list[dict]:
    """
    Scan recent events for each template's habit_signal definition.

    Returns a list of fire-records for templates whose signal threshold was
    reached within the window. Each record:

        {
          "template_id":      str,
          "intent":           str,
          "occurrences":      int,
          "window_days":      int,
          "min_occurrences":  int,
          "context":          str | None,
          "re_surface":       bool,
          "last_seen":        str (ISO),
          "first_seen":       str (ISO),
        }

    Templates without a habit_signal are skipped silently. Bypasses the
    evidence gate used by update_and_detect — these are curated signals.
    """
    if templates is None:
        # Lazy import: pattern_detector is imported by suggestion_engine which
        # is imported very early during startup. Importing automation_templates
        # at module top-level would create a circular hazard if the templates
        # file ever needs a pattern_detector helper.
        from services.automation_templates import TEMPLATES
        templates = TEMPLATES

    fires: list[dict] = []

    for tmpl in templates:
        sig = tmpl.get("habit_signal")
        if not isinstance(sig, dict):
            continue
        if sig.get("type") != "manual_repeat":
            # Unknown signal types are reserved for future expansion; ignored
            # rather than raising so older Ziggy builds running newer template
            # libraries don't crash.
            continue

        intent = sig.get("intent")
        min_occ = int(sig.get("min_occurrences", 3))
        window_days = int(sig.get("window_days", 14))
        context = sig.get("context")
        if not intent or min_occ <= 0 or window_days <= 0:
            continue

        events = load_events(lookback_days=window_days)
        if extra_events:
            events = list(extra_events) + events

        # Only count successful, non-reversed, automatable executions of the
        # watched intent. Reversed events represent corrections, not habits.
        matched = [
            e for e in events
            if e.get("intent") == intent
            and e.get("result") == "ok"
            and e.get("automatable", True)
            and not e.get("reversed", False)
        ]

        # Apply context filter if specified (e.g., after_midnight only).
        if context:
            predicate = _HABIT_SIGNAL_CONTEXTS.get(context)
            if predicate is not None:
                matched = [e for e in matched if predicate(e)]

        if len(matched) < min_occ:
            continue

        matched.sort(key=lambda e: e.get("ts", ""))
        fires.append({
            "template_id":     tmpl.get("id"),
            "intent":          intent,
            "occurrences":     len(matched),
            "window_days":     window_days,
            "min_occurrences": min_occ,
            "context":         context,
            "re_surface":      bool(sig.get("re_surface", False)),
            "first_seen":      matched[0].get("ts", ""),
            "last_seen":       matched[-1].get("ts", ""),
        })

    return fires


def get_active_template_signals() -> dict[str, dict]:
    """
    Convenience wrapper: returns {template_id: fire_record} for templates whose
    habit_signal is currently firing. Used by the automation router to attach
    a `habit_signal_fired` field to enriched template responses.
    """
    return {f["template_id"]: f for f in template_signal_detector() if f.get("template_id")}


# ---------------------------------------------------------------------------
# Candidate key helpers
# ---------------------------------------------------------------------------

def canonical_key(
    pattern_type: str, intent: str, room: str | None, action: str, day_class: str
) -> str:
    room_norm = (room or "global").lower().replace(" ", "_")
    return f"{pattern_type}|{intent}|{room_norm}|{action}|{day_class}"


def _day_class_from_weekdays(weekdays: set[int]) -> str:
    """0=Mon … 4=Fri, 5=Sat, 6=Sun"""
    workdays = {0, 1, 2, 3, 4}
    weekend = {5, 6}
    if weekdays and weekdays <= workdays:
        return "weekday"
    if weekdays and weekdays <= weekend:
        return "weekend"
    return "any"


# ---------------------------------------------------------------------------
# Time-based pattern updates
# ---------------------------------------------------------------------------

def _update_time_based(events: list[dict], candidates: dict) -> None:
    cfg = _cfg()
    window = cfg.get("time_window_minutes", 45)

    # Bucket: (intent, room, action) → list of
    #   (date_str, week_str, minute_of_day, weekday, ts_str, entity_id)
    buckets: dict[str, list[tuple]] = defaultdict(list)
    for ev in events:
        key = f"{ev['intent']}|{ev.get('room') or 'global'}|{ev.get('action') or ''}"
        ts = datetime.fromisoformat(ev["ts"])
        minute_of_day = ts.hour * 60 + ts.minute
        buckets[key].append((
            ts.strftime("%Y-%m-%d"),
            ts.strftime("%Y-W%W"),
            minute_of_day,
            ts.weekday(),
            ts.isoformat(timespec="seconds"),
            ev.get("entity_id"),
        ))

    for bucket_key, occurrences_data in buckets.items():
        if len(occurrences_data) < _MIN_OCCURRENCES:
            continue

        intent, room_norm, action = bucket_key.split("|")
        room = None if room_norm == "global" else room_norm

        # Cluster by time-of-day
        minutes_list = [od[2] for od in occurrences_data]
        for cluster_indices in _cluster_indices(minutes_list, window):
            cluster_data = [occurrences_data[i] for i in cluster_indices]
            if len(cluster_data) < _MIN_OCCURRENCES:
                continue

            weekdays = {d[3] for d in cluster_data}
            day_class = _day_class_from_weekdays(weekdays)
            ckey = canonical_key("time_based", intent, room, action, day_class)

            existing = candidates.get(ckey)
            if existing and existing.get("status") == "suppressed":
                continue

            dates = {d[0] for d in cluster_data}
            weeks = {d[1] for d in cluster_data}
            times_of_day = [d[2] for d in cluster_data]
            last_seen = max(d[4] for d in cluster_data)
            entity_ids_in_cluster = [d[5] for d in cluster_data if d[5]]

            if existing:
                # Merge: extend sets, keep history
                existing_dates = set(existing["evidence"].get("occurrence_dates", []))
                existing_weeks = set(existing["evidence"].get("occurrence_weeks", []))
                existing_times = existing["evidence"].get("times_of_day_minutes", [])
                existing_entities = existing["evidence"].get("entity_ids", [])
                all_dates = existing_dates | dates
                all_weeks = existing_weeks | weeks
                all_times = (existing_times + times_of_day)[-120:]  # cap at 120 values
                all_entities = (existing_entities + entity_ids_in_cluster)[-120:]
                existing["evidence"].update({
                    "occurrences": len(all_dates),
                    "unique_days": len(all_dates),
                    "unique_weeks": len(all_weeks),
                    "occurrence_dates": sorted(all_dates),
                    "occurrence_weeks": sorted(all_weeks),
                    "times_of_day_minutes": all_times,
                    "entity_ids": all_entities,
                    "last_seen": max(existing["evidence"].get("last_seen", ""), last_seen),
                })
            else:
                avg_min = int(sum(times_of_day) / len(times_of_day))
                candidates[ckey] = _new_candidate(
                    ckey, "time_based", intent, room, action, day_class,
                    evidence={
                        "occurrences": len(dates),
                        "unique_days": len(dates),
                        "unique_weeks": len(weeks),
                        "occurrence_dates": sorted(dates),
                        "occurrence_weeks": sorted(weeks),
                        "times_of_day_minutes": times_of_day,
                        "entity_ids": entity_ids_in_cluster,
                        "reversal_count": 0,
                        "first_seen": min(d[4] for d in cluster_data),
                        "last_seen": last_seen,
                    },
                    extra={"avg_hour": avg_min // 60, "avg_minute": avg_min % 60},
                )

            # Always refresh avg_time + dominant entity from current data
            all_times = candidates[ckey]["evidence"]["times_of_day_minutes"]
            avg_min = int(sum(all_times) / len(all_times))
            candidates[ckey]["details"]["avg_hour"] = avg_min // 60
            candidates[ckey]["details"]["avg_minute"] = avg_min % 60
            candidates[ckey]["details"]["dominant_entity_id"] = _dominant_entity_id(
                candidates[ckey]["evidence"].get("entity_ids", [])
            )


# ---------------------------------------------------------------------------
# Sequence pattern updates
# ---------------------------------------------------------------------------

def _update_sequence(events: list[dict], candidates: dict) -> None:
    cfg = _cfg()
    gap_s = cfg.get("sequence_gap_minutes", 5) * 60

    # Collect (pair_key, date_str, week_str, ts_str) for each observed pair
    pair_occurrences: dict[str, list[tuple]] = defaultdict(list)

    for i, ev_a in enumerate(events):
        ts_a = datetime.fromisoformat(ev_a["ts"]).timestamp()

        for ev_b in events[i + 1:]:
            ts_b = datetime.fromisoformat(ev_b["ts"]).timestamp()
            if ts_b - ts_a > gap_s:
                break
            if ev_b["intent"] == ev_a["intent"] and ev_b.get("room") == ev_a.get("room"):
                continue

            pair_key = (
                f"{ev_a['intent']}:{ev_a.get('room') or 'global'}:{ev_a.get('action') or ''}"
                "→"
                f"{ev_b['intent']}:{ev_b.get('room') or 'global'}:{ev_b.get('action') or ''}"
            )
            ts_dt = datetime.fromisoformat(ev_a["ts"])
            pair_occurrences[pair_key].append((
                ts_dt.strftime("%Y-%m-%d"),
                ts_dt.strftime("%Y-W%W"),
                ts_dt.weekday(),
                ev_a["ts"],
                ev_a.get("entity_id"),
                ev_b.get("entity_id"),
            ))

    for pair_key, occ_data in pair_occurrences.items():
        if len(occ_data) < _MIN_OCCURRENCES:
            continue

        a_str, b_str = pair_key.split("→")
        a_intent, a_room_norm, a_action = a_str.split(":")
        b_intent, b_room_norm, b_action = b_str.split(":")
        a_room = None if a_room_norm == "global" else a_room_norm
        b_room = None if b_room_norm == "global" else b_room_norm

        weekdays = {d[2] for d in occ_data}
        day_class = _day_class_from_weekdays(weekdays)
        # Sequence key encodes both actions
        ckey = f"sequence|{a_intent}|{a_room_norm}|{a_action}|{b_intent}|{b_room_norm}|{b_action}|{day_class}"

        existing = candidates.get(ckey)
        if existing and existing.get("status") == "suppressed":
            continue

        dates = {d[0] for d in occ_data}
        weeks = {d[1] for d in occ_data}
        last_seen = max(d[3] for d in occ_data)
        a_entities = [d[4] for d in occ_data if d[4]]
        b_entities = [d[5] for d in occ_data if d[5]]

        if existing:
            existing_dates = set(existing["evidence"].get("occurrence_dates", []))
            existing_weeks = set(existing["evidence"].get("occurrence_weeks", []))
            existing_a = existing["evidence"].get("entity_ids", [])
            existing_b = existing["evidence"].get("b_entity_ids", [])
            all_dates = existing_dates | dates
            all_weeks = existing_weeks | weeks
            existing["evidence"].update({
                "occurrences": len(all_dates),
                "unique_days": len(all_dates),
                "unique_weeks": len(all_weeks),
                "occurrence_dates": sorted(all_dates),
                "occurrence_weeks": sorted(all_weeks),
                "entity_ids": (existing_a + a_entities)[-120:],
                "b_entity_ids": (existing_b + b_entities)[-120:],
                "last_seen": max(existing["evidence"].get("last_seen", ""), last_seen),
            })
        else:
            candidates[ckey] = _new_candidate(
                ckey, "sequence", a_intent, a_room, a_action, day_class,
                evidence={
                    "occurrences": len(dates),
                    "unique_days": len(dates),
                    "unique_weeks": len(weeks),
                    "occurrence_dates": sorted(dates),
                    "occurrence_weeks": sorted(weeks),
                    "times_of_day_minutes": [],
                    "entity_ids": a_entities,
                    "b_entity_ids": b_entities,
                    "reversal_count": 0,
                    "first_seen": min(d[3] for d in occ_data),
                    "last_seen": last_seen,
                },
                extra={
                    "b_intent": b_intent,
                    "b_room": b_room,
                    "b_action": b_action,
                },
            )

        candidates[ckey]["details"]["dominant_entity_id"] = _dominant_entity_id(
            candidates[ckey]["evidence"].get("entity_ids", [])
        )
        candidates[ckey]["details"]["b_dominant_entity_id"] = _dominant_entity_id(
            candidates[ckey]["evidence"].get("b_entity_ids", [])
        )


# ---------------------------------------------------------------------------
# Qualification: evidence gate + confidence scoring
# ---------------------------------------------------------------------------

def _qualify(candidates: dict) -> list[QualifiedCandidate]:
    qualified: list[QualifiedCandidate] = []
    stale_marker_changed = False

    for ckey, cand in candidates.items():
        if cand.get("status") == "suppressed":
            continue

        # Defense in depth: even if a non-automatable intent slipped into the
        # candidate store from older logs (before _SKIP_INTENTS was tightened),
        # never let it surface as a suggestion.
        if cand.get("intent") in _SKIP_INTENTS:
            continue
        if cand.get("pattern_type") == "sequence" and cand.get("details", {}).get("b_intent") in _SKIP_INTENTS:
            continue

        scores = _compute_scores(cand)
        if scores is None:
            continue  # Failed evidence gate

        cand["scores"] = scores
        composite = scores["composite"]

        if composite < CONFIDENCE_THRESHOLD:
            continue

        # Stale-entity gate: a candidate cached an entity_id that has since
        # left the device registry (unpaired, renamed, or never existed).
        # Surfacing it would produce a suggestion the wizard can't bind to
        # any real device. Mark the candidate as stale so it stops surfacing
        # this run; the stale_at timestamp is overwritten on every check so
        # the candidate auto-recovers as soon as the entity returns. The
        # marker is informational only — re-qualification on the next run
        # will clear it transparently if the entity is back.
        is_valid, stale_reason = _validate_candidate_entities(cand)
        if not is_valid:
            cand["stale_at"] = datetime.now().isoformat(timespec="seconds")
            cand["stale_reason"] = stale_reason
            stale_marker_changed = True
            continue
        # Clear any prior stale marker once the entity is recognised again
        # so historical state doesn't linger on the candidate.
        if "stale_at" in cand or "stale_reason" in cand:
            cand.pop("stale_at", None)
            cand.pop("stale_reason", None)
            stale_marker_changed = True

        details = cand.get("details", {})
        pattern_type = cand["pattern_type"]

        qualified.append(QualifiedCandidate(
            key=ckey,
            pattern_type=pattern_type,
            intent=cand["intent"],
            room=cand.get("room"),
            action=cand["action"],
            day_class=cand["day_class"],
            occurrences=cand["evidence"]["occurrences"],
            confidence=composite,
            scores=scores,
            details=details,
            user_message=_draft_message(cand, details),
            evidence_summary=_build_evidence_summary(cand),
        ))

    # Persist stale-marker churn so the JSON store reflects the latest
    # entity-validity verdict between runs. Save lazily — only when
    # something actually changed.
    if stale_marker_changed:
        _save_candidates(candidates)

    qualified.sort(key=lambda c: c.confidence, reverse=True)
    return qualified


def _compute_scores(cand: dict) -> dict | None:
    ev = cand["evidence"]
    occ = ev.get("occurrences", 0)
    unique_weeks = ev.get("unique_weeks", 0)
    unique_days = ev.get("unique_days", 0)
    reversal_count = ev.get("reversal_count", 0)
    recent_7d = ev.get("recent_7d", 0)
    times = ev.get("times_of_day_minutes", [])
    last_seen_str = ev.get("last_seen", "")

    # --- Evidence gate ---
    if occ < _MIN_OCCURRENCES:
        return None
    if unique_weeks < _MIN_UNIQUE_WEEKS:
        return None
    if unique_days < _MIN_UNIQUE_DAYS:
        return None
    if occ > 0 and reversal_count / occ >= _MAX_REVERSAL_RATE:
        return None
    if last_seen_str:
        try:
            last_seen = datetime.fromisoformat(last_seen_str)
            if (datetime.now() - last_seen).days > _MAX_STALENESS_DAYS:
                return None
        except ValueError:
            pass

    # --- Recompute recent_7d from occurrence_dates ---
    cutoff_7d = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    recent_7d = sum(
        1 for d in ev.get("occurrence_dates", []) if d >= cutoff_7d
    )

    # --- Frequency: sigmoid((occ - 7) / 4) ---
    frequency_score = 1.0 / (1.0 + math.exp(-(occ - 7) / 4.0))

    # --- Consistency: unique_weeks / observed_weeks ---
    first_seen_str = ev.get("first_seen", "")
    observed_weeks = 1
    if first_seen_str:
        try:
            first_seen = datetime.fromisoformat(first_seen_str)
            observed_weeks = max(1, (datetime.now() - first_seen).days // 7)
        except ValueError:
            pass
    consistency_score = min(unique_weeks / observed_weeks, 1.0)

    # --- Recency: recent_7d / total occurrences ---
    recency_score = recent_7d / max(occ, 1)

    # --- Temporal precision (time-based only) ---
    if len(times) >= 3:
        mean_t = sum(times) / len(times)
        stdev_t = math.sqrt(sum((t - mean_t) ** 2 for t in times) / len(times))
        temporal_precision = max(0.0, 1.0 - stdev_t / 45.0)
    else:
        temporal_precision = 0.5  # neutral for non-time-based

    # --- Reversal penalty ---
    reversal_penalty = min(reversal_count / max(occ, 1), 0.5) * 0.4

    composite = (
        frequency_score    * 0.25
        + consistency_score  * 0.30
        + recency_score      * 0.20
        + temporal_precision * 0.15
        + 0.10               # base
        - reversal_penalty
    )

    return {
        "frequency": round(frequency_score, 3),
        "consistency": round(consistency_score, 3),
        "recency": round(recency_score, 3),
        "temporal_precision": round(temporal_precision, 3),
        "reversal_penalty": round(reversal_penalty, 3),
        "composite": round(max(0.0, min(1.0, composite)), 3),
    }


# ---------------------------------------------------------------------------
# Candidate persistence
# ---------------------------------------------------------------------------

# In-memory cache for candidates.json. The pattern detector update path was
# loading and rewriting the entire file per event; this cache skips the read
# when the file hasn't changed since the last write and writes atomically.
_candidates_lock = threading.Lock()
_candidates_cache: dict | None = None
_candidates_mtime: float = 0.0


def _candidates_mtime_now() -> float:
    try:
        return CANDIDATES_FILE.stat().st_mtime
    except OSError:
        return 0.0


def _load_candidates() -> dict:
    global _candidates_cache, _candidates_mtime
    with _candidates_lock:
        if not CANDIDATES_FILE.exists():
            _candidates_cache = {}
            _candidates_mtime = 0.0
            return dict(_candidates_cache)
        mtime = _candidates_mtime_now()
        if _candidates_cache is None or mtime != _candidates_mtime:
            try:
                with open(CANDIDATES_FILE, encoding="utf-8") as f:
                    data = json.load(f)
                    _candidates_cache = data if isinstance(data, dict) else {}
            except (json.JSONDecodeError, OSError):
                _candidates_cache = {}
            _candidates_mtime = mtime
        return dict(_candidates_cache)


def _save_candidates(candidates: dict) -> None:
    global _candidates_cache, _candidates_mtime
    with _candidates_lock:
        CANDIDATES_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = CANDIDATES_FILE.with_suffix(CANDIDATES_FILE.suffix + ".tmp")
        tmp.write_text(json.dumps(candidates, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(CANDIDATES_FILE)
        _candidates_cache = dict(candidates) if isinstance(candidates, dict) else {}
        _candidates_mtime = _candidates_mtime_now()


def get_candidate(key: str) -> dict | None:
    return _load_candidates().get(key)


def mark_candidate_surfaced(key: str, suggestion_id: str) -> None:
    candidates = _load_candidates()
    if key in candidates:
        candidates[key]["status"] = "surfaced"
        candidates[key]["surfaced_suggestion_id"] = suggestion_id
        _save_candidates(candidates)


def mark_candidate_suppressed(key: str) -> None:
    candidates = _load_candidates()
    if key in candidates:
        candidates[key]["status"] = "suppressed"
        _save_candidates(candidates)


# ---------------------------------------------------------------------------
# Evidence summary builder
# ---------------------------------------------------------------------------

_DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _build_evidence_summary(cand: dict) -> dict:
    """
    Compile a frozen, human-readable evidence snapshot from a candidate dict.
    Called after _compute_scores() so cand["scores"] is already populated.
    """
    ev = cand.get("evidence", {})
    scores = cand.get("scores", {})

    occ = ev.get("occurrences", 0)
    reversal_count = ev.get("reversal_count", 0)
    occurrence_dates = ev.get("occurrence_dates", [])
    times = ev.get("times_of_day_minutes", [])
    last_seen_str = ev.get("last_seen", "")

    weekday_set: set[int] = set()
    for d_str in occurrence_dates:
        try:
            weekday_set.add(datetime.strptime(d_str, "%Y-%m-%d").weekday())
        except ValueError:
            pass

    summary: dict = {
        "occurrences": occ,
        "unique_weeks": ev.get("unique_weeks", 0),
        "last_seen": last_seen_str[:10] if last_seen_str else "",
        "reversal_rate": round(reversal_count / max(occ, 1), 2),
        "active_day_names": [_DAY_NAMES[i] for i in sorted(weekday_set)],
        "scores": {
            k: scores.get(k)
            for k in ("frequency", "consistency", "recency", "temporal_precision")
        },
    }

    if times:
        min_t = min(times)
        max_t = max(times)
        avg_t = int(sum(times) / len(times))
        summary["time_window"] = (
            f"{min_t // 60:02d}:{min_t % 60:02d}-{max_t // 60:02d}:{max_t % 60:02d}"
        )
        summary["avg_time"] = f"{avg_t // 60:02d}:{avg_t % 60:02d}"

    return summary


# ---------------------------------------------------------------------------
# Candidate factory
# ---------------------------------------------------------------------------

def _new_candidate(
    key: str,
    pattern_type: str,
    intent: str,
    room: str | None,
    action: str,
    day_class: str,
    evidence: dict,
    extra: dict | None = None,
) -> dict:
    return {
        "key": key,
        "pattern_type": pattern_type,
        "intent": intent,
        "room": room,
        "action": action,
        "day_class": day_class,
        "status": "accumulating",
        "surfaced_suggestion_id": None,
        "rejection_count": 0,
        "quality_filtered": False,
        "evidence": evidence,
        "scores": {},
        "details": extra or {},
    }


# ---------------------------------------------------------------------------
# Message drafting
# ---------------------------------------------------------------------------

_DAY_PHRASE = {
    "weekday": "on weekdays",
    "weekend": "on weekends",
    "any": "",
}


def _dominant_entity_id(entity_ids: list[str]) -> str | None:
    """Return the entity_id that contributed at least half of the occurrences,
    or None if the cluster is split across multiple devices.
    """
    if not entity_ids:
        return None
    from collections import Counter
    counts = Counter(eid for eid in entity_ids if eid)
    if not counts:
        return None
    top, top_count = counts.most_common(1)[0]
    if top_count / len(entity_ids) < 0.5:
        return None
    return top


def _entity_id_is_known(entity_id: str | None) -> bool:
    """Return True if entity_id resolves to a current device in the registry.

    Used by _qualify() to guard against surfacing a habit suggestion whose
    cached entity_id points at a device the user has since unpaired or
    renamed. Blank / None ids are treated as known — _device_phrase falls
    back to a generic phrase in that case. If the registry itself is
    unreachable we fail OPEN so a transient lookup failure can't blackhole
    every suggestion in the system.
    """
    if not entity_id:
        return True
    try:
        from services.device_registry import get_device_info
        info = get_device_info(entity_id)
    except Exception:
        return True
    return bool(info)


def _validate_candidate_entities(cand: dict) -> tuple[bool, str | None]:
    """Verify every entity_id cached on a candidate is still in the device
    registry. Returns (True, None) when the candidate is safe to promote,
    or (False, reason) when at least one entity_id is now stale.

    Sequence candidates carry both `dominant_entity_id` (action A) and
    `b_dominant_entity_id` (action B); both must check out.
    """
    details = cand.get("details") or {}

    eid_a = details.get("dominant_entity_id")
    if not _entity_id_is_known(eid_a):
        return False, f"stale_entity_id:{eid_a}"

    if cand.get("pattern_type") == "sequence":
        eid_b = details.get("b_dominant_entity_id")
        if not _entity_id_is_known(eid_b):
            return False, f"stale_b_entity_id:{eid_b}"

    return True, None


def _device_phrase(entity_id: str | None) -> tuple[str | None, str | None]:
    """Resolve an entity_id to (human phrase, room) via the device registry.

    Returns ('the office light', 'office') when a registry entry exists,
    or (None, None) when the entity is unknown / unclaimed. The phrase is
    designed to slot directly into "turn on X" / "turn off X" verbs.
    """
    if not entity_id:
        return None, None
    try:
        from services.device_registry import get_device_info
        info = get_device_info(entity_id)
    except Exception:
        return None, None
    if not info:
        return None, None

    room = info.get("room")
    # Prefer the registry's friendly name when present — it's already curated.
    name = info.get("name")
    if name:
        return f"the {name.lower()}", room

    device_type = (info.get("device_type") or "device").replace("_", " ")
    if room and room != "global":
        room_clean = room.replace("_", " ")
        return f"the {room_clean} {device_type}", room
    return f"the {device_type}", None


def _time_of_day(hour: int) -> str:
    """Bucket an hour into a friendly time-of-day word."""
    if 5 <= hour < 12:
        return "morning"
    if 12 <= hour < 14:
        return "midday"
    if 14 <= hour < 18:
        return "afternoon"
    if 18 <= hour < 22:
        return "evening"
    return "night"


def _join_clauses(*parts: str) -> str:
    """Join non-empty clauses with single spaces, collapsing whitespace."""
    return " ".join(p for p in (p.strip() for p in parts) if p)


def _verb_phrase(intent: str, action: str, entity_id: str | None, fallback_room: str | None) -> str:
    """Build the verb clause, preferring a specific device when we have one.

    If we know which device caused this pattern, "turn on the office light"
    reads naturally and doesn't need a separate room clause. Otherwise we
    fall back to the generic verb + room composition.
    """
    device_phrase, device_room = _device_phrase(entity_id)
    on_off = action if action in ("on", "off") else None

    if device_phrase and on_off:
        return f"turn {on_off} {device_phrase}"

    base = _action_phrase(intent, action)
    room = device_room or fallback_room
    room_str = _room_phrase(room)
    return _join_clauses(base, room_str)


def _draft_message(cand: dict, details: dict) -> str:
    intent = cand["intent"]
    room = cand.get("room")
    action = cand["action"]
    day_class = cand["day_class"]
    pattern_type = cand["pattern_type"]
    day_str = _DAY_PHRASE.get(day_class, "")

    entity_id = details.get("dominant_entity_id")
    verb_clause = _verb_phrase(intent, action, entity_id, room)

    if pattern_type == "time_based":
        h = details.get("avg_hour", 0)
        m = details.get("avg_minute", 0)
        time_str = f"{h:02d}:{m:02d}"
        tod = _time_of_day(h)

        # Lead with temporal context — "Most evenings around 19:48 on weekdays,
        # you turn off the bedroom light." Drops the raw occurrence count from
        # the headline (it's already in the evidence drawer) and frames as
        # observation, not assertion.
        when = _join_clauses(f"Most {tod}s around {time_str}", day_str)
        return f"{when}, you {verb_clause}. Want me to schedule it?"

    if pattern_type == "sequence":
        b_intent = details.get("b_intent", "")
        b_room = details.get("b_room")
        b_action = details.get("b_action", "")
        b_entity_id = details.get("b_dominant_entity_id")
        b_verb_clause = _verb_phrase(b_intent, b_action, b_entity_id, b_room)

        tail = f" {day_str}" if day_str else ""
        return (
            f"When you {verb_clause}, you usually {b_verb_clause} shortly after{tail}."
            f" Want me to combine them into one routine?"
        )

    # Fallback (group / unknown pattern types)
    body = _join_clauses(f"You often {verb_clause}", day_str)
    return f"{body}."


def _room_phrase(room: str | None) -> str:
    """Render the room as 'in the X' or empty when unknown.

    The old fallback "in your home" lied: it implied location knowledge we
    didn't have, and read oddly when the action itself wasn't location-bound.
    Better to drop the clause entirely than to fill it with filler.
    """
    if not room or room == "global":
        return ""
    return f"in the {room.replace('_', ' ')}"


def _action_phrase(intent: str, action: str) -> str:
    """Map an (intent, action) pair to a natural verb phrase.

    Goal: never let a raw `intent.replace('_', ' ')` slip through to the user
    — every shape of Ziggy intent should produce something a non-technical
    person would actually say.
    """
    on_off = action if action in ("on", "off") else None

    # Bulk / whole-home actions
    if intent == "turn_off_everything":
        return "turn everything off"
    if intent == "turn_off_all_lights":
        return "turn all the lights off"
    if intent == "turn_on_all_lights":
        return "turn all the lights on"

    # Lights (including toggle_light, set_brightness, set_light_color, etc.)
    if "light" in intent:
        if on_off == "on":
            return "turn the light on"
        if on_off == "off":
            return "turn the light off"
        if "brightness" in intent:
            return "adjust the brightness"
        if "color" in intent:
            return "change the light color"
        return "use the light"

    # Generic device / switch toggles — the Ziggy UI fires these for
    # arbitrary entities that aren't classified yet. Keep the wording vague
    # but human: "turn something on" beats "toggle device".
    if intent in ("toggle_device", "toggle_switch", "switch_device", "control_device"):
        if on_off == "on":
            return "turn something on"
        if on_off == "off":
            return "turn something off"
        return "use a device"

    # Climate / AC
    if "ac" in intent or "climate" in intent or "hvac" in intent:
        if on_off == "on":
            return "turn the AC on"
        if on_off == "off":
            return "turn the AC off"
        if "temperature" in intent:
            return "change the temperature"
        if "fan" in intent:
            return "change the fan setting"
        return "adjust the AC"

    # TV / media
    if "tv" in intent:
        if on_off == "on":
            return "turn the TV on"
        if on_off == "off":
            return "turn the TV off"
        return "control the TV"
    if intent.startswith("play_") or intent == "media_play":
        return "start playback"
    if intent.startswith("pause_") or intent == "media_pause":
        return "pause playback"

    # IR — action carries the command name
    if "ir_send" in intent:
        if action and action not in ("on", "off", "ir_send"):
            return f"send the {action.replace('_', ' ')} command"
        return "send an IR command"

    # Common set_* intents that don't fit a domain bucket above
    if intent == "set_temperature":
        return "change the temperature"
    if intent == "set_brightness":
        return "adjust the brightness"
    if intent == "set_volume":
        return "change the volume"
    if intent == "set_color" or intent == "set_color_temp":
        return "change the color"

    # Covers / locks / scenes
    if "open" in intent:
        return "open the cover"
    if "close" in intent:
        return "close the cover"
    if "lock" in intent and "unlock" not in intent:
        return "lock the door"
    if "unlock" in intent:
        return "unlock the door"
    if "scene" in intent or intent.startswith("activate_"):
        return "activate a scene"

    # Fallback: humanize the intent name; keep it short and singular.
    cleaned = intent.replace("_", " ").strip()
    return cleaned or "use a device"


# ---------------------------------------------------------------------------
# Clustering helper
# ---------------------------------------------------------------------------

def _cluster_indices(minutes: list[int], window: int) -> list[list[int]]:
    """
    Group by time-of-day proximity.
    Returns lists of indices into the original list, not values.
    """
    if not minutes:
        return []
    indexed = sorted(enumerate(minutes), key=lambda x: x[1])
    clusters: list[list[int]] = [[indexed[0][0]]]
    anchor_val = indexed[0][1]

    for orig_idx, val in indexed[1:]:
        if val - anchor_val <= window:
            clusters[-1].append(orig_idx)
        else:
            clusters.append([orig_idx])
            anchor_val = val

    return clusters


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _cfg() -> dict:
    return settings.get("pattern_learning", {})
