"""
One-time migration: backfill evidence_summary onto existing suggestions.

Priority order:
  1. Suggestion already has canonical_key → look up candidate, use real evidence
  2. Time-based suggestion whose trigger.value matches a known candidate → use real evidence
  3. Everything else → synthesize minimal summary from the suggestion's own trigger field
     (only avg_time; no fabricated counts or windows)
"""
from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

SUGGESTIONS_FILE = Path("user_files/suggestions.json")
CANDIDATES_FILE  = Path("user_files/pattern_candidates.json")

_DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# Map trigger time values we know map to a specific candidate key
_TIME_TRIGGER_TO_CANDIDATE: dict[str, str] = {
    "07:51": "time_based|turn_off_everything|global|turn|weekday",
    "07:29": "time_based|toggle_light|bedroom|on|weekday",
}


def _build_from_candidate(cand: dict) -> dict:
    ev = cand.get("evidence", {})
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
        "scores": cand.get("scores", {}),
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


def _build_synthetic(sug: dict) -> dict | None:
    """
    Build a minimal evidence summary purely from the suggestion's own fields.
    Only sets avg_time for time-based patterns — never fabricates counts or windows.
    """
    trigger = sug.get("trigger", {})
    if trigger.get("type") == "time" and trigger.get("value"):
        return {"avg_time": trigger["value"]}
    return None


def main() -> None:
    if not SUGGESTIONS_FILE.exists():
        print("suggestions.json not found — nothing to migrate.")
        sys.exit(0)

    suggestions: list[dict] = json.loads(SUGGESTIONS_FILE.read_text(encoding="utf-8"))
    candidates: dict = {}
    if CANDIDATES_FILE.exists():
        candidates = json.loads(CANDIDATES_FILE.read_text(encoding="utf-8"))

    real_count = 0
    synth_count = 0
    skip_count = 0

    for sug in suggestions:
        if sug.get("evidence_summary") is not None:
            skip_count += 1
            continue

        # 1. Direct canonical_key lookup
        ckey = sug.get("canonical_key")
        if ckey and ckey in candidates:
            sug["evidence_summary"] = _build_from_candidate(candidates[ckey])
            real_count += 1
            continue

        # 2. Infer candidate from trigger time value
        trigger_val = sug.get("trigger", {}).get("value", "")
        inferred_key = _TIME_TRIGGER_TO_CANDIDATE.get(trigger_val)
        if inferred_key and inferred_key in candidates:
            sug["evidence_summary"] = _build_from_candidate(candidates[inferred_key])
            real_count += 1
            continue

        # 3. Synthesize from trigger
        es = _build_synthetic(sug)
        sug["evidence_summary"] = es
        if es:
            synth_count += 1

    SUGGESTIONS_FILE.write_text(
        json.dumps(suggestions, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(
        f"Migration complete.\n"
        f"  Real evidence backfilled : {real_count}\n"
        f"  Synthetic (avg_time only): {synth_count}\n"
        f"  Already had evidence     : {skip_count}\n"
        f"  Total suggestions        : {len(suggestions)}"
    )


if __name__ == "__main__":
    main()
