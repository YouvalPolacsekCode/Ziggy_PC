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
from core.result_utils import L
from core.logger_module import log_info
from services.suggestion_manager import (
    get_pending, get_all, get_by_id, update_status, count_pending,
)


async def handle_list_suggestions(params: dict, *, source: str = "unknown") -> dict:
    suggestions = get_pending()
    if not suggestions:
        return ok(L("No pending automation suggestions right now. Ziggy is still learning your habits.",
                    "אין כרגע הצעות אוטומציה ממתינות. זיגי עדיין לומד את ההרגלים שלך."))

    lines: list[str] = [L(f"Ziggy has {len(suggestions)} suggestion(s) for you:\n",
                          f"לזיגי יש {len(suggestions)} הצעות עבורך:\n")]
    for s in suggestions:
        pct = int(s["confidence"] * 100)
        lines.append(L(
            f"[{s['id']}] {s['user_message']}\n"
            f"  Confidence: {pct}% | Type: {s['pattern_type']}",
            f"[{s['id']}] {s['user_message']}\n"
            f"  ביטחון: {pct}% | סוג: {s['pattern_type']}",
        ))

    lines.append(L("\nReply: accept <id> | reject <id> | snooze <id> | why <id>",
                   "\nהשב: accept <id> | reject <id> | snooze <id> | why <id>"))
    return ok("\n\n".join(lines), data={"suggestions": suggestions})


async def handle_accept_suggestion(params: dict, *, source: str = "unknown") -> dict:
    sug_id = params.get("suggestion_id") or params.get("id")
    if not sug_id:
        return err(L("Please provide a suggestion ID. Example: accept sug_abc123",
                     "אנא ספקו מזהה הצעה. לדוגמה: accept sug_abc123"))

    sug = get_by_id(sug_id)
    if not sug:
        return err(L(f"Suggestion '{sug_id}' not found.", f"ההצעה '{sug_id}' לא נמצאה."))

    update_status(sug_id, "accepted")
    log_info(f"[PatternHandler] Suggestion {sug_id} accepted by user.")

    # Future: trigger automation creation via ha_automations or routine_file
    return ok(
        L(f"Great! I've marked this suggestion as accepted.\n"
          f"Automation setup for: {sug['user_message']}\n\n"
          f"(Full automation creation coming in the next version.)",
          f"מצוין! סימנתי את ההצעה הזו כמאושרת.\n"
          f"הגדרת אוטומציה עבור: {sug['user_message']}\n\n"
          f"(יצירת אוטומציה מלאה תגיע בגרסה הבאה.)"),
        data={"suggestion": sug},
    )


async def handle_reject_suggestion(params: dict, *, source: str = "unknown") -> dict:
    sug_id = params.get("suggestion_id") or params.get("id")
    if not sug_id:
        return err(L("Please provide a suggestion ID. Example: reject sug_abc123",
                     "אנא ספקו מזהה הצעה. לדוגמה: reject sug_abc123"))

    if not get_by_id(sug_id):
        return err(L(f"Suggestion '{sug_id}' not found.", f"ההצעה '{sug_id}' לא נמצאה."))

    update_status(sug_id, "rejected")
    log_info(f"[PatternHandler] Suggestion {sug_id} rejected by user.")
    return ok(L("Noted. I won't suggest this again.", "רשמתי. לא אציע את זה שוב."))


async def handle_snooze_suggestion(params: dict, *, source: str = "unknown") -> dict:
    sug_id = params.get("suggestion_id") or params.get("id")
    days = int(params.get("days", 3))
    if not sug_id:
        return err(L("Please provide a suggestion ID. Example: snooze sug_abc123",
                     "אנא ספקו מזהה הצעה. לדוגמה: snooze sug_abc123"))

    if not get_by_id(sug_id):
        return err(L(f"Suggestion '{sug_id}' not found.", f"ההצעה '{sug_id}' לא נמצאה."))

    update_status(sug_id, "snoozed", snooze_days=days)
    log_info(f"[PatternHandler] Suggestion {sug_id} snoozed for {days} days.")
    return ok(L(f"Got it. I'll remind you about this in {days} days.",
                f"הבנתי. אזכיר לך על זה בעוד {days} ימים."))


async def handle_explain_suggestion(params: dict, *, source: str = "unknown") -> dict:
    sug_id = params.get("suggestion_id") or params.get("id")
    if not sug_id:
        return err(L("Please provide a suggestion ID. Example: why sug_abc123",
                     "אנא ספקו מזהה הצעה. לדוגמה: why sug_abc123"))

    sug = get_by_id(sug_id)
    if not sug:
        return err(L(f"Suggestion '{sug_id}' not found.", f"ההצעה '{sug_id}' לא נמצאה."))

    pct = int(sug["confidence"] * 100)
    es = sug.get("evidence_summary")

    _PATTERN_LABELS = {
        "time_based": "Time pattern",
        "sequence": "Sequence / routine",
        "group": "Group",
    }
    lines = [f"Pattern type: {_PATTERN_LABELS.get(sug['pattern_type'], sug['pattern_type'])}"]

    if es:
        n = es.get("occurrences", "?")
        weeks = es.get("unique_weeks", "?")
        last = es.get("last_seen", "")
        last_part = f" — last seen {last}" if last else ""
        lines.append(f"Observed {n} time(s) across {weeks} week(s){last_part}")

        if es.get("time_window"):
            lines.append(
                f"Time window: {es['time_window']}  (avg {es.get('avg_time', '')})"
            )

        days = es.get("active_day_names", [])
        if days:
            lines.append(f"Active days: {', '.join(days)}")

        reversal_rate = es.get("reversal_rate", 0)
        if reversal_rate > 0:
            lines.append(f"Reversal rate: {int(reversal_rate * 100)}%  (fraction immediately undone)")

    lines += [
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
            return ok(L("Pattern analysis complete. No new suggestions at this time.",
                        "ניתוח הדפוסים הושלם. אין הצעות חדשות כרגע."))
        return ok(
            L(f"Analysis complete. {len(new)} new suggestion(s) found.",
              f"הניתוח הושלם. נמצאו {len(new)} הצעות חדשות."),
            data={"new_suggestions": new},
        )
    except Exception as e:
        return err(L(f"Pattern analysis failed: {e}", f"ניתוח הדפוסים נכשל: {e}"))


HANDLERS = {
    "list_suggestions": handle_list_suggestions,
    "accept_suggestion": handle_accept_suggestion,
    "reject_suggestion": handle_reject_suggestion,
    "snooze_suggestion": handle_snooze_suggestion,
    "explain_suggestion": handle_explain_suggestion,
    "run_pattern_analysis": handle_run_pattern_analysis,
}
