#!/usr/bin/env python3
"""
Test script for Ziggy's pattern learning system.

Usage:
    cd c:\\Users\\Youval Polacsek\\Ziggy_PC
    python scripts/test_pattern_learning.py [--no-llm] [--clear]

Options:
    --no-llm   Use heuristic suggestions only (skip OpenAI call)
    --clear    Wipe events.jsonl and suggestions.json before running

What this does:
  1. Injects realistic sample events into the event log
  2. Runs the pattern detector
  3. Generates suggestions (LLM or heuristic)
  4. Prints results

Sample patterns injected:
  - Living room light turned on around 19:30 every evening (7 times)
  - AC turned on shortly after arriving home in the afternoon (4 times)
  - TV + dim lights grouped together in the evening (4 times)
  - Office light turned on at ~09:00 on weekdays (5 times)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

# Ensure project root is on the path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Test Ziggy pattern learning")
    parser.add_argument("--no-llm", action="store_true", help="Skip OpenAI call")
    parser.add_argument("--clear", action="store_true", help="Clear existing data first")
    args = parser.parse_args()

    events_file = Path("user_files/events.jsonl")
    suggestions_file = Path("user_files/suggestions.json")

    if args.clear:
        if events_file.exists():
            events_file.unlink()
            print("  Cleared events.jsonl")
        if suggestions_file.exists():
            suggestions_file.unlink()
            print("  Cleared suggestions.json")

    # ----------------------------------------------------------------
    # Step 1: Inject sample events
    # ----------------------------------------------------------------
    print("\n=== Step 1: Injecting sample events ===\n")

    now = datetime.now()
    sample_events: list[dict] = []

    def make_event(days_ago: int, hour: int, minute: int, intent: str,
                   room: str | None, action: str, source: str = "voice") -> dict:
        ts = now - timedelta(days=days_ago)
        ts = ts.replace(hour=hour, minute=minute, second=0, microsecond=0)
        return {
            "ts": ts.isoformat(timespec="seconds"),
            "source": source,
            "intent": intent,
            "room": room,
            "action": action,
            "value": None,
            "result": "ok",
            "ctx": {
                "hour": hour,
                "minute": minute,
                "day_of_week": ts.weekday(),
                "time_slot": _time_slot(hour),
            },
        }

    # Pattern A: Living room light on at ~19:30 (7 occurrences over 13 days)
    for i, (d, h, m) in enumerate([
        (1, 19, 28), (2, 19, 35), (3, 19, 31), (4, 19, 27),
        (5, 19, 33), (8, 19, 30), (11, 19, 29),
    ]):
        sample_events.append(make_event(d, h, m, "toggle_light", "living_room", "on"))

    # Pattern B: Office light on at ~09:00 on weekdays (5 occurrences)
    for d, h, m in [(1, 8, 58), (2, 9, 3), (3, 9, 1), (6, 8, 59), (7, 9, 2)]:
        sample_events.append(make_event(d, h, m, "toggle_light", "office", "on"))

    # Pattern C: AC on after toggle_light living_room (sequence, 4 times)
    for d, (h1, m1), (h2, m2) in [
        (1, (19, 28), (19, 32)),
        (2, (19, 35), (19, 39)),
        (3, (19, 31), (19, 36)),
        (4, (19, 27), (19, 31)),
    ]:
        sample_events.append(make_event(d, h1, m1, "toggle_light", "living_room", "on"))
        sample_events.append(make_event(d, h2, m2, "control_ac", "living_room", "on"))

    # Pattern D: TV + dim lights grouped (group, 4 times)
    for d, h, m in [(1, 21, 5), (3, 21, 10), (5, 20, 58), (7, 21, 2)]:
        sample_events.append(make_event(d, h, m, "control_tv", "living_room", "on"))
        sample_events.append(make_event(d, h, m + 1, "toggle_light", "living_room", "off"))

    from services.pattern_logger import inject_sample_events
    inject_sample_events(sample_events)
    print(f"  Injected {len(sample_events)} sample events into {events_file}")

    # ----------------------------------------------------------------
    # Step 2: Run pattern detector
    # ----------------------------------------------------------------
    print("\n=== Step 2: Running pattern detector ===\n")

    from services.pattern_detector import detect_patterns
    patterns = detect_patterns()

    if not patterns:
        print("  No patterns detected (check min_occurrences in settings.yaml).")
        return

    for p in patterns:
        print(f"  [{p.pattern_type.upper()}] {p.key}")
        print(f"    Occurrences : {p.occurrences}")
        print(f"    Confidence  : {p.confidence:.0%}")
        print(f"    Draft msg   : {p.user_message}")
        print()

    # ----------------------------------------------------------------
    # Step 3: Synthesize suggestions
    # ----------------------------------------------------------------
    print("=== Step 3: Synthesizing suggestions ===\n")

    if args.no_llm:
        # Patch config temporarily
        from core import settings_loader
        settings_loader.settings.setdefault("pattern_learning", {})["llm_synthesis"] = False
        print("  (LLM synthesis disabled — using heuristics)")

    from services.suggestion_engine import run_analysis
    new_suggestions = run_analysis()

    if not new_suggestions:
        print("  No new suggestions generated (may already exist in suggestions.json).")
    else:
        print(f"  Generated {len(new_suggestions)} suggestion(s):\n")
        for s in new_suggestions:
            pct = int(s["confidence"] * 100)
            print(f"  [{s['id']}] {s['user_message']}")
            print(f"    Type       : {s['pattern_type']}")
            print(f"    Confidence : {pct}%")
            print(f"    Reasoning  : {s['reasoning']}")
            print(f"    Trigger    : {json.dumps(s['trigger'])}")
            print(f"    Actions    : {json.dumps(s['actions'])}")
            print()

    # ----------------------------------------------------------------
    # Step 4: Show all pending suggestions
    # ----------------------------------------------------------------
    print("=== Step 4: Pending suggestions ===\n")

    from services.suggestion_manager import get_pending
    pending = get_pending()
    if not pending:
        print("  No pending suggestions.")
    else:
        for s in pending:
            print(f"  [{s['id']}] {s['user_message']} (status: {s['status']})")

    print(f"\nDone. Event log: {events_file} | Suggestions: {suggestions_file}\n")


def _time_slot(hour: int) -> str:
    if 5 <= hour < 9:
        return "early_morning"
    if 9 <= hour < 12:
        return "morning"
    if 12 <= hour < 14:
        return "midday"
    if 14 <= hour < 18:
        return "afternoon"
    if 18 <= hour < 22:
        return "evening"
    return "night"


if __name__ == "__main__":
    main()
