"""
Suggestion engine for Ziggy pattern learning.

Flow:
  1. detect_patterns()  — heuristic analysis of event log
  2. _synthesize()      — optionally ask OpenAI to improve/filter/phrase suggestions
  3. add_suggestion()   — persist new suggestions to suggestions.json
  4. notify_fn()        — push pending suggestions to Telegram (if provided)

The engine runs in a background thread via start_pattern_scheduler().
It fires once per day at the configured analysis_hour.

Privacy note: only redacted pattern summaries (no raw entity IDs or values)
are sent to OpenAI. The raw event log never leaves the device.
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from threading import Event

from core.logger_module import log_info, log_error
from core.settings_loader import settings
from services.pattern_detector import detect_patterns, PatternMatch
from services.suggestion_manager import add_suggestion, get_pending


_SYSTEM_PROMPT = """\
You are Ziggy's pattern analysis engine. You receive detected household behavior
patterns and must return practical automation suggestions.

Rules:
- Only suggest automations that are clearly useful and privacy-respecting.
- Never suggest anything dangerous, noisy, or creepy.
- Skip patterns that are too vague or not actionable.
- Return ONLY valid JSON: {"suggestions": [ ... ]}.

Each suggestion object must have:
{
  "pattern_type": "time_based" | "sequence" | "group",
  "pattern_summary": "concise description of the pattern",
  "user_message": "natural-language message to show the user",
  "trigger": {"type": "time|state|sequence|manual", "value": "..."},
  "actions": [{"intent": "...", "params": {}}],
  "confidence": 0.0-1.0,
  "reasoning": "why this automation is useful",
  "safety_note": null
}
"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_analysis(notify_fn=None, shutdown: Event | None = None) -> list[dict]:
    """
    Run pattern detection + LLM synthesis, save new suggestions, and notify.
    Returns list of newly created suggestion dicts (created today).
    """
    log_info("[PatternEngine] Starting pattern analysis...")

    patterns = detect_patterns()
    if not patterns:
        log_info("[PatternEngine] No patterns above threshold. Nothing to suggest.")
        return []

    log_info(f"[PatternEngine] Detected {len(patterns)} pattern(s). Synthesizing...")

    cfg = settings.get("pattern_learning", {})
    if cfg.get("llm_synthesis", True):
        suggestions_data = _synthesize_with_llm(patterns)
    else:
        suggestions_data = _heuristic_suggestions(patterns)

    today_prefix = datetime.now().strftime("%Y-%m-%d")
    new_suggestions: list[dict] = []

    for sug_data in suggestions_data:
        try:
            sug = add_suggestion(
                pattern_type=sug_data.get("pattern_type", "unknown"),
                pattern_summary=sug_data.get("pattern_summary", ""),
                user_message=sug_data.get("user_message", ""),
                trigger=sug_data.get("trigger", {}),
                actions=sug_data.get("actions", []),
                confidence=float(sug_data.get("confidence", 0.5)),
                reasoning=sug_data.get("reasoning", ""),
                safety_note=sug_data.get("safety_note"),
            )
            if sug.get("created_at", "").startswith(today_prefix):
                new_suggestions.append(sug)
        except Exception as e:
            log_error(f"[PatternEngine] Failed to save suggestion: {e}")

    if new_suggestions and notify_fn:
        _notify_pending(notify_fn)

    log_info(
        f"[PatternEngine] Done. {len(new_suggestions)} new suggestion(s) created."
    )
    return new_suggestions


def start_pattern_scheduler(
    notify_fn=None, shutdown: Event | None = None
) -> None:
    """
    Blocking loop that runs run_analysis() once per day at the configured hour.
    Designed to run in a daemon thread. Exits when shutdown is set.
    """
    cfg = settings.get("pattern_learning", {})
    if not cfg.get("enabled", True):
        log_info("[PatternEngine] Pattern learning disabled — scheduler not started.")
        return

    analysis_hour = cfg.get("analysis_hour", 9)
    log_info(
        f"[PatternEngine] Scheduler running. Analysis fires daily at {analysis_hour:02d}:00."
    )

    last_run_date = None

    while True:
        if shutdown and shutdown.is_set():
            break

        now = datetime.now()
        if now.hour == analysis_hour and now.date() != last_run_date:
            last_run_date = now.date()
            try:
                run_analysis(notify_fn=notify_fn, shutdown=shutdown)
            except Exception as e:
                log_error(f"[PatternEngine] Scheduled analysis failed: {e}")

        time.sleep(60)


