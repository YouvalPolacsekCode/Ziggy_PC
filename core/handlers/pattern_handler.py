"""
Intent handlers for the pattern learning / automation suggestion system.

Exposes intents:
  list_suggestions    — show pending suggestions
  accept_suggestion   — user accepts; marks as accepted (automation creation is a future step)
  reject_suggestion   — user rejects permanently
  snooze_suggestion   — remind again in N days
  explain_suggestion  — show reasoning behind a suggestion
  run_pattern_analysis — manually trigger a pattern analysis run
"""
from __future__ import annotations

from core.intent_utils import ok, err
from core.logger_module import log_info
from services.suggestion_manager import (
    get_pending, get_all, get_by_id, update_status, count_pending,
)


async def handle_list_suggestions(params: dict, *, source: str = "unknown") -> dict:
    suggestions = get_pending()
    if not suggestions:
        return ok("No pending automation suggestions right now. Ziggy is still learning your habits.")

    lines: list[str] = [f"Ziggy has {len(suggestions)} suggestion(s) for you:\n"]
    for s in suggestions:
        pct = int(s["confidence"] * 100)
        lines.append(
            f"[{s['id']}] {s['user_message']}\n"
            f"  Confidence: {pct}% | Type: {s['pattern_type']}"
        )

    lines.append("\nReply: accept <id> | reject <id> | snooze <id> | why <id>")
    return ok("\n\n".join(lines), data={"suggestions": suggestions})


async def handle_accept_suggestion(params: dict, *, source: str = "unknown") -> dict:
    sug_id = params.get("suggestion_id") or params.get("id")
    if not sug_id:
        return err("Please provide a suggestion ID. Example: accept sug_abc123")

    sug = get_by_id(sug_id)
    if not sug:
        return err(f"Suggestion '{sug_id}' not found.")

    update_status(sug_id, "accepted")
    log_info(f"[PatternHandler] Suggestion {sug_id} accepted by user.")

    # Future: trigger automation creation via ha_automations or routine_file
    return ok(
        f"Great! I've marked this suggestion as accepted.\n"
        f"Automation setup for: {sug['user_message']}\n\n"
        f"(Full automation creation coming in the next version.)",
        data={"suggestion": sug},
    )


async def handle_reject_suggestion(params: dict, *, source: str = "unknown") -> dict:
    sug_id = params.get("suggestion_id") or params.get("id")
    if not sug_id:
        return err("Please provide a suggestion ID. Example: reject sug_abc123")

    if not get_by_id(sug_id):
        return err(f"Suggestion '{sug_id}' not found.")

    update_status(sug_id, "rejected")
    log_info(f"[PatternHandler] Suggestion {sug_id} rejected by user.")
    return ok("Noted. I won't suggest this again.")


async def handle_snooze_suggestion(params: dict, *, source: str = "unknown") -> dict:
    sug_id = params.get("suggestion_id") or params.get("id")
    days = int(params.get("days", 3))
    if not sug_id:
        return err("Please provide a suggestion ID. Example: snooze sug_abc123")

    if not get_by_id(sug_id):
        return err(f"Suggestion '{sug_id}' not found.")

    update_status(sug_id, "snoozed", snooze_days=days)
    log_info(f"[PatternHandler] Suggestion {sug_id} snoozed for {days} days.")
    return ok(f"Got it. I'll remind you about this in {days} days.")


async def handle_explain_suggestion(params: dict, *, source: str = "unknown") -> dict:
    sug_id = params.get("suggestion_id") or params.get("id")
    if not sug_id:
        return err("Please provide a suggestion ID. Example: why sug_abc123")

    sug = get_by_id(sug_id)
    if not sug:
        return err(f"Suggestion '{sug_id}' not found.")

    pct = int(sug["confidence"] * 100)
    lines = [
        f"Pattern type: {sug['pattern_type']}",
        f"Reasoning: {sug['reasoning']}",
        f"Confidence: {pct}%",
        f"Trigger: {sug['trigger']}",
    ]
    if sug.get("safety_note"):
        lines.append(f"Safety note: {sug['safety_note']}")

    return ok("\n".join(lines))


async def handle_run_pattern_analysis(params: dict, *, source: str = "unknown") -> dict:
    """Manually trigger a pattern analysis run (for testing or on-demand)."""
    try:
        from services.suggestion_engine import run_analysis
        new = run_analysis()
        if not new:
            return ok("Pattern analysis complete. No new suggestions at this time.")
        return ok(
            f"Analysis complete. {len(new)} new suggestion(s) found.",
            data={"new_suggestions": new},
        )
    except Exception as e:
        return err(f"Pattern analysis failed: {e}")


HANDLERS = {
    "list_suggestions": handle_list_suggestions,
    "accept_suggestion": handle_accept_suggestion,
    "reject_suggestion": handle_reject_suggestion,
    "snooze_suggestion": handle_snooze_suggestion,
    "explain_suggestion": handle_explain_suggestion,
    "run_pattern_analysis": handle_run_pattern_analysis,
}
