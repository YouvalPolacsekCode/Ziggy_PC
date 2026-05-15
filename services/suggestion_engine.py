"""
Suggestion engine for Ziggy pattern learning.

Flow:
  1. update_and_detect()   — accumulate events into persistent candidates,
                             return those that pass the evidence gate + confidence threshold
  2. _quality_gate()       — ask Ollama (local, free) whether each candidate is worth
                             surfacing; filter out noise; generate polished user copy
  3. add_suggestion()      — persist at most 1 new suggestion per run (hard cap)
  4. notify_fn()           — push to Telegram if provided

Ollama runs locally — no tokens, no billing, no internet required.
Falls back to heuristic copy if Ollama is unavailable.

Privacy: the raw event log never leaves the device. Ollama receives only
structured summaries (intent names, room names, occurrence counts, timing stats).
"""
from __future__ import annotations

import json
import time
from datetime import datetime
from threading import Event

from core.logger_module import log_info, log_error
from core.settings_loader import settings
from services.pattern_detector import (
    update_and_detect,
    QualifiedCandidate,
    mark_candidate_surfaced,
)
from services.suggestion_manager import (
    add_suggestion,
    get_pending,
    pending_slots_available,
    is_suppressed,
    within_rejection_cooldown,
)


_QUALITY_GATE_SYSTEM_PROMPT = """\
You are Ziggy's suggestion quality filter. You evaluate detected household behavior patterns
and decide whether each one is worth showing to the user as an automation suggestion.

You will receive a JSON list of candidates. For each, return a JSON object with:
  "recommend": true or false
  "reason": a specific sentence that cites the actual evidence — mention the occurrence count,
             the number of distinct weeks it was observed, and for time-based patterns the
             observed time window. Example: "You've done this 8 times between 07:15–07:45,
             across 3 weeks — last seen 2026-05-11." Never write generic benefit statements
             like "this will save time" or "this will ensure your preferences are met".
  "user_message": a natural, friendly message to show the user (only if recommend=true)
  "trigger": {"type": "time|sequence|manual", "value": "HH:MM or description"}
  "actions": [{"intent": "...", "params": {}}]

Return a JSON array, one object per input candidate, in the same order.

Rules:
- Recommend ONLY if the behavior is genuinely habitual (consistent across multiple weeks, active recently).
- Do NOT recommend if an existing automation already covers it.
- Do NOT recommend query-only patterns (checking temperature, checking if someone is home).
- Do NOT recommend anything that could be creepy, noisy, or unsafe.
- Keep user_message concise, friendly, and specific (mention the time or context).
- For trigger.value on time-based patterns use "HH:MM" format.
"""


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_analysis(notify_fn=None, shutdown: Event | None = None) -> list[dict]:
    """
    Run the full pipeline: detect → quality gate → surface at most 1 new suggestion.
    Returns list of newly created suggestion dicts (created in this run).
    """
    log_info("[SuggestionEngine] Starting analysis...")

    candidates = update_and_detect()
    if not candidates:
        log_info("[SuggestionEngine] No qualified candidates above threshold.")
        return []

    log_info(f"[SuggestionEngine] {len(candidates)} candidate(s) qualified. Running quality gate...")

    # Filter out already-surfaced, suppressed, or cooled-down candidates
    open_candidates = [
        c for c in candidates
        if not is_suppressed(c.key)
        and not within_rejection_cooldown(c.key)
    ]

    if not open_candidates:
        log_info("[SuggestionEngine] All candidates suppressed or in cooldown.")
        return []

    if pending_slots_available() == 0:
        log_info("[SuggestionEngine] Pending cap reached — no new suggestions this run.")
        return []

    existing_automations = _get_existing_automation_names()
    evaluated = _quality_gate(open_candidates, existing_automations)

    if not evaluated:
        log_info("[SuggestionEngine] Quality gate filtered all candidates.")
        return []

    # Promote at most 1 new suggestion per run
    new_suggestions: list[dict] = []
    for ev in evaluated[:1]:
        try:
            sug = add_suggestion(
                canonical_key=ev["canonical_key"],
                pattern_type=ev["pattern_type"],
                pattern_summary=ev.get("pattern_summary", ev["canonical_key"]),
                user_message=ev["user_message"],
                trigger=ev["trigger"],
                actions=ev["actions"],
                confidence=ev["confidence"],
                reasoning=ev.get("reason", ""),
                safety_note=ev.get("safety_note"),
                evidence_summary=ev.get("evidence_summary"),
            )
            if sug:
                mark_candidate_surfaced(ev["canonical_key"], sug["id"])
                new_suggestions.append(sug)
                log_info(f"[SuggestionEngine] Created suggestion {sug['id']} — {ev['canonical_key']}")
        except Exception as e:
            log_error(f"[SuggestionEngine] Failed to save suggestion: {e}")

    if new_suggestions and notify_fn:
        _notify_pending(notify_fn)

    log_info(f"[SuggestionEngine] Done. {len(new_suggestions)} new suggestion(s) created.")
    return new_suggestions