# ---------------------------------------------------------------------------
# LLM synthesis
# ---------------------------------------------------------------------------

def _synthesize_with_llm(patterns: list[PatternMatch]) -> list[dict]:
    """Ask OpenAI to filter, rephrase, and enrich pattern matches."""
    try:
        from integrations.openai_client import get_client
    except ImportError:
        log_error("[PatternEngine] OpenAI client unavailable. Using heuristic fallback.")
        return _heuristic_suggestions(patterns)

    cfg = settings.get("pattern_learning", {})
    lookback = settings.get("pattern_learning", {}).get("lookback_days", 14)
    model = cfg.get("llm_model", "gpt-4o-mini")

    # Privacy-safe summary: no raw entity IDs or personal values
    pattern_summaries = [
        {
            "type": p.pattern_type,
            "draft_message": p.user_message,
            "occurrences": p.occurrences,
            "confidence": round(p.confidence, 2),
        }
        for p in patterns
    ]

    user_content = (
        f"Detected patterns from the past {lookback} days:\n"
        + json.dumps(pattern_summaries, indent=2)
    )

    try:
        client = get_client()
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.3,
            max_tokens=1500,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content
        parsed = json.loads(raw)

        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for key in ("suggestions", "results", "data"):
                if isinstance(parsed.get(key), list):
                    return parsed[key]
            # Fallback: return first list value found
            for v in parsed.values():
                if isinstance(v, list):
                    return v
        return []

    except Exception as e:
        log_error(f"[PatternEngine] LLM synthesis error: {e}. Using heuristic fallback.")
        return _heuristic_suggestions(patterns)


# ---------------------------------------------------------------------------
# Heuristic fallback (no LLM)
# ---------------------------------------------------------------------------

def _heuristic_suggestions(patterns: list[PatternMatch]) -> list[dict]:
    """Convert PatternMatch objects directly into suggestion dicts."""
    suggestions: list[dict] = []

    for p in patterns:
        d = p.details

        if p.pattern_type == "time_based":
            h, m = d.get("avg_hour", 0), d.get("avg_minute", 0)
            trigger = {"type": "time", "value": f"{h:02d}:{m:02d}"}
            actions = [{
                "intent": d.get("intent", ""),
                "params": {
                    "room": d.get("room", ""),
                    "turn_on": d.get("action") == "on",
                },
            }]

        elif p.pattern_type == "sequence":
            trigger = {
                "type": "sequence",
                "value": f"{d.get('a_intent')} in {d.get('a_room')}",
            }
            actions = [{"intent": d.get("b_intent", ""), "params": {"room": d.get("b_room", "")}}]

        else:  # group
            trigger = {"type": "manual", "value": "user_initiated"}
            actions = [{"intent": "group", "params": {"signature": d.get("signature", "")}}]

        suggestions.append({
            "pattern_type": p.pattern_type,
            "pattern_summary": p.key,
            "user_message": p.user_message,
            "trigger": trigger,
            "actions": actions,
            "confidence": p.confidence,
            "reasoning": f"Observed {p.occurrences} time(s) in the lookback window.",
            "safety_note": None,
        })

    return suggestions


# ---------------------------------------------------------------------------
# Notification helper
# ---------------------------------------------------------------------------

def _notify_pending(notify_fn) -> None:
    pending = get_pending()
    if not pending:
        return

    lines = [f"Ziggy has {len(pending)} automation suggestion(s) for you:\n"]
    for s in pending[:3]:  # Cap at 3 to avoid Telegram wall-of-text
        pct = int(s["confidence"] * 100)
        lines.append(f"• {s['user_message']} [{pct}% confidence | ID: {s['id']}]")

    if len(pending) > 3:
        lines.append(f"  ...and {len(pending) - 3} more. Say 'list suggestions' to see all.")

    lines.append("\nSay 'accept <id>', 'reject <id>', or 'snooze <id>'.")

    try:
        notify_fn("\n".join(lines))
    except Exception as e:
        log_error(f"[PatternEngine] Notification failed: {e}")
