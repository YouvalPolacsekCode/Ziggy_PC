#!/usr/bin/env python3
"""Stress-test Ziggy chat's tool-routing decisions.

Sister of stress_test_chat.py — that script tests REPLY SHAPE (prose contract).
This one tests INTENT ROUTING — which tool the LLM picks for a given input,
with extra focus on Ziggy Pro Mode (design_automation_set) vs the specialized
single-purpose tools (create_automation, toggle_light, create_occupancy_sensor,
instantiate_blueprint, etc.).

Why this matters
----------------
The Pro Mode designer is invisible to users — they describe an outcome in
natural language and the LLM decides whether to:
  (a) call design_automation_set → multi-artifact preview card (Pro Mode)
  (b) call a specialized tool directly → single artifact, no preview
  (c) fall through to chat_with_gpt → conversational reply, no action

A wrong routing decision means a worse UX:
  - "make the kitchen smart" routed to create_occupancy_sensor skips the
    preview card and creates just one artifact silently.
  - "תכין לי שגרת ערב" routed to chat_with_gpt produces a conversational
    reply with no automation built.

Usage
-----
  # Against canary (default)
  python3 scripts/stress_test_pro_mode.py

  # Against local dev
  python3 scripts/stress_test_pro_mode.py --base http://127.0.0.1:8001

  # Filter to one category
  python3 scripts/stress_test_pro_mode.py --category pro_mode_en

  # Write markdown report
  python3 scripts/stress_test_pro_mode.py --report /tmp/pro_mode_report.md

  # Use a specific session token (otherwise reads from env ZIGGY_TOKEN)
  ZIGGY_TOKEN=... python3 scripts/stress_test_pro_mode.py
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field
from typing import Optional, Union


# ── Categories ───────────────────────────────────────────────────────────────
#
# pro_mode_en     — English outcome-shaped requests; SHOULD hit design_automation_set
# pro_mode_he     — Hebrew outcome-shaped requests; SHOULD hit design_automation_set
# single_en       — English single-action requests; SHOULD NOT hit Pro Mode
# single_he       — Hebrew single-action requests; SHOULD NOT hit Pro Mode
# chat_en/he      — Conversational; SHOULD fall through to chat (no automation tool)
# edge            — Gibberish, empty, mixed-language; SHOULD degrade gracefully
# ambiguous       — Could go either way; we record what happens without asserting


@dataclass
class Case:
    name: str
    category: str
    input: str
    # Expected intent(s). Either a string (exactly that), a list (any of these
    # passes), or None (no assertion — just record what happened).
    expect: Optional[Union[str, list[str]]] = None
    # Intent(s) that would be a FAILURE. Asserted only when set.
    not_expect: Optional[Union[str, list[str]]] = None
    # Optional substring that must appear in the reply text (Hebrew or English).
    expect_reply_contains: Optional[str] = None


_PRO_MODE_INTENT = "design_automation_set"


CASES: list[Case] = [
    # ── Pro Mode — English ─────────────────────────────────────────────────
    Case("EN: set up smart bedroom",      "pro_mode_en", "set up smart bedroom lights",                                  expect=_PRO_MODE_INTENT),
    Case("EN: make the kitchen smart",    "pro_mode_en", "make the kitchen smart — light on when someone is there",      expect=_PRO_MODE_INTENT),
    Case("EN: automate the office",       "pro_mode_en", "automate the office",                                          expect=_PRO_MODE_INTENT),
    Case("EN: design morning routine",    "pro_mode_en", "design a morning routine",                                     expect=_PRO_MODE_INTENT),
    Case("EN: I want bedroom to ...",     "pro_mode_en", "I want my bedroom to wake me up gently every morning",        expect=_PRO_MODE_INTENT),
    Case("EN: make living room intel.",   "pro_mode_en", "make my living room intelligent",                              expect=_PRO_MODE_INTENT),
    Case("EN: help me automate",          "pro_mode_en", "help me automate the bedroom",                                 expect=_PRO_MODE_INTENT),
    Case("EN: smart bathroom",            "pro_mode_en", "set up smart bathroom",                                        expect=_PRO_MODE_INTENT),
    Case("EN: smart routine for kitchen", "pro_mode_en", "design a smart routine for the kitchen",                       expect=_PRO_MODE_INTENT),
    Case("EN: organize automations",      "pro_mode_en", "organize the bedroom automations",                             expect=_PRO_MODE_INTENT),

    # ── Pro Mode — Hebrew ──────────────────────────────────────────────────
    Case("HE: תכין מטבח חכם",            "pro_mode_he", "תכין לי מטבח חכם",                                              expect=_PRO_MODE_INTENT),
    Case("HE: תעשה אוטומציה לחדר",       "pro_mode_he", "תעשה אוטומציה לחדר העבודה — אורות נדלקים כשמזהים תנועה",        expect=_PRO_MODE_INTENT),
    Case("HE: תארגן שגרת ערב",           "pro_mode_he", "תארגן לי שגרת ערב",                                             expect=_PRO_MODE_INTENT),
    Case("HE: הפוך חדר שינה לחכם",       "pro_mode_he", "הפוך את חדר השינה לחכם",                                        expect=_PRO_MODE_INTENT),
    Case("HE: תגדיר חדר עבודה חכם",      "pro_mode_he", "תגדיר לי חדר עבודה חכם",                                        expect=_PRO_MODE_INTENT),
    Case("HE: אני רוצה שהמטבח...",       "pro_mode_he", "אני רוצה שהמטבח יהיה חכם — אורות אוטומטיים כשמישהו נכנס",       expect=_PRO_MODE_INTENT),
    Case("HE: תכין שגרת בוקר",           "pro_mode_he", "תכין לי שגרת בוקר",                                             expect=_PRO_MODE_INTENT),
    Case("HE: תארגן אוטומציות לסלון",    "pro_mode_he", "תארגן לי את האוטומציות בסלון",                                  expect=_PRO_MODE_INTENT),

    # ── Single-action — should NOT hit Pro Mode ────────────────────────────
    Case("EN: turn off bedroom lights",   "single_en",   "turn off bedroom lights",                                      not_expect=_PRO_MODE_INTENT),
    Case("EN: set AC to 24",              "single_en",   "set AC in the bedroom to 24",                                  not_expect=_PRO_MODE_INTENT),
    Case("EN: temp in living room?",      "single_en",   "what's the temperature in the living room",                    not_expect=_PRO_MODE_INTENT),
    Case("EN: create automation explicit","single_en",   "create an automation: turn off bedroom light every day at 23:00", not_expect=_PRO_MODE_INTENT),
    Case("EN: create occupancy explicit", "single_en",   "create an occupancy sensor for the kitchen",                   expect="create_occupancy_sensor"),
    Case("EN: instantiate template",      "single_en",   "use the motion-activated light template for the bathroom",     expect="instantiate_blueprint"),

    Case("HE: כבה אורות חדר שינה",       "single_he",   "כבה את האורות בחדר השינה",                                      not_expect=_PRO_MODE_INTENT),
    Case("HE: הדלק אור מטבח",            "single_he",   "הדלק את האור במטבח",                                            not_expect=_PRO_MODE_INTENT),
    Case("HE: מה הטמפרטורה",             "single_he",   "מה הטמפרטורה בסלון",                                            not_expect=_PRO_MODE_INTENT),
    Case("HE: צור אוטומציה מפורשת",      "single_he",   "צור אוטומציה: כבה את האור בחדר השינה כל יום ב-23:00",           not_expect=_PRO_MODE_INTENT),

    # ── Chat — should fall through to chat_with_gpt ────────────────────────
    Case("EN: thanks",                    "chat_en",     "thanks",                                                       not_expect=_PRO_MODE_INTENT),
    Case("EN: what time",                 "chat_en",     "what time is it",                                              not_expect=_PRO_MODE_INTENT),
    Case("HE: תודה",                     "chat_he",     "תודה",                                                          not_expect=_PRO_MODE_INTENT),
    Case("HE: מה השעה",                  "chat_he",     "מה השעה",                                                       not_expect=_PRO_MODE_INTENT),

    # ── Edge cases — graceful degradation ──────────────────────────────────
    Case("EDGE: empty",                   "edge",        "",                                                             not_expect=_PRO_MODE_INTENT),
    Case("EDGE: only punctuation",        "edge",        "???",                                                          not_expect=_PRO_MODE_INTENT),
    Case("EDGE: single word automation",  "edge",        "automation",                                                   not_expect=_PRO_MODE_INTENT),
    Case("EDGE: gibberish",               "edge",        "asdfqwer123 zxcv",                                             not_expect=_PRO_MODE_INTENT),
    Case("EDGE: mixed lang outcome",      "edge",        "set up מטבח smart",                                            None),  # ambiguous

    # ── Ambiguous — observational, no assertion ────────────────────────────
    Case("AMB: bedroom too dark when in", "ambiguous",   "the bedroom is too dark when I come in",                       None),
    Case("AMB: fix the bedroom",          "ambiguous",   "fix the bedroom",                                              None),
    Case("AMB: lights off too fast",      "ambiguous",   "the lights keep turning off too fast",                         None),
]


# ── Runner ───────────────────────────────────────────────────────────────────


def _post(base: str, path: str, body: dict, token: str, timeout: float = 90.0) -> tuple[int, dict]:
    # Cloudflare in front of canary returns 1010 (Browser Integrity Check)
    # for the default Python-urllib UA. A browser-like UA gets through.
    req = urllib.request.Request(
        f"{base.rstrip('/')}{path}",
        method="POST",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent":    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
            "Accept":        "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {"error": "non-json error response"}
    except Exception as e:
        return 0, {"error": str(e)}


def run_case(base: str, token: str, case: Case) -> dict:
    """Send one input through /api/intent and capture the routing decision.

    NOTE: we use /api/intent rather than /api/chat because the chat endpoint
    strips the `intent` field from its response (it's meant for human-facing
    chat replies, not for tool-routing audits). The intent endpoint exposes
    the same routing decision while running through the same parser stack.
    """
    started = time.time()
    status, resp = _post(base, "/api/intent", {"text": case.input, "source": "stress_test"}, token)
    elapsed_ms = int((time.time() - started) * 1000)

    actual_intent = resp.get("intent") if isinstance(resp, dict) else None
    actual_reply  = (resp.get("reply") or "")[:200] if isinstance(resp, dict) else ""
    actual_kind   = (resp.get("data") or {}).get("kind") if isinstance(resp, dict) else None

    verdict = "pass"
    reasons: list[str] = []

    # Network / 5xx
    if status >= 500 or status == 0:
        verdict = "error"
        reasons.append(f"http {status}: {resp.get('error') or 'unknown'}")
    elif case.expect is not None:
        exp = [case.expect] if isinstance(case.expect, str) else list(case.expect)
        if actual_intent not in exp:
            verdict = "fail"
            reasons.append(f"expected intent in {exp}, got {actual_intent!r}")
    if case.not_expect is not None and verdict == "pass":
        bad = [case.not_expect] if isinstance(case.not_expect, str) else list(case.not_expect)
        if actual_intent in bad:
            verdict = "fail"
            reasons.append(f"got forbidden intent {actual_intent!r}")
    if case.expect_reply_contains and verdict == "pass":
        if case.expect_reply_contains not in actual_reply:
            verdict = "fail"
            reasons.append(f"reply missing substring {case.expect_reply_contains!r}")

    return {
        "name":           case.name,
        "category":       case.category,
        "input":          case.input,
        "status":         status,
        "actual_intent":  actual_intent,
        "actual_kind":    actual_kind,
        "actual_reply":   actual_reply,
        "verdict":        verdict,
        "reasons":        reasons,
        "elapsed_ms":     elapsed_ms,
    }


def render_markdown(results: list[dict]) -> str:
    """Markdown report grouped by category, with summary stats."""
    by_cat: dict[str, list[dict]] = {}
    for r in results:
        by_cat.setdefault(r["category"], []).append(r)

    total = len(results)
    passes = sum(1 for r in results if r["verdict"] == "pass")
    fails  = sum(1 for r in results if r["verdict"] == "fail")
    errors = sum(1 for r in results if r["verdict"] == "error")
    avg_ms = int(sum(r["elapsed_ms"] for r in results) / total) if total else 0

    out = []
    out.append("# Ziggy Pro Mode — Routing Stress Test\n")
    out.append(f"**Summary:** {passes}/{total} pass · {fails} fail · {errors} error · avg {avg_ms} ms\n")

    for cat in ("pro_mode_en", "pro_mode_he", "single_en", "single_he", "chat_en", "chat_he", "edge", "ambiguous"):
        if cat not in by_cat:
            continue
        rows = by_cat[cat]
        cat_pass = sum(1 for r in rows if r["verdict"] == "pass")
        out.append(f"\n## {cat} ({cat_pass}/{len(rows)} pass)\n")
        out.append("| # | Verdict | Input | Got intent | ms | Notes |")
        out.append("|---|---------|-------|------------|----|-------|")
        for i, r in enumerate(rows, 1):
            icon = {"pass": "✅", "fail": "❌", "error": "💥"}[r["verdict"]]
            inp = r["input"][:60].replace("|", "\\|").replace("\n", " ") or "(empty)"
            got = (r["actual_intent"] or "—").replace("|", "\\|")
            notes = "; ".join(r["reasons"]) if r["reasons"] else ""
            notes = notes[:80].replace("|", "\\|")
            out.append(f"| {i} | {icon} | `{inp}` | `{got}` | {r['elapsed_ms']} | {notes} |")
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base",     default="https://app.ziggy-home.com", help="API base URL")
    ap.add_argument("--token",    default=os.environ.get("ZIGGY_TOKEN", ""),
                    help="Session token; falls back to $ZIGGY_TOKEN")
    ap.add_argument("--category", help="Filter to one category (e.g. pro_mode_en)")
    ap.add_argument("--report",   help="Write markdown report to this path")
    ap.add_argument("--limit",    type=int, default=0, help="Cap to first N cases")
    args = ap.parse_args()

    if not args.token:
        print("ERROR: provide --token or set $ZIGGY_TOKEN", file=sys.stderr)
        return 2

    cases = CASES
    if args.category:
        cases = [c for c in cases if c.category == args.category]
    if args.limit:
        cases = cases[: args.limit]

    print(f"[stress_test] base={args.base} cases={len(cases)}", file=sys.stderr)
    results = []
    for i, c in enumerate(cases, 1):
        print(f"  [{i}/{len(cases)}] {c.category:14} {c.name[:40]:42} ", end="", file=sys.stderr, flush=True)
        r = run_case(args.base, args.token, c)
        results.append(r)
        icon = {"pass": "✅", "fail": "❌", "error": "💥"}[r["verdict"]]
        print(f"{icon} {r['elapsed_ms']:>5} ms  got={r['actual_intent']}", file=sys.stderr)
        # Small pause to not hammer OpenAI
        time.sleep(0.3)

    md = render_markdown(results)
    if args.report:
        with open(args.report, "w", encoding="utf-8") as f:
            f.write(md)
        print(f"\n[stress_test] report written to {args.report}", file=sys.stderr)
    else:
        print(md)

    # Exit non-zero if anything failed (CI-friendly)
    bad = sum(1 for r in results if r["verdict"] in ("fail", "error"))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
