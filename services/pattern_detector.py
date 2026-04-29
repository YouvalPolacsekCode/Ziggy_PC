"""
Heuristic pattern detector for Ziggy.

Reads the structured event log and detects three pattern types:

  time_based  — same action occurs at a similar time of day repeatedly
  sequence    — action B consistently follows action A within a short gap
  group       — multiple different actions cluster together in a short window

No machine learning is used. All detection is deterministic and thresholds are
configurable via settings.yaml under pattern_learning.

To add a new pattern type: write a _detect_<type>() function that accepts a
sorted list of event dicts and returns a list[PatternMatch], then register it
in detect_patterns().
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import NamedTuple

from services.pattern_logger import load_events
from core.settings_loader import settings


class PatternMatch(NamedTuple):
    pattern_type: str   # "time_based" | "sequence" | "group"
    key: str            # Stable dedup key
    occurrences: int
    details: dict       # Type-specific data used to build suggestion
    confidence: float   # 0.0 – 1.0
    user_message: str   # Draft human-readable sentence


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_patterns(extra_events: list[dict] | None = None) -> list[PatternMatch]:
    """Run all detectors and return deduplicated matches above thresholds."""
    cfg = _cfg()
    events = load_events(lookback_days=cfg.get("lookback_days", 14))
    if extra_events:
        events = extra_events + events

    # Only learn from successfully executed actions
    events = [e for e in events if e.get("result") == "ok"]
    if not events:
        return []

    # Sort once; detectors that need ordering use this list directly
    events.sort(key=lambda e: e["ts"])

    results: list[PatternMatch] = []
    results.extend(_detect_time_based(events))
    results.extend(_detect_sequence(events))
    results.extend(_detect_group(events))

    # Deduplicate by key (first match wins)
    seen: set[str] = set()
    unique: list[PatternMatch] = []
    for p in results:
        if p.key not in seen:
            seen.add(p.key)
            unique.append(p)

    return unique


# ---------------------------------------------------------------------------
# Time-based: same action at a similar clock time, N+ occurrences
# ---------------------------------------------------------------------------

def _detect_time_based(events: list[dict]) -> list[PatternMatch]:
    cfg = _cfg()
    min_occ = cfg.get("min_occurrences", 3)
    window = cfg.get("time_window_minutes", 45)

    # Bucket by (intent, room, action)
    buckets: dict[str, list[int]] = defaultdict(list)
    bucket_events: dict[str, list[dict]] = defaultdict(list)
    for ev in events:
        k = f"{ev['intent']}|{ev.get('room') or 'global'}|{ev.get('action') or ''}"
        minutes_of_day = ev["ctx"]["hour"] * 60 + ev["ctx"]["minute"]
        buckets[k].append(minutes_of_day)
        bucket_events[k].append(ev)

    matches: list[PatternMatch] = []
    for key, minutes in buckets.items():
        if len(minutes) < min_occ:
            continue

        for cluster in _cluster_minutes(minutes, window=window):
            if len(cluster) < min_occ:
                continue

            avg_min = int(sum(cluster) / len(cluster))
            avg_hour = avg_min // 60
            avg_minute = avg_min % 60
            time_str = f"{avg_hour:02d}:{avg_minute:02d}"

            intent, room, action = key.split("|")
            confidence = min(len(cluster) / (min_occ * 1.5), 1.0) * 0.9

            matches.append(PatternMatch(
                pattern_type="time_based",
                key=f"time|{key}|{time_str}",
                occurrences=len(cluster),
                details={
                    "avg_hour": avg_hour,
                    "avg_minute": avg_minute,
                    "intent": intent,
                    "room": room,
                    "action": action,
                },
                confidence=confidence,
                user_message=(
                    f"You usually {_action_phrase(intent, action)} "
                    f"{_room_phrase(room)} around {time_str}. "
                    f"Want me to automate that?"
                ),
            ))

    return matches


# ---------------------------------------------------------------------------
# Sequence: action B consistently follows action A within a short gap
# ---------------------------------------------------------------------------

def _detect_sequence(events: list[dict]) -> list[PatternMatch]:
    cfg = _cfg()
    min_occ = cfg.get("min_occurrences", 3)
    gap_s = cfg.get("sequence_gap_minutes", 5) * 60

    pair_counts: dict[str, int] = defaultdict(int)

    for i, ev_a in enumerate(events):
        ts_a = datetime.fromisoformat(ev_a["ts"]).timestamp()

        for ev_b in events[i + 1:]:
            ts_b = datetime.fromisoformat(ev_b["ts"]).timestamp()
            if ts_b - ts_a > gap_s:
                break
            # Skip same action in same room (that's time-based, not sequence)
            if ev_b["intent"] == ev_a["intent"] and ev_b.get("room") == ev_a.get("room"):
                continue

            pair_key = (
                f"{ev_a['intent']}:{ev_a.get('room') or ''}:{ev_a.get('action') or ''}"
                " -> "
                f"{ev_b['intent']}:{ev_b.get('room') or ''}:{ev_b.get('action') or ''}"
            )
            pair_counts[pair_key] += 1

    matches: list[PatternMatch] = []
    for pair_key, count in pair_counts.items():
        if count < min_occ:
            continue

        a_str, b_str = pair_key.split(" -> ")
        a_intent, a_room, a_action = a_str.split(":")
        b_intent, b_room, b_action = b_str.split(":")

        confidence = min(count / (min_occ * 1.5), 1.0) * 0.8

        matches.append(PatternMatch(
            pattern_type="sequence",
            key=f"seq|{pair_key}",
            occurrences=count,
            details={
                "a_intent": a_intent, "a_room": a_room, "a_action": a_action,
                "b_intent": b_intent, "b_room": b_room, "b_action": b_action,
            },
            confidence=confidence,
            user_message=(
                f"After you {_action_phrase(a_intent, a_action)} {_room_phrase(a_room)}, "
                f"you often {_action_phrase(b_intent, b_action)} {_room_phrase(b_room)}. "
                f"Should I combine these into a routine?"
            ),
        ))

    return matches


# ---------------------------------------------------------------------------
# Group: multiple different actions cluster within a short window
# ---------------------------------------------------------------------------

def _detect_group(events: list[dict]) -> list[PatternMatch]:
    cfg = _cfg()
    min_occ = cfg.get("min_occurrences", 3)
    gap_s = cfg.get("sequence_gap_minutes", 5) * 60

    sig_counts: dict[str, int] = defaultdict(int)

    for i, anchor in enumerate(events):
        ts_anchor = datetime.fromisoformat(anchor["ts"]).timestamp()
        group = [anchor]

        for ev in events[i + 1:]:
            if datetime.fromisoformat(ev["ts"]).timestamp() - ts_anchor > gap_s:
                break
            group.append(ev)

        if len(group) < 2:
            continue

        # Canonical signature: sorted set of (intent, room, action) tuples
        parts = sorted({
            f"{e['intent']}:{e.get('room') or ''}:{e.get('action') or ''}"
            for e in group
        })
        if len(parts) < 2:
            continue
        sig = " + ".join(parts)
        sig_counts[sig] += 1

    matches: list[PatternMatch] = []
    for sig, count in sig_counts.items():
        if count < min_occ:
            continue

        action_descs = []
        for part in sig.split(" + "):
            intent, room, action = part.split(":")
            action_descs.append(
                f"{_action_phrase(intent, action)} {_room_phrase(room)}".strip()
            )

        confidence = min(count / (min_occ * 1.5), 1.0) * 0.75
        desc = ", ".join(action_descs)

        matches.append(PatternMatch(
            pattern_type="group",
            key=f"group|{sig}",
            occurrences=count,
            details={"signature": sig, "action_count": len(sig.split(" + "))},
            confidence=confidence,
            user_message=(
                f"You often do these together: {desc}. "
                f"Should I create a combined routine?"
            ),
        ))

    return matches


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _cfg() -> dict:
    return settings.get("pattern_learning", {})


def _cluster_minutes(minutes: list[int], window: int) -> list[list[int]]:
    """Group sorted minute-of-day values into clusters within ±window minutes."""
    if not minutes:
        return []
    sorted_mins = sorted(minutes)
    clusters: list[list[int]] = [[sorted_mins[0]]]
    for m in sorted_mins[1:]:
        if m - clusters[-1][0] <= window:
            clusters[-1].append(m)
        else:
            clusters.append([m])
    return clusters


def _room_phrase(room: str) -> str:
    if not room or room == "global":
        return "in your home"
    return f"in the {room.replace('_', ' ')}"


def _action_phrase(intent: str, action: str) -> str:
    if "light" in intent:
        if action == "on":
            return "turn on the lights"
        if action == "off":
            return "turn off the lights"
        return "control the lights"
    if "ac" in intent or "climate" in intent:
        if action == "on":
            return "turn on the AC"
        if action == "off":
            return "turn off the AC"
        return "adjust the AC"
    if "tv" in intent:
        if action == "on":
            return "turn on the TV"
        if action == "off":
            return "turn off the TV"
        return "control the TV"
    return intent.replace("_", " ")