def start_pattern_scheduler(
    notify_fn=None, shutdown: Event | None = None
) -> None:
    """
    Blocking loop that runs run_analysis() once per day at the configured hour.
    Designed to run in a daemon thread.
    """
    cfg = settings.get("pattern_learning", {})
    if not cfg.get("enabled", True):
        log_info("[SuggestionEngine] Pattern learning disabled — scheduler not started.")
        return

    analysis_hour = cfg.get("analysis_hour", 9)
    log_info(f"[SuggestionEngine] Scheduler running. Analysis fires daily at {analysis_hour:02d}:00.")

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
                log_error(f"[SuggestionEngine] Scheduled analysis failed: {e}")

        time.sleep(60)


# ---------------------------------------------------------------------------
# Quality gate — Ollama binary filter
# ---------------------------------------------------------------------------

def _quality_gate(
    candidates: list[QualifiedCandidate],
    existing_automations: list[str],
) -> list[dict]:
    """
    Ask Ollama to evaluate each candidate.
    Returns list of enriched dicts for candidates that pass (recommend=true).
    Falls back to heuristic conversion if Ollama is unavailable.
    """
    cfg = settings.get("pattern_learning", {})
    if not cfg.get("llm_synthesis", True):
        return _heuristic_enrich(candidates)

    try:
        from integrations.ollama_client import get_client, is_available, default_model
    except ImportError:
        log_info("[SuggestionEngine] Ollama client not importable. Using heuristic fallback.")
        return _heuristic_enrich(candidates)

    if not is_available():
        log_info("[SuggestionEngine] Ollama not reachable. Using heuristic fallback.")
        return _heuristic_enrich(candidates)

    model = settings.get("ollama", {}).get("model", default_model())

    # Build structured input — no raw event data, only derived stats
    payload = []
    for c in candidates:
        ev_scores = c.scores
        payload.append({
            "index": len(payload),
            "canonical_key": c.key,
            "pattern_type": c.pattern_type,
            "behavior_summary": c.user_message,
            "occurrences": c.occurrences,
            "confidence": c.confidence,
            "scores": {
                "consistency_across_weeks": ev_scores.get("consistency"),
                "recency_last_7d": ev_scores.get("recency"),
                "timing_precision": ev_scores.get("temporal_precision"),
            },
            "existing_automations": existing_automations,
            "details": c.details,
        })

    user_content = json.dumps(payload, ensure_ascii=False)

    try:
        client = get_client()
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": _QUALITY_GATE_SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.2,
            max_tokens=1200,
        )
        raw = response.choices[0].message.content or ""
        results = _parse_llm_response(raw)

        enriched = []
        for i, item in enumerate(results):
            if not item.get("recommend"):
                continue
            if i >= len(candidates):
                continue
            c = candidates[i]
            enriched.append({
                "canonical_key": c.key,
                "pattern_type": c.pattern_type,
                "pattern_summary": c.user_message,
                "user_message": item.get("user_message") or c.user_message,
                "trigger": item.get("trigger") or _default_trigger(c),
                "actions": item.get("actions") or _default_actions(c),
                "confidence": c.confidence,
                "reason": item.get("reason", ""),
                "safety_note": item.get("safety_note"),
                "evidence_summary": c.evidence_summary,
            })

        log_info(f"[SuggestionEngine] Ollama approved {len(enriched)}/{len(candidates)} candidate(s).")
        return enriched

    except Exception as e:
        log_error(f"[SuggestionEngine] Ollama quality gate failed: {e}. Using heuristic fallback.")
        return _heuristic_enrich(candidates)


def _parse_llm_response(raw: str) -> list[dict]:
    """Extract a JSON array from the LLM response, tolerating markdown fences."""
    raw = raw.strip()
    # Strip markdown code fences if present
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(
            l for l in lines if not l.startswith("```")
        ).strip()

    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return parsed
        if isinstance(parsed, dict):
            for key in ("suggestions", "results", "data", "candidates"):
                if isinstance(parsed.get(key), list):
                    return parsed[key]
        return []
    except json.JSONDecodeError:
        return []


