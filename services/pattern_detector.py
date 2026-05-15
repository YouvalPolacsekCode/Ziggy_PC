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
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import NamedTuple

from services.pattern_logger import load_events
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

    # Bucket: (intent, room, action) → list of (date_str, week_str, minute_of_day, weekday)
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

            if existing:
                # Merge: extend sets, keep history
                existing_dates = set(existing["evidence"].get("occurrence_dates", []))
                existing_weeks = set(existing["evidence"].get("occurrence_weeks", []))
                existing_times = existing["evidence"].get("times_of_day_minutes", [])
                all_dates = existing_dates | dates
                all_weeks = existing_weeks | weeks
                all_times = (existing_times + times_of_day)[-120:]  # cap at 120 values
                existing["evidence"].update({
                    "occurrences": len(all_dates),
                    "unique_days": len(all_dates),
                    "unique_weeks": len(all_weeks),
                    "occurrence_dates": sorted(all_dates),
                    "occurrence_weeks": sorted(all_weeks),
                    "times_of_day_minutes": all_times,
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
                        "reversal_count": 0,
                        "first_seen": min(d[4] for d in cluster_data),
                        "last_seen": last_seen,
                    },
                    extra={"avg_hour": avg_min // 60, "avg_minute": avg_min % 60},
                )

            # Always refresh avg_time from current data
            all_times = candidates[ckey]["evidence"]["times_of_day_minutes"]
            avg_min = int(sum(all_times) / len(all_times))
            candidates[ckey]["details"]["avg_hour"] = avg_min // 60
            candidates[ckey]["details"]["avg_minute"] = avg_min % 60


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

        if existing:
            existing_dates = set(existing["evidence"].get("occurrence_dates", []))
            existing_weeks = set(existing["evidence"].get("occurrence_weeks", []))
            all_dates = existing_dates | dates
            all_weeks = existing_weeks | weeks
            existing["evidence"].update({
                "occurrences": len(all_dates),
                "unique_days": len(all_dates),
                "unique_weeks": len(all_weeks),
                "occurrence_dates": sorted(all_dates),
                "occurrence_weeks": sorted(all_weeks),
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


# ---------------------------------------------------------------------------
# Qualification: evidence gate + confidence scoring
# ---------------------------------------------------------------------------

def _qualify(candidates: dict) -> list[QualifiedCandidate]:
    qualified: list[QualifiedCandidate] = []

    for ckey, cand in candidates.items():
        if cand.get("status") == "suppressed":
            continue

        scores = _compute_scores(cand)
        if scores is None:
            continue  # Failed evidence gate

        cand["scores"] = scores
        composite = scores["composite"]

        if composite < CONFIDENCE_THRESHOLD:
            continue

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

def _load_candidates() -> dict:
    if not CANDIDATES_FILE.exists():
        return {}
    try:
        with open(CANDIDATES_FILE, encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_candidates(candidates: dict) -> None:
    CANDIDATES_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CANDIDATES_FILE, "w", encoding="utf-8") as f:
        json.dump(candidates, f, indent=2, ensure_ascii=False)


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

def _draft_message(cand: dict, details: dict) -> str:
    intent = cand["intent"]
    room = cand.get("room")
    action = cand["action"]
    day_class = cand["day_class"]
    pattern_type = cand["pattern_type"]
    occ = cand["evidence"]["occurrences"]

    action_str = _action_phrase(intent, action)
    room_str = _room_phrase(room)
    day_str = {"weekday": "on weekdays", "weekend": "on weekends", "any": ""}.get(day_class, "")

    if pattern_type == "time_based":
        h = details.get("avg_hour", 0)
        m = details.get("avg_minute", 0)
        time_str = f"{h:02d}:{m:02d}"
        return (
            f"You {action_str} {room_str} around {time_str} {day_str}".strip()
            + f" — {occ} times so far. Want me to automate that?"
        )

    if pattern_type == "sequence":
        b_intent = details.get("b_intent", "")
        b_room = details.get("b_room")
        b_action = details.get("b_action", "")
        b_str = f"{_action_phrase(b_intent, b_action)} {_room_phrase(b_room)}".strip()
        return (
            f"After you {action_str} {room_str}, you often {b_str} {day_str}".strip()
            + f" — {occ} times. Should I combine these into a routine?"
        )

    return f"You often {action_str} {room_str} {day_str}".strip() + f" ({occ} times)."


def _room_phrase(room: str | None) -> str:
    if not room or room == "global":
        return "in your home"
    return f"in the {room.replace('_', ' ')}"


def _action_phrase(intent: str, action: str) -> str:
    if "light" in intent or "toggle_light" in intent:
        return "turn on the lights" if action == "on" else (
            "turn off the lights" if action == "off" else "control the lights"
        )
    if "ac" in intent or "climate" in intent:
        return "turn on the AC" if action == "on" else (
            "turn off the AC" if action == "off" else "adjust the AC"
        )
    if "tv" in intent or "control_tv" in intent:
        return "turn on the TV" if action == "on" else (
            "turn off the TV" if action == "off" else "control the TV"
        )
    if "ir_send" in intent:
        return f"send IR command ({action})"
    return intent.replace("_", " ")


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