# ---------------------------------------------------------------------------
# Heuristic fallback (Ollama unavailable)
# ---------------------------------------------------------------------------

def _heuristic_enrich(candidates: list[QualifiedCandidate]) -> list[dict]:
    """Convert QualifiedCandidates directly to enriched dicts without LLM."""
    result = []
    for c in candidates:
        result.append({
            "canonical_key": c.key,
            "pattern_type": c.pattern_type,
            "pattern_summary": c.user_message,
            "user_message": c.user_message,
            "trigger": _default_trigger(c),
            "actions": _default_actions(c),
            "confidence": c.confidence,
            "reason": _heuristic_reason(c),
            "safety_note": None,
            "evidence_summary": c.evidence_summary,
        })
    return result


def _heuristic_reason(c: QualifiedCandidate) -> str:
    """Generate a specific, evidence-citing reason string without the LLM."""
    es = c.evidence_summary
    n = es.get("occurrences", c.occurrences)
    weeks = es.get("unique_weeks", "?")
    last = es.get("last_seen", "")
    last_part = f" Last seen {last}." if last else ""

    if c.pattern_type == "time_based" and es.get("time_window"):
        tw = es["time_window"]
        avg = es.get("avg_time", "")
        days = es.get("active_day_names", [])
        day_part = f" on {', '.join(days)}" if days else ""
        return (
            f"You did this {n} time(s) between {tw} (avg {avg})"
            f"{day_part}, across {weeks} week(s).{last_part}"
        )

    if c.pattern_type == "sequence":
        b_intent = c.details.get("b_intent", "").replace("_", " ")
        b_room = c.details.get("b_room") or ""
        b_str = f"{b_intent} in {b_room}".strip() if b_room else b_intent
        return (
            f"After {c.intent.replace('_', ' ')}, you often {b_str} — "
            f"{n} time(s) across {weeks} week(s).{last_part}"
        )

    return f"Observed {n} time(s) across {weeks} week(s).{last_part}"


def _default_trigger(c: QualifiedCandidate) -> dict:
    if c.pattern_type == "time_based":
        h = c.details.get("avg_hour", 0)
        m = c.details.get("avg_minute", 0)
        return {"type": "time", "value": f"{h:02d}:{m:02d}"}
    if c.pattern_type == "sequence":
        return {
            "type": "sequence",
            "value": f"{c.intent} in {c.room or 'home'}",
        }
    return {"type": "manual", "value": "user_initiated"}


def _default_actions(c: QualifiedCandidate) -> list[dict]:
    if c.pattern_type == "sequence":
        b = c.details
        return [{"intent": b.get("b_intent", ""), "params": {"room": b.get("b_room", "")}}]
    return [{"intent": c.intent, "params": {"room": c.room, "turn_on": c.action == "on"}}]


# ---------------------------------------------------------------------------
# HA automation context
# ---------------------------------------------------------------------------

def _get_existing_automation_names() -> list[str]:
    """
    Return a list of existing Home Assistant automation / routine names.
    Used by the LLM to avoid suggesting something already automated.
    Falls back to empty list on any error.
    """
    try:
        from services.ha_automations import list_automations
        automations = list_automations()
        return [a.get("alias") or a.get("friendly_name") or "" for a in automations if a]
    except Exception:
        pass

    try:
        from pathlib import Path
        import json as _json
        automations_file = Path("user_files/automations.json")
        if automations_file.exists():
            data = _json.loads(automations_file.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [a.get("name") or a.get("alias") or "" for a in data]
    except Exception:
        pass

    return []


# ---------------------------------------------------------------------------
# Notification helper
# ---------------------------------------------------------------------------

def _notify_pending(notify_fn) -> None:
    pending = get_pending()
    if not pending:
        return

    lines = [f"Ziggy has {len(pending)} automation suggestion(s) for you:\n"]
    for s in pending[:3]:
        pct = int(s["confidence"] * 100)
        lines.append(f"• {s['user_message']} [{pct}% | {s['id']}]")

    if len(pending) > 3:
        lines.append(f"  ...and {len(pending) - 3} more. Say 'list suggestions' to see all.")

    lines.append("\nSay 'accept <id>', 'reject <id>', or 'snooze <id>'.")

    try:
        notify_fn("\n".join(lines))
    except Exception as e:
        log_error(f"[SuggestionEngine] Notification failed: {e}")
